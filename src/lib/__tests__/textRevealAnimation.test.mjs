import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRevealHistory,
  resetRevealHistory,
  pushRevealSample,
  revealTimeForIndex,
  animatedTailStart,
  splitIntoWordRuns,
  remainingFadeMs,
  WORD_FADE_DURATION_MS,
  MAX_ANIMATED_WORDS,
  WORD_FADE_BLUR_PX,
  WORD_OPACITY_DURATION_MS,
  REDUCED_MOTION_BLOCK_FADE_MS,
  GIST_CHIP_FADE_MS,
  REVEAL_WORD_CLASS,
} from '../textRevealAnimation.mjs';

test('config matches the current tuning (160ms fade, 90ms opacity, 12-word cap, 2px blur)', () => {
  assert.equal(WORD_FADE_DURATION_MS, 160);
  assert.equal(WORD_OPACITY_DURATION_MS, 90);
  assert.equal(MAX_ANIMATED_WORDS, 12);
  assert.equal(WORD_FADE_BLUR_PX, 2);
  assert.equal(REDUCED_MOTION_BLOCK_FADE_MS, 140);
  assert.equal(GIST_CHIP_FADE_MS, 220);
  assert.equal(REVEAL_WORD_CLASS, 'reveal-word');
  // The CSS keyframes hardcode these; they must agree or the negative
  // animation-delay lands on the wrong frame of the animation.
  assert.ok(WORD_FADE_DURATION_MS <= 300, 'UI motion stays under 300ms');
});

test('opacity settles strictly before the blur clears — presence precedes focus', () => {
  // The whole point of splitting the two curves. If these ever converge the
  // effect collapses back to a plain crossfade.
  assert.ok(
    WORD_OPACITY_DURATION_MS < WORD_FADE_DURATION_MS,
    'a word must become legible before it finishes sharpening',
  );
  // ...but not so early that the word is fully opaque while still visibly
  // smeared, which reads as a rendering fault rather than a materialization.
  assert.ok(
    WORD_OPACITY_DURATION_MS > WORD_FADE_DURATION_MS * 0.4,
    'opacity finishing too early leaves an opaque blurred word',
  );
});

test('the seal hold covers the LONGEST word animation, not just the opacity leg', () => {
  // remainingFadeMs is what holds the finalize; it must be keyed to the blur
  // duration (the longer of the two) or the seal would land while the last
  // word is still sharpening.
  assert.equal(WORD_FADE_DURATION_MS, Math.max(WORD_FADE_DURATION_MS, WORD_OPACITY_DURATION_MS));
});

test('revealTimeForIndex returns the frame that FIRST put a character on screen', () => {
  const h = createRevealHistory();
  pushRevealSample(h, 1000, 10);
  pushRevealSample(h, 1016, 20);
  pushRevealSample(h, 1032, 30);
  // char 0-9 arrived on the first frame
  assert.equal(revealTimeForIndex(h, 0), 1000);
  assert.equal(revealTimeForIndex(h, 9), 1000);
  // char 10 is the first character of the SECOND frame
  assert.equal(revealTimeForIndex(h, 10), 1016);
  assert.equal(revealTimeForIndex(h, 19), 1016);
  assert.equal(revealTimeForIndex(h, 20), 1032);
});

test('revealTimeForIndex returns null past the newest sample (not yet revealed)', () => {
  const h = createRevealHistory();
  pushRevealSample(h, 1000, 10);
  assert.equal(revealTimeForIndex(h, 10), null);
  assert.equal(revealTimeForIndex(h, 999), null);
});

test('an empty history never claims to know a reveal time', () => {
  const h = createRevealHistory();
  assert.equal(revealTimeForIndex(h, 0), null);
});

test('history is pruned by AGE, so it stays bounded during a long answer', () => {
  const h = createRevealHistory();
  for (let i = 1; i <= 600; i++) pushRevealSample(h, i * 16, i * 4);
  // 600 frames = ~9.6s of streaming; only the last ~260ms can still matter.
  assert.ok(h.samples.length < 25, `history grew to ${h.samples.length} samples`);
  // ...and the retained window still answers lookups inside the fade window.
  const newest = h.samples[h.samples.length - 1];
  assert.equal(revealTimeForIndex(h, newest.len - 1), newest.ts);
});

