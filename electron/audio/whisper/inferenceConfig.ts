import type { WorkerInitMessage } from './types';
// Pure module (no electron / fs / transformers) — safe to import statically.
import { guardEncoderDtype } from './allocationGuard';

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
 * Apple Silicon (CoreML) used to take a uniform fp32 path because the ORT
 * CoreML EP had limited operator coverage for pre-quantized ONNX ops. As of
 * the 2026-07 audit the default is now the same per-module q8/fp32 map as
 * every other platform — modern CoreML handles the fp32 encoder fine and
 * the q8 decoder is the dominant speed win. A user can opt BACK to fp32
 * via the `whisperAppleSiliconDtype` setting (see resolveAppleSiliconDtype
 * below) if WER regresses on their hardware.
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
 * Scale the catalog `sizeMb` (which is measured for the default mixed-q8
 * download: fp32 encoder + q8 decoders) toward the bytes the CURRENT platform
 * will actually download, so the progress-bar denominator (`expectedBytes`) is
 * directionally right per-platform instead of platform-blind.
 *
 * WHY THIS MATTERS: the bar denominator is `max(expectedBytes, observedTotal)`.
 * That self-corrects an UNDER-estimate (observed grows past it) but CANNOT
 * correct an OVER-estimate (the bar would finish at e.g. 65% then vanish). So
 * the only safe failure direction is to under-estimate. This factor is kept
 * deliberately conservative — at or below the true ratio — so the result stays
 * a lower bound on every platform and the un-correctable over-estimate case
 * can never occur. Being a bit low just means the bar advances slightly faster
 * early and the observed total takes over partway through, which is smooth.
 *
 *   - Apple Silicon resolves uniform fp32 (see resolveInferenceConfig): the q8
 *     decoders are instead downloaded at fp32, so the real download is larger
 *     than the catalog q8 figure. A factor >1 keeps expectedBytes a lower bound
 *     while starting far closer to reality. 1.6 is intentionally below the
 *     true fp32/q8 ratio (~2–3× on the decoder-heavy portion) so we never
 *     over-shoot.
 *   - Everything else already matches the catalog's mixed-q8 measurement → 1.0.
 */
function dtypeSizeFactor(dtype: string | Record<string, string>): number {
    // Uniform fp32 across all modules = the Apple Silicon / large-download path.
    if (dtype === 'fp32') return 1.6;
    // Mixed per-module map (WHISPER_SAFE_DTYPE) or any q8/q4 string: the catalog
    // figure already reflects this, so no scaling.
    return 1.0;
}

/**
 * The dtype a SPECIFIC model actually loads — and therefore the dtype whose
 * ONNX filenames its cache must contain.
 *
 * SINGLE SOURCE OF TRUTH. `resolveInferenceConfig()` answers "what does this
 * platform prefer", which is NOT the same question: a model whose fp32 encoder
 * weights are at or above Chromium's 2 GiB - 2 MiB PartitionAlloc ceiling
 * (Whisper Large v3 Turbo) gets its encoder downgraded to q8, because asking
 * ORT for that single allocation traps the process (SIGTRAP — see
 * allocationGuard.ts). Such a model downloads `encoder_model_quantized.onnx`,
 * never `encoder_model.onnx`.
 *
 * Every consumer that maps a model to on-disk artifacts MUST go through here —
 * the worker init message, the model-list status, download verification, and
 * startup preload readiness. Using the unguarded platform dtype anywhere in
 * that set desynchronises them: a complete turbo download gets reported as
 * incomplete (verification looks for the fp32 encoder the worker never
 * fetched), and a stale fp32 cache gets classified as ready.
 *
 * Best-effort by contract: an unknown id, or any failure in the catalog
 * lookup, returns the platform dtype untouched. This function must never
 * throw and never block a load or a download.
 */
export function resolveModelDtype(modelId: string): string | Record<string, string> {
    return resolveGuardedDtype(modelId).dtype;
}

interface GuardedDtype {
    dtype: string | Record<string, string>;
    /** Catalog fp32 encoder size, forwarded to the worker's own preflight. */
    encoderFp32Bytes: number | undefined;
    executionProviders: string[];
}

function resolveGuardedDtype(modelId: string, warn = false): GuardedDtype {
    const { executionProviders, dtype: resolvedDtype } = resolveInferenceConfig();
    try {
        // Late require — modelManager imports electron, which isn't available
        // when this module is first loaded in some contexts (test harnesses).
        const { getModelEncoderFp32Bytes } = require('./modelManager');
        const encoderFp32Bytes = getModelEncoderFp32Bytes(modelId);
        const guard = guardEncoderDtype(resolvedDtype, encoderFp32Bytes);
        if (guard.downgraded && warn) {
            console.warn(`[inferenceConfig] ${modelId}: ${guard.reason}`);
        }
        return { dtype: guard.dtype, encoderFp32Bytes, executionProviders };
    } catch {
        return { dtype: resolvedDtype, encoderFp32Bytes: undefined, executionProviders };
    }
}

