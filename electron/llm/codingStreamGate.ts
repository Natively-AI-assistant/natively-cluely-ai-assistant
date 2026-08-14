// electron/llm/codingStreamGate.ts
//
// Section-gated live streaming for coding/DSA answers (REPORT C1 — corrected).
//
// THE PROBLEM the scaffold-buffer tried to solve was "don't flash code-first
// markdown while the model streams". But buffering the ENTIRE response until
// generation + validation completed made coding answers feel >10s slow on the
// default Gemini model — the live-streaming feel was gone.
//
// THE FIX: stream coding tokens LIVE as soon as the structure is provably
// non-code-first. We hold tokens in a tiny buffer ONLY until the first markdown
// heading ("## ") is confirmed present, then flush and pass every subsequent
// token straight through. Because the prompt now forces "## Approach" first,
// the gate opens on (or near) the very first chunk in the common case — so
// first-useful-token ≈ provider first-token latency, not full-generation latency.
//
// If the model disobeys and emits code first, the gate stays closed and the
// caller's post-stream validate→repair reorders it (the old safe behavior) —
// but ONLY in that bad case, not always. Pure, dependency-free, unit-testable.

export class CodingStreamGate {
  private buf = '';
  private opened = false;

  // Max chars to buffer before force-flushing. Bounds the worst-case "held"
  // latency if no heading ever appears early. Generous enough to span leading
  // whitespace/newlines before "## Approach", small enough to stay imperceptible.
  static readonly MAX_GATE_CHARS = 48;

  /**
   * Feed one raw token. Returns the text to EMIT now:
   *  - while gating and not yet safe: '' (buffered)
   *  - on the chunk that opens the gate: the whole accumulated prefix
   *  - once open: the token verbatim (pass-through)
   */
  push(token: string): string {
    if (this.opened) return token;
    this.buf += token;
    if (this.shouldOpen()) {
      this.opened = true;
      const flush = this.buf;
      this.buf = '';
      return flush;
    }
    return '';
  }

  /**
   * Flush whatever remains at stream end. Covers the short-answer case where the
   * gate never opened (e.g. a terse reply with no heading) — we still emit it so
   * nothing is silently dropped. Idempotent: returns '' once already flushed.
   */
  finish(): string {
    if (this.opened) return '';
    this.opened = true;
    const flush = this.buf;
    this.buf = '';
    return flush;
  }

  get isOpen(): boolean {
    return this.opened;
  }

  /** True once any non-empty chunk has been (or is being) emitted. */
  hasEmitted(): boolean {
    return this.opened;
  }

  private shouldOpen(): boolean {
    // Hard cap: never hold more than MAX_GATE_CHARS (bounds flash latency).
    if (this.buf.length >= CodingStreamGate.MAX_GATE_CHARS) return true;
    const t = this.buf.trimStart();
    // Open as soon as a markdown heading prefix (#, ##, ###) leads the content —
    // that is the proof the answer is NOT code-first. trimStart so the model's
    // common leading newlines don't delay the gate.
    if (/^#{1,3}\s/.test(t)) return true;
    // A lone "#"/"##" with no following space yet — keep gating one more token to
    // see the space (avoids opening on a stray '#').
    if (/^#{1,3}$/.test(t)) return false;
    // Anything else leading (code fence, def/function/class, prose) → keep
    // gating; if it turns out code-first, validate/repair fixes it post-stream.
    return false;
  }
}
