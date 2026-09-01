/**
 * A GGUF reranker at the single rerank seam, via llama.cpp.
 *
 * Core already ran ONNX cross-encoders; this adds the other local format, so a
 * model published only as GGUF is usable without an extension.
 *
 * WHAT THIS CAN AND CANNOT RUN — measured, not assumed:
 *
 *   bge-reranker-v2-m3   arch bert    -> works, 119ms for 5 passages
 *   jina-reranker-v3.5   arch qwen3   -> llama.cpp refuses: no ranking head
 *   qwen3-reranker-0.6b  arch qwen3   -> same refusal
 *
 * llama.cpp's ranking path needs a model with a classification head and RANK
 * pooling. The two qwen3-architecture "rerankers" are generative models scored
 * a completely different way (Jina's own rerank.py needs a patched llama.cpp,
 * per-token hidden states and a separate projector). Their catalogue entries
 * say so rather than offering a download that cannot score.
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

interface Pending {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class GgufReranker implements RerankSeamPort {
  /**
   * llama.cpp handles the whole pool in one call and batches internally, so the
   * seam's default batch of 6 would just be four extra round trips through the
   * worker for no benefit. See RerankSeamPort.batchSize.
   */
  readonly batchSize = Number.MAX_SAFE_INTEGER;

  private worker: Worker | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, Pending>();
  private loadingPromise: Promise<void> | null = null;
  private loadFailed = false;
  private loadFailureReason: string | null = null;

  constructor(private readonly modelPath: string) {}

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
    const worker = new Worker(this.workerPath());

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
    const worker = this.getWorker();
    const requestId = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`gguf reranker timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      worker.postMessage({ ...message, requestId, modelPath: this.modelPath });
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

  async dispose(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    this.loadingPromise = null;
    this.rejectAllPending(new Error('gguf reranker disposed'));
    if (!worker) return;
    try { await worker.terminate(); } catch { /* best effort */ }
  }
}
