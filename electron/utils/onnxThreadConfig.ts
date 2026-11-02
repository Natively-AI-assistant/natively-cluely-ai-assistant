// electron/utils/onnxThreadConfig.ts
//
// Shared bounded ONNX Runtime thread-count config + cross-loader concurrency
// gate for every local onnxruntime-node consumer in this app
// (LocalEmbeddingProvider, LocalReranker,
// worker, Whisper's worker).
//
// WHY THIS EXISTS (2026-07-05 SIGTRAP crash hardening):
// 9/9 real macOS crash reports (~/Library/Logs/DiagnosticReports/Electron-*.ips)
// showed an identical main-thread crash inside onnxruntime::BFCArena::Extend →
// posix_memalign, happening during a live InferenceSession::Run() call, with
// 16-17 ORT-related OS threads alive at crash time. This is consistent with
// multiple ONNX Runtime sessions (Whisper STT + a local
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
// MiniLM, ms-marco, and Whisper's encoder/decoder —
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
// (LocalEmbeddingProvider, LocalReranker, Whisper) gate
// here before posting `init` to their worker.

import os from 'os';
import { execFileSync } from 'child_process';
import fs from 'fs';

export interface OnnxThreadBounds {
    intraOpNumThreads: number;
    interOpNumThreads: number;
    executionMode: 'sequential' | 'parallel';
    enableCpuMemArena?: boolean;
    enableMemPattern?: boolean;
}

function readIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function readBoolEnv(name: string, fallback: boolean): boolean {
    const raw = process.env[name];
    if (!raw) return fallback;
    const normalized = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

/**
 * Workload shape, which decides the intra-op thread default.
 *
 * 'default' — one graph pass per unit of work (Whisper/Distil/Moonshine/
 *   Parakeet encode, embeddings, reranking, intent classification). A single
 *   intra-op thread costs these very little, so they keep the conservative
 *   bound the crash forensics below argue for.
 *
 * 'rnnt-decode' — the autoregressive transducer loop (Nemotron). One chunk is
 *   an encoder pass PLUS a per-encoder-frame greedy loop where every emitted
 *   symbol costs a decoder run and a joint run, so a chunk is ~two orders of
 *   magnitude more ORT invocations than a CTC pass. Published profiling of
 *   Parakeet RNN-T puts ~67% of runtime in greedy decoding vs ~33% in the
 *   encoder, and pinning that loop to one thread is what made Nemotron feel
 *   slow next to CTC models of the same parameter count.
 *
 * 'whisper-encode' — Whisper and Distil-Whisper through transformers.js. The
 *   encoder pads every call to 30 s of audio, so a call costs the same for a
 *   one-word partial as for a full sentence, and on one thread it is longer
 *   than the 1.5 s partial cadence for Small and up. Measured on an M4
 *   MacBook Air (4 performance cores), fp32 encoder + q8 decoder, 2026-10-14,
 *   time per transcription call:
 *
 *     model      1 thread    4 threads
 *     Small      5-11 s      3.5-4.6 s   (Indonesian, 7-12 s clips)
 *     Medium     ~13 s       ~4.3 s      (encoder alone)
 *     Turbo      24-28 s     8-11 s
 *     Base       1.4-4 s     1.3-2.6 s
 *
 *   Moonshine is NOT in this group: its encoder sizes to the clip, and more
 *   threads measured no faster (174 ms on one thread).
 */
export type OnnxWorkload = 'default' | 'rnnt-decode' | 'whisper-encode';

/**
 * Intra-op default for the transducer decode loop and the Whisper encoder.
 *
 * Measured on an M-series (10 logical / 4 performance cores), Nemotron int4,
 * CPU EP, 2.46s fixture, median of 3 after warmup — identical transcript at
 * every setting:
 *
 *   1 thread   936ms   RTF 0.380
 *   2 threads  547ms   RTF 0.222
 *   4 threads  385ms   RTF 0.156   <-- best
 *   8 threads  528ms   RTF 0.214
 *
 * 8 is WORSE than 4: past the performance-core count the pool spills onto
 * efficiency cores and contends. So this tracks cores but caps at 4 rather
 * than scaling with the whole machine — the cap is the point, not a guess.
 * Halving logical cores approximates the perf-core count portably (Apple's
 * hw.perflevel0 has no cross-platform equivalent).
 */
function defaultPerfCoreIntraOpThreads(): number {
    let logical = 4;
    try {
        logical = (require('os') as typeof import('os')).cpus()?.length || 4;
    } catch {
        logical = 4;
    }
    return Math.max(1, Math.min(4, Math.floor(logical / 2)));
}

/**
 * Bounded thread-count session options shared by every local ONNX consumer.
 * Kept as a fresh object per call (session_options is merged/mutated by
 * transformers.js internals — never share one object across sessions).
 *
 * `NATIVELY_ONNX_INTRA_OP_THREADS` still overrides every workload, so the
 * measurements above stay reproducible without a new build.
 */
export function getBoundedOnnxSessionOptions(workload: OnnxWorkload = 'default'): OnnxThreadBounds {
    const intraDefault = workload === 'default' ? 1 : defaultPerfCoreIntraOpThreads();
    return {
        intraOpNumThreads: readIntEnv('NATIVELY_ONNX_INTRA_OP_THREADS', intraDefault),
        interOpNumThreads: readIntEnv('NATIVELY_ONNX_INTER_OP_THREADS', 1),
        executionMode: 'sequential',
        // Disable ORT's persistent BFCArena/memory-pattern reuse by default.
        // The crash forensics above point at BFCArena::Extend; standard system
        // allocations are safer inside Electron. Env vars keep this reversible
        // for perf experiments without shipping a new build.
        enableCpuMemArena: readBoolEnv('NATIVELY_ONNX_ENABLE_CPU_MEM_ARENA', false),
        enableMemPattern: readBoolEnv('NATIVELY_ONNX_ENABLE_MEM_PATTERN', false),
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

// The semaphore lives on globalThis, NOT at module scope: this module is
// inlined into 32 dist bundles (whisper, embedding, reranker, RAG, main), and
// a per-bundle copy caps sessions at 2 PER COPY — a harness co-loading three
// ONNX consumers could run six native sessions, exactly the multi-hundred-MB
// BFC-arena condition this gate exists to prevent. The comment above covers
// the worker-heap dimension; this covers the bundle dimension.
interface OnnxSemaphore {
    inFlightNormal: number;
    inFlightHigh: number;
    /** Weight-exceeds-cap holders currently running (they must run alone). */
    exclusiveInFlight: number;
    waitersNormal: Array<() => void>;
    waitersHigh: Array<() => void>;
}
const _sem: OnnxSemaphore = (() => {
    const g = globalThis as unknown as Record<string, OnnxSemaphore | undefined>;
    if (!g.__nativelyOnnxSemaphoreV1__) {
        g.__nativelyOnnxSemaphoreV1__ = { inFlightNormal: 0, inFlightHigh: 0, exclusiveInFlight: 0, waitersNormal: [], waitersHigh: [] };
    }
    return g.__nativelyOnnxSemaphoreV1__;
})();

function readMaxConcurrent(): number {
    return readIntEnv('NATIVELY_ONNX_MAX_CONCURRENT_SESSIONS', 2);
}

/**
 * Budget for latency-critical (`'high'`) sessions — the local STT channels —
 * SEPARATE from the background cap above. Default 2: one worker per audio
 * channel (mic + system).
 *
 * Why separate (2026-09-11, live-reproduced): the local embedding and
 * reranker workers each hold a background slot for the app lifetime, which
 * is the whole default cap. Counting STT against the same pool meant a
 * per-channel local STT worker could NEVER be admitted while local RAG was
 * on — the channel waited forever (now: fails after 20s). STT is the
 * feature the user is looking at during a meeting; the RAG workers already
 * run with the CPU arena disabled and every session passes the
 * available-memory gate, so the worst case is cap + budget = 4 workers,
 * only when the user explicitly enabled per-channel local models.
 */
function readHighPriorityBudget(): number {
    return readIntEnv('NATIVELY_ONNX_HIGH_PRIORITY_SESSIONS', 2);
}

function readMinFreeGB(): number {
    const raw = process.env.NATIVELY_ONNX_MIN_FREE_GB;
    if (!raw) return 2.0;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) && n >= 0 ? n : 2.0;
}

// A weight-exceeds-cap acquisition (see canAcquireNow's exclusive-mode
// branch) is admitted only when the gate is completely free, and the
// holder that eventually wins keeps it for its ENTIRE session lifetime
// (e.g. a whole meeting for LocalWhisperSTT) — not a brief critical
// section. So a wait past cold-start-plus-margin here isn't "queued a bit
// longer", it's permanent: the current holder will not release until ITS
// session ends, which for a live recording could be hours away. Reject
// after this bound so the caller's existing error path can engage instead
// of hanging forever. Deliberately NOT applied to weight <= cap
// acquisitions (normal-priority queuing under ordinary contention is
// expected to legitimately wait longer than this). Overridable via env var
// (matching readMaxConcurrent/readMinFreeGB's own pattern) so tests don't
// need to hand-wait the real default.
function readExclusiveTimeoutMs(): number {
    return readIntEnv('NATIVELY_ONNX_EXCLUSIVE_TIMEOUT_MS', 15000);
}

function canAcquireNow(priority: OnnxSlotPriority, weight: number): boolean {
    const cap = readMaxConcurrent();
    const current = _sem.inFlightNormal + _sem.inFlightHigh;
    // An exclusive holder (weight > cap) runs alone: nobody else is admitted
    // — from either pool — until it releases.
    if ((_sem.exclusiveInFlight ?? 0) > 0) return false;
    // A request whose own weight exceeds the cap (Nemotron's 3 sessions
    // against the default cap of 2) can never satisfy "current + weight <=
    // cap" — that would deadlock forever. Treat it as exclusive: admit only
    // when nothing else is in flight, then let it run alone even though it
    // temporarily exceeds the nominal cap.
    if (weight > cap) {
        return current === 0;
    }
    if (priority === 'high') {
        // Latency-critical STT channels draw on their OWN budget — see
        // readHighPriorityBudget for why they must not queue behind the
        // lifetime-held background slots.
        return _sem.inFlightHigh + weight <= readHighPriorityBudget();
    }
    // Background consumers: their own cap. High-priority waiters no longer
    // block them — the pools are disjoint, so a queued STT channel is waiting
    // on ITS budget, not on this slot.
    return _sem.inFlightNormal + weight <= cap;
}

function removeFromQueue(queue: Array<() => void>, resolver: () => void): void {
    const idx = queue.indexOf(resolver);
    if (idx !== -1) queue.splice(idx, 1);
}

/**
 * Acquire a shared ONNX session slot. Returns a release function the caller
 * MUST call when the session is torn down (typically in worker `error`/`exit`
 * handlers).
 *
 * Priority 'high' is for latency-critical consumers (Whisper) — it acquires
 * ahead of queued normal-priority waiters but does NOT preempt a running
 * session. If the cap is exhausted, high-priority waiters block normal-priority
 * acquisitions so Whisper can take the next free slot promptly.
 *
 * `weight` (default 1) is how many concurrent native ONNX sessions this one
 * acquisition represents — NemotronEngine opens 3 (encoder/decoder/joint)
 * per worker, so its caller passes `weight: 3`. A `weight` that exceeds the
 * cap runs in exclusive mode (see canAcquireNow) and is subject to
 * readExclusiveTimeoutMs(): since an exclusive holder keeps the gate for
 * its entire session lifetime, a wait past that bound means the request
 * cannot be satisfied while the current holder is alive, not that it needs
 * a bit more patience — the promise REJECTS in that case instead of hanging
 * forever. A `weight <= cap` acquisition still never rejects and blocks
 * however long ordinary contention requires, exactly as before.
 */
export async function acquireOnnxSlot(priority: OnnxSlotPriority = 'normal', weight: number = 1): Promise<() => void> {
    const cap = readMaxConcurrent();
    const exclusive = weight > cap;
    const queue = priority === 'high' ? _sem.waitersHigh : _sem.waitersNormal;
    const timeoutMs = readExclusiveTimeoutMs();
    const deadline = exclusive ? Date.now() + timeoutMs : null;

    while (!canAcquireNow(priority, weight)) {
        let resolveWaiter!: () => void;
        const waiterP = new Promise<void>((resolve) => {
            resolveWaiter = resolve;
            queue.push(resolve);
        });

        if (deadline === null) {
            await waiterP;
            continue;
        }

        const remaining = deadline - Date.now();
        if (remaining <= 0) {
            removeFromQueue(queue, resolveWaiter);
            throw new Error(
                `ONNX slot acquisition timed out after ${timeoutMs}ms — ` +
                `weight ${weight} exceeds the concurrency cap (${cap}), and another exclusive-mode ` +
                `session is already holding the gate for its full lifetime. This model cannot run ` +
                `concurrently with the session currently holding the ONNX gate.`
            );
        }

        const TIMEOUT = Symbol('onnx-slot-acquire-timeout');
        const outcome = await Promise.race([
            waiterP.then(() => 'resolved' as const),
            new Promise<typeof TIMEOUT>((resolve) => setTimeout(() => resolve(TIMEOUT), remaining)),
        ]);
        if (outcome === TIMEOUT) {
            removeFromQueue(queue, resolveWaiter);
            throw new Error(
                `ONNX slot acquisition timed out after ${timeoutMs}ms — ` +
                `weight ${weight} exceeds the concurrency cap (${cap}), and another exclusive-mode ` +
                `session is already holding the gate for its full lifetime. This model cannot run ` +
                `concurrently with the session currently holding the ONNX gate.`
            );
        }
        // Resolved normally within the deadline — loop re-checks canAcquireNow.
    }

    if (priority === 'high') _sem.inFlightHigh += weight;
    else _sem.inFlightNormal += weight;
    if (exclusive) _sem.exclusiveInFlight = (_sem.exclusiveInFlight ?? 0) + 1;

    let released = false;
    return () => {
        if (released) return;
        released = true;
        if (priority === 'high') _sem.inFlightHigh -= weight;
        else _sem.inFlightNormal -= weight;
        if (exclusive) _sem.exclusiveInFlight = Math.max(0, (_sem.exclusiveInFlight ?? 0) - 1);
        // Wake EVERY waiter, not just one: a multi-unit release (weight > 1)
        // can free capacity for more than one queued weight-1 waiter, and a
        // single-wake design (correct when every release always freed
        // exactly what one waiter needed) would leave the extra capacity
        // idle with nobody polling for it. Each woken waiter re-checks
        // canAcquireNow itself (the `while` loop above) and re-enqueues if
        // it still doesn't fit — waking more than necessary is safe, just
        // slightly less efficient than a targeted wake.
        const highWaiters = _sem.waitersHigh.splice(0);
        const normalWaiters = _sem.waitersNormal.splice(0);
        highWaiters.forEach(resolve => resolve());
        normalWaiters.forEach(resolve => resolve());
    };
}

// ── Available-memory measurement ───────────────────────────────────────────
//
// CRITICAL: `os.freemem()` is the WRONG metric for "can I afford to load a
// model right now". On macOS it returns ONLY the truly-free page list, which
// the kernel deliberately keeps near-zero — idle RAM is used as file cache
// (inactive/speculative pages) and reclaimed instantly on demand. On a healthy
// 16-48GB Mac `os.freemem()` routinely reads 100-400MB, so a 2GB floor tested
// against it refuses EVERY local ONNX session (embedder, reranker, intent
// classifier, Whisper) essentially always — even with tens of GB reclaimable.
// This silently killed on-device embeddings/RAG for keyless users (the model
// is installed and preflight-verified, but the gate wrongly reports OOM).
//
// The right metric is AVAILABLE memory (free + reclaimable), which is what
// Activity Monitor / `top` mean by "available":
//   - macOS:  vm_stat → (free + inactive + speculative) * page_size
//   - Linux:  /proc/meminfo → MemAvailable
//   - Windows: os.freemem(), which libuv reads as GlobalMemoryStatusEx
//             ullAvailPhys — already Task Manager's "Available".
//   - other:  fall back to os.freemem() (best effort).
//
// Measurement is cached briefly (the value only needs to gate a burst of model
// loads at ingest/boot; spawning `vm_stat` per chunk would be wasteful).

const AVAIL_MEM_CACHE_TTL_MS = 1000;

/** Which probe produced a reading. The figures are not equivalent across OSes, so logs name it. */
export type AvailableMemorySource = 'override' | 'vm_stat' | 'meminfo' | 'freemem';
export interface AvailableMemoryReading {
    gb: number;
    source: AvailableMemorySource;
}
let availMemCache: { reading: AvailableMemoryReading; at: number } | null = null;

/** The OS reads behind measureAvailableMemory(); injectable so every platform branch is testable on any host. */
export interface AvailableMemoryProbes {
    /** `vm_stat` output (macOS). */
    vmStat(): string;
    /** /proc/meminfo contents (Linux). */
    meminfo(): string;
    /** os.freemem() in bytes. */
    freemem(): number;
}

const SYSTEM_MEMORY_PROBES: AvailableMemoryProbes = {
    // execFileSync (no shell) — args are fixed literals, no injection surface.
    vmStat: () => execFileSync('vm_stat', [], { encoding: 'utf8', timeout: 1000 }),
    meminfo: () => fs.readFileSync('/proc/meminfo', 'utf8'),
    freemem: () => os.freemem(),
};

/** macOS: parse `vm_stat` into available GB (free + inactive + speculative). */
function parseVmStatAvailableGB(out: string): number | null {
    // "Mach Virtual Memory Statistics: (page size of 16384 bytes)"
    const pageSize = Number.parseInt(out.match(/page size of (\d+) bytes/)?.[1] || '4096', 10);
    const pages = (label: string): number => {
        const m = out.match(new RegExp(`${label}:\\s+(\\d+)\\.`));
        return m ? Number.parseInt(m[1], 10) : 0;
    };
    const free = pages('Pages free');
    const inactive = pages('Pages inactive');
    const speculative = pages('Pages speculative');
    if (!Number.isFinite(pageSize) || pageSize <= 0) return null;
    const bytes = (free + inactive + speculative) * pageSize;
    return bytes / 1024 ** 3;
}

/** Linux: read MemAvailable (kB) from /proc/meminfo. */
function parseMeminfoAvailableGB(meminfo: string): number | null {
    const kb = Number.parseInt(meminfo.match(/^MemAvailable:\s+(\d+)\s+kB/m)?.[1] || '', 10);
    if (!Number.isFinite(kb)) return null;
    return (kb * 1024) / 1024 ** 3;
}

/**
 * One uncached measurement of AVAILABLE memory for `platform`, or null when
 * nothing usable could be read.
 *
 * A reading of 0 counts as "could not measure", never "no memory": libuv
 * reports a failed GlobalMemoryStatusEx (Windows) as 0 bytes, and a vm_stat
 * whose labels did not parse sums to 0 pages. A running machine never has
 * 0 bytes available, and refusing on that would block every local model for no
 * real reason — the gates fail OPEN on a failed measurement instead.
 */
export function measureAvailableMemory(
    platform: NodeJS.Platform,
    probes: AvailableMemoryProbes = SYSTEM_MEMORY_PROBES,
): AvailableMemoryReading | null {
    let gb: number | null = null;
    let source: AvailableMemorySource = 'freemem';
    try {
        if (platform === 'darwin') { gb = parseVmStatAvailableGB(probes.vmStat()); source = 'vm_stat'; }
        else if (platform === 'linux') { gb = parseMeminfoAvailableGB(probes.meminfo()); source = 'meminfo'; }
    } catch {
        gb = null;
    }
    if (gb != null && Number.isFinite(gb) && gb > 0) return { gb, source };
    // Windows' primary probe, and the macOS/Linux fallback when theirs failed:
    // there os.freemem() is a conservative (low) estimate, so the gate leans
    // toward refusing, as it always has.
    let bytes: number;
    try {
        bytes = probes.freemem();
    } catch {
        return null;
    }
    if (!Number.isFinite(bytes) || bytes <= 0) return null;
    return { gb: bytes / 1024 ** 3, source: 'freemem' };
}

/** One-line picture of who holds the gate, for logs and actionable errors. */
export function describeOnnxGate(): string {
    const cap = readMaxConcurrent();
    const budget = readHighPriorityBudget();
    return `${_sem.inFlightNormal}/${cap} background ONNX sessions and ${_sem.inFlightHigh}/${budget} ` +
        `high-priority (STT) sessions in use` +
        `${(_sem.exclusiveInFlight ?? 0) > 0 ? ', an exclusive holder is running' : ''}; ` +
        `${_sem.waitersHigh.length} high-priority + ${_sem.waitersNormal.length} normal-priority waiting`;
}

/**
 * `acquireOnnxSlot` with a deadline. Rejects with an actionable message when
 * no slot frees within `timeoutMs`; a slot that arrives after the deadline is
 * released immediately so the abandoned waiter can never hold the gate.
 *
 * Why this exists (2026-09-11, live-reproduced): the local embedding and
 * reranker workers each hold a slot for the app lifetime. With the default cap
 * of 2 that is the whole gate, so a per-channel local STT worker's plain
 * `acquireOnnxSlot('high')` waited FOREVER — no log, no error — and that
 * channel transcribed nothing for the entire meeting (the interviewer channel
 * never even logged "Cold-starting worker"). A bounded wait turns a silent
 * dead channel into a visible STT failure the user can act on.
 */
export function acquireOnnxSlotWithin(
    priority: OnnxSlotPriority,
    weight: number,
    timeoutMs: number,
    label: string = 'onnx',
): Promise<() => void> {
    return new Promise((resolve, reject) => {
        let settled = false;
        const slowLog = setTimeout(() => {
            if (!settled) console.warn(`[OnnxGate] ${label} has waited ${Math.min(3000, timeoutMs)}ms for an ONNX session — ${describeOnnxGate()}`);
        }, Math.min(3000, timeoutMs));
        (slowLog as any).unref?.();
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            clearTimeout(slowLog);
            reject(new Error(
                `${label}: no ONNX session slot became free within ${timeoutMs}ms — ${describeOnnxGate()}. ` +
                `Raise NATIVELY_ONNX_HIGH_PRIORITY_SESSIONS (STT channels) or NATIVELY_ONNX_MAX_CONCURRENT_SESSIONS ` +
                `(background models), or use a cloud STT provider.`,
            ));
        }, timeoutMs);
        (timer as any).unref?.();
        acquireOnnxSlot(priority, weight).then(
            (release) => {
                if (settled) { release(); return; } // too late — never hold the gate from an abandoned wait
                settled = true;
                clearTimeout(timer);
                clearTimeout(slowLog);
                resolve(release);
            },
            (err) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                clearTimeout(slowLog);
                reject(err);
            },
        );
    });
}

