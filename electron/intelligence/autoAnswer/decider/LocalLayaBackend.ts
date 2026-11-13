/**
 * The local decider backend (campaign Phase 4.2): the fine-tuned Laya decider in a worker thread
 * (deciderWorker.ts) through onnxruntime-node. Follows RouterModel.ts for the host side: an ONNX
 * slot per call, a free-memory floor, a cross-launch load sentinel, cooperative shutdown.
 *
 * Platform: the execution-provider list comes from deciderPlatform.executionProvidersFor with an
 * INJECTED platform (darwin and win32 tested; anything else is unavailable, not routed through
 * another platform's path).
 *
 * At most one decision in flight. A native ONNX run cannot be cancelled, so a second candidate
 * arriving while one runs is refused at once and the cascade escalates it, instead of queueing
 * behind a run whose result is already too late.
 */
import path from 'path';
import fs from 'fs';
import { type BackendDecision, type DecisionBackend, type DeciderRequest, type DeciderThresholds, ESCALATE_ALL } from './DecisionBackend';
import { parseDeciderManifest, type DeciderManifest } from './deciderManifest';
import { executionProvidersFor, deciderIntraOpThreads, type DeciderEp } from './deciderPlatform';

export const DECIDER_ONNX_FAMILY = 'decider' as const;
/** Session creation for a ~400 MB int8 graph; the first decide waits at most this long. */
export const DECIDER_LOAD_TIMEOUT_MS = 15_000;

export interface WorkerLike {
    postMessage(msg: unknown): void;
    on(event: 'message' | 'error' | 'exit', fn: (arg: any) => void): unknown;
    unref?(): void;
}

export interface LocalLayaDeps {
    /** The downloaded model directory (Phase 6), or null when there is none. */
    modelDir(): string | null;
    platform: NodeJS.Platform;
    env?: Record<string, string | undefined>;
    logicalCores?: number;
    createWorker?(): WorkerLike;
    exists?(p: string): boolean;
    readFile?(p: string): string;
    /** ONNX slot and memory gate (onnxThreadConfig). Resolve null when no slot within `ms`. */
    acquireSlot?(ms: number): Promise<(() => void) | null>;
    enoughMemory?(): boolean;
    /** Load sentinel (onnxLoadSentinel): written before spawn, cleared on ready. */
    sentinel?: { write(id: string): void; clear(id: string): void; poisoned(): boolean };
    retire?(w: WorkerLike): void;
    clockNow?(): number;
}

type Pending = { resolve: (v: any) => void; reject: (e: any) => void; timer: ReturnType<typeof setTimeout> };

export class LocalLayaBackend implements DecisionBackend {
    readonly kind = 'local' as const;
    private worker: WorkerLike | null = null;
    private pending = new Map<number, Pending>();
    private seq = 0;
    private loaded = false;
    private busy = false;
    private disabled = false;
    private poisonChecked = false;
    private eps: DeciderEp[] | null;
    /** The EP the session actually came up on (status message), for telemetry and the bench. */
    activeEp: DeciderEp | null = null;

    constructor(private readonly deps: LocalLayaDeps) {
        try { this.eps = executionProvidersFor(deps.platform, deps.env ?? {}); } catch { this.eps = null; }
    }

    private exists(p: string): boolean {
        try { return (this.deps.exists ?? fs.existsSync)(p); } catch { return false; }
    }

    private manifestCache: { dir: string; m: DeciderManifest | null } | null = null;

    /** The model's parsed manifest, or null when it is missing or invalid (then nothing decides). */
    manifest(): DeciderManifest | null {
        const dir = this.deps.modelDir();
        if (!dir) return null;
        if (this.manifestCache?.dir === dir) return this.manifestCache.m;
        let m: DeciderManifest | null = null;
        try {
            const read = this.deps.readFile ?? ((p: string) => fs.readFileSync(p, 'utf8'));
            m = parseDeciderManifest(JSON.parse(read(path.join(dir, 'manifest.json'))));
        } catch { m = null; }
        this.manifestCache = { dir, m };
        return m;
    }

    /** Per-label thresholds fitted on calib and shipped in the manifest; ESCALATE_ALL without one. */
    thresholds(): DeciderThresholds {
        return this.manifest()?.thresholds ?? ESCALATE_ALL;
    }

    isAvailable(): boolean {
        if (this.disabled || !this.eps) return false;
        const dir = this.deps.modelDir();
        if (!dir || !this.exists(path.join(dir, 'manifest.json')) || !this.manifest()) return false;
        if (!this.poisonChecked && !this.worker) {
            this.poisonChecked = true;
            if (this.deps.sentinel?.poisoned()) { this.disabled = true; return false; }
        }
        return true;
    }

    warmUp(): void {
        if (!this.isAvailable() || this.loaded) return;
        this.post({ type: 'init' }, DECIDER_LOAD_TIMEOUT_MS).then(() => { this.loaded = true; }, () => { /* decide() reports */ });
    }

    async decide(req: DeciderRequest, signal?: AbortSignal): Promise<BackendDecision> {
        if (!this.isAvailable()) throw new Error('local decider unavailable');
        if (this.deps.enoughMemory && !this.deps.enoughMemory()) throw new Error('local decider: low memory');
        if (this.busy) throw new Error('local decider busy');
        if (signal?.aborted) throw new Error('aborted');
        this.busy = true;
        let release: (() => void) | null = null;
        try {
            const budget = this.loaded ? 60_000 : DECIDER_LOAD_TIMEOUT_MS;
            if (this.deps.acquireSlot) {
                release = await this.deps.acquireSlot(budget);
                if (!release) throw new Error('local decider: no ONNX slot');
            }
            const result = await this.post({ type: 'decide', req }, budget, signal);
            this.loaded = true;
            return result as BackendDecision;
        } finally {
            release?.();
            this.busy = false;
        }
    }

