/**
 * Node.js Worker Thread for ASR inference via @huggingface/transformers v3+.
 *
 * Supports two model families:
 *   - Whisper (and Distil-Whisper): batch-architected, 30s windows, slow but
 *     widely supported and multilingual.
 *   - Moonshine: streaming-architected with encoder caching + decoder state
 *     reuse, ~100× lower latency than Whisper Large v3 at comparable WER.
 *     English-only. Models load in 26–60MB quantized.
 *
 * @huggingface/transformers is ESM-only. The electron tsconfig compiles to
 * CommonJS, which means TypeScript rewrites `import()` to `require()`.
 * We bypass this by loading the package through `new Function(...)` so
 * the compiler never sees the import expression and Node.js handles it
 * natively as a true dynamic ESM import at runtime.
 */
import { parentPort } from 'worker_threads';
import { createWhisperTaskQueue } from './whisperTaskQueue';
import { WhisperProgressAggregator } from './whisperProgressAggregator';
import { downloadModelFilesResumable } from './resumableDownload';
import { getBoundedOnnxSessionOptions } from '../../utils/onnxThreadConfig';
// Shared language-capability module (also consumed by ipcHandlers for the
// Settings UI). Replaces two hand-maintained tables that had both drifted:
//  - LANG_MAP was keyed by BCP-47 tags ('en-US') while the host actually
//    sends the app's internal settings key ('english-us' — LocalWhisperSTT
//    forwards CredentialsManager.getSttLanguage() verbatim), so EVERY lookup
//    missed and multilingual Whisper silently ran in auto-detect regardless
//    of the user's language setting. resolveWhisperLanguage() accepts the
//    internal key, plus BCP-47/iso639 tags for compatibility, and covers all
//    30 RECOGNITION_LANGUAGES (the old map covered 13).
//  - ENGLISH_ONLY_MODELS was a hand-typed id list that omitted Parakeet CTC
//    (English-only per NVIDIA's model card). isEnglishOnlyLocalModel() is
//    derived from MODEL_CATALOG's own `multilingual` flag instead.
import { detectedWhisperLanguage, isEnglishOnlyLocalModel, resolveWhisperLanguage } from './modelLanguageSupport';
import { moonshineMaxNewTokens } from './moonshineTokenBudget';
import { loadedOnnxFiles, onnxDirFor } from './modelManager';

let pipe: any = null;
let loadedModelId = '';

// ── Dual-channel Nemotron (2026-08-13) ──────────────────────────────────
//
// One worker can now serve TWO channels (mic + system-audio) sharing ONE
// loaded model (one set of 3 ONNX sessions) — see
// electron/audio/whisper/nemotron/sharedWorkerRegistry.ts (main-process
// side) for how two LocalWhisperSTT instances end up pointed at the same
// worker. Worker-side, each channel gets its OWN NemotronEngine instance
// (own pendingBuffer/cacheState/decoderState/lookbackBuffer — exactly the
// per-channel isolation NemotronEngine already provided pre-dual-channel,
// unchanged), keyed by the channelId the host sends on every nemotron-rnnt
// init/transcribe/setLanguage message. Set only when sessionLayout ===
// 'nemotron-rnnt' — mutually exclusive with `pipe` above (one model loaded
// per worker).
let nemotronSharedResources: import('./nemotron/nemotronEngine').NemotronSharedResources | null = null;
const nemotronChannels = new Map<string, import('./nemotron/nemotronEngine').NemotronEngine>();

// Serializes every message that touches ONE channel's NemotronEngine mutable
// state (pendingBuffer/cacheState/decoderState/lookbackBuffer). The worker's
// `parentPort.on('message', async ...)` handler does NOT serialize
// concurrent invocations — a second message can fire while the first is
// still awaiting inside NemotronEngine.pushAudio(). Two overlapping calls for
// the SAME channel can process the same buffered audio twice, corrupting
// that channel's cache state for the rest of the segment. Keyed per
// channelId (not one module-level chain) so channel A's messages can never
// interleave with each other, but channel A's messages no longer wait behind
// channel B's — they're independent conversations sharing only the
// underlying compute, exactly like the two NemotronEngine instances
// themselves. This is the same serialization pattern the original
// single-worker fix (c69c8379) established, now keyed per channel.
const nemotronChains = new Map<string, Promise<void>>();
function getNemotronChain(channelId: string): Promise<void> {
  return nemotronChains.get(channelId) ?? Promise.resolve();
}
function setNemotronChain(channelId: string, p: Promise<void>): void {
  nemotronChains.set(channelId, p);
}

// Per-channel SEGMENT-level token accumulator (2026-08-14 code review,
// CONFIRMED finding). The host's transcript contract — inherited from how
// every other model in this catalog behaves — is that a `partial` carries
// the full segment text SO FAR and the final `result` carries the WHOLE
// segment's text: SessionTracker only commits finals (non-final segments are
// dropped at SessionTracker.addTranscript), so the `result` text IS the
// meeting transcript. Nemotron's delta-dispatch design breaks that contract
// without this accumulator: each streaming message carries only ~560ms of
// NEW audio, so a per-message decode yields only that delta's words — and
// the final message carries only the segment's last sub-560ms tail. Without
// accumulation, a 6-second sentence commits as its last word (or '') and
// the committed transcript, RAG feed, and suggestion triggers lose nearly
// everything, even though the live interim display looked plausible.
//
// Accumulating TOKEN IDS (not text) and decoding the whole sequence in one
// decodeTokens() call also fixes the chunk-boundary word-splitting artifact
// ('jump s', 'la zy'): SentencePiece pieces that straddle a chunk boundary
// only merge into one word when decoded together (see
// ChunkTranscript.tokenIds in nemotronEngine.ts).
//
// Lifecycle: cleared on nemotronReset (segment start), after every final
// `result` (segment closed), and on closeChannel.
const nemotronSegmentTokens = new Map<string, number[]>();

