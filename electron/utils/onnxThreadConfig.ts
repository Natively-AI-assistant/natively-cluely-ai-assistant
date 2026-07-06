// electron/utils/onnxThreadConfig.ts
//
// Shared bounded ONNX Runtime thread-count config + cross-loader concurrency
// gate for every local onnxruntime-node consumer in this app
// (LocalEmbeddingProvider, LocalReranker, IntentClassifier's zero-shot
// worker, Whisper's worker).
//
// WHY THIS EXISTS (2026-07-05 SIGTRAP crash hardening):
// 9/9 real macOS crash reports (~/Library/Logs/DiagnosticReports/Electron-*.ips)
// showed an identical main-thread crash inside onnxruntime::BFCArena::Extend →
// posix_memalign, happening during a live InferenceSession::Run() call, with
// 16-17 ORT-related OS threads alive at crash time. This is consistent with
// multiple ONNX Runtime sessions (Whisper STT + IntentClassifier + a local
// embedding/rerank fallback) racing on native allocator/thread-pool resources
// when several are concurrently active in-process.
//
// A creation-time mutex does NOT help — the crash is inside Run(), not
// Create(). Instead, every loader bounds its OWN session to a small, fixed
// number of intra/inter-op threads via ONNX Runtime SessionOptions. This
// caps the total native thread/memory pressure any single session can
// generate, so even when multiple sessions are concurrently executing the
// aggregate stays low — without fully serializing inference across loaders
// (which would throttle Whisper's ~750ms real-time streaming loop
// unacceptably).
//
// Conservative defaults: 1 intra-op thread (no internal op-level
// parallelism) and 1 inter-op thread (sequential execution mode; these
// models have no independent parallel subgraphs to exploit anyway). This is
// the safest configuration for small/quantized transformer models like
// MiniLM, mobilebert, bge-reranker-base, and Whisper's encoder/decoder —
// none of these benefit meaningfully from multi-threaded intra-op execution
// at these model sizes, so the throughput cost of bounding is minimal while
// the crash-surface reduction is significant.
//
// Overridable via env vars for local experimentation / future retuning
// without a code change.
//
// Layer 2 (2026-07-06): shared cross-loader concurrency semaphore +
// free-memory floor. The original crash forensics showed the issue is NOT
// per-session thread count — it's the aggregate pressure of multiple
// concurrent ONNX sessions on the BFCArena. A global acquire/release gate
// caps how many can be live at once, and a `os.freemem()` floor refuses
// any new session when the system is tight. All four consumers
// (LocalEmbeddingProvider, LocalReranker, IntentClassifier, Whisper) gate
// here before posting `init` to their worker.

import os from 'os';

export interface OnnxThreadBounds {
    intraOpNumThreads: number;
    interOpNumThreads: number;
    executionMode: 'sequential' | 'parallel';
}

function readIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Bounded thread-count session options shared by every local ONNX consumer.
 * Kept as a fresh object per call (session_options is merged/mutated by
 * transformers.js internals — never share one object across sessions).
 */
export function getBoundedOnnxSessionOptions(): OnnxThreadBounds {
    return {
        intraOpNumThreads: readIntEnv('NATIVELY_ONNX_INTRA_OP_THREADS', 1),
        interOpNumThreads: readIntEnv('NATIVELY_ONNX_INTER_OP_THREADS', 1),
        executionMode: 'sequential',
    };
}

// ── Cross-loader concurrency gate ──────────────────────────────────────────
//
// A small async semaphore + memory floor shared by every local ONNX
// consumer. Acquired main-side BEFORE posting `init` to a worker —
// worker_threads have separate JS heaps so the in-memory counter must live
// in the main process. Default cap: 2 concurrent sessions (Whisper + one
// other). On a 16GB MacBook Air with 4 native ONNX consumers live
// simultaneously, the BFC arena can grow into the multi-hundred-MB range
// and `posix_memalign` traps. The gate is the structural half of the fix
// for that crash surface; per-session `getBoundedOnnxSessionOptions()`
// (intra/inter-op = 1) is the conservative half.
//
// Refusal policy: the slot release function is async-safe; calling it more
// than once is a no-op. Acquisition fails OPEN if `os.freemem()` itself
// throws (rare sandboxed Linux configs) — the failure case is just
// measurement, not a real signal of trouble.

