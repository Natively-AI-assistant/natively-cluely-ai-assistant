// scripts/intent-benchmark/providers/workerHost.mjs
//
// Shared parent-side worker lifecycle: spawn, request/response correlation,
// timeout, teardown.
//
// Every model candidate needs exactly this and none of it is interesting, so it
// lives once. The timeout matters more than it looks: a candidate that hangs
// must fail its row and let the run continue, not stall a 400-row sweep. The
// production classifier's own 30s worker timeout is far too generous for a
// benchmark, so this defaults to 10s and records the failure.

import { Worker } from 'node:worker_threads';

export class WorkerHost {
  constructor(scriptPath, workerData, { timeoutMs = 10_000 } = {}) {
    this.scriptPath = scriptPath;
    this.workerData = workerData;
    this.timeoutMs = timeoutMs;
    this.worker = null;
    this.pending = new Map();
    this.nextId = 1;
    this.loadMs = null;
  }

  async start() {
    this.worker = new Worker(this.scriptPath, { workerData: this.workerData });
    this.worker.on('message', (m) => {
      if (m.type === 'loaded') { this.loadMs = m.ms; return; }
      const p = this.pending.get(m.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(m.id);
      if (m.type === 'error') p.reject(new Error(m.error));
      else p.resolve(m);
    });
    this.worker.on('error', (e) => {
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(e); }
      this.pending.clear();
    });
    await this.ask({ type: 'init' });
  }

  ask(msg) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`worker request ${id} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ ...msg, id });
    });
  }

  async stop() {
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    if (this.worker) { await this.worker.terminate(); this.worker = null; }
  }
}
