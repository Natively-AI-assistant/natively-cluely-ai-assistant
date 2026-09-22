// @huggingface/transformers is ESM-only — the actual pipeline()/inference now
// runs inside a dedicated worker_threads.Worker (localEmbeddingWorker.ts),
// NOT on the Electron main thread. See the crash-hardening note below.
//
// WHY WORKER-ISOLATED (2026-07-05): 9/9 real macOS crash reports
// (~/Library/Logs/DiagnosticReports/Electron-*.ips) showed the app crashing
// on the MAIN THREAD inside ONNX Runtime's BFC allocator
// (BFCArena::Extend → posix_memalign) during a live InferenceSession::Run()
// call, with 16-17 ORT-related OS threads alive at crash time. This is
// consistent with multiple ONNX sessions (Whisper's streaming STT worker +
// the intent classifier's zero-shot worker, since removed + this local-embedding fallback) being
// concurrently active in-process. Both of those other consumers already ran
// their ONNX sessions inside a worker_threads.Worker; this provider was the
// ONLY one still calling pipeline()/embed() directly on the main process. It
// is now isolated the same way, following the exact message-passing pattern
// the (since removed) intent classifier used.
//
// Public API (isAvailable/embed/embedQuery/embedBatch) is UNCHANGED — all
// worker plumbing is internal so EmbeddingPipeline.ts and
// EmbeddingProviderResolver.ts require no changes.
import path from 'path';
import fs from 'fs';
import { Worker } from 'worker_threads';
import { app } from 'electron';
import { IEmbeddingProvider } from './IEmbeddingProvider';
import { embeddingSpaceKey } from '../embeddingSpace';
import { acquireOnnxSlot, hasEnoughMemoryForOnnxSession, getMinFreeGBForOnnxSession } from '../../utils/onnxThreadConfig';
import {
    clearLoadSentinel as clearOnnxLoadSentinel,
    consumePoisonedOnnxLoad,
    isSentinelWithinTtl,
    writeLoadSentinel as writeOnnxLoadSentinel,
} from '../../utils/onnxLoadSentinel';
import { ProviderStatusRegistry } from '../../services/ProviderStatusRegistry';
import type { LocalWorkerStatus } from '../../utils/workerStatus';
import { resolveBundledScript } from '../resolveRagWorker';
import {
  experimentSpaceModelId,
  resolveEmbeddingExperiment,
  type EmbeddingExperiment,
} from '../embeddingExperiments';
import { BUNDLED_LOCAL_EMBEDDING, type LocalEmbeddingRecipe } from '../bundledLocalEmbedding';

const WORKER_INIT_TIMEOUT_MS = 60_000; // model load (cold disk read + ORT session init)
const WORKER_EMBED_TIMEOUT_MS = 30_000; // a single embed()/embedBatch() call

/** Process-local poison flag: set by the cold-start consume path to tell the
 *  ensureLoaded + embed paths to fast-fail this launch. Mirrors
 *  LocalReranker's startupPoisoned. */
let startupPoisoned = false;

/**
 * How long a disposed worker may keep running to finish work already in flight.
 * Generous on purpose: it drains in the background and each pending request has
 * its own timeout, so this is only a backstop against a wedged thread.
 */
const DISPOSE_DRAIN_MAX_MS = 120_000;

/**
 * Providers whose worker thread is alive, for the quit drain below.
 *
 * On `globalThis`, not module scope: esbuild inlines this file into more than
 * one bundle, and a module-scoped set would give each bundle its own view.
 */
const LIVE_PROVIDERS_KEY = '__nativelyLiveLocalEmbeddingProviders';
function liveProviders(): Set<LocalEmbeddingProvider> {
  const g = globalThis as unknown as Record<string, Set<LocalEmbeddingProvider> | undefined>;
  return (g[LIVE_PROVIDERS_KEY] ??= new Set<LocalEmbeddingProvider>());
}

