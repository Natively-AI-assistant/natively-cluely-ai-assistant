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
import { isEnglishOnlyModel, resolveWhisperLanguage } from './language';

let pipe: any = null;
let loadedModelId = '';

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

const warnedEnglishOnlyLanguageOverrides = new Set<string>();

if (!parentPort) throw new Error('whisperWorker must be run as a Worker thread');

// Loads @huggingface/transformers via a real dynamic import() at runtime.
// Using new Function prevents TypeScript from rewriting import() → require()
// in the CommonJS output, which would fail because the package is ESM-only.
async function loadTransformers(): Promise<{ pipeline: any; env: any }> {
  return (new Function('return import("@huggingface/transformers")')()) as any;
}

parentPort.on('message', async (msg: any) => {
  if (msg.type === 'init') {
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

      console.log(`[WhisperWorker] Loading ${msg.modelId} | providers=${providers.join(',')} | dtype=${dtypeDesc}`);

      // HF Transformers fires progress_callback per *file* (encoder, decoder,
      // tokenizer, config…). The raw `data.progress` is per-file 0..100, which
      // makes a model-level bar bounce around (3 → 2 → 100 → 5 → …) as files
      // start, complete, and new ones enter the stream.
      //
      // Strategy: register every file we ever see in a Map, keep its value
      // monotonic per file (0 on initiate, latest pct on progress, 100 on done),
      // and report the AVERAGE across the map. Capped at 99 so the bar never
      // hits 100 before the IPC 'complete' signal — that boundary is owned by
      // the 'ready' message below.
      const fileProgress = new Map<string, number>();
      let lastPostedPct = 0;
      pipe = await pipeline('automatic-speech-recognition', msg.modelId, {
        dtype,
        progress_callback: (data: any) => {
          const key: string | undefined = data.file ?? data.name;
          if (!key) return;
          let val: number | null = null;
          if (data.status === 'initiate' || data.status === 'download' || data.status === 'downloading') {
            if (!fileProgress.has(key)) val = 0;
          } else if (data.status === 'progress') {
            const p = Number(data.progress);
            if (!Number.isNaN(p)) val = Math.min(100, Math.max(0, p));
          } else if (data.status === 'done') {
            val = 100;
          } else {
            return;
          }
          if (val !== null) {
            const prev = fileProgress.get(key) ?? 0;
            // Per-file monotonic: each file's progress only goes up.
            fileProgress.set(key, Math.max(prev, val));
          }
          if (fileProgress.size === 0) return;
          let sum = 0;
          for (const v of fileProgress.values()) sum += v;
          const avg = sum / fileProgress.size;
          // Cap at 99 — only the 'ready' completion event sets 100. Floor so
          // we don't post 0.7 → 1 → 1 → 1.4 → 2 churn.
          const rounded = Math.min(99, Math.floor(avg));
          // Cross-file safety net: don't decrease (e.g. when a brand-new file
          // joins the map at 0% it shouldn't drag the bar backwards).
          const next = Math.max(lastPostedPct, rounded);
          if (next === lastPostedPct) return;
          lastPostedPct = next;
          parentPort!.postMessage({
            type: 'progress',
            modelId: msg.modelId,
            progress: next,
          });
        },
      });
      loadedModelId = msg.modelId;
      // New model = stale prompt cache (different tokenizer vocab)
      cachedPromptText = '';
      cachedPromptIds = null;
      warnedEnglishOnlyLanguageOverrides.clear();

      parentPort!.postMessage({ type: 'ready' });
    } catch (e: any) {
      parentPort!.postMessage({
        type: 'error',
        message: `Failed to load model: ${e.message}`,
      });
    }
  } else if (msg.type === 'setPrompt') {
    await updatePromptCache(msg.prompt);
  } else if (msg.type === 'transcribe') {
    if (!pipe) {
      parentPort!.postMessage({ type: 'error', message: 'Model not loaded' });
      return;
    }
    try {
      let language = resolveWhisperLanguage(msg.language);
      const streaming: boolean = !!msg.streaming;

      // English-only checkpoints (Distil-Whisper + .en variants) have no
      // multilingual decoder. Force language='english' regardless of the
      // user's auto/non-English setting so the model isn't asked to
      // transcribe phonetically into the wrong language.
      if (isEnglishOnlyModel(loadedModelId)) {
        if (language && language !== 'english') {
          const warningKey = `${loadedModelId}:${msg.language}`;
          if (!warnedEnglishOnlyLanguageOverrides.has(warningKey)) {
            console.warn(
              `[WhisperWorker] ${loadedModelId} is English-only; overriding requested language "${msg.language}" (${language}) to english. ` +
              'Select a multilingual Whisper model for Russian transcription.',
            );
            warnedEnglishOnlyLanguageOverrides.add(warningKey);
          }
        }
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
