/**
 * Deterministic AI-response streaming: a rate-capped, word-aware "reveal"
 * layer that decouples how fast text is DISPLAYED from how fast the
 * provider actually emits it.
 *
 * Problem this replaces: different providers (Groq, Gemini, MiniMax,
 * DeepSeek, ...) chunk their output at wildly different, bursty intervals —
 * a few characters, a pause, then a whole sentence. Mirroring that directly
 * in the UI reads as jittery and "cheap", and the pattern differs per
 * provider, which is the opposite of a consistent product feel.
 *
 * Fix: the model keeps generating at full speed in the background (nothing
 * here slows inference down) — this module only paces how much of the
 * already-arrived backlog is shown per frame:
 *
 *   displayRate = min(providerRate, MAX_REVEAL_RATE)
 *
 * If the provider is slower than the cap, whatever has arrived is shown
 * essentially immediately (the cap never becomes the bottleneck for a slow
 * trickle). If the provider bursts faster than the cap, the excess is
 * buffered and drained smoothly over subsequent frames instead of dumped in
 * one paint — same visual cadence regardless of which provider is behind
 * the answer.
 *
 * This module is a pure, clock-free state machine: every timestamp
 * (`nowMs`) and frame delta (`deltaMs`) is passed in by the caller (a
 * requestAnimationFrame loop in NativelyInterface.tsx), never read via
 * Date.now()/performance.now() here — that's what makes it exhaustively
 * unit-testable without faking the DOM or the clock.
 */

// ── Configuration (tune here) ───────────────────────────────────────────────
// v2: character-based rate (the token/chars-per-token estimate from v1 added
// an indirection this spec doesn't need — chars/sec is specified directly).
// 180 chars/sec ≈ 45 tokens/sec — raised from 120 (≈30 tok/s, the middle of
// the 20-40 tok/s UI display-speed band) per explicit request for a faster
// cap. Above the commonly-cited band's upper edge; the initial buffer,
// word/punctuation-aware boundaries, and deferred-completion behavior all
// still apply unchanged at this rate.
export const MAX_REVEAL_CHARACTERS_PER_SECOND = 180;
export const INITIAL_BUFFER_MS = 80;
export const INITIAL_BUFFER_CHAR_THRESHOLD = 12;
// Informational only — the render loop is driven by real rAF timestamps
// (variable deltaMs), not a fixed-interval timer built around this number.
// Real deltas are strictly more robust to dropped/late frames than a
// setTimeout(1000/60) would be, and the rate-cap math below already adapts
// to whatever deltaMs it's given.
export const USE_ANIMATION_FRAME = true;
// When false (the default): a stream's natural completion does NOT snap the
// remaining backlog to full text — the reveal keeps draining at the same
// deterministic rate all the way to the last character, so the animation
// feels identical from the first character to the final period regardless
// of when the network finished. When true: stream-end commits the full text
// immediately (the v1 behavior) — useful for a future experiment/rollback
// without code changes. NativelyInterface.tsx's finalize call sites are
// expected to honor this flag explicitly (it is NOT auto-applied inside
// tickPacer, which has no concept of "the provider is done").
export const FLUSH_IMMEDIATELY_ON_COMPLETE = false;

// Exposed as one object matching the shape callers may want to pass around /
// log / tune together, per spec. The individual named exports above remain
// the source of truth (this just mirrors them).
export const STREAM_RENDER_CONFIG = {
  maxCharactersPerSecond: MAX_REVEAL_CHARACTERS_PER_SECOND,
  initialBufferMs: INITIAL_BUFFER_MS,
  initialBufferCharacterThreshold: INITIAL_BUFFER_CHAR_THRESHOLD,
  useAnimationFrame: USE_ANIMATION_FRAME,
  flushImmediatelyOnComplete: FLUSH_IMMEDIATELY_ON_COMPLETE,
};

// Brief holds after punctuation so the reveal has a natural reading rhythm
// instead of a metronomic character drip. Frozen budget during a hold (see
// tickPacer) means the pause costs real wall-clock time, not banked chars —
// no burst on release. Not part of the v2 spec's explicit config list, but
// not contradicted by it either — kept from v1 since it measurably improves
// reading feel and is already built/tested.
export const SENTENCE_END_PAUSE_MS = 140; // . ! ?
export const CLAUSE_PAUSE_MS = 70; // , ; :

// Derived shorthand for the per-frame math below (deltaMs is in
// milliseconds).
export const MAX_REVEAL_CHARS_PER_MS = MAX_REVEAL_CHARACTERS_PER_SECOND / 1000;

const SENTENCE_END_CHARS = new Set(['.', '!', '?']);
const CLAUSE_PAUSE_CHARS = new Set([',', ';', ':']);