test('pruning keeps one sample beyond the cutoff so a boundary lookup still resolves', () => {
  const h = createRevealHistory();
  pushRevealSample(h, 0, 10);
  pushRevealSample(h, 100, 20);
  pushRevealSample(h, 500, 30); // 500 - 260 = 240 cutoff; both earlier samples expired
  assert.ok(h.samples.length >= 2, 'must not prune down to a single sample');
  assert.equal(h.samples[h.samples.length - 1].len, 30);
});

test('non-monotonic samples are rejected rather than corrupting the search', () => {
  const h = createRevealHistory();
  pushRevealSample(h, 1000, 20);
  pushRevealSample(h, 1016, 20); // no new characters
  pushRevealSample(h, 1032, 15); // backwards (should be impossible, but)
  pushRevealSample(h, 900, 30); // backwards in time
  assert.equal(h.samples.length, 1);
  assert.equal(revealTimeForIndex(h, 19), 1000);
});

test('animatedTailStart bounds the animated window to the fade duration', () => {
  // Explicit duration, not WORD_FADE_DURATION_MS: this asserts the WINDOWING
  // LOGIC, which must hold at any duration. The tuned value is pinned by the
  // config test above, so tying these fixtures to it as well would only make
  // every future retune look like a logic regression.
  const DURATION = 260;
  const h = createRevealHistory();
  pushRevealSample(h, 0, 100, DURATION);
  pushRevealSample(h, 200, 150, DURATION);
  pushRevealSample(h, 400, 200, DURATION);
  // At t=400 the fade window opens at t=140; the newest sample at/older than
  // that is the t=0 one (len 100) — so chars 100..200 are still animating.
  assert.equal(animatedTailStart(h, 400, 200, DURATION), 100);
});

test('animatedTailStart animates from 0 when the whole stream is younger than the fade', () => {
  const h = createRevealHistory();
  pushRevealSample(h, 1000, 5);
  pushRevealSample(h, 1016, 12);
  assert.equal(animatedTailStart(h, 1020, 12, WORD_FADE_DURATION_MS), 0);
});

test('animatedTailStart animates nothing when there is no history (post-reset)', () => {
  const h = createRevealHistory();
  assert.equal(animatedTailStart(h, 1000, 400, WORD_FADE_DURATION_MS), 400);
});

test('reset clears the history so a new answer never inherits stale timestamps', () => {
  const h = createRevealHistory();
  pushRevealSample(h, 5000, 400);
  resetRevealHistory(h);
  assert.equal(h.samples.length, 0);
  // The critical property: after reset, index 0 of the NEW stream must not
  // resolve to the previous stream's clock.
  assert.equal(revealTimeForIndex(h, 0), null);
  assert.equal(animatedTailStart(h, 10, 3, WORD_FADE_DURATION_MS), 3);
});

test('animatedTailStart never exceeds revealedLen', () => {
  const h = createRevealHistory();
  pushRevealSample(h, 0, 500);
  assert.equal(animatedTailStart(h, 1000, 20, WORD_FADE_DURATION_MS), 20);
});

test('splitIntoWordRuns keeps whitespace OUTSIDE the wrapped words', () => {
  const runs = splitIntoWordRuns('hello world');
  assert.deepEqual(runs, [
    { text: 'hello', isWord: true },
    { text: ' ', isWord: false },
    { text: 'world', isWord: true },
  ]);
});

test('splitIntoWordRuns preserves leading and trailing whitespace exactly', () => {
  const runs = splitIntoWordRuns('  a\n b ');
  assert.equal(runs.map((r) => r.text).join(''), '  a\n b ');
  assert.deepEqual(runs.filter((r) => r.isWord).map((r) => r.text), ['a', 'b']);
});