// Serializes the INIT sequence itself, separately from the per-channel
// transcribe/setLanguage chains above. Without this, two `init` messages
// arriving close together (the realistic case — main.ts starts both
// LocalWhisperSTT channels back-to-back at meeting start) could BOTH observe
// `nemotronSharedResources === null` and both run the full download +
// session-creation path concurrently — defeating the entire point of this
// change (one shared set of sessions) and wasting a real download+load. This
// chain guarantees the first init to arrive fully finishes (populating
// nemotronSharedResources) before a second init's body ever runs, so the
// second one reliably takes the fast, no-I/O "reuse shared sessions" path.
let nemotronInitChain: Promise<void> = Promise.resolve();

// Tokenized prompt cache — populated by `setPrompt` messages, reused by
// every subsequent transcribe. Cleared on model swap.
//
// The transcribe message handler must remain serial w.r.t. setPrompt so we
// don't read a half-updated cache; the host-side caller (LocalWhisperSTT)
// posts setPrompt via the same MessagePort which Node guarantees orders
// strictly with transcribe messages. As long as no two transcribe messages
// are in flight concurrently (the streamingTaskInFlight guard ensures this),
// the cache is consistent.
let cachedPromptText = '';
let cachedPromptIds: number[] | null = null;

// Moonshine doesn't have Whisper's prompt_ids mechanism. Detect by model id
// so we silently skip the prompt parameter for Moonshine variants.
const isMoonshineModel = (id: string) => /\/moonshine-/i.test(id);

const PROMPT_TOKEN_CAP = 224; // Whisper's prompt window per generation_whisper.js

async function updatePromptCache(promptText: string): Promise<void> {
  const trimmed = (promptText ?? '').trim();
  if (!trimmed) {
    cachedPromptText = '';
    cachedPromptIds = null;
    return;
  }
  if (trimmed === cachedPromptText && cachedPromptIds !== null) return;
  if (!pipe?.tokenizer) return; // model not yet loaded
  if (isMoonshineModel(loadedModelId)) {
    // Skip tokenization entirely for Moonshine — no prompt mechanism.
    cachedPromptText = trimmed;
    cachedPromptIds = null;
    return;
  }
  try {
    // add_special_tokens=false: Whisper inserts <|startofprev|> itself.
    const encoded = await pipe.tokenizer(trimmed, { add_special_tokens: false });
    const raw = encoded?.input_ids?.tolist?.()?.[0] ?? [];
    // Truncate from the END (keep first 224). Session-static biasing prompts
    // typically front-load the most important vocabulary (attendee names,
    // company/project names, glossary terms), so dropping the tail of less
    // important tokens preserves the user's priority order.
    cachedPromptIds = raw.slice(0, PROMPT_TOKEN_CAP).map((n: bigint | number) => {
      const v = Number(n);
      // Whisper vocab is ~50k tokens — well under 2^53 — but if a future
      // model ships sentinel ids with high bits set, fail loud rather than
      // silently bias on a precision-lost token id.
      if (!Number.isSafeInteger(v)) {
        throw new Error(`Token id ${n} exceeds Number.MAX_SAFE_INTEGER — cannot use as prompt_id`);
      }
      return v;
    });
    cachedPromptText = trimmed;
    // Non-null: assigned unconditionally just above; tsc drops the narrowing of a
    // module-level `let` across the intervening .map() callback.
    if (cachedPromptIds!.length === 0) {
      console.debug('[WhisperWorker] Prompt tokenized to 0 ids — biasing disabled');
    }
  } catch (e: any) {
    console.warn('[WhisperWorker] Prompt tokenization failed:', e.message);
    cachedPromptText = '';
    cachedPromptIds = null;
  }
}

if (!parentPort) throw new Error('whisperWorker must be run as a Worker thread');

// Loads @huggingface/transformers via a real dynamic import() at runtime.
// Using new Function prevents TypeScript from rewriting import() → require()
// in the CommonJS output, which would fail because the package is ESM-only.
async function loadTransformers(): Promise<{ pipeline: any; env: any }> {
  return (new Function('return import("@huggingface/transformers")')()) as any;
}

/**
 * Loads (first channel) or joins (every later channel) the shared Nemotron
 * model for one channelId. Never throws — always resolves, posting either a
 * `ready` or an `error` message itself, so nemotronInitChain (its only
 * caller) never sees a rejection from normal failure paths.
 */
async function initNemotronChannel(msg: any, channelId: string): Promise<void> {
  try {
    const { NemotronEngine } = require('./nemotron/nemotronEngine');
    let engine;
    if (nemotronSharedResources) {
      // A later channel joining an already-loaded worker: no I/O, no ONNX
      // session creation — just a fresh per-channel decode-state instance
      // pointed at the sessions the FIRST channel already loaded.
      engine = await NemotronEngine.create(msg.cacheDir, msg.executionProviders ?? ['cpu'], nemotronSharedResources);
    } else {
      const { downloadNemotronFiles } = require('./nemotron/downloadFiles');
      const path = require('path');
      const modelDir = path.join(msg.cacheDir, ...String(msg.modelId).split('/'));
      await downloadNemotronFiles(modelDir, (pct: number) => {
        parentPort!.postMessage({ type: 'progress', modelId: msg.modelId, progress: pct, channelId });
      });
      engine = await NemotronEngine.create(modelDir, msg.executionProviders ?? ['cpu']);
      nemotronSharedResources = engine.getSharedResources();
    }
    nemotronChannels.set(channelId, engine);
    parentPort!.postMessage({ type: 'ready', channelId });
  } catch (e: any) {
    // Must carry the same 'Failed to load model' prefix the transformers.js
    // init path below already uses — LocalWhisperSTT's `msg.type === 'error'`
    // handler only calls emit('error')/runs the corrupt-model purge when the
    // message string-matches that prefix. Without it, a Nemotron init
    // failure (including a truncated download caught by
    // downloadNemotronFiles' integrity check) silently never surfaces: no
    // emit('error'), no purge, workerReady stays false forever with zero
    // user-facing diagnostic.
    parentPort!.postMessage({ type: 'error', channelId, message: `Failed to load model: ${e?.message ?? String(e)}` });
  }
}

