// electron/intelligence/memory/HindsightRetainQueue.ts
//
// Spec Phase 16 — async retain queue. retain() must NEVER block the live answer path
// (rule #4) and must NOT retain every partial STT chunk synchronously (rule #5). This
// queue buffers retain items and drains them on a background microtask with a bounded
// concurrency of 1 (ordered, gentle) — so the live path just enqueues and moves on.
//
// Pure orchestration; the actual retain work is the injected worker. Never throws into
// the caller.

import type { RetainItem } from './MemoryProvider';

export class HindsightRetainQueue {
  private q: RetainItem[] = [];
  private draining = false;
  private readonly maxQueue: number;

  constructor(private worker: (item: RetainItem) => Promise<void>, maxQueue = 500) {
    this.maxQueue = maxQueue;
  }

  /** Enqueue an item and kick the drain on a microtask. Returns immediately. */
  enqueue(item: RetainItem): void {
    try {
      if (this.q.length >= this.maxQueue) this.q.shift(); // drop oldest under pressure
      this.q.push(item);
      // Schedule drain without blocking — microtask, not awaited.
      if (!this.draining) void this.drain();
    } catch { /* never throw */ }
  }

  /** Drain the queue, one item at a time. Safe to call repeatedly. */
  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.q.length > 0) {
        const item = this.q.shift()!;
        try { await this.worker(item); } catch { /* a failed item never stops the queue */ }
      }
    } finally {
      this.draining = false;
    }
  }

  get depth(): number { return this.q.length; }
}