/**
 * Best-effort AVAILABLE (not merely free) system memory, with the probe that
 * produced it. See measureAvailableMemory() for the per-OS probes and the
 * os.freemem() fallback. Successful readings are cached for
 * AVAIL_MEM_CACHE_TTL_MS to avoid spawning vm_stat per model load.
 *
 * Override for tests / incident tuning with NATIVELY_ONNX_AVAILABLE_MEM_GB
 * (a fixed value forces the gate deterministically).
 *
 * Throws when memory could not be measured at all; every gate catches that
 * and fails OPEN.
 */
export function getAvailableMemoryReading(): AvailableMemoryReading {
    const override = process.env.NATIVELY_ONNX_AVAILABLE_MEM_GB;
    if (override) {
        const n = Number.parseFloat(override);
        if (Number.isFinite(n) && n >= 0) return { gb: n, source: 'override' };
    }

    const now = Date.now();
    if (availMemCache && now - availMemCache.at < AVAIL_MEM_CACHE_TTL_MS) {
        return availMemCache.reading;
    }

    const reading = measureAvailableMemory(process.platform);
    if (!reading) throw new Error('available memory could not be measured');
    availMemCache = { reading, at: now };
    return reading;
}

/** getAvailableMemoryReading() in GB. Throws when memory could not be measured. */
export function getAvailableMemoryGB(): number {
    return getAvailableMemoryReading().gb;
}

