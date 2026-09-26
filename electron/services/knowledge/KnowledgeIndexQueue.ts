// electron/services/knowledge/KnowledgeIndexQueue.ts
//
// OKF Phase 7 — background indexing queue for Knowledge Pack generation.
// KnowledgeManager.generateForFile() is synchronous (~300-500ms on the
// 66-page benchmark thesis, per the extractionMs stat) — fine to run inline
// at upload time for typical documents. This queue exists for the case the
// migration plan flags as a risk: a VERY large document (100s of pages)
// where synchronous extraction would visibly block the upload UI.
//
// Design: a single-flight-per-file in-process queue (no persistence — an
// in-flight job lost on app restart just re-runs generateForFile
// synchronously on next access, since KnowledgeManager.getPackForFile falls
// back to whatever is already persisted). Emits progress events over a
// simple EventEmitter so ipcHandlers can forward them to the renderer.

import { EventEmitter } from 'node:events';
import type { GenerateResult, ReferenceFileInput } from './KnowledgeManager';

export type IndexJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface IndexJobProgress {
  fileId: string;
  status: IndexJobStatus;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

// Bounded per KnowledgeCache.ts's BoundedMap precedent — `jobs` previously
// had no eviction, growing one entry per unique fileId ever indexed for the
// life of the process (a long-running session that uploads/regenerates many
// files over hours would leak memory, however slowly). Simple
// evict-oldest-on-overflow via delete+re-set (Map iteration order is
// insertion order), same as KnowledgeCache's cap.
const MAX_TRACKED_JOBS = 256;

class KnowledgeIndexQueueImpl extends EventEmitter {
  private jobs = new Map<string, IndexJobProgress>();
  private cancelled = new Set<string>();
  private inFlight = new Map<string, Promise<GenerateResult>>();

  /**
   * Enqueues (or returns the in-flight promise for) a generateForFile job.
   * Single-flight per fileId — a second call while one is running for the
   * SAME file returns the same promise rather than starting a duplicate.
   */
  enqueue(
    file: ReferenceFileInput,
    force: boolean,
    runner: (file: ReferenceFileInput, force: boolean) => GenerateResult,
  ): Promise<GenerateResult> {
    const existing = this.inFlight.get(file.id);
    if (existing) return existing;

    this.cancelled.delete(file.id);
    this.setProgress(file.id, { fileId: file.id, status: 'queued' });

    const promise = new Promise<GenerateResult>((resolve) => {
      // Yield to the event loop once so `queued` progress is observable
      // before `running` fires — matters for a UI that wants to show a
      // brief "queued" state on a busy queue (future multi-job scheduler).
      setImmediate(() => {
        if (this.cancelled.has(file.id)) {
          this.setProgress(file.id, { fileId: file.id, status: 'cancelled', finishedAt: Date.now() });
          resolve({ status: 'skipped_empty' }); // cancelled = treated as a no-op result
          return;
        }
        this.setProgress(file.id, { fileId: file.id, status: 'running', startedAt: Date.now() });
        try {
          const result = runner(file, force);
          if (this.cancelled.has(file.id)) {
            this.setProgress(file.id, { fileId: file.id, status: 'cancelled', finishedAt: Date.now() });
          } else {
            this.setProgress(file.id, { fileId: file.id, status: 'done', finishedAt: Date.now() });
          }
          resolve(result);
        } catch (err: any) {
          this.setProgress(file.id, { fileId: file.id, status: 'failed', finishedAt: Date.now(), error: String(err?.message || err) });
          resolve({ status: 'failed', error: String(err?.message || err) });
        } finally {
          this.inFlight.delete(file.id);
        }
      });
    });

    this.inFlight.set(file.id, promise);
    return promise;
  }

  /**
   * Best-effort cancellation. The synchronous extractor (OkfExtractor is
   * pure regex/string work with no yield points) cannot be interrupted
   * mid-run — cancel() only prevents a QUEUED job from starting and marks a
   * RUNNING job's result as discarded once it completes (the DB write still
   * happens; a discarded job's data is simply not reported as 'done' to
   * listeners, and a subsequent getPackForFile call will still see it since
   * suppressing the persisted write for an already-computed result would
   * waste the completed work for no benefit).
   */
  cancel(fileId: string): void {
    this.cancelled.add(fileId);
  }

  getProgress(fileId: string): IndexJobProgress | null {
    return this.jobs.get(fileId) ?? null;
  }

  private setProgress(fileId: string, progress: IndexJobProgress): void {
    if (this.jobs.has(fileId)) this.jobs.delete(fileId); // refresh insertion order (LRU-ish)
    this.jobs.set(fileId, progress);
    if (this.jobs.size > MAX_TRACKED_JOBS) {
      const oldestKey = this.jobs.keys().next().value;
      if (oldestKey !== undefined) this.jobs.delete(oldestKey);
    }
    this.emit('progress', progress);
  }
}

// GOTCHA (same pattern as KnowledgeCache.ts): scripts/build-electron.js
// bundles every .ts file as its own esbuild entry point, so a plain
// `export const knowledgeIndexQueue = new KnowledgeIndexQueueImpl()` would
// give ipcHandlers.ts's inlined copy a DIFFERENT EventEmitter instance than
// KnowledgeManager.ts's — the progress listener registered in ipcHandlers.ts
// would never fire for jobs enqueued via KnowledgeManager.ts. Anchor to
// globalThis so every bundle shares the same singleton within the process.
const GLOBAL_KEY = '__natively_okf_knowledge_index_queue__';
function getGlobalQueue(): KnowledgeIndexQueueImpl {
  const g = globalThis as unknown as Record<string, KnowledgeIndexQueueImpl | undefined>;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new KnowledgeIndexQueueImpl();
  return g[GLOBAL_KEY];
}
export const knowledgeIndexQueue = getGlobalQueue();