export type OnnxSlotPriority = 'normal' | 'high';

let inFlightNormal = 0;
let inFlightHigh = 0;
const waitersNormal: Array<() => void> = [];
const waitersHigh: Array<() => void> = [];

function readMaxConcurrent(): number {
    return readIntEnv('NATIVELY_ONNX_MAX_CONCURRENT_SESSIONS', 2);
}

function readMinFreeGB(): number {
    const raw = process.env.NATIVELY_ONNX_MIN_FREE_GB;
    if (!raw) return 2.0;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) && n >= 0 ? n : 2.0;
}

function canAcquireNow(priority: OnnxSlotPriority): boolean {
    const cap = readMaxConcurrent();
    if (priority === 'high') {
        return inFlightNormal + inFlightHigh < cap;
    }
    // Normal priority: only acquire when there are no high-priority waiters
    // queued (so Whisper can grab the next slot promptly).
    if (waitersHigh.length > 0) return false;
    return inFlightNormal + inFlightHigh < cap;
}

/**
 * Acquire a shared ONNX session slot. Returns a release function the caller
 * MUST call when the session is torn down (typically in worker `error`/`exit`
 * handlers). Blocks until a slot is available; NEVER rejects.
 *
 * Priority 'high' is for latency-critical consumers (Whisper) — it acquires
 * ahead of queued normal-priority waiters but does NOT preempt a running
 * session. If the cap is exhausted, high-priority waiters block normal-priority
 * acquisitions so Whisper can take the next free slot promptly.
 */
export async function acquireOnnxSlot(priority: OnnxSlotPriority = 'normal'): Promise<() => void> {
    const queue = priority === 'high' ? waitersHigh : waitersNormal;
    // Only enqueue when we're actually going to wait — otherwise stale
    // resolvers accumulate in the queue and confuse the FIFO order.
    while (!canAcquireNow(priority)) {
        const waiterP = new Promise<void>(resolve => queue.push(resolve));
        await waiterP;
    }
    if (priority === 'high') inFlightHigh++;
    else inFlightNormal++;

    let released = false;
    return () => {
        if (released) return;
        released = true;
        if (priority === 'high') inFlightHigh--;
        else inFlightNormal--;
        // Wake the next eligible waiter. Try high first, then normal — keeps
        // Whisper latency-critical even when embeddings are queued.
        const nextHigh = waitersHigh.shift();
        if (nextHigh) nextHigh();
        else {
            const nextNormal = waitersNormal.shift();
            if (nextNormal) nextNormal();
        }
    };
}

/**
 * Free-memory floor for admitting a new ONNX session. Returns true if the
 * system has at least `NATIVELY_ONNX_MIN_FREE_GB` (default 2.0 GB) free.
 *
 * Fails OPEN (returns true) if the measurement itself throws — refusing on
 * a measurement failure would block the app for no real reason.
 */
export function hasEnoughMemoryForOnnxSession(): boolean {
    try {
        return (os.freemem() / 1024 ** 3) >= readMinFreeGB();
    } catch {
        return true;
    }
}

/** Returns the current free-memory floor in GB (live, env-aware). */
export function getMinFreeGBForOnnxSession(): number {
    return readMinFreeGB();
}

/** Returns the current max-concurrent cap (live, env-aware). */
export function getMaxConcurrentOnnxSessions(): number {
    return readMaxConcurrent();
}

/**
 * Test-only: reset the gate state so a test can re-exercise concurrent
 * acquisition from scratch. Not exported in the main barrel — only for the
 * test suite.
 */
export function __resetOnnxGateForTests(): void {
    inFlightNormal = 0;
    inFlightHigh = 0;
    waitersNormal.length = 0;
    waitersHigh.length = 0;
}
