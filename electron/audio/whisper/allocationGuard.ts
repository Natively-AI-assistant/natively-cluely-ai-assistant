// electron/audio/whisper/allocationGuard.ts
//
// Single-allocation ceiling guard for ONNX Runtime sessions running inside
// Electron.
//
// WHY THIS EXISTS (Whisper Large v3 Turbo SIGTRAP):
// Chromium's PartitionAlloc refuses any single allocation of 2 GiB or more —
// and it does NOT return NULL, it intentionally traps:
//
//   // partition_alloc_constants.h
//   MaxDirectMapped() = (1UL << 31) - kSuperPageSize   // 2 GiB - 2 MiB
//   // "Intentionally set to less than 2GiB to make sure that a 2GiB
//   //  allocation fails. This is a security choice in Chrome, to help
//   //  making size_t vs int bugs harder to exploit."
//
// Whisper Large v3 Turbo ships a 2.4 GB fp32 encoder (`encoder_model.onnx_data`).
// WHISPER_SAFE_DTYPE pins `encoder_model: 'fp32'` for every Whisper-family
// model, so loading turbo makes ORT allocate those initializers and land
// straight on the ceiling: posix_memalign → PartitionAlloc → `brk 0` →
// EXC_BREAKPOINT (SIGTRAP). The whole app dies, with no catchable JS error and
// nothing in telemetry. Because the selected model preloads at startup, the app
// crash-loops and the user cannot even reach Settings to pick another model.
//
// This is NOT an out-of-memory condition: it reproduces identically with 82% of
// system RAM free, and the same files load in 1.3-1.8 s under plain Node on the
// same machine. It is a hard ceiling, so it cannot be fixed by freeing memory,
// by the available-memory floor in onnxThreadConfig.ts, or by the arena
// settings there (`enableCpuMemArena` already defaults to false — the crash
// happens anyway once a single initializer tensor is this big).
//
// The only durable fix is to never ask for the allocation: resolve a quantized
// encoder for checkpoints whose fp32 encoder weights are at or above the cap,
// and — as a second line of defence for any caller that bypasses that — refuse
// the load with a structured error BEFORE calling CreateSession. Anything that
// reaches posix_memalign with >= 2 GiB is unrecoverable by construction.
//
// Pure module: no electron, no fs, no transformers. Safe to import from the
// worker, from the main process, and from unit tests.

/**
 * Largest single allocation Chromium's PartitionAlloc will serve, in bytes:
 * 2 GiB - kSuperPageSize (2 MiB). A request at or above this traps the process.
 */
export const PARTITION_ALLOC_MAX_BYTES = 2 ** 31 - 2 * 1024 * 1024;

/** Encoder dtype used when the fp32 encoder cannot be allocated in-process. */
export const ENCODER_FALLBACK_DTYPE = 'q8';

/**
 * True when a single allocation of `bytes` would hit PartitionAlloc's ceiling
 * and trap. Non-finite / non-positive sizes are treated as "unknown" → false,
 * so a missing catalog figure never blocks a load that used to work.
 */
export function exceedsPartitionAllocCap(bytes: number | undefined | null): boolean {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return false;
    return n >= PARTITION_ALLOC_MAX_BYTES;
}

export interface EncoderDtypeGuardResult {
    /** The dtype to actually load with — encoder downgraded only when needed. */
    dtype: string | Record<string, string>;
    /** True when the encoder entry was rewritten away from fp32. */
    downgraded: boolean;
    /** Human-readable explanation, present only when downgraded. */
    reason?: string;
}

/** The dtype this config resolves for `encoder_model` (mirrors the loader). */
function encoderDtypeOf(dtype: string | Record<string, string>): string {
    if (typeof dtype === 'string') return dtype;
    return dtype.encoder_model ?? 'fp32'; // matches the transformers loader default
}

/**
 * Rewrite an inference dtype so the encoder never triggers a >= 2 GiB single
 * allocation. Only touches the `encoder_model` entry, and only when
 *
 *   - the resolved encoder dtype is fp32 (a quantized encoder is already small
 *     enough — it is the fp32 initializers that are one huge tensor block), and
 *   - the catalog records fp32 encoder weights at or above the cap.
 *
 * Everything else (decoder dtypes, execution providers, models with no recorded
 * weight size) is returned untouched, so this cannot regress a model that
 * loads today. A string dtype is widened to a per-module map rather than
 * mutated wholesale — quantizing the decoder along with the encoder would be a
 * silent accuracy change nobody asked for.
 */
export function guardEncoderDtype(
    dtype: string | Record<string, string>,
    encoderFp32Bytes: number | undefined,
): EncoderDtypeGuardResult {
    if (!exceedsPartitionAllocCap(encoderFp32Bytes)) return { dtype, downgraded: false };
    if (encoderDtypeOf(dtype) !== 'fp32') return { dtype, downgraded: false };

    const base: Record<string, string> =
        typeof dtype === 'string'
            ? {
                  encoder_model: dtype,
                  decoder_model: dtype,
                  decoder_model_merged: dtype,
                  decoder_with_past_model: dtype,
              }
            : { ...dtype };

    return {
        dtype: { ...base, encoder_model: ENCODER_FALLBACK_DTYPE },
        downgraded: true,
        reason:
            `fp32 encoder weights are ${formatBytes(encoderFp32Bytes)}, at or above ` +
            `Chromium's ${formatBytes(PARTITION_ALLOC_MAX_BYTES)} single-allocation ceiling — ` +
            `loading it would trap the process (SIGTRAP), so the encoder is loaded ` +
            `as ${ENCODER_FALLBACK_DTYPE} instead.`,
    };
}

/**
 * Last-line preflight for the worker: returns an error message when the
 * resolved config would still ask ORT for an untenable single allocation, or
 * null when the load is safe to attempt. Callers must post this as a
 * `WorkerErrorResponse` and return WITHOUT calling pipeline()/CreateSession —
 * once the allocation is requested there is no recoverable error, only a trap.
 */
export function preflightAllocation(
    modelId: string,
    dtype: string | Record<string, string>,
    encoderFp32Bytes: number | undefined,
): string | null {
    if (encoderDtypeOf(dtype) !== 'fp32') return null;
    if (!exceedsPartitionAllocCap(encoderFp32Bytes)) return null;
    return (
        `Refusing to load ${modelId}: its fp32 encoder needs a single ` +
        `${formatBytes(encoderFp32Bytes)} allocation, at or above Chromium's ` +
        `${formatBytes(PARTITION_ALLOC_MAX_BYTES)} limit. ONNX Runtime would trap the ` +
        `process instead of failing. Pick a smaller model, or load the encoder ` +
        `as ${ENCODER_FALLBACK_DTYPE}.`
    );
}

function formatBytes(bytes: number | undefined): string {
    const n = Number(bytes);
    if (!Number.isFinite(n)) return 'unknown';
    return `${(n / 1024 ** 3).toFixed(2)} GiB`;
}