// ── Dual-channel Parakeet TDT (2026-09-25) ─────────────────────────────
// Either engine: ONNX Runtime on the CPU (ParakeetTdtEngine) or, on Apple
// Silicon, the Neural Engine helper (AneParakeetEngine). Both are stateless
// per call, so the worker treats them alike.
interface ParakeetChannelEngine {
  transcribe(pcm: Float32Array): Promise<{ text: string }>;
}
let parakeetSharedResources: import('./parakeet/parakeetTdtEngine').ParakeetTdtSharedResources | null = null;
// One helper process per worker, shared by its channels like the ONNX sessions.
let parakeetAneEngine: import('./parakeet/aneBackend').AneParakeetEngine | null = null;
const parakeetChannels = new Map<string, ParakeetChannelEngine>();
const parakeetChains = new Map<string, Promise<void>>();
function getParakeetChain(channelId: string): Promise<void> {
  return parakeetChains.get(channelId) ?? Promise.resolve();
}
function setParakeetChain(channelId: string, p: Promise<void>): void {
  parakeetChains.set(channelId, p);
}
let parakeetInitChain: Promise<void> = Promise.resolve();

async function initParakeetChannel(msg: any, channelId: string): Promise<void> {
  try {
    const path = require('path');
    const modelDir = path.join(msg.cacheDir, ...String(msg.modelId).split('/'));
    const onProgress = (pct: number) => {
      parentPort!.postMessage({ type: 'progress', modelId: msg.modelId, progress: pct, channelId: msg.channelId });
    };
    let engine: ParakeetChannelEngine;
    if (msg.parakeetBackend === 'coreml-ane' && msg.aneHelperPath) {
      if (!parakeetAneEngine) {
        const { AneParakeetEngine, parakeetCoreMlModelForRepo } = require('./parakeet/aneBackend');
        // sourceRepoId is the CoreML repo (see buildWorkerInitMessage); its
        // files live in that repo's own folder, beside the ONNX one.
        const found = parakeetCoreMlModelForRepo(String(msg.sourceRepoId ?? ''));
        if (!found || found.modelId !== msg.modelId) throw new Error(`${msg.modelId} has no Neural Engine build at ${msg.sourceRepoId}`);
        const { downloadParakeetFiles } = require('./parakeet/downloadFiles');
        const coremlDir = path.join(msg.cacheDir, ...String(msg.sourceRepoId).split('/'));
        const model = found.model;
        await downloadParakeetFiles(coremlDir, model.download, onProgress);
        parakeetAneEngine = await AneParakeetEngine.create(msg.aneHelperPath, coremlDir, model.version, {
          // The helper is this worker's engine. If it dies mid-session, end the
          // worker too, so the host's existing crash handling (error event,
          // recovery, reload on the next start) runs instead of every later
          // request failing quietly.
          onUnexpectedExit: (error: Error) => {
            parentPort!.postMessage({ type: 'error', message: `Parakeet Neural Engine helper stopped: ${error.message}` });
            process.exit(1);
          },
        });
      }
      engine = parakeetAneEngine!;
    } else if (parakeetSharedResources) {
      const { ParakeetTdtEngine } = require('./parakeet/parakeetTdtEngine');
      engine = await ParakeetTdtEngine.create(msg.cacheDir, msg.executionProviders ?? ['cpu'], parakeetSharedResources);
    } else {
      const { ParakeetTdtEngine } = require('./parakeet/parakeetTdtEngine');
      const { downloadParakeetTdtFiles } = require('./parakeet/downloadFiles');
      await downloadParakeetTdtFiles(modelDir, onProgress, msg.modelId);
      const onnxEngine = await ParakeetTdtEngine.create(modelDir, msg.executionProviders ?? ['cpu']);
      parakeetSharedResources = onnxEngine.getSharedResources();
      engine = onnxEngine;
    }
    parakeetChannels.set(channelId, engine);
    loadedModelId = msg.modelId;
    parentPort!.postMessage({ type: 'ready', channelId: msg.channelId });
  } catch (e: any) {
    parentPort!.postMessage({ type: 'error', channelId: msg.channelId, message: `Failed to load model: ${e?.message ?? String(e)}` });
  }
}