/**
 * Available-memory floor for admitting a new ONNX session. Returns true if the
 * system has at least `NATIVELY_ONNX_MIN_FREE_GB` (default 2.0 GB) of
 * AVAILABLE memory (free + OS-reclaimable cache), NOT merely `os.freemem()`.
 * See getAvailableMemoryGB() for why the distinction is load-bearing on macOS.
 *
 * Fails OPEN (returns true) if the measurement itself throws — refusing on
 * a measurement failure would block the app for no real reason.
 */
export function hasEnoughMemoryForOnnxSession(extraGB: number = 0): boolean {
    return checkMemoryForOnnxSession(extraGB).ok;
}

/**
 * The shared-floor gate (plus the caller's model headroom), returning the
 * reading it decided on — the same shape as checkMemoryForModelSize(), so
 * every ONNX loader reports a refusal through describeModelMemoryShortfall().
 * Fails OPEN on a measurement error.
 */
export function checkMemoryForOnnxSession(extraGB: number = 0): ModelMemoryCheck {
    return checkAvailableMemoryAgainst(getMinFreeGBForOnnxSession(extraGB));
}

/**
 * Returns the current free-memory floor in GB (live, env-aware), plus the
 * caller's model-specific headroom.
 *
 * `extraGB` makes the gate MODEL-AWARE (2026-09-22). The shared floor is blind
 * to what is about to load, so without it a 492 MB embedding model was admitted
 * under exactly the conditions that admit a 134 MB one. A caller loading a
 * heavier model passes its extra footprint (see
 * BUNDLED_LOCAL_EMBEDDING.extraMemoryHeadroomGB). Every existing caller omits
 * it and is therefore unchanged.
 */
