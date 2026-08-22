/**
 * Deterministic clock for Auto Answer tests. Same shape as
 * `AutoAnswerClock.ts`'s Clock. `advance(ms)` runs due timers in firing order
 * (ties by registration order); timers scheduled while advancing are honoured
 * inside the same advance when they fall due within it.
 */
export class FakeClock {
  constructor(start = 1_000_000) {
    this.t = start;
    this.seq = 0;
    this.timers = new Map();
  }
  now() { return this.t; }
  setTimeout(fn, ms) {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + Math.max(0, ms), fn, id });
    return id;
  }
  clearTimeout(id) { this.timers.delete(id); }
  pendingCount() { return this.timers.size; }
  advance(ms) {
    const target = this.t + ms;
    for (;;) {
      let next = null;
      for (const timer of this.timers.values()) {
        if (timer.at <= target && (next === null || timer.at < next.at || (timer.at === next.at && timer.id < next.id))) next = timer;
      }
      if (!next) break;
      this.timers.delete(next.id);
      this.t = Math.max(this.t, next.at);
      next.fn();
    }
    this.t = target;
  }
}