parentPort.on('message', async (msg: any) => {
  if (msg.type === 'shutdown') {
    // Cooperative stop — see electron/utils/onnxWorkerShutdown.ts. The host
    // never calls worker.terminate() on this worker: doing that while an ONNX
    // run() or session load is on this thread aborts the whole app. A message
    // is only delivered when this thread is idle, so no native call is in
    // flight here, and process.exit() in a worker thread stops this thread
    // only. Work still queued behind this message is abandoned on purpose —
    // the host has already stopped listening for it.
    // The Neural Engine helper would also exit on its own when this thread's
    // pipes close; disposing it first makes that immediate.
    parakeetAneEngine?.dispose();
    process.exit(0);
  }
  if (msg.type === 'init') {
    if (msg.sessionLayout === 'nemotron-rnnt') {
      const channelId: string | undefined = msg.channelId;
      if (!channelId) {
        // Defensive: every real caller (sharedWorkerRegistry.ts) always sets
        // this. Fail loud rather than silently keying state off `undefined`,
        // which would let a second real channel collide with a malformed one.
        // `channelId: msg.channelId` is included for shape-consistency with
        // every other error this worker posts in the nemotron-rnnt init path
        // (see initNemotronChannel's catch) — it's `undefined` here by
        // definition of this branch, so it does NOT by itself make
        // sharedWorkerRegistry.ts's own listener (which only reacts when
        // `msg.channelId` is truthy) treat this as a rejection; that
        // listener still won't see this message. This case remains
        // unreachable in real production traffic (see above), so it's
        // acceptable for it to surface only via the caller-side promise
        // machinery rather than a registry-side reject.
        parentPort!.postMessage({ type: 'error', channelId: msg.channelId, message: 'Failed to load model: init.channelId is required for sessionLayout "nemotron-rnnt"' });
        return;
      }
      // Chained (not awaited here — the outer message handler doesn't await
      // its own return value either way, matching the existing
      // transcribe/setLanguage chaining convention below) so a second init
      // arriving while the first is still mid-download/mid-session-creation
      // reliably waits for `nemotronSharedResources` to actually be populated
      // before deciding which path to take. See nemotronInitChain's own doc
      // comment above for why this race is real, not hypothetical.
      nemotronInitChain = nemotronInitChain.then(() => initNemotronChannel(msg, channelId)).catch((chainErr) => {
        // Unreachable in practice — initNemotronChannel has its own
        // try/catch and never rethrows — but guards the chain itself so one
        // truly unexpected throw can't permanently wedge every future
        // channel's init behind a rejected promise.
        console.error('[WhisperWorker] nemotron init chain error (should be unreachable):', chainErr);
      });
      return; // do not fall through to the transformers.js pipeline() path below
    }
    if (msg.sessionLayout === 'parakeet-tdt') {
      const channelId: string = msg.channelId || 'default';
      parakeetInitChain = parakeetInitChain.then(() => initParakeetChannel(msg, channelId)).catch((chainErr) => {
        console.error('[WhisperWorker] parakeet init chain error (should be unreachable):', chainErr);
      });
      return;
    }
    // Validate required fields BEFORE entering the try/catch so the error
    // surfaces as a structured `error` postMessage rather than an unhandled
    // worker throw (which would leave the host's workerReady stuck false).
    if (msg.dtype === undefined || msg.dtype === null) {
      parentPort!.postMessage({
        type: 'error',
        message: 'init.dtype is required (use resolveInferenceConfig().dtype)',
      });
      return;
    }
    try {
      const { pipeline, env } = await loadTransformers();

      env.cacheDir = msg.cacheDir;
      env.allowRemoteModels = true;

      // This path runs on the CPU, on every platform, and says so.
      //
      // It used to set `env.backends.onnx.executionProviders` to the host's
      // list (['coreml','cpu'] on Apple Silicon, ['dml','cpu'] on Windows) and
      // log "providers=coreml,cpu". transformers.js 3.x never reads that
      // field: it derives the providers from the pipeline's `device` option,
      // which defaults to 'cpu' under Node, and only fills
      // session_options.executionProviders when it is absent. No `device` was
      // ever passed, so every Whisper, Distil-Whisper and Moonshine session
      // has always been CPU — while the log and the Settings copy claimed the
      // GPU.
      //
      // The dead assignment is removed rather than "fixed" by wiring the
      // accelerator in, because the one measurement there is says not to:
      // Moonshine Base, M4 MacBook Air, 2026-10-14, 2.46 s clip, median of 3 —
      //   cpu          load  533ms   infer 174ms
      //   coreml+cpu   load 1126ms   infer 289ms
      // (the same direction as the Nemotron and Parakeet numbers in
      // inferenceConfig.ts). DirectML has never been measured for these models
      // at all. Turning either on is a change to make with numbers, per model.
      const providers: string[] = ['cpu'];
      // Per-module dtype: required. @huggingface/transformers v3 no longer
      // honors the v2 `quantized: true` flag — must use `dtype` explicitly.
      const dtype: string | Record<string, string> = msg.dtype;
      // Sort entries for deterministic log output across runs.
      const dtypeDesc = typeof dtype === 'string'
        ? dtype
        : 'mixed:' + Object.entries(dtype).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(',');
      // Whisper and Distil-Whisper get more than one intra-op thread (the host
      // decides, see OnnxWorkload 'whisper-encode'); every other model keeps
      // the shared default.
      const intraOpThreads = Number(msg.intraOpThreads);
      const sessionOptions = Number.isInteger(intraOpThreads) && intraOpThreads > 0
        ? { ...getBoundedOnnxSessionOptions(), intraOpNumThreads: intraOpThreads }
        : getBoundedOnnxSessionOptions();
      // The files may come from a different repo than the id Settings stores
      // (see WhisperModelInfo.repoId). Progress and errors still say modelId.
      const sourceRepoId: string = typeof msg.sourceRepoId === 'string' && msg.sourceRepoId ? msg.sourceRepoId : msg.modelId;

      console.log(`[WhisperWorker] Loading ${msg.modelId}${sourceRepoId !== msg.modelId ? ` from ${sourceRepoId}` : ''} | providers=${providers.join(',')} | dtype=${dtypeDesc} | threads=${sessionOptions.intraOpNumThreads}`);

      // DIAGNOSTICS (2026-06-13): the model files load fine in isolation (raw ORT +
      // transformers, both in system node), yet the live worker can fail with
      // "Protobuf parsing failed". Log the exact runtime view so the failing GUI run
      // prints precisely WHY — cacheDir, resolved file paths + sizes, ORT backend, and
      // the ORT version transformers actually bound. Cheap, init-only (not per-token).
      try {
        const _fs = require('fs');
        const _path = require('path');
        const _modelDir = onnxDirFor(String(msg.cacheDir), String(sourceRepoId));
        const _stat = (p: string) => { try { return _fs.statSync(p).size; } catch { return -1; } };
        // Bytes per file transformers.js will load, -1 when missing.
        const _files = Object.fromEntries(
          loadedOnnxFiles(dtype, msg.useExternalDataFormat, msg.sessionLayout).map(f => [f, _stat(_path.join(_modelDir, f))]),
        );
        let _ortVer = 'unknown';
        try { _ortVer = require('onnxruntime-node/package.json').version; } catch { /* bundled? */ }
        console.log('[WhisperWorker][diag]', JSON.stringify({
          cacheDir: String(msg.cacheDir),
          modelDir: _modelDir,
          modelDirExists: _fs.existsSync(_modelDir),
          files: _files,
          providers, dtype: dtypeDesc,
          sessionOptions,
          ortNodeVersion: _ortVer,
          ortBackend: (env.backends?.onnx ? Object.keys(env.backends.onnx) : []),
          execEnv: { execPath: process.execPath, nodeVer: process.version, modules: process.versions.modules, electron: process.versions.electron || 'n/a' },
        }));
      } catch (diagErr: any) {
        console.log('[WhisperWorker][diag] diagnostics failed (non-fatal):', diagErr?.message);
      }

      // HF Transformers fires progress_callback per *file* (encoder, decoder,
      // tokenizer, config…). The raw `data.progress` is per-file 0..100, which
      // makes a model-level bar bounce around (3 → 2 → 100 → 5 → …) as files
      // start, complete, and new ones enter the stream. The byte-weighted
      // aggregation that turns those per-file events into a smooth model-level
      // percentage lives in whisperProgressAggregator.ts (pure + unit-tested);
      // see that file for the full rationale on why count-averaging produced
      // the old "jumps to ~80% then stalls" bug.
      //
      // expectedBytes = catalog download size, the denominator from byte zero.
      // 0 when unknown / lookup failed → the aggregator falls back to observed
      // file totals. The constructor sanitizes any non-finite/negative value.
      const aggregator = new WhisperProgressAggregator(Number(msg.expectedBytes));
      // External-data format: forwarded only when the catalog declares it (for
      // checkpoints whose config.json omits it, e.g. Whisper Large v3 Turbo).
      // When undefined, transformers falls back to the model's own config —
      // preserving prior behaviour for every self-declaring model. Without this
      // the sibling `*.onnx_data` weight file is never fetched and ORT aborts:
      // "filesystem error: in file_size: ... encoder_model.onnx_data".
      const useExternalDataFormat: boolean | Record<string, boolean> | undefined =
        msg.useExternalDataFormat;
      // Not installed yet: fetch the large files with resume first, so a
      // dropped connection costs the bytes since the drop, not the whole file.
      // pipeline() then finds them in its cache and fetches only the small ones.
      const resumableFiles: string[] = Array.isArray(msg.resumableFiles) ? msg.resumableFiles : [];
      if (resumableFiles.length > 0) {
        let lastPct = -1;
        let lastPostAt = 0;
        await downloadModelFilesResumable({
          cacheDir: msg.cacheDir,
          repo: sourceRepoId,
          files: resumableFiles,
          onProgress: (event) => {
            const { pct } = aggregator.update(event);
            if (pct === null) return;
            // One message per step, not per network chunk; but also one every
            // few seconds while bytes keep arriving, so a meeting waiting on a
            // big model on a slow line (Turbo: ~28 MB per step) sees it moving.
            const now = Date.now();
            if (pct === lastPct && now - lastPostAt < 3000) return;
            lastPct = pct;
            lastPostAt = now;
            parentPort!.postMessage({ type: 'progress', modelId: msg.modelId, progress: pct });
          },
        });
      }
      pipe = await pipeline('automatic-speech-recognition', sourceRepoId, {
        dtype,
        session_options: sessionOptions,
        ...(useExternalDataFormat !== undefined
          ? { use_external_data_format: useExternalDataFormat }
          : {}),
        progress_callback: (data: any) => {
          const { pct } = aggregator.update(data);
          if (pct === null) return;
          parentPort!.postMessage({
            type: 'progress',
            modelId: msg.modelId,
            progress: pct,
          });
        },
      });
      loadedModelId = msg.modelId;
      // New model = stale prompt cache (different tokenizer vocab)
      cachedPromptText = '';
      cachedPromptIds = null;
      autoLanguage = null;

      parentPort!.postMessage({ type: 'ready' });
    } catch (e: any) {
      // Full failure dump (2026-06-13 diag): the error message alone ("Protobuf
      // parsing failed") doesn't say WHICH file or WHY. Log the full error, stack,
      // and any ORT-specific cause so the failing GUI run is self-diagnosing.
      try {
        console.error('[WhisperWorker][diag] MODEL LOAD FAILED:', {
          modelId: msg.modelId,
          message: e?.message,
          name: e?.name,
          code: e?.code,
          cause: e?.cause ? String(e.cause).slice(0, 300) : undefined,
          stackHead: String(e?.stack || '').split('\n').slice(0, 5).join(' | '),
        });
      } catch { /* noop */ }
      parentPort!.postMessage({
        type: 'error',
        message: `Failed to load model: ${e.message}`,
      });
    }
  } else if (msg.type === 'closeChannel') {
    // Dual-channel Nemotron only. Drop this channel's engine + serialization
    // chain from the worker's bookkeeping. Deliberately NOT chained onto
    // nemotronChains — a transcribe already in flight for this channel keeps
    // its own captured `engine` reference (see below) and finishes normally;
    // this just stops the worker from tracking the channel going forward.
    // Whether the underlying worker process itself terminates is a
    // main-side (sharedWorkerRegistry.ts) refcount decision, not this
    // worker's — the shared ONNX sessions and any OTHER live channel are
    // completely unaffected.
    if (msg.channelId) {
      nemotronChannels.delete(msg.channelId);
      nemotronChains.delete(msg.channelId);
      nemotronSegmentTokens.delete(msg.channelId);
      parakeetChannels.delete(msg.channelId);
      parakeetChains.delete(msg.channelId);
    }
    return;
  } else if (msg.type === 'setPrompt') {
    await updatePromptCache(msg.prompt);
  } else if (msg.type === 'setLanguage') {
    // nemotron-rnnt only — silently ignored (no-op) for the transformers.js
    // pipeline() path (and for an unrecognized/absent channelId), same
    // convention as `nemotronReset` on 'transcribe'. langId is already
    // resolved + fail-closed-checked host-side (see
    // LocalWhisperSTT.resolveAndApplyNemotronLanguage / languageTable.ts) —
    // the worker just forwards it.
    //
    // Chained onto THIS channel's own chain (cheap and correct to order it
    // through the same queue) so a language change can never apply mid-way
    // through an in-flight chunk's processing for that channel — it always
    // lands strictly between two of that channel's own transcribe messages,
    // never inside one, and never waits behind the OTHER channel's chunks.
    const channelId: string | undefined = msg.channelId;
    const engine = channelId ? nemotronChannels.get(channelId) : undefined;
    if (engine) {
      setNemotronChain(channelId!, getNemotronChain(channelId!).then(() => {
        engine.setLanguage(msg.langId);
      }).catch((chainErr) => {
        // A rejection escaping the .then() above (should not happen — this
        // closure can't throw) must not permanently wedge every future
        // message behind a rejected promise — log and let the chain continue.
        console.error('[WhisperWorker] nemotron chain error (should be unreachable):', chainErr);
      }));
      return;
    }
    const parakeetChannelKey = channelId || 'default';
    const parakeet = parakeetChannels.get(parakeetChannelKey) ?? (parakeetChannels.size === 1 ? parakeetChannels.values().next().value : undefined);
    if (parakeet && msg.language && msg.language !== 'auto') {
      const { RECOGNITION_LANGUAGES } = require('../../config/languages');
      const langEntry = RECOGNITION_LANGUAGES[msg.language];
      const iso = langEntry?.iso639 || String(msg.language).split('-')[0].toLowerCase();
      const { PARAKEET_TDT_SUPPORTED_ISO639 } = require('./modelLanguageSupport');
      if (iso && !PARAKEET_TDT_SUPPORTED_ISO639.has(iso)) {
        console.warn(`[WhisperWorker] Parakeet TDT language warning: "${msg.language}" (${iso}) is not in 25 supported European languages`);
      }
    }
    return;
  } else if (msg.type === 'transcribe') {
    const channelId: string | undefined = msg.channelId;
    const engine = channelId ? nemotronChannels.get(channelId) : undefined;
    if (engine) {
      setNemotronChain(channelId!, getNemotronChain(channelId!).then(async () => {
        try {
          if (msg.nemotronReset) {
            engine.reset();
            // Segment boundary: the accumulated tokens belong to the PREVIOUS
            // segment (whose final already decoded-and-cleared them, or which
            // was abandoned via a host-side cursor rewind) — never let them
            // leak into this segment's transcript.
            nemotronSegmentTokens.delete(channelId!);
          }
          const results = await engine.pushAudio(msg.audio);
          if (!msg.streaming) {
            // Final pass: decode whatever's left in the < CHUNK_SAMPLES tail
            // buffer (zero-padded) instead of silently dropping the last partial
            // chunk of the segment. Streaming (partial) passes intentionally
            // leave it buffered for the next pushAudio() call to complete.
            const tail = await engine.flush();
            if (tail) results.push(tail);
          }
          // Accumulate this message's token ids onto the SEGMENT accumulator
          // and decode the whole segment in one pass — see
          // nemotronSegmentTokens' doc comment for why per-message text (the
          // old `results.map(r => r.text).join(' ')`) silently lost almost
          // the entire committed transcript, and why ids (not text) must be
          // what accumulates.
          const acc = nemotronSegmentTokens.get(channelId!) ?? [];
          for (const r of results) acc.push(...r.tokenIds);
          const text = engine.decodeTokens(acc).trim();
          if (msg.streaming) {
            // Partial: full segment text SO FAR — matching every other
            // model's partial semantics (the host displays it as the live
            // interim line and dedupes unchanged repeats).
            nemotronSegmentTokens.set(channelId!, acc);
            parentPort!.postMessage({ type: 'partial', taskId: msg.taskId, channelId, text });
          } else {
            // Final: the WHOLE segment's text. Segment is closed — clear the
            // accumulator so the next segment starts clean even if its first
            // message somehow arrives without nemotronReset.
            nemotronSegmentTokens.delete(channelId!);
            parentPort!.postMessage({ type: 'result', taskId: msg.taskId, channelId, text });
          }
        } catch (e: any) {
          parentPort!.postMessage({ type: 'error', taskId: msg.taskId, channelId, message: e?.message ?? String(e) });
        }
      }).catch((chainErr) => {
        // A rejection escaping the .then() above (should not happen given
        // the try/catch inside it, but guards the chain itself) must not
        // permanently wedge every future message behind a rejected
        // promise — log and let the chain continue.
        console.error('[WhisperWorker] nemotron chain error (should be unreachable):', chainErr);
      }));
      return;
    }
    const parakeetChannelKey = channelId || 'default';
    const parakeetEngine = parakeetChannels.get(parakeetChannelKey) ?? (parakeetChannels.size === 1 ? parakeetChannels.values().next().value : undefined);
    if (parakeetEngine) {
      setParakeetChain(parakeetChannelKey, getParakeetChain(parakeetChannelKey).then(async () => {
        try {
          if (msg.language && msg.language !== 'auto') {
            const { RECOGNITION_LANGUAGES } = require('../../config/languages');
            const langEntry = RECOGNITION_LANGUAGES[msg.language];
            const iso = langEntry?.iso639 || String(msg.language).split('-')[0].toLowerCase();
            const { PARAKEET_TDT_SUPPORTED_ISO639 } = require('./modelLanguageSupport');
            if (iso && !PARAKEET_TDT_SUPPORTED_ISO639.has(iso)) {
              console.warn(`[WhisperWorker] Parakeet TDT does not support language "${msg.language}" (${iso}) — defaulting to European multilingual recognition`);
            }
          }
          const res = await parakeetEngine.transcribe(msg.audio);
          parentPort!.postMessage({
            type: msg.streaming ? 'partial' : 'result',
            taskId: msg.taskId,
            channelId: msg.channelId,
            text: res.text,
          });
        } catch (e: any) {
          parentPort!.postMessage({
            type: 'error',
            taskId: msg.taskId,
            channelId: msg.channelId,
            message: e?.message ?? String(e),
          });
        }
      }).catch((chainErr) => {
        console.error('[WhisperWorker] parakeet chain error (should be unreachable):', chainErr);
      }));
      return;
    }
    if (!pipe) {
      parentPort!.postMessage({ type: 'error', message: 'Model not loaded' });
      return;
    }
    whisperQueue.push(msg);
  }
});