export function getMinFreeGBForOnnxSession(extraGB: number = 0): number {
    return readMinFreeGB() + sanitizeExtraGB(extraGB);
}

// ── Model-size-aware floor for the local STT models ────────────────────────
//
// The shared floor above is one number (2 GB) for every model. That is the
// right order of magnitude for a 1 GB Whisper Large v3 Turbo and far too much
// for the 26 MB Moonshine Tiny that the app itself recommends for small
// machines: an 8 GB laptop with a call client and a browser open routinely has
// less than 2 GB available, so local STT refused to start on exactly the
// hardware the smallest model exists for.
//
// A model needs roughly its own file size again in working memory once loaded
// (weights plus session buffers), so the floor is a fixed margin plus twice
// the catalog size — and never MORE than the shared floor, so no model is
// refused under conditions that admit it today. This only ever lowers the bar
// for small models:
//
//   Moonshine Tiny   26 MB  -> 0.55 GB      Whisper Small     486 MB -> 1.45 GB
//   Moonshine Base   60 MB  -> 0.62 GB      Parakeet TDT v3   670 MB -> 1.81 GB
//   Whisper Base    130 MB  -> 0.75 GB      Large v3 Turbo   2850 MB -> 2.00 GB (shared floor)
//
// NATIVELY_ONNX_MIN_FREE_GB still sets the ceiling, so an operator override
// (including 0, which disables the gate) keeps working.
const MODEL_FLOOR_MARGIN_GB = 0.5;
const MODEL_FLOOR_SIZE_FACTOR = 2;

