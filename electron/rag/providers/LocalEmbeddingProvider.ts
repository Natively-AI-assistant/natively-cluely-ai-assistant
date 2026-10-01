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
import { acquireOnnxSlot, acquireOnnxSlotWithin, hasEnoughMemoryForOnnxSession, getMinFreeGBForOnnxSession } from '../../utils/onnxThreadConfig';
import {
    clearLoadSentinel as clearOnnxLoadSentinel,
    consumePoisonedOnnxLoad,
    isSentinelWithinTtl,
    writeLoadSentinel as writeOnnxLoadSentinel,
} from '../../utils/onnxLoadSentinel';
import { ProviderStatusRegistry } from '../../services/ProviderStatusRegistry';
import type { LocalWorkerStatus } from '../../utils/workerStatus';
import { resolveBundledScript } from '../resolveRagWorker';
import { BUNDLED_LOCAL_EMBEDDING } from '../bundledLocalEmbedding';
import { resolveEmbeddingExperiment, experimentSpaceModelId } from '../embeddingExperiments';

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

import {
  BUNDLED_CATALOG_ID,
  findEmbeddingCatalogModel,
  type LocalEmbeddingModel,
} from '../embeddingModelCatalog';
import {
  resolveEmbeddingModelPath,
} from '../../services/embeddings/localEmbeddingModelInstaller';

export interface LocalEmbeddingOptions {
  modelId?: string;
  dimensions?: number;
  runtime?: 'onnx' | 'gguf';
  modelPath?: string;
  /**
   * Bound the wait for an ONNX session slot (ms). For short-lived probe/test
   * instances that run beside the live provider: they must still count
   * against the session cap, but a busy gate should fail them fast rather
   * than hang the Settings action.
   */
  slotWaitMs?: number;
}