// Whisper / Moonshine: one pass at a time, finals first (whisperTaskQueue.ts).
const whisperQueue = createWhisperTaskQueue<any>({
  run: runWhisperTranscribe,
  // Answered so the host stops waiting on it; it shows no text.
  skip: (msg) => parentPort!.postMessage({ type: 'partial', taskId: msg.taskId, text: '', skipped: true }),
  behind: (waitedMs) => parentPort!.postMessage({ type: 'behind', waitedMs }),
});

// "Auto Detect" on a multilingual Whisper. Left to transformers.js 3.8.1 a null
// language is transcribed as English (it has no detection), so French speech
// came back as English sentences (2026-10-21).
//
// Every final is checked, so a meeting that changes language follows it. The
// check runs the encoder once and the transcription reuses that output
// (encoder_outputs), so it costs one decoder step, not a second encoder pass.
// Partials use the language of the last final. An unsure guess keeps the
// language before it: under 50%, or under 80% on a clip shorter than 1.5 s.
let autoLanguage: string | null = null;
const AUTO_LANGUAGE_MIN_SAMPLES = 16000 * 1.5;

// Both steps use transformers.js internals (the version is pinned exactly in
// package.json and WhisperInternalsContract2026_10_21.test.mjs checks them).
// If one still fails three finals in a row it is switched off for the
// session: every final would otherwise pay for a failed attempt first.
const INTERNALS_FAILURE_LIMIT = 3;
const internalsFailures = { detect: 0, reuse: 0 };
function internalsUsable(step: 'detect' | 'reuse'): boolean {
  return internalsFailures[step] < INTERNALS_FAILURE_LIMIT;
}
function internalsResult(step: 'detect' | 'reuse', ok: boolean, e?: any): void {
  if (ok) {
    internalsFailures[step] = 0;
    return;
  }
  internalsFailures[step] += 1;
  if (internalsFailures[step] === INTERNALS_FAILURE_LIMIT) {
    console.warn(`[WhisperWorker] ${step === 'detect' ? 'Auto Detect' : 'Reusing the encoder output'} failed ${INTERNALS_FAILURE_LIMIT} times in a row, off until restart:`, e?.message ?? e);
  }
}