/** Available-memory floor (GB) for loading a model of `modelSizeMb`. Unknown size → the shared floor. */
export function getMinFreeGBForModelSize(modelSizeMb: number | undefined | null): number {
    const shared = readMinFreeGB();
    if (typeof modelSizeMb !== 'number' || !Number.isFinite(modelSizeMb) || modelSizeMb <= 0) return shared;
    const needed = MODEL_FLOOR_MARGIN_GB + (modelSizeMb / 1024) * MODEL_FLOOR_SIZE_FACTOR;
    return Math.min(shared, Math.round(needed * 100) / 100);
}

/** One reading of the local-STT memory gate: the figure compared, and the floor it was compared to. */
export interface ModelMemoryCheck {
    ok: boolean;
    /** null when the measurement threw (the gate then fails OPEN). */
    availableGB: number | null;
    /** The probe behind availableGB; null with it. */
    source: AvailableMemorySource | null;
    floorGB: number;
}

/**
 * The model-size gate, returning the reading it decided on so a refusal can
 * report that exact figure instead of measuring again (the 1s cache can expire
 * between the check and the message). Fails OPEN on a measurement error.
 */
export function checkMemoryForModelSize(modelSizeMb: number | undefined | null): ModelMemoryCheck {
    return checkAvailableMemoryAgainst(getMinFreeGBForModelSize(modelSizeMb));
}