/**
 * Construct the worker `init` message for a given model. Single source of
 * truth — three callers (LocalWhisperSTT.spawnWorker, modelPreloader.preload,
 * local-whisper-start-download IPC) all use this so the message shape stays
 * consistent. The cacheDir lookup is lazy (avoids importing electron from
 * this leaf module).
 */
export function buildWorkerInitMessage(modelId: string): WorkerInitMessage {
    // Late require — modelManager imports electron, which isn't available
    // when this module is first loaded in some contexts (test harnesses).
    const {
        getModelsDir,
        getModelSizeBytes,
        getModelExternalDataFormat,
    } = require('./modelManager');
    // Guarded, per-model dtype — the same value every cache consumer sees.
    const { executionProviders, dtype, encoderFp32Bytes } = resolveGuardedDtype(modelId, true);
    // Catalog download size — progress-bar denominator from byte zero. The
    // lookup is best-effort: if it's missing (unknown id) or the call fails
    // for any reason, we send 0 and the worker falls back to summing the
    // per-file byte totals it observes during the download. The size is a
    // UX nicety for the progress bar, never required for the download itself,
    // so a failure here must NEVER prevent the worker from starting.
    // Scaled by the GUARDED dtype on purpose: a downgraded encoder downloads a
    // smaller quantized file, so the map's 1.0 factor stays a lower bound —
    // the only safe direction for the bar denominator (see dtypeSizeFactor).
    let expectedBytes = 0;
    try {
        const n = Number(getModelSizeBytes(modelId)) * dtypeSizeFactor(dtype);
        if (Number.isFinite(n) && n > 0) expectedBytes = Math.round(n);
    } catch {
        expectedBytes = 0;
    }
    // External-data flag for checkpoints whose weights live in sibling
    // `*.onnx_data` files but whose own config.json doesn't declare it (e.g.
    // Whisper Large v3 Turbo). undefined for every other model — the worker
    // then lets transformers read each model's config.json as before. Like the
    // size lookup above, never let this block worker startup.
    let useExternalDataFormat: boolean | Record<string, boolean> | undefined;
    try {
        useExternalDataFormat = getModelExternalDataFormat(modelId);
    } catch {
        useExternalDataFormat = undefined;
    }
    return {
        type: 'init',
        modelId,
        cacheDir: getModelsDir(),
        executionProviders,
        dtype,
        expectedBytes,
        useExternalDataFormat,
        // Forwarded so the worker can re-run the ceiling check itself — defence
        // in depth for any caller that builds an init message without this
        // helper. See whisperWorker's preflightAllocation call.
        encoderFp32Bytes,
    };
}

/**
 * Apple Silicon dtype override — lets a user opt back to uniform fp32 if
 * the new per-module q8 default regresses WER on their hardware. Read from
 * SettingsManager (`whisperAppleSiliconDtype`); missing/unknown → the new
 * per-module default. Returns null on SettingsManager unavailable (test
 * contexts) so the resolver falls through to its own default.
 */
function resolveAppleSiliconDtype(): string | Record<string, string> | null {
    try {
        // Lazy require: SettingsManager touches electron's app, which isn't
        // available in unit-test contexts. Any throw here means "no override".
        const { SettingsManager } = require('../../services/SettingsManager');
        const raw = SettingsManager.getInstance().get('whisperAppleSiliconDtype');
        if (raw === 'fp32' || raw === 'q8' || raw === 'q4' || raw === 'int8') {
            return 'fp32';
        }
        if (raw === 'mixed') {
            return WHISPER_SAFE_DTYPE;
        }
        return null; // unknown / not set → caller uses its default
    } catch {
        return null;
    }
}

export function resolveInferenceConfig(): InferenceConfig {
    const { platform, arch } = process;

    if (platform === 'darwin' && arch === 'arm64') {
        // Apple Silicon — CoreML uses Metal GPU + ANE. Default changed in
        // 2026-07 from uniform fp32 → mixed per-module (fp32 encoder + q8
        // decoders), matching every other platform. The q8 decoder is the
        // dominant speed win and modern CoreML handles the mixed-precision
        // graph cleanly. A user can override back to fp32 via the
        // `whisperAppleSiliconDtype` setting if their WER regresses.
        const override = resolveAppleSiliconDtype();
        return {
            executionProviders: ['coreml', 'cpu'],
            dtype: override ?? WHISPER_SAFE_DTYPE,
        };
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
