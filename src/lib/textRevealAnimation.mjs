/**
 * Per-word "materialize" animation for the streaming reveal.
 *
 * Companion to textRevealPacing.mjs: that module decides HOW MUCH text is
 * shown each frame; this one decides how each newly-shown word ARRIVES —
 * a short opacity+blur fade so words resolve into focus instead of
 * snapping in, the way text materializes across Apple's UI.
 *
 * ── Why this is keyframe-driven, not JS-driven ──────────────────────────
 * The obvious implementation — compute opacity/blur per word per frame and
 * write inline styles — is WRONG here, because revealTick is not a
 * continuously-running loop. It deliberately stops rescheduling the moment
 * the pacer catches up to the arrived text (`revealedLen >= fullText.length`)
 * and is restarted by ensureRevealTicker when the next token lands. For any
 * provider slower than the reveal cap (the common case) that happens between
 * every chunk. JS-driven styles would freeze the last words mid-fade —
 * blurred and translucent — for the whole inter-token gap.
 *
 * So each word is instead wrapped in a span carrying a CSS animation and a
 * NEGATIVE animation-delay equal to how long ago that word was revealed.
 * The browser owns the timeline: it renders the correct frame immediately
 * and finishes the fade on its own even after the rAF loop has stopped.
 *
 * This also survives the fact that paintRevealedNow rebuilds the node's
 * innerHTML from scratch every frame (markdown is re-parsed, so every
 * element is a NEW node — a CSS transition would restart from zero each
 * time). Because the animation is a pure function of "time since this word
 * was revealed", re-creating the span and re-deriving the same negative
 * delay reproduces exactly the frame the old node would have shown. A word
 * whose fade already completed gets a delay <= -duration and, with
 * fill-mode forwards, renders at its final state — no flicker on restart.
 *
 * Pure and DOM-free: the caller passes timestamps in, so all of it is
 * unit-testable without a browser or a clock.
 */

// ── Configuration (tune here) ───────────────────────────────────────────────
// Scaled with the reveal rate cap (260ms at 240 chars/sec -> 160ms at 400),
// on the same reasoning as the punctuation holds in textRevealPacing.mjs: a
// fixed wall-clock fade against a faster drip means MORE words are mid-fade
// at once, so the blur spreads across whole lines and the text reads mushy
// rather than materializing. Holding the fade proportional keeps roughly ten
// words animating at any instant regardless of rate — the effect stays a
// travelling edge, not a haze. Well under Emil's 300ms ceiling for UI motion.
//
// MUST be kept in sync with the `reveal-word-in` animation duration in
// src/index.css: the negative animation-delay computed here indexes into
// that CSS timeline, so a mismatch lands words on the wrong frame.
export const WORD_FADE_DURATION_MS = 160;

// Opacity settles well BEFORE the blur clears, rather than the two sharing
// one curve. This is the difference between "fading in" and "resolving into
// focus": the word becomes PRESENT almost immediately (so the reader is
// never waiting on legibility), then sharpens over the remaining time. One
// shared curve makes presence and sharpness arrive together, which reads as
// a plain crossfade — correct, but generic.
//
// Kept as a fraction of the fade so it scales with any future retune.
export const WORD_OPACITY_DURATION_MS = Math.round(WORD_FADE_DURATION_MS * 0.56);

// How many trailing words may animate at once. This is a COST cap, not a
// timing one: each blurred span is its own render surface, created and
// destroyed every frame inside an always-on transparent overlay window.
// At the 400 char/s cap a 160ms window covers ~64 chars ≈ 11 words, so 12
// sits just above the natural ceiling — it only binds during a burst drain,
// which is what a cost cap should do. Raising the rate without raising this
// would silently drop the tail words out of the animation entirely: past the
// budget they render as plain text, i.e. they pop in fully sharp.
export const MAX_ANIMATED_WORDS = 12;

// Deliberately small. Blur is what sells "resolving into focus" rather than
// "fading in", but at overlay body-text sizes anything past ~3px reads as a
// rendering glitch instead of a material, and costs more to composite.
// Trimmed from 2.5 alongside the split-curve change: the blur now runs the
// FULL fade on a gentler curve instead of clearing fast on a strong ease-out,
// so the same radius stays visible roughly twice as long and 2.5px started
// to read as smeared rather than soft.
export const WORD_FADE_BLUR_PX = 2;

// One-shot cross-fade for the whole answer block, used ONLY under reduced
// motion. The preference asks for gentler motion, not none: tickPacer's
// reducedMotion branch drops the entire answer in a single frame, and a
// block appearing instantly is harsher than a short opacity fade. No blur
// and no per-word stagger — just presence.
export const REDUCED_MOTION_BLOCK_FADE_MS = 140;

