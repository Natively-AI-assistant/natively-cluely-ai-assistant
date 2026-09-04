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
//     reranker model IS bundled (stale-comment fix 2026-08-13): download-models.js
//     fetches Xenova/bge-reranker-base (q8) at postinstall, extraResources maps
//     resources/models/ → models/, and verify-packaged-local-assets.mjs lists all
//     four reranker files in REQUIRED_MODEL_FILES — the build FAILS without them.
//     If the model is genuinely absent at runtime, load() fails and the caller
//     falls through to the existing top-K (graceful degradation, not the norm).
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
import { Worker } from 'worker_threads';
import { resolveRagWorker } from './resolveRagWorker';
import { app } from 'electron';
import {
    acquireOnnxSlot,
    hasEnoughMemoryForOnnxSession,
    getMinFreeGBForOnnxSession,
    getAvailableMemoryGB,
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
 * The bundled default: ms-marco-MiniLM-L-6-v2, q8, ~24MB.
 *
 * It replaced bge-reranker-base on 2026-09-04, and the reason is the whole
 * point. Measured against a NO-RERANKER baseline on a 40-passage pool with
 * same-topic distractors (docs/reranker-benchmark-2026-09-04.md):
 *
 *     bge-reranker-base    MRR 0.7558   -0.0810 vs baseline   +3/-7   1873ms
 *     ms-marco-MiniLM-L-6  MRR 0.8688   +0.0320 vs baseline   +4/-2    211ms
 *
 * The old default was the worst reranker in that table — it made retrieval
 * measurably worse while costing 283MB of installer and ~1.9s a call. This one
 * is a twelfth of the size, nine times faster, and actually improves the
 * ranking. Both are q8, so the dtype default below is unchanged.
 *
 * Override via NATIVELY_RERANKER_MODEL for experimentation.
 */
const DEFAULT_RERANKER_MODEL = 'Xenova/ms-marco-MiniLM-L-6-v2';

/**
 * `app.getPath('userData')` rebuilt by hand, for the paths where `app` is not
 * available. Must stay identical to the installer's own fallback — the reader
 * and the writer disagreeing is how a downloaded model becomes invisible.
 */
function fallbackUserDataDir(): string {
    const home = process.env.HOME || process.env.USERPROFILE || process.cwd();
    switch (process.platform) {
        case 'darwin':
            return path.join(home, 'Library', 'Application Support', 'natively');
        case 'win32':
            return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'natively');
        default:
            return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'natively');
    }
}

const WORKER_INIT_TIMEOUT_MS = 60_000; // model load (cold disk read + ORT session init)
const WORKER_RERANK_TIMEOUT_MS = 15_000; // a single rerank() call (bounded candidate pool ~30)

