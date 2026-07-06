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
// IntentClassifier's zero-shot worker + this local-embedding fallback) being
// concurrently active in-process. Both of those other consumers already ran
// their ONNX sessions inside a worker_threads.Worker; this provider was the
// ONLY one still calling pipeline()/embed() directly on the main process. It
// is now isolated the same way, following the exact message-passing pattern
// used by electron/llm/IntentClassifier.ts / intentClassifierWorker.ts.
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

const WORKER_INIT_TIMEOUT_MS = 60_000; // model load (cold disk read + ORT session init)
const WORKER_EMBED_TIMEOUT_MS = 30_000; // a single embed()/embedBatch() call

export class LocalEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'local';
  readonly dimensions = 384; // all-MiniLM-L6-v2
  readonly model = 'Xenova/all-MiniLM-L6-v2';
  readonly space: string;

  private worker: Worker | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void; timer: ReturnType<typeof setTimeout> }>();
  private loadingPromise: Promise<void> | null = null; // prevents concurrent init races
  private loaded = false;
  private slotRelease: (() => void) | null = null;
  private modelPath: string;

  constructor() {
    this.space = embeddingSpaceKey({ name: this.name, model: this.model, dimensions: this.dimensions });
    // Point to the bundled model inside the app's resources.
    // In dev: use app.getAppPath() so the path is independent of how esbuild
    // bundles this file (bundle: true inlines the provider into main.js, which
    // makes __dirname-relative paths fragile).
    // In prod: app.isPackaged = true → use process.resourcesPath (electron-builder extraResources).
    this.modelPath = LocalEmbeddingProvider.resolveModelPath();
  }

  // Resolve to the first candidate that actually holds the model, so the local
  // fallback works whether launched packaged, `electron .` from the repo, or
  // Playwright launching dist-electron/main.js (where getAppPath() points at the
  // built dir, not the repo root that holds resources/models). Without this an
  // exhausted-cloud-quota run had NO working embedder (tokenizer 404).
  private static resolveModelPath(): string {
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
      try { if (fs.existsSync(path.join(c, 'Xenova', 'all-MiniLM-L6-v2', 'tokenizer.json'))) return c; } catch { /* keep trying */ }
    }
    return candidates.find(Boolean) || path.join(process.resourcesPath || '.', 'models');
  }

  // Same candidate-search pattern as resolveModelPath, but for the worker
  // script itself — the compiled `localEmbeddingWorker.js` sibling of this
  // compiled provider file. Mirrors IntentClassifier's getWorkerPath().
  private getWorkerPath(): string {
    const candidates = [
      path.join(__dirname, 'localEmbeddingWorker.js'),
      path.join(__dirname, 'providers', 'localEmbeddingWorker.js'),
      path.join(__dirname, 'rag', 'providers', 'localEmbeddingWorker.js'),
      path.join(__dirname, 'electron', 'rag', 'providers', 'localEmbeddingWorker.js'),
    ];

    let resolvedPath = candidates.find(p => fs.existsSync(p)) ?? candidates[0];
    if (resolvedPath.includes('app.asar') && !resolvedPath.includes('app.asar.unpacked')) {
      resolvedPath = resolvedPath.replace('app.asar', 'app.asar.unpacked');
    }
    return resolvedPath;
  }

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(this.getWorkerPath());

      this.worker.on('message', (msg: { type: string; requestId: number; vectors?: number[][]; error?: string }) => {
        const pending = this.pendingRequests.get(msg.requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pendingRequests.delete(msg.requestId);

        if (msg.type === 'error') {
          pending.reject(new Error(msg.error || 'Worker error'));
        } else {
          pending.resolve(msg);
        }
      });

      this.worker.on('error', (err) => {
        console.error('[LocalEmbeddingProvider] Worker error:', err);
        this.loaded = false;
        this.loadingPromise = null;
        if (this.slotRelease) { this.slotRelease(); this.slotRelease = null; }
        this.rejectAllPending(err);
      });

      this.worker.on('exit', (code) => {
        if (code !== 0) {
          console.warn(`[LocalEmbeddingProvider] Worker exited with code ${code}`);
        }
        this.worker = null;
        this.loaded = false;
        this.loadingPromise = null;
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

    // If another caller already kicked off loading, wait for that same promise
    // rather than launching a second concurrent init.
    if (this.loadingPromise) {
      await this.loadingPromise;
      return;
    }

    // Cross-loader ONNX gate (shared with LocalReranker / IntentClassifier /
    // Whisper). A gate refusal here is non-fatal — embedBatch will reject,
    // EmbeddingPipeline falls back to lexical retrieval, and the next call
    // retries. We do NOT have a `loadFailed` latch (matches the pre-gate
    // behavior); a later, less-pressured moment will retry automatically.
    if (!hasEnoughMemoryForOnnxSession()) {
      throw new Error(
        `insufficient free memory (<${getMinFreeGBForOnnxSession()}GB) — skipping local embedder load`,
      );
    }

    const releaseSlot = await acquireOnnxSlot('normal');

    this.loadingPromise = (async () => {
      try {
        await this.postToWorker({ type: 'init', modelPath: this.modelPath }, WORKER_INIT_TIMEOUT_MS);
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

  async embedQuery(text: string): Promise<number[]> {
    return this.embed(text); // all-MiniLM-L6-v2 is symmetric
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.ensureLoaded();
    const result = await this.postToWorker<{ vectors: number[][] }>(
      { type: 'embed', texts, modelPath: this.modelPath },
      WORKER_EMBED_TIMEOUT_MS,
    );
    return result.vectors;
  }
}