// The trailing [[GIST]] chip is excluded from the per-word walk (it is a
// separate summary element, not part of the prose), so without its own
// treatment it snaps into existence under a paragraph that materialized
// smoothly. Same negative-delay technique, one element, keyed to when the
// chip first appeared.
export const GIST_CHIP_FADE_MS = 220;

// Class name the wrapper spans carry (styled in index.css).
export const REVEAL_WORD_CLASS = 'reveal-word';

/**
 * Bounded history of (timestamp, revealedLen) samples, newest last — one
 * per frame that actually revealed characters. Used to answer "when was the
 * character at index i first shown?".
 *
 * Bounded by time, not by count: anything older than the fade duration can
 * never affect a still-animating word.
 */
export function createRevealHistory() {
  return { samples: [] };
}

/**
 * Reset for a new stream. MUST be called wherever the pacer state is reset
 * (a new msgId), or the next answer's first words inherit the previous
 * answer's timestamps — producing either no animation at all (a delay far
 * past the duration) or, worse, a FUTURE delay that holds text invisible.
 */
export function resetRevealHistory(history) {
  history.samples.length = 0;
}

/**
 * Record that `revealedLen` characters were visible as of `nowMs`.
 * Call once per frame in which revealedLen changed.
 */
export function pushRevealSample(history, nowMs, revealedLen, durationMs = WORD_FADE_DURATION_MS) {
  const samples = history.samples;
  // Monotonic guard: a non-advancing or backward sample carries no new
  // information and would corrupt the search below.
  const last = samples[samples.length - 1];
  if (last && (revealedLen <= last.len || nowMs < last.ts)) return;
  samples.push({ ts: nowMs, len: revealedLen });
  // Drop samples that can no longer be inside any word's fade window. Keep
  // one extra beyond the cutoff so a lookup landing exactly at the boundary
  // still resolves instead of falling back.
  const cutoff = nowMs - durationMs;
  let drop = 0;
  while (drop + 1 < samples.length && samples[drop + 1].ts < cutoff) drop++;
  if (drop > 0) samples.splice(0, drop);
}

/**
 * When was the character at `index` first revealed?
 * Returns the timestamp of the earliest sample whose revealedLen exceeds
 * `index` (that frame is the one that first put the character on screen),
 * or null if it predates the retained history — in which case the caller
 * should treat the character as long-settled and not animate it.
 */
export function revealTimeForIndex(history, index) {
  const samples = history.samples;
  let lo = 0;
  let hi = samples.length - 1;
  let found = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].len > index) {
      found = samples[mid].ts;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return found;
}

/**
 * First character index that should still be animating at `nowMs`.
 *
 * Everything from here to `revealedLen` is inside the fade window; anything
 * before it has settled and must be left as plain text (both to bound the
 * cost and so that settled text is never re-wrapped).
 */
export function animatedTailStart(history, nowMs, revealedLen, durationMs = WORD_FADE_DURATION_MS) {
  const samples = history.samples;
  const cutoff = nowMs - durationMs;
  // Newest-first scan: the window is at most a handful of samples wide.
  for (let i = samples.length - 1; i >= 0; i--) {
    if (samples[i].ts <= cutoff) return Math.min(samples[i].len, revealedLen);
  }
  // Whole retained history is inside the window (stream just started).
  return samples.length > 0 ? 0 : revealedLen;
}

/**
 * How long the LAST revealed character still has left in its fade, at
 * `nowMs`. Zero once it has settled (or if it predates the retained
 * history, or nothing has been revealed).
 *
 * Used to hold the stream's final commit until the closing words have
 * finished materializing. Without it, the finalize swaps the imperative DOM
 * for React-rendered plain text while the last word is still mid-fade, and
 * that word snaps from blurred to sharp — the one frame of the animation the
 * user is most likely to be looking directly at.
 */
export function remainingFadeMs(history, nowMs, revealedLen, durationMs = WORD_FADE_DURATION_MS) {
  if (revealedLen <= 0) return 0;
  const revealedAt = revealTimeForIndex(history, revealedLen - 1);
  if (revealedAt === null) return 0;
  const elapsed = nowMs - revealedAt;
  if (elapsed < 0) return durationMs; // clock skew: hold the full duration
  return Math.max(0, durationMs - elapsed);
}

/**
 * Split `text` into alternating [non-word, word, non-word, word, ...] runs,
 * so a wrapper span always contains a WHOLE word and the whitespace between
 * words stays outside it as a bare text node.
 *
 * Whitespace must stay unwrapped: an animating span is a render surface,
 * and wrapping the spaces too would double the surface count for no visual
 * gain (a blurred space is a blurred nothing).
 */
export function splitIntoWordRuns(text) {
  const runs = [];
  const re = /\S+/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index), isWord: false });
    runs.push({ text: m[0], isWord: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), isWord: false });
  return runs;
}