function checkAvailableMemoryAgainst(floorGB: number): ModelMemoryCheck {
    let reading: AvailableMemoryReading;
    try {
        reading = getAvailableMemoryReading();
    } catch {
        return { ok: true, availableGB: null, source: null, floorGB };
    }
    return { ok: reading.gb >= floorGB, availableGB: reading.gb, source: reading.source, floorGB };
}

/**
 * "0.61GB available, this model needs 0.62GB" for a refused check (issue #707).
 * The one wording for every local ONNX loader (STT, embedder, reranker).
 * The reading is rounded DOWN: the floor is already on a 0.01 GB grid, so a
 * refused reading always prints below it. Plain rounding printed
 * "0.62GB available, this model needs 0.62GB" for a 0.6151 GB refusal.
 */
export function describeModelMemoryShortfall(check: ModelMemoryCheck): string {
    if (check.availableGB == null) return `this model needs ${check.floorGB}GB`;
    const shown = (Math.floor(check.availableGB * 100) / 100).toFixed(2);
    return `${shown}GB available, this model needs ${check.floorGB}GB`;
}

/**
 * `hasEnoughMemoryForOnnxSession` for one specific local STT model. Fails OPEN
 * on a measurement error, exactly like the shared check.
 */
export function hasEnoughMemoryForModelSize(modelSizeMb: number | undefined | null): boolean {
    return checkMemoryForModelSize(modelSizeMb).ok;
}

