// electron/utils/onnxWorkerShutdown.ts
//
// The ONLY way a worker that may hold an onnxruntime-node session is asked to
// stop.
//
// WHY NOT worker.terminate() (2026-10-14, reproduced on macOS against the real
// worker, both mid-inference and mid-load):
//
//   libc++abi: terminating due to uncaught exception of type Napi::Error
//   -> SIGABRT of the WHOLE app
//
// onnxruntime-node runs InferenceSession.run() and loadModel() synchronously on
// the worker's JS thread (inside a setImmediate callback). terminate() marks
// that isolate as stopping while the native call is still running. When the
// call returns, the binding's next N-API call fails, it tries to raise that as
// a JavaScript exception, raising fails too (the isolate is stopping), and the
// C++ exception escapes a noexcept N-API callback. That is std::terminate —
// not a worker error, a process abort. A 2.9.2 user crash report shows exactly
// this stack (Napi::Error::ThrowAsJavaScriptException -> __cxa_throw ->
// abort) on a WorkerThread.
//
// A grace timer before terminate() does not fix it, it only narrows it: an
// inference or a model load that outlasts the timer is killed the same way.
//
// WHAT THIS DOES INSTEAD: post a `shutdown` message. The worker handles a
// message only when its JS thread is idle — between native calls, never inside
// one — and then exits itself with process.exit(0), which in a worker thread
// stops that thread only. No native frame is on the stack at that point, so
// nothing is left to throw into a stopping isolate.
//
// There is deliberately NO hard-kill fallback. A worker wedged inside native
// code forever keeps its thread until the app quits; terminating it would
// trade that leak for the abort above.
//
// This is the rule for EVERY onnxruntime-node worker in the app — local STT,
// the model downloads, local embeddings, the local reranker and the router
// model — and for the quit path (see the registry below).
//
// Platform note: this is plain worker_threads messaging, identical on macOS
// and Windows. The abort is a property of the N-API binding, not of the OS, so
// the same rule applies on both.

/** The message a worker script must answer with `process.exit(0)`. */
export const ONNX_WORKER_SHUTDOWN_MESSAGE = Object.freeze({ type: 'shutdown' as const });

export interface RetirableWorker {
    postMessage(message: unknown): void;
}

/** A worker whose exit can be observed (a real worker_threads Worker). */
export interface ObservableWorker extends RetirableWorker {
    once(event: 'exit', listener: (code: number) => void): unknown;
}

// ── Live-worker registry ────────────────────────────────────────────────────
//
// Every ONNX worker the app spawns is registered here, for two reasons:
//
//  1. QUIT. Process exit stops worker threads the same way terminate() does,
//     so quitting while any of them is inside a native call is the same abort.
//     The quit path asks every live worker to exit and waits (bounded) for
//     them to be gone before the process is allowed to wind down.
//  2. "Has it exited?" has to be answerable after the fact — a worker that is
//     already gone never emits another 'exit', and waiting for one would
//     always run to the timeout.
//
// On globalThis, not at module scope: this file is inlined into every dist
// bundle that imports it (main, the STT class, the RAG providers), and a
// per-bundle Set would hide each bundle's workers from the quit path.
interface WorkerRegistry {
    live: Set<ObservableWorker>;
    exited: WeakSet<object>;
}

function registry(): WorkerRegistry {
    const g = globalThis as unknown as { __nativelyOnnxWorkerRegistryV1__?: WorkerRegistry };
    if (!g.__nativelyOnnxWorkerRegistryV1__) {
        g.__nativelyOnnxWorkerRegistryV1__ = { live: new Set(), exited: new WeakSet() };
    }
    return g.__nativelyOnnxWorkerRegistryV1__;
}

function canObserve(worker: unknown): worker is ObservableWorker {
    return !!worker && typeof (worker as ObservableWorker).once === 'function'
        && typeof (worker as ObservableWorker).postMessage === 'function';
}

/**
 * Register a freshly spawned ONNX worker. Returns the same worker, so it wraps
 * the `new Worker(...)` expression. A stand-in with no exit event (unit tests)
 * is returned untouched.
 */
export function trackOnnxWorker<T>(worker: T): T {
    if (!canObserve(worker)) return worker;
    const reg = registry();
    if (reg.live.has(worker) || reg.exited.has(worker)) return worker;
    reg.live.add(worker);
    worker.once('exit', () => {
        reg.live.delete(worker);
        reg.exited.add(worker);
    });
    return worker;
}

/** ONNX workers that have been spawned and have not exited. */
export function liveOnnxWorkerCount(): number {
    return registry().live.size;
}

/**
 * Ask a worker to exit at its next idle point. Returns immediately; listen for
 * the worker's own `exit` (code 0) to know it is gone. Safe to call on a worker
 * that has already exited.
 */
export function retireOnnxWorker(worker: RetirableWorker | null | undefined): void {
    if (!worker) return;
    try {
        worker.postMessage(ONNX_WORKER_SHUTDOWN_MESSAGE);
    } catch {
        // The worker is already gone — nothing left to stop.
    }
}

/**
 * retireOnnxWorker(), then wait until the worker has really exited.
 *
 * Resolves true once it is gone, false if it is still alive after `maxWaitMs`
 * (it is inside a long native call, or wedged). It is NOT killed in that case:
 * the caller decides what it may safely do with a worker that still exists.
 * A stand-in whose exit cannot be observed counts as gone.
 */
export function retireOnnxWorkerAndWait(
    worker: RetirableWorker | null | undefined,
    maxWaitMs: number,
): Promise<boolean> {
    if (!worker) return Promise.resolve(true);
    if (!canObserve(worker)) {
        retireOnnxWorker(worker);
        return Promise.resolve(true);
    }
    const reg = registry();
    if (reg.exited.has(worker)) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (gone: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(gone);
        };
        const timer = setTimeout(() => finish(false), Math.max(0, maxWaitMs));
        (timer as unknown as { unref?: () => void }).unref?.();
        worker.once('exit', () => {
            reg.live.delete(worker);
            reg.exited.add(worker);
            finish(true);
        });
        retireOnnxWorker(worker);
    });
}

/**
 * Quit path: ask every live ONNX worker to exit and wait for them, at most
 * `maxWaitMs` in total. Never rejects.
 */
export async function retireAllOnnxWorkers(maxWaitMs: number): Promise<{ asked: number; stillAlive: number }> {
    const workers = [...registry().live];
    if (workers.length === 0) return { asked: 0, stillAlive: 0 };
    const gone = await Promise.all(workers.map((w) => retireOnnxWorkerAndWait(w, maxWaitMs).catch(() => false)));
    return { asked: workers.length, stillAlive: gone.filter((g) => !g).length };
}

/** Test-only: forget every tracked worker. */
export function __resetOnnxWorkerRegistryForTests(): void {
    const g = globalThis as unknown as { __nativelyOnnxWorkerRegistryV1__?: WorkerRegistry };
    g.__nativelyOnnxWorkerRegistryV1__ = undefined;
}