function acceptsAutoLanguage(guess: { probability: number } | null, samples: number): boolean {
  if (!guess) return false;
  if (!autoLanguage) return true;
  return guess.probability >= (samples >= AUTO_LANGUAGE_MIN_SAMPLES ? 0.5 : 0.8);
}

async function detectAutoLanguage(audio: Float32Array): Promise<{ language: string | null; encoderOutputs: any }> {
  const model = pipe?.model;
  const config = model?.generation_config;
  const langToId = config?.lang_to_id;
  const sot = config?.decoder_start_token_id;
  if (!langToId || sot == null || !pipe.processor || typeof model._prepare_encoder_decoder_kwargs_for_generation !== 'function') {
    return { language: autoLanguage, encoderOutputs: null };
  }
  const { Tensor } = await loadTransformers() as any;
  const { input_features } = await pipe.processor(audio);
  const { encoder_outputs } = await model._prepare_encoder_decoder_kwargs_for_generation({
    inputs_tensor: input_features,
    model_inputs: { input_features },
    model_input_name: 'input_features',
    generation_config: {},
  });
  const out = await model({
    encoder_outputs,
    decoder_input_ids: new Tensor('int64', BigInt64Array.from([BigInt(sot)]), [1, 1]),
  });
  const guess = detectedWhisperLanguage(out.logits.data, langToId);
  if (acceptsAutoLanguage(guess, audio.length) && guess!.language !== autoLanguage) {
    console.log(`[WhisperWorker] Auto Detect: ${guess!.language} (${Math.round(guess!.probability * 100)}%, was ${autoLanguage ?? 'none'}, ${loadedModelId})`);
    autoLanguage = guess!.language;
  }
  return { language: autoLanguage, encoderOutputs: encoder_outputs };
}