test('splitIntoWordRuns round-trips any input without losing a character', () => {
  for (const input of ['', ' ', 'one', 'a, b; c.', '  spaced  out  ', 'emoji 🎉 tail', '\t\ntabs\t']) {
    assert.equal(splitIntoWordRuns(input).map((r) => r.text).join(''), input, `lost data on ${JSON.stringify(input)}`);
  }
});

test('a realistic stream: every word gets a delay inside [-duration, 0)', () => {
  const h = createRevealHistory();
  const text = 'The quick brown fox jumps over the lazy dog and keeps on running for a while';
  // 240 chars/sec at 60fps = 4 chars/frame
  let len = 0;
  let t = 0;
  const seen = [];
  while (len < text.length) {
    t += 16;
    len = Math.min(text.length, len + 4);
    pushRevealSample(h, t, len, WORD_FADE_DURATION_MS);
    const start = animatedTailStart(h, t, len, WORD_FADE_DURATION_MS);
    for (let i = start; i < len; i++) {
      const ts = revealTimeForIndex(h, i);
      if (ts === null) continue;
      const age = t - ts;
      seen.push(age);
      assert.ok(age >= 0, `negative age ${age} at char ${i}`);
      assert.ok(age <= WORD_FADE_DURATION_MS, `stale char ${i} still in the animated window (age ${age})`);
    }
  }
  assert.ok(seen.length > 0, 'the animated window was never populated');
});

test('remainingFadeMs holds the full duration when the last char just landed', () => {
  const h = createRevealHistory();
  pushRevealSample(h, 1000, 50);
  // The tick that revealed the final character IS this tick.
  assert.equal(remainingFadeMs(h, 1000, 50, WORD_FADE_DURATION_MS), WORD_FADE_DURATION_MS);
});

test('remainingFadeMs counts down as the last word settles', () => {
  const DURATION = 260; // explicit: behavior under test, not the tuned value
  const h = createRevealHistory();
  pushRevealSample(h, 1000, 50, DURATION);
  assert.equal(remainingFadeMs(h, 1100, 50, DURATION), DURATION - 100);
  assert.equal(remainingFadeMs(h, 1259, 50, DURATION), 1);
});

test('remainingFadeMs is 0 once the last word has settled — the seal is not delayed', () => {
  const h = createRevealHistory();
  pushRevealSample(h, 1000, 50);
  assert.equal(remainingFadeMs(h, 1000 + WORD_FADE_DURATION_MS, 50, WORD_FADE_DURATION_MS), 0);
  assert.equal(remainingFadeMs(h, 99999, 50, WORD_FADE_DURATION_MS), 0);
});

test('remainingFadeMs is 0 for an empty stream or an empty history', () => {
  const h = createRevealHistory();
  assert.equal(remainingFadeMs(h, 1000, 0, WORD_FADE_DURATION_MS), 0);
  assert.equal(remainingFadeMs(h, 1000, 50, WORD_FADE_DURATION_MS), 0, 'no history: never hold the seal');
});

test('remainingFadeMs never exceeds the fade duration, even on clock skew', () => {
  const h = createRevealHistory();
  pushRevealSample(h, 5000, 50);
  // nowMs behind the sample (should not happen; must not produce a huge hold)
  const held = remainingFadeMs(h, 4000, 50, WORD_FADE_DURATION_MS);
  assert.ok(held >= 0 && held <= WORD_FADE_DURATION_MS, `hold ${held} out of range`);
});

test('the seal hold is bounded: a whole answer cannot delay finalize by more than one fade', () => {
  const h = createRevealHistory();
  let len = 0;
  for (let t = 16; len < 400; t += 16) {
    len = Math.min(400, len + 4);
    pushRevealSample(h, t, len, WORD_FADE_DURATION_MS);
    const hold = remainingFadeMs(h, t, len, WORD_FADE_DURATION_MS);
    assert.ok(hold <= WORD_FADE_DURATION_MS, `hold ${hold} exceeded one fade duration`);
  }
});