export class LocalEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'local';
  readonly dimensions: number;
  readonly model: string;
  readonly space: string;
  readonly runtime: 'onnx' | 'gguf';
  readonly catalogId: string;
  readonly pooling: 'mean' | 'cls' | 'last';
  /** Prepended to query text only; empty for a symmetric model. */
  readonly queryPrefix: string;
  /** Prepended to document/chunk text only. */
  readonly documentPrefix: string;
  /** Free memory (GB) this model needs above the shared ONNX floor. */
  private readonly extraMemoryHeadroomGB: number;
  /** transformers.js identifier the worker loads (the catalog `modelId`). */
  private readonly hfModelId: string;
  /** Indexing batch ceiling; ModeHybridRetriever sizes its sub-batches to it. */
  readonly maxBatchSize?: number;
  /** Input truncation below the tokenizer's own limit (long-context models). */
  private readonly maxInputTokens?: number;
  private readonly slotWaitMs: number | undefined;
  /** Set by shutdownForQuit(): new requests are refused so the worker can drain. */
  private closingForQuit = false;

  private worker: Worker | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void; timer: ReturnType<typeof setTimeout> }>();
  private loadingPromise: Promise<void> | null = null; // prevents concurrent init races
  private loaded = false;
  private slotRelease: (() => void) | null = null;
  private lastWorkerStatus: LocalWorkerStatus | null = null;
  private nonRecoverableLoadError: Error | null = null;
  private modelPath: string;

  constructor(opts?: LocalEmbeddingOptions) {
    // No settings fallback here: an argument-less instance is the BUNDLED model
    // (multilingual-e5-small since 2026-09-22, electron/rag/bundledLocalEmbedding.ts).
    // The pipeline's offline fallback is constructed that way, and it must not
    // inherit the user's catalog pick (a multi-GB model in a different
    // embedding space). The resolver passes the pick explicitly.
    const modelId = opts?.modelId;
    const catalogEntry = modelId ? findEmbeddingCatalogModel(modelId) : null;
    // R&D only: NATIVELY_EMBEDDING_EXPERIMENT swaps the argument-less (bundled)
    // provider for a registered benchmark recipe. Unset in every shipped build.
    const experiment = catalogEntry ? null : resolveEmbeddingExperiment();
    if (catalogEntry) {
      this.catalogId = catalogEntry.id;
      this.model = catalogEntry.repo;
      this.hfModelId = catalogEntry.modelId || catalogEntry.repo;
      this.dimensions = opts?.dimensions || catalogEntry.dimensions;
      this.runtime = opts?.runtime || catalogEntry.runtime;
      this.pooling = catalogEntry.pooling || 'mean';
      this.queryPrefix = catalogEntry.queryPrefix || '';
      this.documentPrefix = catalogEntry.documentPrefix || '';
      this.extraMemoryHeadroomGB = catalogEntry.bundled
        ? BUNDLED_LOCAL_EMBEDDING.extraMemoryHeadroomGB
        : (catalogEntry.memoryHeadroomGB ?? 0);
      this.maxBatchSize = catalogEntry.maxBatchSize;
      this.maxInputTokens = catalogEntry.maxInputTokens;
      const resolved = catalogEntry.bundled ? null : resolveEmbeddingModelPath(catalogEntry);
      this.modelPath = opts?.modelPath || resolved || LocalEmbeddingProvider.resolveModelPath(this.hfModelId);
    } else if (experiment) {
      this.catalogId = `experiment:${experiment.key}`;
      this.model = experimentSpaceModelId(experiment);
      this.hfModelId = experiment.modelId;
      this.dimensions = experiment.dimensions;
      this.runtime = 'onnx';
      this.pooling = experiment.pooling;
      this.queryPrefix = experiment.queryPrefix;
      this.documentPrefix = experiment.documentPrefix;
      this.extraMemoryHeadroomGB = 0;
      // Benchmarks run the recipe's own cap, so results describe what ships.
      this.maxInputTokens = experiment.maxInputTokens;
      this.maxBatchSize = experiment.maxBatchSize;
      this.modelPath = opts?.modelPath || LocalEmbeddingProvider.resolveModelPath(this.hfModelId);
    } else {
      const bundled = BUNDLED_LOCAL_EMBEDDING;
      this.catalogId = BUNDLED_CATALOG_ID;
      // The bundled model's space key is its plain model id, the convention
      // MiniLM used (`local:xenova/all-minilm-l6-v2:384`).
      this.model = bundled.modelId;
      this.hfModelId = bundled.modelId;
      this.dimensions = opts?.dimensions || bundled.dimensions;
      this.runtime = opts?.runtime || 'onnx';
      this.pooling = bundled.pooling;
      this.queryPrefix = bundled.queryPrefix;
      this.documentPrefix = bundled.documentPrefix;
      this.extraMemoryHeadroomGB = bundled.extraMemoryHeadroomGB;
      this.modelPath = opts?.modelPath || LocalEmbeddingProvider.resolveModelPath(this.hfModelId);
    }

    this.slotWaitMs = opts?.slotWaitMs;
    this.space = embeddingSpaceKey({ name: this.name, model: this.model, dimensions: this.dimensions });
  }

  // Resolve to the first candidate that actually holds the model, so the local
  // fallback works whether launched packaged, `electron .` from the repo, or
  // Playwright launching dist-electron/main.js (where getAppPath() points at the
  // built dir, not the repo root that holds resources/models). Without this an
  // exhausted-cloud-quota run had NO working embedder (tokenizer 404).
  private static resolveModelPath(probeModelId: string = BUNDLED_LOCAL_EMBEDDING.modelId): string {
    const candidates: string[] = [];
    if (process.env.NATIVELY_LOCAL_MODELS_PATH) candidates.push(process.env.NATIVELY_LOCAL_MODELS_PATH);
    try {
      if (app?.isPackaged && process.resourcesPath) {
        candidates.push(path.join(process.resourcesPath, 'models'));
      }
    } catch { /* app not ready or running in test */ }
    let appPath = '';
    try { appPath = app?.getAppPath?.() || ''; } catch { /* not ready */ }
    if (appPath) {
      candidates.push(path.join(appPath, 'resources', 'models'));
      candidates.push(path.join(appPath, '..', 'resources', 'models'));
      candidates.push(path.join(appPath, '..', '..', 'resources', 'models'));
    }
    candidates.push(path.join(process.cwd(), 'resources', 'models'));
    for (const c of candidates) {
      try { if (fs.existsSync(path.join(c, ...probeModelId.split('/'), 'tokenizer.json'))) return c; } catch { /* keep trying */ }
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

    // slotRelease is NOT called here. The slot must be held until the worker
    // actually finishes draining — releasing it early would let a replacement
    // provider claim the slot before this worker's ONNX session is torn down,
    // defeating the memory-pressure guard. slotRelease is called from inside
    // terminateWhenDrained() once the thread exits.
    const pendingSlotRelease = this.slotRelease;
    this.slotRelease = null;

    // An intentional teardown is not a crash. terminate() exits the thread with
    // code 1 and the exit handler only clears the sentinel on code 0, so
    // without this every embedding config change left a "died hard" record —
    // and a restart inside ONNX_LOAD_SENTINEL_TTL_MS would set startupPoisoned
    // and SKIP local embedding for that launch. This path only became reachable
    // when dispose() was introduced; before that the old worker was orphaned
    // and never exited, so it never wrote one.
    try { clearOnnxLoadSentinel('embeddings', this.model); } catch { /* best effort */ }

    if (!worker) {
      if (pendingSlotRelease) {
        try { pendingSlotRelease(); } catch { /* best effort */ }
      }
      this.rejectAllPending(new Error(reason));
      return;
    }

    // Nothing owed — terminate now.
    if (this.pendingRequests.size === 0) {
      try { await worker.terminate(); } catch { /* already gone */ }
      if (pendingSlotRelease) {
        try { pendingSlotRelease(); } catch { /* best effort */ }
      }
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
    void this.terminateWhenDrained(worker, pendingSlotRelease);
  }

  /**
   * Wait for the outstanding replies this worker still owes, then stop it.
   *
   * Bounded, because a wedged worker must not be kept alive forever — but
   * generously, since this runs in the background and every pending request
   * already carries its own per-call timeout, so the map empties on its own
   * even if the worker never answers.
   *
   * The slot is released AFTER the worker exits so no replacement can claim
   * the same ONNX slot before this worker's session is torn down.
   */
  private async terminateWhenDrained(worker: Worker, slotRelease?: (() => void) | null): Promise<void> {
    const deadline = Date.now() + DISPOSE_DRAIN_MAX_MS;
    while (this.pendingRequests.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    try { await worker.terminate(); } catch { /* already gone */ }
    // Release the slot only after the worker has exited — preserving memory safety.
    if (slotRelease) {
      try { slotRelease(); } catch { /* best effort */ }
    }
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
    // MODEL-AWARE since 2026-09-22: the shared floor plus this model's own
    // extra footprint (the floor alone is blind to model size).
    if (!hasEnoughMemoryForOnnxSession(this.extraMemoryHeadroomGB)) {
      throw new Error(
        `insufficient available memory (<${getMinFreeGBForOnnxSession(this.extraMemoryHeadroomGB)}GB for ${this.hfModelId}) — skipping local embedder load`,
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
      const releaseSlot = this.slotWaitMs !== undefined
        ? await acquireOnnxSlotWithin('normal', 1, this.slotWaitMs, 'local-embedding probe')
        : await acquireOnnxSlot('normal');
      try {
        await this.postToWorker(
          {
            type: 'init',
            modelId: this.catalogId,
            hfModelId: this.hfModelId,
            modelPath: this.modelPath,
            runtime: this.runtime,
            dimensions: this.dimensions,
            pooling: this.pooling,
            maxInputTokens: this.maxInputTokens,
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
   * Query and document text are NOT embedded the same way for asymmetric
   * models (e5: "query: "/"passage: ", Arctic/BGE: a query instruction, Nomic:
   * "search_query: "/"search_document: "). EmbeddingPipeline routes queries
   * here and chunks to embedBatch(), so this is the one place for the split.
   * A symmetric model (empty prefixes) falls through to a plain embed().
   */
  async embedQuery(text: string): Promise<number[]> {
    if (!this.queryPrefix) return this.embed(text);
    const [vector] = await this.embedRaw([this.queryPrefix + text]);
    return vector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const prefix = this.documentPrefix;
    return this.embedRaw(prefix ? texts.map((t) => prefix + t) : texts);
  }

  /**
   * Post already-prefixed text to the worker, never more than `maxBatchSize`
   * texts per worker call. ModeHybridRetriever already sizes its sub-batches to
   * the cap, but profile ingest (10 per batch) and live meeting indexing call
   * embedBatch with their own sizes. A capped model (nomic-v1.5 SIGTRAPs at
   * 16; the 1024-d models time out) must be safe whichever caller it serves.
   */
  private async embedRaw(texts: string[]): Promise<number[][]> {
    const cap = this.maxBatchSize && this.maxBatchSize > 0 ? this.maxBatchSize : 0;
    if (cap && texts.length > cap) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += cap) out.push(...(await this.embedRawOnce(texts.slice(i, i + cap))));
      return out;
    }
    return this.embedRawOnce(texts);
  }

  private async embedRawOnce(texts: string[]): Promise<number[][]> {
    await this.ensureLoaded();
    const result = await this.postToWorker<{ vectors: number[][]; dimensions?: number }>(
      {
        type: 'embed',
        texts,
        modelId: this.catalogId,
        hfModelId: this.hfModelId,
        modelPath: this.modelPath,
        runtime: this.runtime,
        dimensions: this.dimensions,
        pooling: this.pooling,
        maxInputTokens: this.maxInputTokens,
      },
      WORKER_EMBED_TIMEOUT_MS,
    );
    // The worker derives the width from the tensor. If it disagrees with the
    // width this provider advertises, every vector written under this space key
    // would be mislabelled, so refuse rather than index them.
    const width = result.dimensions ?? result.vectors?.[0]?.length;
    if (width && width !== this.dimensions) {
      throw new Error(
        `[LocalEmbeddingProvider] ${this.model} returned ${width}d but this ` +
        `provider advertises ${this.dimensions}d — refusing to emit mislabelled vectors`,
      );
    }
    return result.vectors;
  }

  /**
   * Quit-time teardown (2026-09-22).
   *
   * Quitting while this worker was inside a native ONNX call ABORTED the app:
   * process exit tore the worker thread down mid-`run()`, onnxruntime-node's
   * binding threw a Napi::Error into the dying environment, and libc++ called
   * std::terminate (SIGABRT). Reproduced 4/4 on multilingual-e5-small and 3/3
   * on MiniLM by quitting mid-indexing. A quit during model LOAD also left the
   * load sentinel behind, so the next launch skipped local embedding.
   *
   * So: refuse new requests, let the ones already sent finish (each is one
   * batch), then terminate a worker that is idle in its message loop. Bounded:
   * a wedged worker must not hold the quit hostage.
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
