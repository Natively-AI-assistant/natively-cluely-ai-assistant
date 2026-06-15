/**
 * Resolves the optimal ONNX Runtime execution providers and per-module
 * quantization (dtype) strategy for the current platform at runtime.
 *
 * Per-module dtype is the documented Whisper-safe configuration: keep the
 * encoder at fp32 (Whisper's encoder is extremely sensitive to quantization
 * — known to degrade WER several percentage points when run at int8) while
 * quantizing the decoder to q8 (decoder is token-level, much more robust to
 * quantization and dominates inference time, so the speedup is large).
 *
 * Apple Silicon (CoreML) is the exception — the ONNX Runtime CoreML EP has
 * limited operator coverage for pre-quantized ONNX ops; feeding it fp32
 * keeps the entire encoder graph on Metal/ANE instead of falling back to
 * CPU per-subgraph. Use uniform fp32 there.
 */
export interface InferenceConfig {
    executionProviders: string[];
    // String → single dtype for all ONNX files (e.g. 'fp32', 'q8', 'q4').
    // Record  → per-file dtype keyed by ONNX basename without suffix:
    //           'encoder_model', 'decoder_model_merged',
    //           'decoder_model', 'decoder_with_past_model'.
    dtype: string | Record<string, string>;
}

/**
 * Whisper-safe per-module dtype map. Applies to Whisper, Distil-Whisper, and
 * Moonshine — all three use the same encoder/decoder ONNX file naming.
 *
 *   encoder_model            → fp32  (preserves acoustic encoder accuracy)
 *   decoder_model            → q8    (token decoder; quantizing here is the
 *   decoder_model_merged     → q8     standard speedup with negligible WER cost)
 *   decoder_with_past_model  → q8
 *
 * The Record acts as a SUPERSET — keys that don't match any of the loaded
 * model's actual ONNX files are silently ignored by the loader, so a single
 * map can serve all three model families (Whisper uses merged decoder,
 * Moonshine uses separate decoder + with_past, etc.).
 */
const WHISPER_SAFE_DTYPE: Record<string, string> = {
    encoder_model: 'fp32',
    decoder_model: 'q8',
    decoder_model_merged: 'q8',
    decoder_with_past_model: 'q8',
};

/**
 * Construct the worker `init` message for a given model. Single source of
 * truth — three callers (LocalWhisperSTT.spawnWorker, modelPreloader.preload,
 * local-whisper-start-download IPC) all use this so the message shape stays
 * consistent. The cacheDir lookup is lazy (avoids importing electron from
 * this leaf module).
 */
export function buildWorkerInitMessage(modelId: string): {
    type: 'init';
    modelId: string;
    cacheDir: string;
    executionProviders: string[];
    dtype: string | Record<string, string>;
} {
    // Late require — modelManager imports electron, which isn't available
    // when this module is first loaded in some contexts (test harnesses).
    const { getModelsDir, normalizeWhisperModelId } = require('./modelManager');
    const { executionProviders, dtype } = resolveInferenceConfig();
    return {
        type: 'init',
        modelId: normalizeWhisperModelId(modelId),
        cacheDir: getModelsDir(),
        executionProviders,
        dtype,
    };
}

export function resolveInferenceConfig(): InferenceConfig {
    const { platform, arch } = process;

    if (platform === 'darwin' && arch === 'arm64') {
        // Apple Silicon — CoreML uses Metal GPU + ANE. Feed it fp32 ONNX
        // and let CoreML re-quantize internally; it's tuned for this path.
        return { executionProviders: ['coreml', 'cpu'], dtype: 'fp32' };
    }

    if (platform === 'win32') {
        // Windows — DirectML over NVIDIA / AMD / Intel GPUs. Per-module dtype
        // gives best accuracy/speed tradeoff for the larger Whisper/Distil
        // checkpoints; DirectML handles mixed precision via session options.
        return { executionProviders: ['dml', 'cpu'], dtype: WHISPER_SAFE_DTYPE };
    }

    // Intel Mac, Linux, unknown — CPU. Per-module gives a real speedup on
    // decoder-heavy inference without sacrificing encoder accuracy.
    return { executionProviders: ['cpu'], dtype: WHISPER_SAFE_DTYPE };
}
