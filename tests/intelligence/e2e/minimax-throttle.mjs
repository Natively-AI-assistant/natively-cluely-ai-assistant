/**
 * minimax-throttle.mjs — a GLOBAL question-per-minute throttle.
 *
 * The prompt mandates 25 questions/minute TOTAL across all keys (NOT per key). We
 * implement it as a single shared gate that every provider start awaits, enforcing
 * BOTH a rolling-60s ceiling (≤qpm starts in any 60s window) AND a minimum spacing
 * between starts (so a burst can't fire 25 calls in the first second then idle). All
 * workers share one instance, so concurrency never exceeds the global rate.
 */
export class GlobalThrottle {
  constructor({ qpm = 25, minSpacingMs = null } = {}) {
    this.qpm = qpm;
    this.windowMs = 60000;
    this.minSpacingMs = minSpacingMs != null ? minSpacingMs : Math.floor(this.windowMs / qpm); // 25 → 2400ms
    this.starts = []; // timestamps of recent starts (within window)
    this.lastStart = 0;
    this._chain = Promise.resolve(); // serialize acquire() so checks are atomic
  }

  async acquire() {
    // Serialize so two concurrent acquirers can't both pass the window check.
    const prev = this._chain;
    let release;
    this._chain = new Promise((r) => { release = r; });
    await prev;
    try {
      while (true) {
        const now = Date.now();
        // prune window
        this.starts = this.starts.filter((t) => now - t < this.windowMs);
        const sinceLast = now - this.lastStart;
        const spacingWait = this.lastStart ? Math.max(0, this.minSpacingMs - sinceLast) : 0;
        let windowWait = 0;
        if (this.starts.length >= this.qpm) {
          const earliest = this.starts[0];
          windowWait = Math.max(0, this.windowMs - (now - earliest) + 5);
        }
        const wait = Math.max(spacingWait, windowWait);
        if (wait <= 0) {
          this.lastStart = now;
          this.starts.push(now);
          return;
        }
        await new Promise((r) => setTimeout(r, wait));
      }
    } finally {
      release();
    }
  }

  stats() {
    const now = Date.now();
    return { qpm: this.qpm, minSpacingMs: this.minSpacingMs, inWindow: this.starts.filter((t) => now - t < this.windowMs).length };
  }
}