// WhisperPreTrainedModel.forward_params leaves out encoder_outputs, so
// generate() would drop it and run the encoder again. With it listed,
// generate() skips the encoder ("if (!('encoder_outputs' in model_inputs))").
function letGenerateReuseEncoderOutputs(model: any): boolean {
  if (!Array.isArray(model?.forward_params)) return false;
  if (!model.forward_params.includes('encoder_outputs')) model.forward_params = [...model.forward_params, 'encoder_outputs'];
  return true;
}

async function runWhisperTranscribe(msg: any): Promise<void> {
  if (!pipe) {
    parentPort!.postMessage({ type: 'error', taskId: msg.taskId, message: 'Model not loaded' });
    return;
  }
  try {
    let language: string | null = resolveWhisperLanguage(msg.language);
    const streaming: boolean = !!msg.streaming;

    // English-only checkpoints (Distil-Whisper + .en variants) have no
    // multilingual decoder — and transformers.js REJECTS the decoder-prompt
    // options for them outright. From the installed library source:
    //
    //   if (e.is_multilingual) { …lang_to_id / task_to_id… }
    //   else if (s || r) throw new Error(
    //     "Cannot specify `task` or `language` for an English-only model…")
    //
    // where s = generationConfig.language and r = generationConfig.task. So
    // BOTH must be omitted, not just one, and this block previously did the
    // exact opposite: it FORCED language='english' on precisely the models
    // that forbid it. Every transcription then threw, and because the
    // streaming loop re-dispatches per audio window the failure repeated
    // once per chunk — 15,733 identical errors across three days in the
    // 2026-08-12 production log (10,183 of them in a single day), with the
    // user's local STT silently producing nothing the whole time.
    //
    // Omitting them is not a downgrade: an English-only checkpoint can only
    // transcribe, and only in English, so there is nothing left to express.
    //
    // Derived from MODEL_CATALOG's `multilingual` flag (modelLanguageSupport)
    // rather than the previous hand-typed id set, which omitted Parakeet CTC
    // — English-only per NVIDIA's model card, and a CTC pipeline with no
    // decoder prompt to condition anyway.
    let encoderOutputs: any = null;
    const isEnglishOnly = isEnglishOnlyLocalModel(loadedModelId);
    if (isEnglishOnly) {
      language = null;
    } else if (!language && !isMoonshineModel(loadedModelId)) {
      if (streaming) {
        language = autoLanguage;
      } else if (internalsUsable('detect')) {
        try {
          ({ language, encoderOutputs } = await detectAutoLanguage(msg.audio));
          internalsResult('detect', true);
        } catch (e: any) {
          console.warn('[WhisperWorker] Auto Detect failed, keeping the last language:', e?.message ?? e);
          internalsResult('detect', false, e);
          language = autoLanguage;
        }
      } else {
        language = autoLanguage;
      }
    }

    // Streaming partial passes use deterministic settings so consecutive
    // overlapping windows are stable enough for LocalAgreement-2 to
    // converge on a committed prefix. Final passes also disable
    // condition_on_previous_text + add Whisper's standard fallback
    // thresholds to suppress repetition loops on long segments.
    const opts: any = streaming
      ? {
          sampling_rate: 16000,
          task: 'transcribe',
          temperature: 0,
          no_speech_threshold: 0.6,
          // Whisper's anti-loop check — drops outputs whose token gzip
          // ratio exceeds 2.4 (typical of "thank you. thank you. thank
          // you..." hallucinations on near-silent windows). Final pass
          // uses the same threshold; streaming should match for
          // consistency in what reaches the user.
          compression_ratio_threshold: 2.4,
          condition_on_previous_text: false,
          return_timestamps: false,
        }
      : {
          sampling_rate: 16000,
          task: 'transcribe',
          condition_on_previous_text: false,
          compression_ratio_threshold: 2.4,
          logprob_threshold: -1.0,
          no_speech_threshold: 0.6,
        };
    // `task` is set unconditionally in BOTH opts branches above, so an
    // English-only model must have it stripped here — fixing only the
    // `language` line would still throw on `task`.
    if (isEnglishOnly) {
      delete opts.task;
    } else if (language) {
      opts.language = language;
    }

    // Use the pre-tokenized prompt cache populated by setPrompt messages.
    // Skip for Moonshine (cached IDs are null in that case anyway).
    if (cachedPromptIds && cachedPromptIds.length > 0 && !isMoonshineModel(loadedModelId)) {
      opts.prompt_ids = cachedPromptIds;
    }

    // Moonshine: set the token budget ourselves. Left to the library it is
    // floor(whole seconds) * 6, which is ZERO for anything under a second —
    // see moonshineTokenBudget.ts. msg.audio is already 16 kHz mono (the
    // host resamples before posting).
    if (isMoonshineModel(loadedModelId)) {
      opts.max_new_tokens = moonshineMaxNewTokens(msg.audio?.length ?? 0, 16000);
    }

    let result: any;
    if (encoderOutputs && internalsUsable('reuse') && letGenerateReuseEncoderOutputs(pipe.model)) {
      try {
        result = await pipe(msg.audio, { ...opts, encoder_outputs: encoderOutputs });
        internalsResult('reuse', true);
      } catch (e: any) {
        console.warn('[WhisperWorker] Reusing the encoder output failed, running it again:', e?.message ?? e);
        internalsResult('reuse', false, e);
        result = await pipe(msg.audio, opts);
      }
    } else {
      result = await pipe(msg.audio, opts);
    }
    parentPort!.postMessage({
      type: streaming ? 'partial' : 'result',
      taskId: msg.taskId,
      text: result.text ?? '',
    });
  } catch (e: any) {
    parentPort!.postMessage({
      type: 'error',
      taskId: msg.taskId,
      message: `Transcription failed: ${e.message}`,
    });
  }
}