/** Backstop for a disposed reranker worker that still owes replies. */
const RERANK_DISPOSE_DRAIN_MAX_MS = 30_000;

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
        // Resolution order: env override > the user's selected model > default.
        // The env var stays FIRST so an experiment or a CI pin still wins over
        // stored settings, which is what every other model knob in this repo does.
        const selected = readSelectedLocalReranker();
        // An env override replaces the SELECTION, not half of it. Taking modelId
        // from the env and dtype from the stored selection can name a file that
        // does not exist — an Ettin selection is fp32 (onnx/model.onnx) while
        // bge-reranker-base is q8 (onnx/model_quantized.onnx), so mixing them
        // asks for a variant the repo never shipped and latches loadFailed with
        // a message that names neither the env var nor the selection.
        const envModel = (process.env.NATIVELY_RERANKER_MODEL || '').trim();
        const effective = envModel ? null : selected;
        this.modelId = envModel || selected?.modelId || DEFAULT_RERANKER_MODEL;
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
        // dtype is PER MODEL, not global. bge-reranker-base ships
        // `onnx/model_quantized.onnx` (q8); the Ettin repositories ship
        // `onnx/model.onnx` (fp32) plus architecture-specific int8 exports that
        // cannot be one cross-platform choice. Applying the q8 default to an
        // Ettin model asks transformers.js for a file that is not there.
        this.dtype = (process.env.NATIVELY_RERANKER_DTYPE || '').trim()
            || effective?.dtype
            || 'q8';
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
            // Fallback for when app.getPath isn't ready (ELECTRON_RUN_AS_NODE
            // probes, tests, early boot). This MUST agree with the writer:
            // localModelInstaller.fallbackUserDataDir() picks per platform, and
            // hardcoding the macOS shape here sent Windows and Linux looking in
            // `<home>/Library/Application Support/...` — a directory nothing
            // ever writes, so a downloaded model was invisible to the reranker
            // meant to load it, and resolveModelPath fell through to its
            // unverified last resort. CLAUDE.md forbids exactly this.
            const homeLocalModels = path.join(fallbackUserDataDir(), 'local-models');
            if (userDataDir) candidates.push(path.join(userDataDir, 'local-models'));
            if (homeLocalModels !== path.join(userDataDir || '', 'local-models')) {
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
        // Every candidate above needs Electron's `app`. Without it — a plain
        // `node --test`, or any ELECTRON_RUN_AS_NODE probe — none are even
        // built, so resolution fell straight through to the UNVERIFIED last
        // resort below: `<cwd>/models`. On a dev machine that directory is a
        // stale download cache, and a truncated model there loads as
        // "Protobuf parsing failed", which disables reranking silently.
        //
        // These two are cwd-relative and VERIFIED by the same marker, so they
        // cost nothing in a packaged app (cwd is not the repo, the marker is
        // absent, they are skipped) and let a test find the bundled model.
        // `resources/models` comes first deliberately: it is the copy the
        // repository actually ships, and `<cwd>/models` is the ambiguous cache
        // that should only win when nothing better exists.
        try {
            const cwd = process.cwd();
            candidates.push(path.join(cwd, 'resources', 'models'));
            candidates.push(path.join(cwd, 'models'));
        } catch { /* cwd can throw if the directory was removed */ }

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
        // Ascends from __dirname rather than guessing the depth — the three
        // fixed candidates this used to try resolved from `electron/` and
        // `electron/rag/` only, and this class is inlined into bundles under
        // `llm/`, `services/` and `services/reranking/` as well. See
        // resolveRagWorker.ts for the measurement.
        return resolveRagWorker(__dirname, 'localRerankerWorker.js');
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

            // Do not let this worker hold the Node event loop open.
            //
            // MUST be after the listeners above: attaching a 'message' listener
            // re-references the underlying MessagePort, so an unref() next to
            // `new Worker()` is undone by the following line.
            //
            // Electron's main process is anchored by `app` and its windows, so
            // this cannot cause a premature exit. Under `node --test` there is no
            // anchor, and a referenced worker made every importing test file pass
            // its assertions and then never exit — blocking the whole suite.
            // See docs/context-intelligence-v3/01_INVESTIGATION_REPORT.md F21.
            // Optional call: test doubles substitute a mock Worker that does not
            // implement unref(). A hard call throws there and disables the model.
            this.worker.unref?.();
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
    /**
     * Whether the model is ALREADY loaded, without loading it.
     *
     * `isAvailable()` calls ensureLoaded(), so asking it "is the reranker ready"
     * is really telling it "load the reranker" — a settings panel that called it
     * to render a badge would block on a model load, and on a first run on a
     * download. This is the read-only question.
     */
    isLoaded(): boolean {
        return this.loaded;
    }

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
            const availGB = getAvailableMemoryGB().toFixed(1);
            throw new Error(
                `insufficient available memory (${availGB}GB < ${getMinFreeGBForOnnxSession()}GB) — skipping reranker load`,
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

    /**
     * Tear the worker down and forget every cached load decision.
     *
     * Public because switching models needs exactly this: the modelId and dtype
     * are read in the constructor, so a new selection only takes effect once
     * this instance is disposed and replaced. Without it, "Use this model" would
     * silently do nothing until the next launch.
     */
    dispose(reason = 'disposed'): void {
        const worker = this.worker;
        this.worker = null;
        this.loadingPromise = null;
        this.loadFailed = false;
        this.loaded = false;

        // An INTENTIONAL teardown is not a crash — clear the sentinel here
        // (2026-09-04).
        //
        // `terminate()` exits the thread with code 1, and the exit handler only
        // clears the sentinel on code 0, so every ordinary model switch through
        // reloadLocalReranker() left a "died hard" record behind. Restarting
        // within ONNX_LOAD_SENTINEL_TTL_MS (5 min) then made
        // consumeLocalRerankerSentinel() set startupPoisoned and SKIP local
        // reranking for that whole launch — a false crash signal produced by a
        // normal user action, with the usual silent symptom.
        try { clearOnnxLoadSentinel('reranker', this.modelId); } catch { /* best effort */ }

        if (!worker) {
            if (this.slotRelease) { this.slotRelease(); this.slotRelease = null; }
            this.rejectAllPending(new Error(reason));
            return;
        }

        // Let an in-flight rerank finish rather than killing it mid-call.
        //
        // A rerank fails CLOSED — null means "keep the existing order" — so
        // this does not lose data the way a rejected embed does. But disposal
        // is triggered by the user switching models, which can land in the
        // middle of a meeting turn, and silently dropping that turn's ranking
        // is exactly the "reranker did nothing" symptom. Terminating mid
        // `session.run()` is also the native-abort shape this worker exists to
        // contain. The worker's own exit handler releases the ONNX gate slot.
        if (this.pendingRequests.size === 0) {
            worker.terminate().catch(() => {});
            return;
        }
        void this.terminateWhenDrained(worker);
    }

    /**
     * Wait for replies this worker still owes, then stop it. Bounded: each
     * pending request carries its own timeout, so the map drains even if the
     * worker never answers.
     */
    private async terminateWhenDrained(worker: Worker): Promise<void> {
        const deadline = Date.now() + RERANK_DISPOSE_DRAIN_MAX_MS;
        while (this.pendingRequests.size > 0 && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        try { await worker.terminate(); } catch { /* already gone */ }
    }

    /** Test-only alias, kept so existing tests read the same. */
    __resetForTests(): void {
        this.dispose('reset for tests');
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

/**
 * The model the user selected, or null for the built-in.
 *
 * Read lazily and defensively: this runs on the retrieval path via the
 * constructor, and a missing or half-initialised SettingsManager must fall back
 * to the bundled model rather than throw. esbuild bundles every electron file
 * separately, so a top-level import would inline a second SettingsManager —
 * see services/extensions/singleton.ts.
 */
function readSelectedLocalReranker(): { modelId: string; dtype: string } | null {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { SettingsManager } = require('../services/SettingsManager');
        // `.get(key)` — SettingsManager has no getSettings(). Calling one threw
        // into the catch below, which returned null, so a selected model was
        // silently ignored and the bundled one kept running while the UI
        // reported the switch had succeeded.
        const id = (SettingsManager.getInstance().get('reranker') as any)?.localModelId;
        if (!id || typeof id !== 'string') return null;

        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { findCatalogModel } = require('./rerankerModelCatalog') as typeof import('./rerankerModelCatalog');
        const entry = findCatalogModel(id);
        // Only ONNX entries run in THIS runtime. A GGUF selection is executed by
        // its extension, and honouring it here would point transformers.js at a
        // directory containing one .gguf file it cannot read.
        if (!entry || entry.runtime !== 'onnx' || !entry.modelId) return null;
        return { modelId: entry.modelId, dtype: entry.dtype ?? 'fp32' };
    } catch {
        return null;
    }
}

/**
 * Swap the active local reranker.
 *
 * Disposes the running instance and drops the singleton so the next
 * `getLocalReranker()` rebuilds against the current selection. Callers must
 * have written the setting FIRST — the constructor is what reads it.
 *
 * `ModesManager.prewarmModeReferenceIndex` calls `getLocalReranker()` each time
 * rather than holding a reference, so a warm instance cannot survive this.
 */
export function reloadLocalReranker(reason = 'model changed'): void {
    const previous = _instance;
    _instance = null;
    try { previous?.dispose(reason); } catch { /* a failed teardown must not block the switch */ }
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