// Markdown constructs (bold/italic/code/link/heading/strikethrough) are
// delimited by these characters. Stopping a reveal exactly mid-run of them
// (e.g. showing "...text **" and pausing there) is the one case where
// pausing costs nothing (more text is already buffered) but skipping it
// avoids ever presenting a lone, ambiguous delimiter run as the visible
// edge of the answer.
const MARKDOWN_TAIL_HOLDBACK_RE = /[*_`[\]~#]+$/;

// A "word character" continues the current word — letters, digits,
// underscore, and apostrophe (so contractions like "don't" aren't split at
// the apostrophe). Anything else — whitespace, AND punctuation (comma,
// period, closing quote, ...) — is a boundary: a candidate landing right
// before a comma has already revealed a COMPLETE word ("Hello world," with
// the cursor after "world"), it should not be treated as mid-word just
// because the very next character happens to be punctuation rather than
// whitespace. (Markdown delimiters are also non-word by this definition —
// deliberately: holding back a bare "**" run is MARKDOWN_TAIL_HOLDBACK_RE's
// job above, not this function's; this function only cares about words.)
function isWordChar(ch) {
  return ch !== undefined && /[\p{L}\p{N}_']/u.test(ch);
}

function isWordBoundaryChar(ch) {
  return !isWordChar(ch);
}

/**
 * Snap `candidateLen` back to the start of an in-progress word so a reveal
 * never stops mid-fragment ("interv" this frame, "iew" the next) when the
 * rest of the word has already arrived. A no-op if `candidateLen` already
 * sits at a clean boundary (end of a word, or the true live edge of
 * arrival — handled by the caller). Never returns below `minLen`; if no
 * boundary exists between `minLen` and `candidateLen` (the whole span is one
 * unbroken word), returns `candidateLen` unchanged rather than stall.
 */
function snapToWordBoundary(text, candidateLen, minLen) {
  if (candidateLen <= minLen) return candidateLen;
  if (isWordBoundaryChar(text[candidateLen]) || isWordBoundaryChar(text[candidateLen - 1])) {
    return candidateLen;
  }
  let i = candidateLen;
  while (i > minLen && !isWordBoundaryChar(text[i - 1])) i -= 1;
  return i > minLen ? i : candidateLen;
}

/**
 * The single boundary-holdback policy for a reveal candidate: never end a
 * frame's reveal mid-markdown-delimiter-run or mid-word when the rest is
 * already sitting in the buffer. A no-op at the true live edge of arrival
 * (`candidateLen >= text.length`) — there is nothing buffered beyond it to
 * wait for, so the true arrived tail is shown as-is and self-resolves the
 * moment more text arrives.
 *
 * Forward progress is the one invariant that always wins: if honoring every
 * holdback would produce zero progress (result <= minLen), the raw
 * candidate is returned instead. A one-frame partial-word/partial-delimiter
 * flash is strictly better than a permanently frozen reveal — this is what
 * keeps the RAG chunk path (which calls this against a shrinking window that
 * may never grow past a stuck fragment like "**bo") from stalling forever.
 */
export function snapRevealBoundary(text, candidateLen, minLen) {
  if (candidateLen >= text.length) return candidateLen;

  let snapped = candidateLen;
  const mdMatch = text.slice(0, snapped).match(MARKDOWN_TAIL_HOLDBACK_RE);
  if (mdMatch) {
    const trimmed = snapped - mdMatch[0].length;
    if (trimmed > minLen) snapped = trimmed;
  }
  snapped = snapToWordBoundary(text, snapped, minLen);

  return snapped > minLen ? snapped : candidateLen;
}

/**
 * Fresh per-stream pacer state. Create one per answer (reset whenever a new
 * stream/msgId is adopted) — never share across concurrent/successive
 * streams, since `revealedLen` and the initial-buffer/pause timestamps are
 * only meaningful relative to one text's arrival.
 */
export function createPacerState() {
  return {
    revealedLen: 0,
    // Fractional characters carried across frames (the rate cap is
    // ~3 chars/frame at 60fps, which does not divide evenly into whole
    // chars — dropping the remainder every frame would make the effective
    // rate visibly slower than configured).
    charBudget: 0,
    // Wall-clock timestamp of this stream's first tick (for the initial
    // smoothing buffer window). Null until the first tickPacer call.
    bufferStartMs: null,
    // True until the initial smoothing buffer's gate has been passed.
    buffering: true,
    // While `nowMs < pauseUntilMs`, hold the reveal (a punctuation beat).
    pauseUntilMs: 0,
  };
}

/**
 * Advance one frame of the deterministic reveal. Mutates and returns
 * `state`. `nowMs`/`deltaMs` come from the caller's requestAnimationFrame
 * timestamp — this function never reads the clock itself.
 *
 * Behavior, in order:
 *   1. `reducedMotion` (WCAG 2.3.3) bypasses everything — full text, no
 *      buffer, no rate cap, no punctuation holds. Matches this file's
 *      "snap, don't animate" convention elsewhere in the codebase.
 *   2. Initial smoothing buffer: reveal nothing until EITHER
 *      INITIAL_BUFFER_MS has elapsed since this stream's first tick OR
 *      the arrived text has reached INITIAL_BUFFER_CHAR_THRESHOLD chars —
 *      whichever comes first. Removes the common "two characters then a
 *      dead pause" startup stutter.
 *   3. No backlog (revealed has fully caught up to arrived): the char
 *      budget is reset to zero rather than left to accumulate "idle
 *      credit". This is deliberate — every burst is paced at the exact
 *      same cap regardless of how long the preceding silence was, which is
 *      what makes the cadence read as consistent/deterministic rather than
 *      "sometimes fast after a pause, sometimes not".
 *   4. A punctuation hold in effect: skip this frame entirely, INCLUDING
 *      budget accumulation, so release-after-pause resumes at the normal
 *      rate rather than bursting on banked time.
 *   5. Otherwise: accumulate `deltaMs * MAX_REVEAL_CHARS_PER_MS` into the
 *      budget, spend the whole-character part of it (snapped to a clean
 *      word/markdown boundary), and — if the just-revealed run ends on
 *      sentence/clause punctuation — arm the next hold.
 */
export function tickPacer(state, fullText, nowMs, deltaMs, opts = {}) {
  const { reducedMotion = false } = opts;

  if (reducedMotion) {
    state.revealedLen = fullText.length;
    state.buffering = false;
    state.charBudget = 0;
    state.pauseUntilMs = 0;
    return state;
  }

  if (state.bufferStartMs === null) {
    state.bufferStartMs = nowMs;
  }

  if (state.buffering) {
    const elapsed = nowMs - state.bufferStartMs;
    if (elapsed >= INITIAL_BUFFER_MS || fullText.length >= INITIAL_BUFFER_CHAR_THRESHOLD) {
      state.buffering = false;
    } else {
      return state;
    }
  }

  const backlog = fullText.length - state.revealedLen;
  if (backlog <= 0) {
    state.charBudget = 0;
    return state;
  }

  if (nowMs < state.pauseUntilMs) return state;

  state.charBudget += deltaMs * MAX_REVEAL_CHARS_PER_MS;
  const chunk = Math.floor(state.charBudget);
  if (chunk <= 0) return state;

  const prevRevealedLen = state.revealedLen;
  const rawCandidate = Math.min(prevRevealedLen + chunk, fullText.length);
  const snapped = snapRevealBoundary(fullText, rawCandidate, prevRevealedLen);

  // Only spend budget for what was actually revealed — a word/delimiter held
  // back for this frame keeps its saved-up budget for the next one instead
  // of being charged for characters the user didn't actually see yet.
  state.charBudget -= snapped - prevRevealedLen;
  state.revealedLen = snapped;

  // Scan the WHOLE slice revealed this tick, not just its last character.
  // A single tick can span multiple characters (a large character budget
  // after the initial buffer closes, or catching up from a burst), so a
  // sentence/clause boundary can land mid-slice instead of exactly at the
  // end — checking only fullText[snapped - 1] would silently skip the
  // pause for text that jumped past a period/comma without landing on it.
  // Walk backward so the LAST (most recently reached) punctuation mark in
  // the slice wins, matching how a reader would pause at the boundary they
  // just arrived at, not an earlier one further back in the same tick.
  for (let i = snapped - 1; i >= prevRevealedLen; i -= 1) {
    const ch = fullText[i];
    if (SENTENCE_END_CHARS.has(ch)) {
      state.pauseUntilMs = nowMs + SENTENCE_END_PAUSE_MS;
      break;
    }
    if (CLAUSE_PAUSE_CHARS.has(ch)) {
      state.pauseUntilMs = nowMs + CLAUSE_PAUSE_MS;
      break;
    }
  }

  return state;
}

/**
 * Worst-case wall-clock time this pacer could legitimately take to fully
 * reveal `charCount` characters, ignoring punctuation holds (a slight
 * underestimate — used to size safety-net timeouts generously, not to
 * predict the exact finish time).
 */
export function estimateRevealDurationMs(charCount) {
  return Math.ceil(charCount / MAX_REVEAL_CHARS_PER_MS);
}
