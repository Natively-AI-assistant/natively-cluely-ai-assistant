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
import { WhisperProgressAggregator } from './whisperProgressAggregator';
import { getBoundedOnnxSessionOptions } from '../../utils/onnxThreadConfig';

const LANG_MAP: Record<string, string | null> = {
  'auto': null,
  'en-US': 'english',
  'en-GB': 'english',
  'fr-FR': 'french',
  'de-DE': 'german',
  'es-ES': 'spanish',
  'ja-JP': 'japanese',
  'ko-KR': 'korean',
  'zh-CN': 'chinese',
  'zh-TW': 'chinese',
  'pt-BR': 'portuguese',
  'it-IT': 'italian',
  'ru-RU': 'russian',
  'ar': 'arabic',
  'hi-IN': 'hindi',
};

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
    if (cachedPromptIds.length === 0) {
      console.debug('[WhisperWorker] Prompt tokenized to 0 ids — biasing disabled');
    }
  } catch (e: any) {
    console.warn('[WhisperWorker] Prompt tokenization failed:', e.message);
    cachedPromptText = '';
    cachedPromptIds = null;
  }
}

// Distil-Whisper checkpoints have NO multilingual decoder. If the user picks
// 'auto' or any non-English language, the worker will silently transcribe
// non-English audio as phonetic English. Force language='english' so the
// behaviour is at least documented and consistent.
const ENGLISH_ONLY_MODELS = new Set([
  // Moonshine — English-only by design
  'onnx-community/moonshine-tiny-ONNX',
  'onnx-community/moonshine-base-ONNX',
  // Distil-Whisper — English-only checkpoints
  'distil-whisper/distil-small.en',
  'distil-whisper/distil-medium.en',
  'distil-whisper/distil-large-v2',
  'distil-whisper/distil-large-v3',
  // Whisper .en variants
  'Xenova/whisper-tiny.en',
  'Xenova/whisper-base.en',
  'Xenova/whisper-small.en',
  'Xenova/whisper-medium.en',
]);

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

parentPort.on('message', async (msg: any) => {
  if (msg.type === 'init') {
    if (msg.sessionLayout === 'nemotron-rnnt') {
      const channelId: string | undefined = msg.channelId;
      if (!channelId) {
        // Defensive: every real caller (sharedWorkerRegistry.ts) always sets
        // this. Fail loud rather than silently keying state off `undefined`,
        // which would let a second real channel collide with a malformed one.
        parentPort!.postMessage({ type: 'error', message: 'Failed to load model: init.channelId is required for sessionLayout "nemotron-rnnt"' });
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

      // Apply hardware-specific execution providers (CoreML, DirectML, CUDA, CPU)
      const providers: string[] = msg.executionProviders ?? ['cpu'];
      if (env.backends?.onnx) {
        env.backends.onnx.executionProviders = providers;
      }
      // Per-module dtype: required. @huggingface/transformers v3 no longer
      // honors the v2 `quantized: true` flag — must use `dtype` explicitly.
      const dtype: string | Record<string, string> = msg.dtype;
      // Sort entries for deterministic log output across runs.
      const dtypeDesc = typeof dtype === 'string'
        ? dtype
        : 'mixed:' + Object.entries(dtype).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(',');
      const sessionOptions = getBoundedOnnxSessionOptions();

      console.log(`[WhisperWorker] Loading ${msg.modelId} | providers=${providers.join(',')} | dtype=${dtypeDesc}`);

      // DIAGNOSTICS (2026-06-13): the model files load fine in isolation (raw ORT +
      // transformers, both in system node), yet the live worker can fail with
      // "Protobuf parsing failed". Log the exact runtime view so the failing GUI run
      // prints precisely WHY — cacheDir, resolved file paths + sizes, ORT backend, and
      // the ORT version transformers actually bound. Cheap, init-only (not per-token).
      try {
        const _fs = require('fs');
        const _path = require('path');
        const _orgName = String(msg.modelId).split('/');
        const _modelDir = _path.join(String(msg.cacheDir), _orgName[0] || '', _orgName[1] || '', 'onnx');
        const _encName = typeof dtype === 'string' && dtype !== 'fp32' ? `encoder_model_${dtype}.onnx` : 'encoder_model.onnx';
        const _decName = typeof dtype === 'string' && dtype !== 'fp32' ? `decoder_model_merged_${dtype}.onnx` : 'decoder_model_merged.onnx';
        const _stat = (p: string) => { try { return _fs.statSync(p).size; } catch { return -1; } };
        let _ortVer = 'unknown';
        try { _ortVer = require('onnxruntime-node/package.json').version; } catch { /* bundled? */ }
        console.log('[WhisperWorker][diag]', JSON.stringify({
          cacheDir: String(msg.cacheDir),
          modelDir: _modelDir,
          modelDirExists: _fs.existsSync(_modelDir),
          encoderFile: _encName, encoderBytes: _stat(_path.join(_modelDir, _encName)),
          decoderFile: _decName, decoderBytes: _stat(_path.join(_modelDir, _decName)),
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
      pipe = await pipeline('automatic-speech-recognition', msg.modelId, {
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
    }
    return;
  } else if (msg.type === 'transcribe') {
    const channelId: string | undefined = msg.channelId;
    const engine = channelId ? nemotronChannels.get(channelId) : undefined;
    if (engine) {
      setNemotronChain(channelId!, getNemotronChain(channelId!).then(async () => {
        try {
          if (msg.nemotronReset) engine.reset();
          const results = await engine.pushAudio(msg.audio);
          if (!msg.streaming) {
            // Final pass: decode whatever's left in the < CHUNK_SAMPLES tail
            // buffer (zero-padded) instead of silently dropping the last partial
            // chunk of the segment. Streaming (partial) passes intentionally
            // leave it buffered for the next pushAudio() call to complete.
            const tail = await engine.flush();
            if (tail) results.push(tail);
          }
          const text = results.map(r => r.text).join(' ').trim();
          parentPort!.postMessage(
            msg.streaming
              ? { type: 'partial', taskId: msg.taskId, channelId, text }
              : { type: 'result', taskId: msg.taskId, channelId, text },
          );
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
    if (!pipe) {
      parentPort!.postMessage({ type: 'error', message: 'Model not loaded' });
      return;
    }
    try {
      let language: string | null = LANG_MAP[msg.language] ?? null;
      const streaming: boolean = !!msg.streaming;

      // English-only checkpoints (Distil-Whisper + .en variants) have no
      // multilingual decoder. Force language='english' regardless of the
      // user's auto/non-English setting so the model isn't asked to
      // transcribe phonetically into the wrong language.
      if (ENGLISH_ONLY_MODELS.has(loadedModelId)) {
        language = 'english';
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
      if (language) opts.language = language;

      // Use the pre-tokenized prompt cache populated by setPrompt messages.
      // Skip for Moonshine (cached IDs are null in that case anyway).
      if (cachedPromptIds && cachedPromptIds.length > 0 && !isMoonshineModel(loadedModelId)) {
        opts.prompt_ids = cachedPromptIds;
      }

      const result = await pipe(msg.audio, opts);
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
});
