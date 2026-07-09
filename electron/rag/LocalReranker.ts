// electron/rag/LocalReranker.ts
//
// Phase 1 (smart-retrieval rollout) — LOCAL cross-encoder reranker.
//
// A cross-encoder scores (query, passage) JOINTLY and is far more accurate than
// the bi-encoder cosine fusion used on the hot path — at the cost of running one
// model pass per candidate. We run it ON-DEVICE via @huggingface/transformers
// (the SAME ONNX runtime already loaded for the MiniLM embedder and the
// mobilebert intent classifier), so the escalation costs $0, hits no API, and is
// immune to the Gemini 429s that are routine in this app.
//
// LOAD POSTURE:
//   • ESM-only package → forced runtime import() via `new Function` inside the
//     dedicated worker (see localRerankerWorker.ts for the why).
//   • Packaged prod: local_files_only, model read from resources/models. The
//     reranker model is NOT bundled yet, so in a packaged build load() fails and
//     the caller falls through to the existing top-K — that is the intended
//     default-OFF posture until the model is added to extraResources.
//   • Dev: allowRemoteModels so the model is fetched + cached on first use.
//
// WORKER-ISOLATED (2026-07-05 SIGTRAP crash hardening): the actual ONNX
// cross-encoder model/tokenizer load and inference (the forward pass in
// rerank()) now run inside a dedicated worker_threads.Worker, NOT on the
// Electron main thread — mirroring the isolation already applied to
// LocalEmbeddingProvider, Whisper's worker, and IntentClassifier's zero-shot
// worker. See localEmbeddingWorker.ts for the full crash-forensics writeup:
// this file previously had the identical unsafe main-thread ONNX pattern,
// fixed now while the reranker is still inert rather than waiting for it to
// go live and hit the same crash.
//
// Everything here is best-effort: any failure (package missing, model absent,
// API shape mismatch) resolves to `null`, never throws, and the retriever keeps
// its current behavior. The Phase-1 flag (`ragLocalRerank`) gates whether this
// is consulted at all.

import path from 'path';
import fs from 'fs';
import os from 'os';
import { Worker } from 'worker_threads';
import { app } from 'electron';
import {
    acquireOnnxSlot,
    hasEnoughMemoryForOnnxSession,
    getMinFreeGBForOnnxSession,
} from '../utils/onnxThreadConfig';
import {
    clearLoadSentinel as clearOnnxLoadSentinel,
    consumePoisonedOnnxLoad,
    isSentinelWithinTtl,
    writeLoadSentinel as writeOnnxLoadSentinel,
} from '../utils/onnxLoadSentinel';

export interface RerankResult {
    /** Index into the input passages array. */
    index: number;
    /** Cross-encoder relevance score (higher = more relevant). Raw logit. */
    score: number;
}

/** Process-local poison flag: set by the cold-start consume path to tell
 *  ensureLoaded + rerank to fast-fail this launch. */
let startupPoisoned = false;

/**
 * Default model: bge-reranker-base, ONNX port that runs in transformers.js.
 * Small cross-encoder (~1.1GB fp32 / ~280MB quantized) — quantized is used.
 * Override via NATIVELY_RERANKER_MODEL for experimentation.
 */
const DEFAULT_RERANKER_MODEL = 'Xenova/bge-reranker-base';

const WORKER_INIT_TIMEOUT_MS = 60_000; // model load (cold disk read + ORT session init)
const WORKER_RERANK_TIMEOUT_MS = 15_000; // a single rerank() call (bounded candidate pool ~30)