export class LocalEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'local';
  readonly dimensions: number;
  readonly model: string;
  readonly space: string;

  /**
   * R&D bake-off only (2026-09-21). Null on every production launch, because
   * `NATIVELY_EMBEDDING_EXPERIMENT` is unset. See embeddingExperiments.ts.
   */
  private readonly experiment: EmbeddingExperiment | null;

  /**
   * What this provider loads and how it calls it: the bundled model
   * (bundledLocalEmbedding.ts) on every production launch, or the experiment
   * candidate when one is set. Always present, so pooling, prefixes, dtype and
   * the memory headroom travel together and cannot be applied piecemeal.
   */
  private readonly recipe: LocalEmbeddingRecipe;

  private worker: Worker | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void; timer: ReturnType<typeof setTimeout> }>();
  private loadingPromise: Promise<void> | null = null; // prevents concurrent init races
  private loaded = false;
  private slotRelease: (() => void) | null = null;
  private lastWorkerStatus: LocalWorkerStatus | null = null;
  private nonRecoverableLoadError: Error | null = null;
  private modelPath: string;
  /** Set by shutdownForQuit(): new requests are refused so the worker can drain. */
  private closingForQuit = false;

  constructor() {
    this.experiment = resolveEmbeddingExperiment();
    this.recipe = this.experiment
      // Experiments carry no measured headroom; they run with the shared floor.
      ? { ...this.experiment, extraMemoryHeadroomGB: 0 }
      : BUNDLED_LOCAL_EMBEDDING;
    this.dimensions = this.recipe.dimensions;
    // The bundled model's space key is its plain model id, the same convention
    // MiniLM used (`local:xenova/all-minilm-l6-v2:384`). Experiments add their
    // recipe suffix so a benchmark index can never share a space with production.
    this.model = this.experiment
      ? experimentSpaceModelId(this.experiment)
      : BUNDLED_LOCAL_EMBEDDING.modelId;
    this.space = embeddingSpaceKey({ name: this.name, model: this.model, dimensions: this.dimensions });
    // Point to the bundled model inside the app's resources.
    // In dev: use app.getAppPath() so the path is independent of how esbuild
    // bundles this file (bundle: true inlines the provider into main.js, which
    // makes __dirname-relative paths fragile).
    // In prod: app.isPackaged = true → use process.resourcesPath (electron-builder extraResources).
    this.modelPath = LocalEmbeddingProvider.resolveModelPath(this.recipe.modelId);
  }

  // Resolve to the first candidate that actually holds the model, so the local
  // fallback works whether launched packaged, `electron .` from the repo, or
  // Playwright launching dist-electron/main.js (where getAppPath() points at the
  // built dir, not the repo root that holds resources/models). Without this an
  // exhausted-cloud-quota run had NO working embedder (tokenizer 404).
  //
  // `modelId` only changes WHICH tokenizer.json is probed for, never the
  // candidate list or its order.
  private static resolveModelPath(modelId: string = BUNDLED_LOCAL_EMBEDDING.modelId): string {
    const probe = path.join(...modelId.split('/'), 'tokenizer.json');
    const candidates: string[] = [];
    if (process.env.NATIVELY_LOCAL_MODELS_PATH) candidates.push(process.env.NATIVELY_LOCAL_MODELS_PATH);
    if (app.isPackaged) candidates.push(path.join(process.resourcesPath, 'models'));
    let appPath = '';
    try { appPath = app.getAppPath(); } catch { /* not ready */ }
    if (appPath) {
      candidates.push(path.join(appPath, 'resources', 'models'));
      candidates.push(path.join(appPath, '..', 'resources', 'models'));
      candidates.push(path.join(appPath, '..', '..', 'resources', 'models'));
    }
    for (const c of candidates) {
      try { if (fs.existsSync(path.join(c, probe))) return c; } catch { /* keep trying */ }
    }
    return candidates.find(Boolean) || path.join(process.resourcesPath || '.', 'models');
  }

  // The compiled `localEmbeddingWorker.js`, which ships at
  // `electron/rag/providers/localEmbeddingWorker.js`. This used to be its own
  // fixed 4-candidate list (mirroring resolveModelPath above), which only
  // resolves when this class is inlined at exactly `electron/rag/providers`,
  // `electron/rag`, `electron`, or the dist-electron root — build-electron.js
  // gives every .ts file under electron/ its own esbuild entry point, so this
  // class also gets inlined at OTHER depths (confirmed against a real build:
  // `electron/services`, e.g. dist-electron/electron/services/
  // StealthKeyboardManager.js and KeybindManager.js both carry this lookup
  // and none of the 4 fixed candidates existed from there). LocalReranker and
  // GgufReranker hit the exact same bug (see resolveRagWorker.ts) and were
  // moved to an ascend-and-probe helper instead of guessing the depth; use
  // the same helper here (`resolveBundledScript` rather than the narrower
  // `resolveRagWorker`, since that one is hardcoded to a worker sitting
  // directly under `rag/`, not `rag/providers/`).
  private getWorkerPath(): string {
    return resolveBundledScript(__dirname, ['rag', 'providers', 'localEmbeddingWorker.js'],
      { unpackFromAsar: true });
  }

  private getWorker(): Worker {
    if (!this.worker) {
      // Cross-launch disk sentinel: written BEFORE new Worker() so a native
      // ORT abort that kills the process before the JS `ready` arrives
      // leaves a recoverable breadcrumb for the next launch's consume.
      writeOnnxLoadSentinel('embeddings', this.model);
      const spawned = new Worker(this.getWorkerPath());
      this.worker = spawned;
      liveProviders().add(this);
      spawned.once('exit', () => { if (this.worker === spawned || this.worker === null) liveProviders().delete(this); });

      this.worker.on('message', (msg: { type: string; requestId?: number; vectors?: number[][]; error?: string; status?: LocalWorkerStatus }) => {
        if (msg.type === 'status' && msg.status) {
          if (msg.status.type === 'ready') {
            // Worker reached `ready` — clear the poisoned-load sentinel.
            clearOnnxLoadSentinel('embeddings', this.model);
          }
          this.handleWorkerStatus(msg.status);
          return;
        }
        const pending = this.pendingRequests.get(msg.requestId as number);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pendingRequests.delete(msg.requestId as number);  // same cast as the .get() above

        if (msg.type === 'error') {
          pending.reject(new Error(msg.error || 'Worker error'));
        } else {
          pending.resolve(msg);
        }
      });

      this.worker.on('error', (err) => {
        // Only act for the worker that is still ours. A disposed worker drains
        // in the background, and its late error must not reject requests that
        // belong to a replacement worker on this instance.
        if (this.worker !== spawned) return;
        console.error('[LocalEmbeddingProvider] Worker error:', err);
        this.loaded = false;
        this.loadingPromise = null;
        // Worker died mid-load — latch non-recoverable so future embed
        // calls don't spin up a fresh worker against the same broken asset.
        if (!this.loaded && !this.nonRecoverableLoadError) {
          this.latchNonRecoverableLoadError(`Worker error before ready: ${err?.message || err}`);
        }
        if (this.slotRelease) { this.slotRelease(); this.slotRelease = null; }
        this.rejectAllPending(err);
      });

      this.worker.on('exit', (code) => {
        // Same scoping as 'error': a disposed worker's exit must not clear
        // state, or reject pending work, that now belongs to its replacement.
        if (this.worker !== spawned) return;
        if (code !== 0) {
          console.warn(`[LocalEmbeddingProvider] Worker exited with code ${code}`);
        }
        // Clear on clean exit; non-zero exit keeps the sentinel so the
        // next launch knows the previous attempt died hard.
        if (code === 0) clearOnnxLoadSentinel('embeddings', this.model);
        this.worker = null;
        this.loaded = false;
        this.loadingPromise = null;
        if (this.slotRelease) { this.slotRelease(); this.slotRelease = null; }
        this.rejectAllPending(new Error(`Worker exited with code ${code}`));
        if (!this.loaded && !this.nonRecoverableLoadError) {
          this.latchNonRecoverableLoadError(`Worker exited with code ${code} before model loaded`);
        }
      });

      // Do not let this worker hold the Node event loop open.
      //
      // MUST be after the listeners above: attaching a 'message' listener
      // re-references the underlying MessagePort, so an unref() next to
      // `new Worker()` is undone by the following line.
      //
      // Electron's main process is anchored by `app` and its windows, so this
      // cannot cause a premature exit. Under `node --test` there is no anchor,
      // and a referenced worker made every importing test file pass its
      // assertions and then never exit — blocking the whole suite.
      // See docs/context-intelligence-v3/01_INVESTIGATION_REPORT.md F21.
      // Optional call: test doubles substitute a mock Worker that does not
      // implement unref(). A hard call throws there and disables the model.
      this.worker.unref?.();
    }
    return this.worker;
  }

  /**
   * Release the worker and the ONNX model it holds.
   *
   * EmbeddingPipeline._doInitialize() runs again whenever an embedding-related
   * setting changes, and it assigns a FRESH LocalEmbeddingProvider over
   * `fallbackProvider`. Without this, the instance being replaced kept its
   * worker — and therefore its loaded MiniLM model — alive for the rest of the
   * session, unreachable by anything. On macOS the Gemini path usually wins so
   * the model never loads at all; on Windows the Gemini embedding key 403s and
   * the resolver demotes to this bundled local model, so it is exactly the
   * platform where the abandoned copy is real.
   *
   * Safe to call more than once, and safe on an instance that never loaded.
   */
  async dispose(reason = 'embedding provider disposed'): Promise<void> {
    const worker = this.worker;
    this.worker = null;          // new work resolves against the new config
    this.loadingPromise = null;

    // An intentional teardown is not a crash. terminate() exits the thread with
    // code 1 and the exit handler only clears the sentinel on code 0, so
    // without this every embedding config change left a "died hard" record —
    // and a restart inside ONNX_LOAD_SENTINEL_TTL_MS would set startupPoisoned
    // and SKIP local embedding for that launch. This path only became reachable
    // when dispose() was introduced; before that the old worker was orphaned
    // and never exited, so it never wrote one.
    try { clearOnnxLoadSentinel('embeddings', this.model); } catch { /* best effort */ }

    if (!worker) {
      this.rejectAllPending(new Error(reason));
      return;
    }

    // Nothing owed — terminate now.
    if (this.pendingRequests.size === 0) {
      try { await worker.terminate(); } catch { /* already gone */ }
      return;
    }

    // DETACH rather than reject (2026-09-04).
    //
    // A rejected embed LOSES chunks: LiveRAGIndexer only warns ("Failed to
    // embed live chunk batch") and moves on, so the batch never reaches the
    // index. Disposal is triggered by an embedding config change, which a user
    // can make while a meeting is recording or while reference files are still
    // ingesting — precisely when losing chunks is least acceptable.
    //
    // Letting them finish under the OLD provider is safe: RAGManager filters
    // retrieval by getActiveSpaceKey(), so vectors written into a superseded
    // embedding space are never retrieved. They cost disk, not correctness.
    //
    // Detached, not awaited, because initializeEmbeddings() is awaited by the
    // set-config IPC — blocking the drain there would freeze Settings for as
    // long as a reference-file batch takes.
    void this.terminateWhenDrained(worker);
  }

  /**
   * Wait for the outstanding replies this worker still owes, then stop it.
   *
   * Bounded, because a wedged worker must not be kept alive forever — but
   * generously, since this runs in the background and every pending request
   * already carries its own per-call timeout, so the map empties on its own
   * even if the worker never answers.
   */
  private async terminateWhenDrained(worker: Worker): Promise<void> {
    const deadline = Date.now() + DISPOSE_DRAIN_MAX_MS;
    while (this.pendingRequests.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    try { await worker.terminate(); } catch { /* already gone */ }
  }

  /**
   * Quit-time teardown (2026-09-22).
   *
   * Quitting while this worker was inside a native ONNX call ABORTED the app:
   * process exit tore the worker thread down mid-`run()`, onnxruntime-node's
   * binding threw a Napi::Error into the dying environment, and libc++ called
   * std::terminate (SIGABRT, a macOS "quit unexpectedly" report). Reproduced
   * 4/4 on multilingual-e5-small and 3/3 on MiniLM by quitting mid-indexing.
   * A quit during model LOAD also left the load sentinel behind, so the next
   * launch read a clean quit as a crashed load and skipped local embedding.
   *
   * So: refuse new requests, let the ones already sent finish (each is one
   * batch), then terminate a worker that is idle in its message loop, which
   * is the same safe path dispose() takes on a config change. Bounded: a
   * wedged worker must not hold the quit hostage.
   */
  async shutdownForQuit(maxWaitMs: number): Promise<'idle' | 'drained' | 'timed-out'> {
    this.closingForQuit = true;
    const worker = this.worker;
    if (!worker) return 'idle';
    const hadWork = this.pendingRequests.size > 0;
    const deadline = Date.now() + maxWaitMs;
    while (this.pendingRequests.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const outcome = this.pendingRequests.size > 0 ? 'timed-out' : hadWork ? 'drained' : 'idle';
    this.worker = null;
    this.loadingPromise = null;
    try { clearOnnxLoadSentinel('embeddings', this.model); } catch { /* best effort */ }
    try { await worker.terminate(); } catch { /* already gone */ }
    liveProviders().delete(this);
    return outcome;
  }

  /** True when any live local embedding worker still owes a reply. */
  static hasInFlightWorkForQuit(): boolean {
    for (const p of liveProviders()) if (p.worker && p.pendingRequests.size > 0) return true;
    return false;
  }

  /** shutdownForQuit() on every live provider, in parallel. */
  static async shutdownAllForQuit(maxWaitMs: number): Promise<string[]> {
    return Promise.all([...liveProviders()].map((p) => p.shutdownForQuit(maxWaitMs).then((o) => `${p.model}:${o}`)));
  }

  private rejectAllPending(err: Error): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pendingRequests.clear();
  }

  private handleWorkerStatus(status: LocalWorkerStatus): void {
    this.lastWorkerStatus = status;
    if (status.type === 'ready') {
      ProviderStatusRegistry.getInstance().setStatus({
        id: 'local-embedding',
        kind: 'packaged_local',
        health: 'ready',
        requiredForStartup: false,
        requiredForCoreFallback: true,
        message: 'Local embedding fallback ready',
        recoverable: true,
        details: { backend: status.backend, modelPath: status.modelPath },
      });
      return;
    }
    if (!status.recoverable) {
      this.nonRecoverableLoadError = new Error(status.message);
    }
    ProviderStatusRegistry.getInstance().setStatus({
      id: 'local-embedding',
      kind: 'packaged_local',
      health: status.recoverable ? 'degraded' : 'missing_required_asset',
      requiredForStartup: false,
      requiredForCoreFallback: true,
      // Human-readable status; `details.reason` carries the debug classification.
      message: status.recoverable
        ? 'Local embedding fallback running in degraded mode. Some semantic search features may be slower or less accurate.'
        : 'Natively local embedding fallback assets are missing or corrupted. Please reinstall Natively.',
      recoverable: status.recoverable,
      details: { backend: status.backend, reason: status.reason, error: status.message },
    });
  }

  getStatus(): LocalWorkerStatus | null {
    return this.lastWorkerStatus ? { ...this.lastWorkerStatus } : null;
  }

  /**
   * Test-only: returns the synthetic non-recoverable load error if the worker
   * latch has been triggered. Returns null otherwise.
   */
  __getNonRecoverableLoadError(): Error | null {
    return this.nonRecoverableLoadError;
  }

  /**
   * Latch a synthetic non-recoverable failure when the worker dies before
   * the model is fully loaded. Idempotent. Mirrors LocalReranker's latch
   * so the retry-on-every-call pathology can't happen against a missing
   * packaged asset.
   */
  private latchNonRecoverableLoadError(message: string): void {
    this.nonRecoverableLoadError = new Error(message);
    ProviderStatusRegistry.getInstance().setStatus({
      id: 'local-embedding',
      kind: 'packaged_local',
      health: 'missing_required_asset',
      requiredForStartup: false,
      requiredForCoreFallback: true,
      message: 'Natively local embedding fallback assets are missing or corrupted. Please reinstall Natively.',
      recoverable: false,
      details: { reason: 'worker-died-before-ready', error: message },
    });
  }

  private postToWorker<T>(message: any, timeoutMs: number): Promise<T> {
    if (this.closingForQuit) {
      return Promise.reject(new Error('[LocalEmbeddingProvider] the app is quitting; local embedding request refused'));
    }
    this.requestId = (this.requestId + 1) % Number.MAX_SAFE_INTEGER;
    const id = this.requestId;
    message.requestId = id;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`[LocalEmbeddingProvider] Worker request ${id} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this.getWorker().postMessage(message);
    });
  }

  async isAvailable(): Promise<boolean> {
    // Local model is ALWAYS available after install — this is the guarantee
    try {
      await this.ensureLoaded();
      return true;
    } catch (e) {
      console.error('[LocalEmbeddingProvider] Model failed to load:', e);
      return false;
    }
  }

  /**
   * 2026-07-05 fix: EmbeddingPipeline.isReady() previously returned true the
   * INSTANT this provider was assigned as `this.provider` (constructor is
   * cheap — no worker spawn, no model load), even though the ONNX worker
   * hadn't actually loaded the model yet (that only happens lazily, inside
   * ensureLoaded(), on the FIRST real embed() call). Callers that gate on
   * isReady() as a synchronous "is it safe to use hybrid retrieval right
   * now" check (ModeHybridRetriever.isEmbeddingAvailable()) took the hybrid
   * branch during that narrow cold-start window, then blocked on
   * getEmbeddingForQuery() for up to WORKER_INIT_TIMEOUT_MS (60s) waiting
   * for the worker to come up. This exposes the REAL state synchronously
   * (never triggers a load itself) so EmbeddingPipeline.isReady() can report
   * "not ready yet" during that window and callers fall back to lexical
   * retrieval instead of stalling a live query.
   */
  isLoaded(): boolean {
    return this.loaded;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (startupPoisoned) {
      throw new Error(
        '[LocalEmbeddingProvider] skipped: previous launch poisoned the load (see `onnx-load-sentinel-embeddings.json`)',
      );
    }
    if (this.nonRecoverableLoadError) throw this.nonRecoverableLoadError;

    // If another caller already kicked off loading, wait for that same promise
    // rather than launching a second concurrent init.
    if (this.loadingPromise) {
      await this.loadingPromise;
      return;
    }

    // Cross-loader ONNX gate (shared with LocalReranker /
    // Whisper). A gate refusal here is non-fatal — embedBatch will reject,
    // EmbeddingPipeline falls back to lexical retrieval, and the next call
    // retries. We do NOT have a `loadFailed` latch (matches the pre-gate
    // behavior); a later, less-pressured moment will retry automatically.
    // MODEL-AWARE since 2026-09-22: the shared floor plus this model's own extra
    // footprint. The floor alone admitted a 492 MB model exactly when it would
    // admit MiniLM's 134 MB. A refusal is non-fatal: retrieval stays lexical and
    // the next call retries once memory frees up.
    const headroomGB = this.recipe.extraMemoryHeadroomGB;
    if (!hasEnoughMemoryForOnnxSession(headroomGB)) {
      throw new Error(
        `insufficient available memory (<${getMinFreeGBForOnnxSession(headroomGB)}GB for ${this.recipe.modelId}) — skipping local embedder load`,
      );
    }

    // The slot is acquired INSIDE the load promise (2026-09-07). It used to be
    // acquired before `loadingPromise` was assigned, so a burst of concurrent
    // embed() calls (EmbeddingPipeline during ingest) each passed the
    // `if (this.loadingPromise)` guard, each acquired a slot, and the second
    // overwrote `slotRelease` — the first release was lost, the shared ONNX
    // gate sat at capacity for the process lifetime, and every later local
    // reranker / router load queued forever with no log. Assigning the promise
    // first makes the guard hold for every concurrent caller.
    this.loadingPromise = (async () => {
      const releaseSlot = await acquireOnnxSlot('normal');
      try {
        // The recipe is always sent, so the worker never falls back to
        // constants of its own and cannot silently load a different model.
        await this.postToWorker(
          {
            type: 'init',
            modelPath: this.modelPath,
            modelId: this.recipe.modelId,
            dtype: this.recipe.dtype,
            pooling: this.recipe.pooling,
          },
          WORKER_INIT_TIMEOUT_MS,
        );
        this.loaded = true;
        this.slotRelease = releaseSlot;
      } catch (e) {
        releaseSlot();
        throw e;
      }
    })();

    try {
      await this.loadingPromise;
    } catch (e) {
      // Reset so a future call can retry
      this.loadingPromise = null;
      this.loaded = false;
      throw e;
    } finally {
      this.loadingPromise = null;
    }
  }

  async embed(text: string): Promise<number[]> {
    const [vector] = await this.embedBatch([text]);
    return vector;
  }

  /**
   * Query and document text are NOT embedded the same way. The bundled
   * multilingual-e5-small wants "query: " on queries and "passage: " on chunks
   * (its card: "even for non-English texts"). EmbeddingPipeline routes queries
   * here and chunks to embedBatch(), so this is the one correct place for the
   * split — feeding a document prefix to a query, or neither to either, is an
   * integration bug that shows up as a model quality result. A symmetric recipe
   * (empty prefixes, e.g. MiniLM) falls through to a plain embed().
   */
  async embedQuery(text: string): Promise<number[]> {
    if (!this.recipe.queryPrefix) return this.embed(text);
    const [vector] = await this.embedRaw([this.recipe.queryPrefix + text]);
    return vector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const prefix = this.recipe.documentPrefix;
    return this.embedRaw(prefix ? texts.map((t) => prefix + t) : texts);
  }

  /** Post already-prefixed text to the worker. */
  private async embedRaw(texts: string[]): Promise<number[][]> {
    await this.ensureLoaded();
    // The recipe rides along on `embed` as well as `init`, because the worker's
    // `if (!pipe) await ensureLoaded(msg)` safety net can fire on a message that
    // never went through init — and without these fields that net would quietly
    // load MiniLM/mean and answer with vectors from the wrong model.
    const result = await this.postToWorker<{ vectors: number[][]; dimensions?: number }>(
      {
        type: 'embed',
        texts,
        modelPath: this.modelPath,
        modelId: this.recipe.modelId,
        dtype: this.recipe.dtype,
        pooling: this.recipe.pooling,
      },
      WORKER_EMBED_TIMEOUT_MS,
    );
    // The worker derives the width from the tensor. If it disagrees with the
    // width this provider advertises, every vector written under this space key
    // would be mislabelled, so refuse rather than index them.
    if (result.dimensions && result.dimensions !== this.dimensions) {
      throw new Error(
        `[LocalEmbeddingProvider] ${this.model} returned ${result.dimensions}d but this ` +
        `provider advertises ${this.dimensions}d — refusing to emit mislabelled vectors`,
      );
    }
    return result.vectors;
  }
}

/**
 * Cold-start helper: read the leftover embeddings sentinel from disk and
 * seed the in-memory poison flag so the next embed() call fast-fails and
 * `isAvailable()` returns false → retrieval routes to lexical. Returns the
 * recovered sentinel record so the caller can stash a recovery notice on
 * AppState. Idempotent.
 */
export function consumeLocalEmbeddingSentinel(): { modelId: string; startedAt: number; attempt: number } | null {
  const consumed = consumePoisonedOnnxLoad('embeddings');
  if (consumed && isSentinelWithinTtl(consumed)) {
    startupPoisoned = true;
    return consumed;
  }
  return null;
}

/**
 * Public reset: clears the cold-start poison flag, allowing the next
 * embed() call to attempt a fresh load. Mirrors `clearLocalRerankerPoison`
 * and the local-whisper-reset-to-default IPC but generalized. Idempotent.
 */
export function clearLocalEmbeddingPoison(): void {
  startupPoisoned = false;
  clearOnnxLoadSentinel('embeddings');
}

/**
 * Diagnostic accessor: is the local embedder currently skipped because the
 * previous launch poisoned the load?
 */
export function isLocalEmbeddingPoisoned(): boolean {
  return startupPoisoned;
}
