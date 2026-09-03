/**
 * A GGUF reranker at the single rerank seam, via llama.cpp.
 *
 * Core already ran ONNX cross-encoders; this adds the other local format, so a
 * model published only as GGUF is usable without an extension.
 *
 * WHAT THIS CAN AND CANNOT RUN — measured, not assumed:
 *
 *   bge-reranker-v2-m3   arch bert    -> llama.cpp's ranking path, 119ms for 5
 *   qwen3-reranker-0.6b  arch qwen3   -> no ranking head; yes/no token scoring
 *   jina-reranker-v3.5   arch qwen3   -> no ranking head; LISTWISE, scored from
 *                                        per-position hidden states through a
 *                                        projector that is not in the GGUF
 *
 * llama.cpp's ranking path needs a classification head and RANK pooling. The
 * two qwen3-architecture "rerankers" have neither, and are not scored the same
 * way as each other either — see qwenRerankPrompt.ts and jinaListwiseRerank.ts.
 * The mode is a property of the model, declared in the catalogue; guessing it
 * yields a refusal or a meaningless number, never a degraded score.
 *
 * Inference runs in a WORKER, not the main thread. That is the same rule the
 * ONNX reranker follows after the 2026-07-05 SIGTRAP crashes: llama.cpp is a
 * native addon that can abort, and off the main thread that is a recoverable
 * rerank failure rather than the app vanishing.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Worker } from 'worker_threads';
import type { RerankSeamPort } from '../services/reranking/RerankerRegistry';

/** Model load: a 400MB GGUF off cold disk, plus llama.cpp init. */
const WORKER_INIT_TIMEOUT_MS = 90_000;
/** One rerank call. Generous relative to the measured 119ms, but bounded. */
const WORKER_RERANK_TIMEOUT_MS = 20_000;

/**
 * Passages per call in 'yes-no' mode, where cost is linear in passages.
 * Ten keeps a call near a second on the measured ~87ms/passage, leaving the
 * 20s ceiling as a genuine backstop rather than something normal load can hit.
 */
const YES_NO_BATCH_SIZE = 10;
/** Graceful-teardown budget. Short: a quit must not wait on a wedged worker. */
const WORKER_DISPOSE_TIMEOUT_MS = 2_000;

interface Pending {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class GgufReranker implements RerankSeamPort {
  /**
   * How many passages to take per call — and it depends on the scoring mode.
   *
   * 'rank' hands the whole pool to llama.cpp, which batches internally, so the
   * seam's default of 6 would be four extra worker round trips for nothing.
   *
   * 'yes-no' is the opposite: the worker runs one FULL language-model forward
   * pass per passage, sequentially. Measured on Qwen3-Reranker 0.6B: ~87ms each,
   * so 30 passages is ~2.4s of the 20s call budget with short passages — and
   * real retrieved chunks are far longer than the ones that was measured on.
   * Chunking keeps any single call well inside the timeout, so a slow machine
   * or a long pool degrades into more calls rather than one that blows the
   * deadline and reranks nothing.
   */
  get batchSize(): number {
    // 'listwise' is emphatically NOT chunked here: the model compares passages
    // against each other in one pass, so slicing the pool at this seam would
    // change the answer. jinaListwiseRerank.planBlocks does its own splitting,
    // against a budget that is a correctness boundary rather than a batch size.
    return this.scoring === 'yes-no' ? YES_NO_BATCH_SIZE : Number.MAX_SAFE_INTEGER;
  }

  private worker: Worker | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, Pending>();
  private loadingPromise: Promise<void> | null = null;
  private loadFailed = false;
  private loadFailureReason: string | null = null;

  /**
   * @param scoring 'rank' for a model with a ranking head (llama.cpp scores it
   *   directly); 'yes-no' for a causal LM like Qwen3-Reranker, which has no
   *   such head and is scored by the probability it puts on "yes" vs "no";
   *   'listwise' for jina-reranker-v3.5, whose score is a cosine between
   *   projected hidden states — see jinaListwiseRerank.ts.
   * @param projectorPath required for 'listwise' and meaningless otherwise:
   *   v3.5's scoring MLP is a separate safetensors file, by Jina's design.
   */
  constructor(
    private readonly modelPath: string,
    private readonly scoring: 'rank' | 'yes-no' | 'listwise' = 'rank',
    private readonly projectorPath: string | null = null,
    /** 'listwise' only: tokens per block. See jinaListwiseRerank.ts. */
    private readonly blockBudget: number | null = null,
    /**
     * Worker factory. Production passes nothing; tests inject a stand-in so the
     * teardown protocol can be exercised without a real llama.cpp thread.
     */
    private readonly spawnWorker: (workerPath: string) => Worker =
      (workerPath) => new Worker(workerPath),
  ) {}

  /** Why the last load failed, for the UI. Null while healthy. */
  get failureReason(): string | null {
    return this.loadFailureReason;
  }