class LocalRerankerImpl {
    private worker: Worker | null = null;
    private requestId = 0;
    private pendingRequests = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void; timer: ReturnType<typeof setTimeout> }>();
    private loadingPromise: Promise<void> | null = null;
    private loadFailed = false;
    private loaded = false;
    // Release function for the shared ONNX slot acquired in ensureLoaded().
    // Wired into worker error/exit handlers so the slot frees when the worker
    // dies — the gate is the structural fix for the multi-ONNX BFCArena crash
    // (2026-07-06) and must release promptly or it deadlocks other consumers.
    private slotRelease: (() => void) | null = null;
    private readonly modelId: string;
    private readonly modelPath: string;
    private readonly dtype: string;

    constructor() {
        this.modelId = (process.env.NATIVELY_RERANKER_MODEL || '').trim() || DEFAULT_RERANKER_MODEL;
        // Resolve the bundled model dir with the same candidate-search pattern
        // as LocalEmbeddingProvider.resolveModelPath — try packaged
        // resourcesPath/models, then app-relative resources/models (works for
        // `electron .` from repo AND Playwright launching dist-electron/main.js
        // where getAppPath() points at the built dir). Verifies the candidate by
        // checking for the model's tokenizer.json so we don't silently fall
        // back to a default HF cache dir that would trigger a redownload on
        // every cold start.
        this.modelPath = LocalRerankerImpl.resolveModelPath(this.modelId);
        // transformers.js v3 selects the ONNX variant by `dtype` (the old
        // `quantized: true` is ignored). q8 loads model_quantized.onnx
        // (~280MB) instead of the fp32 model.onnx (~1.1GB) — the bundled
        // download fetches the quantized variant, so this keeps both the
        // installer and the loaded footprint small. NATIVELY_RERANKER_DTYPE
        // overrides (e.g. 'fp32') for accuracy experiments.
        this.dtype = (process.env.NATIVELY_RERANKER_DTYPE || 'q8').trim() || 'q8';
    }

    private static resolveModelPath(modelId: string): string {
        const candidates: string[] = [];
        if (process.env.NATIVELY_LOCAL_MODELS_PATH) {
            candidates.push(process.env.NATIVELY_LOCAL_MODELS_PATH);
        }
        // 2026-07-06: lazy-download user-data cache is the primary location
        // (populated by rerankerDownloadProvider on first mode activation).
        // Falls through to bundled resourcesPath candidates for legacy
        // installs that already have the model in the bundle from a prior
        // v2.7.x build.
        try {
            const userDataDir = app?.getPath?.('userData') || '';
            // Fallback to HOME-based path when app.getPath isn't ready
            // (e.g. ELECTRON_RUN_AS_NODE test/probe mode).
            const homeLocalModels = process.env.HOME
                ? path.join(process.env.HOME, 'Library/Application Support/natively/local-models')
                : '';
            if (userDataDir) candidates.push(path.join(userDataDir, 'local-models'));
            if (homeLocalModels && homeLocalModels !== path.join(userDataDir || '', 'local-models')) {
                candidates.push(homeLocalModels);
            }
        } catch { /* app not ready yet */ }
        if (app?.isPackaged) {
            candidates.push(path.join(process.resourcesPath || '', 'models'));
        }
        let appPath = '';
        try { appPath = app?.getAppPath?.() || ''; } catch { /* not ready */ }
        if (appPath) {
            candidates.push(path.join(appPath, 'resources', 'models'));
            candidates.push(path.join(appPath, '..', 'resources', 'models'));
            candidates.push(path.join(appPath, '..', '..', 'resources', 'models'));
        }
        // modelId like 'Xenova/bge-reranker-base' -> 'Xenova/bge-reranker-base/tokenizer.json'
        const marker = path.join(...modelId.split('/'), 'tokenizer.json');
        for (const c of candidates) {
            try { if (fs.existsSync(path.join(c, marker))) return c; } catch { /* keep trying */ }
        }
        // Last resort: return the packaged path even if not verified, so the
        // worker gets SOMETHING coherent. The worker will then try the
        // allowRemoteModels path (dev) or local_files_only (prod).
        return path.join(process.resourcesPath || appPath || process.cwd(), 'models');
    }

    private getWorkerPath(): string {
        const candidates = [
            path.join(__dirname, 'localRerankerWorker.js'),
            path.join(__dirname, 'rag', 'localRerankerWorker.js'),
            path.join(__dirname, 'electron', 'rag', 'localRerankerWorker.js'),
        ];

        let resolvedPath = candidates.find(p => fs.existsSync(p)) ?? candidates[0];
        if (resolvedPath.includes('app.asar') && !resolvedPath.includes('app.asar.unpacked')) {
            resolvedPath = resolvedPath.replace('app.asar', 'app.asar.unpacked');
        }
        return resolvedPath;
    }

    private getWorker(): Worker {
        if (!this.worker) {
            // Cross-launch disk sentinel: written BEFORE new Worker() so a
            // native ORT abort that kills the process before the JS `ready`
            // arrives leaves a recoverable breadcrumb for the next launch's
            // consume. Closes the cross-launch crashloop the previous version
            // shared with the Whisper bug.
            writeOnnxLoadSentinel('reranker', this.modelId);
            this.worker = new Worker(this.getWorkerPath());

            this.worker.on('message', (msg: { type: string; requestId: number; scores?: number[]; error?: string }) => {
                const pending = this.pendingRequests.get(msg.requestId);
                if (!pending) return;
                clearTimeout(pending.timer);
                this.pendingRequests.delete(msg.requestId);

                if (msg.type === 'error') {
                    pending.reject(new Error(msg.error || 'Worker error'));
                } else if (msg.type === 'ready') {
                    // Worker reached `ready` — clear the poisoned-load sentinel.
                    clearOnnxLoadSentinel('reranker', this.modelId);
                    pending.resolve(msg);
                } else {
                    pending.resolve(msg);
                }
            });

            this.worker.on('error', (err) => {
                console.warn('[LocalReranker] Worker error (rerank disabled until retry):', err);
                this.loaded = false;
                this.loadingPromise = null;
                // 2026-07-08 latch fix: loadFailed was declared + read but
                // NEVER assigned true, so every worker death mid-load let
                // isAvailable() spin up a fresh worker against the same broken
                // asset. Mirror LocalEmbeddingProvider's
                // latchNonRecoverableLoadError: only latch when we never
                // reached `loaded` (a runtime error after loaded=true is
                // NOT a load failure, just a transient hiccup). Idempotent.
                if (!this.loaded && !this.loadFailed) {
                    this.loadFailed = true;
                }
                // Free the ONNX gate slot so other consumers can proceed.
                if (this.slotRelease) { this.slotRelease(); this.slotRelease = null; }
                this.rejectAllPending(err);
            });

            this.worker.on('exit', (code) => {
                if (code !== 0) {
                    console.warn(`[LocalReranker] Worker exited with code ${code}`);
                }
                // Clear on clean exit; non-zero exit keeps the sentinel so
                // the next launch knows the previous attempt died hard.
                if (code === 0) clearOnnxLoadSentinel('reranker', this.modelId);
                // Same dead-latch fix as the `error` handler above — if we
                // died before `loaded`, latch `loadFailed` so the next call
                // doesn't re-spawn against the same broken asset.
                if (!this.loaded && code !== 0 && !this.loadFailed) {
                    this.loadFailed = true;
                }
                this.worker = null;
                this.loaded = false;
                this.loadingPromise = null;
                // Free the ONNX gate slot on worker exit (any non-zero exit
                // means the worker's session is gone; zero exits also shouldn't
                // hold a slot indefinitely).
                if (this.slotRelease) { this.slotRelease(); this.slotRelease = null; }
                this.rejectAllPending(new Error(`Worker exited with code ${code}`));
            });
        }
        return this.worker;
    }

    private rejectAllPending(err: Error): void {
        for (const [, pending] of this.pendingRequests) {
            clearTimeout(pending.timer);
            pending.reject(err);
        }
        this.pendingRequests.clear();
    }

    private postToWorker<T>(message: any, timeoutMs: number): Promise<T> {
        this.requestId = (this.requestId + 1) % Number.MAX_SAFE_INTEGER;
        const id = this.requestId;
        message.requestId = id;

        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`[LocalReranker] Worker request ${id} timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            this.pendingRequests.set(id, { resolve, reject, timer });
            this.getWorker().postMessage(message);
        });
    }

    private workerConfig(): Record<string, any> {
        return {
            modelId: this.modelId,
            modelPath: this.modelPath,
            isPackaged: Boolean(app?.isPackaged),
            dtype: this.dtype,
        };
    }

    /**
     * True if the model files are present on disk under the resolved
     * modelPath. Used by ModesManager to decide whether to trigger a lazy
     * download vs. just prewarm. Never throws.
     */
    async isCached(): Promise<boolean> {
        try {
            const marker = path.join(this.modelPath, ...this.modelId.split('/'), 'tokenizer.json');
            const onnxFile = path.join(this.modelPath, ...this.modelId.split('/'), 'onnx', `model_${this.dtype === 'q8' ? 'quantized' : ''}.onnx`);
            // Some transformers.js v3 layouts ship model.onnx without the dtype suffix.
            const onnxFileAlt = path.join(this.modelPath, ...this.modelId.split('/'), 'onnx', 'model.onnx');
            if (!fs.existsSync(marker)) return false;
            if (fs.existsSync(onnxFile)) return true;
            if (fs.existsSync(onnxFileAlt)) return true;
            return false;
        } catch {
            return false;
        }
    }

    /**
     * Phase 3: warm the model ahead of the live path (called at mode
     * activation, fire-and-forget) so a live transcript turn never pays the
     * cold-load cost inside its retrieval budget. Best-effort — swallows any
     * failure (the load-failed flag then makes later rerank() calls no-op).
     */
    async prewarm(): Promise<void> {
        try { await this.ensureLoaded(); } catch { /* logged in ensureLoaded */ }
    }

    /**
     * True once a usable model is loaded. Returns false (never throws) when the
     * model/package is unavailable — the caller treats that as "no rerank" and
     * keeps the current top-K.
     */
    async isAvailable(): Promise<boolean> {
        if (startupPoisoned) return false;
        if (this.loadFailed) return false;
        try {
            await this.ensureLoaded();
            return this.loaded;
        } catch {
            return false;
        }
    }

    private async ensureLoaded(): Promise<void> {
        if (this.loaded) return;
        if (startupPoisoned) throw new Error('reranker skipped: previous launch poisoned the load');
        if (this.loadFailed) throw new Error('reranker previously failed to load');
        if (this.loadingPromise) return this.loadingPromise;

        // Cross-loader ONNX gate (electron/utils/onnxThreadConfig.ts). Two
        // checks before admitting a new session: a free-memory floor, and a
        // shared concurrency slot. Either refusal here is non-fatal — the
        // retriever falls back to cosine top-K ordering. We do NOT latch
        // `loadFailed = true` on a gate refusal (that's reserved for actual
        // load errors); a later, less-pressured moment can retry.
        if (!hasEnoughMemoryForOnnxSession()) {
            const freeGB = (os.freemem() / 1024 ** 3).toFixed(1);
            throw new Error(
                `insufficient free memory (${freeGB}GB < ${getMinFreeGBForOnnxSession()}GB) — skipping reranker load`,
            );
        }

        // Acquire the shared slot. Held for the lifetime of this worker — the
        // release function is wired into worker `error`/`exit` handlers in
        // getWorker() so the slot frees automatically when the worker dies.
        const releaseSlot = await acquireOnnxSlot('normal');

        this.loadingPromise = (async () => {
            try {
                await this.postToWorker({ type: 'init', ...this.workerConfig() }, WORKER_INIT_TIMEOUT_MS);
                this.loaded = true;
                // Stash the release so getWorker()'s error/exit handlers can
                // call it. If we never set it (e.g. error before loaded=true),
                // release here instead.
                this.slotRelease = releaseSlot;
            } catch (e) {
                releaseSlot();
                throw e;
            }
        })();

        try {
            await this.loadingPromise;
        } catch (e) {
            // Reset transient failure state so retries are possible. The
            // genuine "load failed" latch is only set when the worker reports
            // a load error (handled via the worker `error`/`exit` handlers).
            this.loaded = false;
            console.warn('[LocalReranker] model load failed (rerank disabled, falling back to top-K):', e instanceof Error ? e.message : e);
            throw e;
        } finally {
            this.loadingPromise = null;
        }
    }

    /**
     * Score each passage against the query with the cross-encoder. Returns
     * results in DESCENDING score order. On any failure returns `null` so the
     * caller keeps the pre-rerank ordering — rerank must never make retrieval
     * worse than the baseline.
     *
     * Cost: one forward pass per passage (batched by the tokenizer). Keep the
     * candidate pool bounded (caller caps at ~30) so this stays in the
     * tens-of-milliseconds range on the local ONNX runtime.
     */
    async rerank(query: string, passages: string[]): Promise<RerankResult[] | null> {
        if (!query.trim() || passages.length === 0) return null;
        try {
            if (!(await this.isAvailable())) return null;

            const result = await this.postToWorker<{ scores?: number[] }>(
                { type: 'rerank', query, passages, ...this.workerConfig() },
                WORKER_RERANK_TIMEOUT_MS,
            );
            const data = result.scores;
            if (!data || data.length < passages.length) {
                console.warn('[LocalReranker] unexpected logits shape — skipping rerank');
                return null;
            }

            const results: RerankResult[] = passages.map((_, i) => ({ index: i, score: Number(data[i]) }));
            results.sort((a, b) => b.score - a.score);
            return results;
        } catch (e) {
            console.warn('[LocalReranker] rerank failed (keeping pre-rerank order):', e instanceof Error ? e.message : e);
            return null;
        }
    }

    /** Test-only: reset cached load state so a test can re-exercise loading. */
    __resetForTests(): void {
        if (this.worker) {
            this.worker.terminate().catch(() => {});
            this.worker = null;
        }
        // Release any held ONNX gate slot so subsequent tests start clean.
        if (this.slotRelease) { this.slotRelease(); this.slotRelease = null; }
        this.rejectAllPending(new Error('reset for tests'));
        this.loadingPromise = null;
        this.loadFailed = false;
        this.loaded = false;
    }

    /**
     * Public seed: set the loadFailed latch without otherwise touching the
     * worker. Called by the cold-start consume path when the previous process
     * died loading this model — the in-memory latch plus the on-disk sentinel
     * together force every rerank()/isAvailable() call to fast-fail this
     * launch. Idempotent.
     */
    public markStartupPoisoned(): void {
        this.loadFailed = true;
    }

    /**
     * Public reset: clear the loadFailed latch. Called by the onnx-reset-family
     * IPC to let the user retry after a successful reinstall or a temp
     * condition resolved. Idempotent.
     */
    public clearLoadFailed(): void {
        this.loadFailed = false;
    }
}

// Process-wide singleton — one model load shared across all modes/queries,
// matching the embedder/intent-classifier lifetime.
let _instance: LocalRerankerImpl | null = null;
export function getLocalReranker(): LocalRerankerImpl {
    if (!_instance) _instance = new LocalRerankerImpl();
    return _instance;
}

export type { LocalRerankerImpl };

/**
 * Cold-start helper: read the leftover reranker sentinel from disk and seed
 * the in-memory poison flag + the singleton's `loadFailed` latch so the
 * next rerank() call fast-fails. Returns the recovered sentinel record so
 * the caller can stash a recovery notice on AppState. Idempotent.
 */
export function consumeLocalRerankerSentinel(): { modelId: string; startedAt: number; attempt: number } | null {
    const consumed = consumePoisonedOnnxLoad('reranker');
    if (consumed && isSentinelWithinTtl(consumed)) {
        startupPoisoned = true;
        try {
            const inst = getLocalReranker();
            inst.markStartupPoisoned();
        } catch { /* defensive */ }
        return consumed;
    }
    return null;
}

/**
 * Public reset: clears the cold-start poison flag AND the singleton's
 * in-memory loadFailed latch, allowing the next rerank() call to attempt a
 * fresh load. Mirrors `local-whisper-reset-to-default` but generalized.
 * Idempotent.
 */
export function clearLocalRerankerPoison(): void {
    startupPoisoned = false;
    clearOnnxLoadSentinel('reranker');
    try {
        const inst = getLocalReranker();
        inst.clearLoadFailed();
    } catch { /* defensive */ }
}

/**
 * Diagnostic accessor: is the reranker currently skipped because the
 * previous launch poisoned the load?
 */
export function isLocalRerankerPoisoned(): boolean {
    return startupPoisoned;
}