/** Negative, NaN or non-finite headroom must never LOWER the shared floor. */
function sanitizeExtraGB(extraGB: number): number {
    return Number.isFinite(extraGB) && extraGB > 0 ? extraGB : 0;
}

/**
 * True when a new high-priority (STT channel) session of `weight` would have to
 * WAIT right now. Read-only: it never changes admission. Lets the model
 * preloader see that a live channel is starving so it can give back a worker
 * nobody has claimed (see ModelPreloader.yieldUnclaimedWorkerIfStarving).
 */
export function isHighPriorityOnnxBudgetExhausted(weight: number = 1): boolean {
    return !canAcquireNow('high', weight);
}

/** Returns the current max-concurrent cap (live, env-aware). */
export function getHighPriorityOnnxBudget(): number {
    return readHighPriorityBudget();
}

export function getMaxConcurrentOnnxSessions(): number {
    return readMaxConcurrent();
}

/**
 * Test-only: reset the gate state so a test can re-exercise concurrent
 * acquisition from scratch. Not exported in the main barrel — only for the
 * test suite.
 */
export function __resetOnnxGateForTests(): void {
    _sem.inFlightNormal = 0;
    _sem.inFlightHigh = 0;
    _sem.exclusiveInFlight = 0;
    _sem.waitersNormal.length = 0;
    _sem.waitersHigh.length = 0;
}