  private workerPath(): string {
    const candidates = [
      path.join(__dirname, 'ggufRerankerWorker.js'),
      path.join(__dirname, 'rag', 'ggufRerankerWorker.js'),
      path.join(__dirname, 'electron', 'rag', 'ggufRerankerWorker.js'),
    ];
    let resolved = candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
    // The worker loads a native addon, which cannot be read from inside an
    // asar archive — the same rewrite LocalReranker does.
    if (resolved.includes('app.asar') && !resolved.includes('app.asar.unpacked')) {
      resolved = resolved.replace('app.asar', 'app.asar.unpacked');
    }
    return resolved;
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = this.spawnWorker(this.workerPath());

    worker.on('message', (msg: any) => {
      const entry = this.pending.get(msg?.requestId);
      if (!entry) return;                 // a reply for a call that already timed out
      this.pending.delete(msg.requestId);
      clearTimeout(entry.timer);
      if (msg.type === 'error') entry.reject(new Error(msg.error));
      else entry.resolve(msg);
    });

    // A worker that dies must reject everything in flight rather than leaving
    // callers to hang until some outer timeout notices.
    const fail = (reason: string) => {
      this.rejectAllPending(new Error(reason));
      this.worker = null;
      this.loadingPromise = null;
    };
    worker.on('error', (e) => fail(`gguf reranker worker error: ${e?.message || e}`));
    worker.on('exit', (code) => { if (code !== 0) fail(`gguf reranker worker exited with code ${code}`); });

    this.worker = worker;
    return worker;
  }

  private post<T>(message: Record<string, unknown>, timeoutMs: number): Promise<T> {
    return this.postTo<T>(this.getWorker(), message, timeoutMs);
  }

  /**
   * Send to an EXPLICIT worker. dispose() needs this: it has already cleared
   * `this.worker`, and routing through getWorker() would spawn a replacement
   * thread just to tell it to shut down.
   */
  private postTo<T>(worker: Worker, message: Record<string, unknown>, timeoutMs: number): Promise<T> {
    const requestId = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`gguf reranker timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      worker.postMessage({
        ...message, requestId,
        modelPath: this.modelPath, scoring: this.scoring, projectorPath: this.projectorPath,
        blockBudget: this.blockBudget,
      });
    });
  }

  private rejectAllPending(error: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  private async ensureLoaded(): Promise<void> {
    // A model llama.cpp cannot rank fails the same way every time. Latch it, so
    // a doomed 400MB load is not retried on every query.
    if (this.loadFailed) throw new Error(this.loadFailureReason ?? 'gguf reranker unavailable');
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = (async () => {
      if (!fs.existsSync(this.modelPath)) {
        throw new Error(`gguf model not found at ${path.basename(this.modelPath)}`);
      }
      await this.post({ type: 'init' }, WORKER_INIT_TIMEOUT_MS);
    })();

    try {
      await this.loadingPromise;
    } catch (e: any) {
      this.loadFailed = true;
      this.loadFailureReason = e?.message || String(e);
      this.loadingPromise = null;
      throw e;
    }
  }

  async isAvailable(): Promise<boolean> {
    try { await this.ensureLoaded(); return true; } catch { return false; }
  }

  /**
   * Fails CLOSED: null means the caller keeps its existing ordering. A rerank
   * failure must never surface as an error to the user.
   */
  async rerank(query: string, passages: string[]): Promise<Array<{ index: number; score: number }> | null> {
    if (!query.trim() || passages.length === 0) return null;
    try {
      await this.ensureLoaded();
      const result = await this.post<{ scores?: number[] }>(
        { type: 'rerank', query, passages }, WORKER_RERANK_TIMEOUT_MS,
      );
      const scores = result?.scores;

      // Every passage scored exactly once, or nothing. A partial ranking sinks
      // the unscored chunks to -Infinity in the caller's ordering, below chunks
      // the reranker never even saw.
      if (!Array.isArray(scores) || scores.length !== passages.length) return null;
      if (!scores.every((s) => typeof s === 'number' && Number.isFinite(s))) return null;

      return scores
        .map((score, index) => ({ index, score }))
        .sort((a, b) => b.score - a.score);
    } catch (e: any) {
      console.warn('[GgufReranker] rerank failed (keeping existing order):', e?.message || e);
      return null;
    }
  }

  /**
   * Release the model, then the thread.
   *
   * `terminate()` alone was not enough (2026-09-03). The worker owns llama.cpp
   * handles — context, model, llama — whose own `dispose()` methods it exposes
   * behind a `dispose` message, and killing the thread skipped every one of
   * them: the mmap'd GGUF and the KV cache were reclaimed by thread death
   * rather than through llama.cpp's API. Terminating also unwinds the thread
   * wherever it stands, including inside a native `context.rankAll()` — the
   * same shape as this repo's Nemotron teardown SIGABRT — and a rerank really
   * can be in flight here, because switching models in Settings disposes the
   * port from the same process that serves retrieval.
   *
   * So: ask first, wait briefly, then terminate regardless. The wait is bounded
   * because a wedged worker must never be able to hold up a quit.
   */
  async dispose(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    this.loadingPromise = null;
    if (!worker) {
      this.rejectAllPending(new Error('gguf reranker disposed'));
      return;
    }

    try {
      await this.postTo<void>(worker, { type: 'dispose' }, WORKER_DISPOSE_TIMEOUT_MS);
    } catch {
      // Timed out or errored — fall through to terminate. Losing the graceful
      // release is strictly better than leaving the thread alive.
    }
    this.rejectAllPending(new Error('gguf reranker disposed'));
    try { await worker.terminate(); } catch { /* best effort */ }
  }
}