    dispose(): void {
        const w = this.worker;
        this.worker = null;
        this.loaded = false;
        this.failAll(new Error('local decider disposed'));
        if (w) { try { (this.deps.retire ?? ((x) => x.postMessage({ type: 'shutdown' })))(w); } catch { /* best effort */ } }
    }

    private modelId(): string {
        return `natively/auto-answer-decider@${this.deps.modelDir() ?? ''}`;
    }

    private getWorker(): WorkerLike {
        if (this.worker) return this.worker;
        if (!this.deps.createWorker) throw new Error('local decider: no worker factory');
        this.deps.sentinel?.write(this.modelId());
        const w = this.deps.createWorker();
        w.on('message', (msg: any) => {
            if (msg?.type === 'status') {
                if (msg.status?.type === 'ready') {
                    this.deps.sentinel?.clear(this.modelId());
                    this.activeEp = msg.ep ?? null;
                } else if (msg.status?.recoverable === false) {
                    this.disabled = true;
                }
                return;
            }
            const p = this.pending.get(msg?.requestId);
            if (!p) return;
            clearTimeout(p.timer);
            this.pending.delete(msg.requestId);
            if (msg.type === 'error') p.reject(new Error(msg.error));
            else p.resolve(msg.result ?? null);
        });
        const gone = () => { this.failAll(new Error('local decider worker gone')); this.worker = null; this.loaded = false; };
        w.on('error', gone);
        w.on('exit', gone);
        w.unref?.();
        this.worker = w;
        return w;
    }

    private failAll(e: Error): void {
        for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(e); }
        this.pending.clear();
    }

    private post(payload: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<any> {
        const requestId = ++this.seq;
        return new Promise((resolve, reject) => {
            const finish = () => { this.pending.delete(requestId); signal?.removeEventListener('abort', onAbort); };
            const onAbort = () => { const p = this.pending.get(requestId); if (p) { clearTimeout(p.timer); finish(); reject(new Error('aborted')); } };
            const timer = setTimeout(() => { finish(); reject(new Error('local decider timeout')); }, timeoutMs);
            this.pending.set(requestId, {
                resolve: (v) => { finish(); resolve(v); },
                reject: (e) => { finish(); reject(e); },
                timer,
            });
            signal?.addEventListener('abort', onAbort, { once: true });
            try {
                this.getWorker().postMessage({
                    ...payload, requestId,
                    modelDir: this.deps.modelDir(),
                    eps: this.eps,
                    threads: deciderIntraOpThreads(this.deps.logicalCores ?? 2, this.deps.env ?? {}),
                });
            } catch (e) {
                clearTimeout(timer);
                finish();
                reject(e);
            }
        });
    }
}

/** Production wiring: the real worker, slot gate, sentinel and shutdown. Lazy requires keep this file pure for tests. */
export function createLocalLayaBackend(modelDir: () => string | null, platform: NodeJS.Platform = process.platform): LocalLayaBackend {
    const os = require('os') as typeof import('os');
    const { Worker } = require('worker_threads') as typeof import('worker_threads');
    const cfg = require('../../../utils/onnxThreadConfig') as typeof import('../../../utils/onnxThreadConfig');
    const sd = require('../../../utils/onnxWorkerShutdown') as typeof import('../../../utils/onnxWorkerShutdown');
    const sen = require('../../../utils/onnxLoadSentinel') as typeof import('../../../utils/onnxLoadSentinel');
    const workerPath = () => {
        const candidates = [
            path.join(__dirname, 'deciderWorker.js'),
            path.join(__dirname, 'decider', 'deciderWorker.js'),
            path.join(__dirname, 'intelligence', 'autoAnswer', 'decider', 'deciderWorker.js'),
            path.join(__dirname, 'electron', 'intelligence', 'autoAnswer', 'decider', 'deciderWorker.js'),
        ];
        let p = candidates.find((c) => fs.existsSync(c)) ?? candidates[0];
        if (p.includes('app.asar') && !p.includes('app.asar.unpacked')) p = p.replace('app.asar', 'app.asar.unpacked');
        return p;
    };
    return new LocalLayaBackend({
        modelDir, platform, env: process.env,
        logicalCores: os.cpus()?.length ?? 2,
        createWorker: () => sd.trackOnnxWorker(new Worker(workerPath())) as unknown as WorkerLike,
        acquireSlot: (ms) => new Promise((resolve) => {
            let settled = false;
            const t = setTimeout(() => { if (!settled) { settled = true; resolve(null); } }, ms);
            cfg.acquireOnnxSlot('normal', 1).then(
                (rel) => { if (settled) { rel(); return; } settled = true; clearTimeout(t); resolve(rel); },
                () => { if (!settled) { settled = true; clearTimeout(t); resolve(null); } },
            );
        }),
        enoughMemory: () => cfg.hasEnoughMemoryForOnnxSession(),
        sentinel: {
            write: (id) => sen.writeLoadSentinel(DECIDER_ONNX_FAMILY, id),
            clear: (id) => sen.clearLoadSentinel(DECIDER_ONNX_FAMILY, id),
            poisoned: () => { const s = sen.consumePoisonedOnnxLoad(DECIDER_ONNX_FAMILY); return !!s && sen.isSentinelWithinTtl(s); },
        },
        retire: (w) => sd.retireOnnxWorker(w as any),
    });
}
