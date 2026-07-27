import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPacerState,
  tickPacer,
  snapRevealBoundary,
  estimateRevealDurationMs,
  MAX_REVEAL_CHARS_PER_MS,
  MAX_REVEAL_CHARACTERS_PER_SECOND,
  INITIAL_BUFFER_MS,
  INITIAL_BUFFER_CHAR_THRESHOLD,
  SENTENCE_END_PAUSE_MS,
  CLAUSE_PAUSE_MS,
  FLUSH_IMMEDIATELY_ON_COMPLETE,
  STREAM_RENDER_CONFIG,
} from '../textRevealPacing.mjs';

const FRAME_MS = 1000 / 60;

// Drive `frames` rAF ticks (each FRAME_MS apart) against `fullText`, starting
// at time 0. Returns the final state.
function run(state, fullText, frames, opts) {
  let now = 0;
  for (let i = 0; i < frames; i += 1) {
    now += FRAME_MS;
    tickPacer(state, fullText, now, FRAME_MS, opts);
  }
  return state;
}

test('config matches the current tuning (180 chars/sec ≈ 45 tok/s, 80ms/12-char initial buffer, deferred flush by default)', () => {
  assert.equal(MAX_REVEAL_CHARACTERS_PER_SECOND, 180);
  assert.equal(MAX_REVEAL_CHARS_PER_MS, 0.18);
  assert.equal(INITIAL_BUFFER_MS, 80);
  assert.equal(INITIAL_BUFFER_CHAR_THRESHOLD, 12);
  assert.equal(FLUSH_IMMEDIATELY_ON_COMPLETE, false);
  assert.deepEqual(STREAM_RENDER_CONFIG, {
    maxCharactersPerSecond: 180,
    initialBufferMs: 80,
    initialBufferCharacterThreshold: 12,
    useAnimationFrame: true,
    flushImmediatelyOnComplete: false,
  });
});

test('initial smoothing buffer: reveals nothing until INITIAL_BUFFER_MS elapses (short text, never hits the char threshold)', () => {
  const state = createPacerState();
  const text = 'hi'; // well under INITIAL_BUFFER_CHAR_THRESHOLD
  let now = 0;
  // Step in small increments up to just under the buffer window.
  while (now < INITIAL_BUFFER_MS - FRAME_MS) {
    now += FRAME_MS;
    tickPacer(state, text, now, FRAME_MS);
    assert.equal(state.revealedLen, 0, `must not reveal before the buffer window closes (now=${now})`);
  }
  // Cross the threshold.
  now += FRAME_MS * 2;
  tickPacer(state, text, now, FRAME_MS);
  assert.ok(state.revealedLen > 0, 'must start revealing once the buffer window has elapsed');
});

test('initial smoothing buffer: opens early once INITIAL_BUFFER_CHAR_THRESHOLD chars have arrived, even before the timer', () => {
  const state = createPacerState();
  const text = 'x'.repeat(INITIAL_BUFFER_CHAR_THRESHOLD + 10);
  // Single tick, well within INITIAL_BUFFER_MS.
  tickPacer(state, text, FRAME_MS, FRAME_MS);
  assert.ok(state.revealedLen > 0, 'char-count trigger should open the gate without waiting for the timer');
});

test('never reveals faster than the configured max rate over a sustained window', () => {
  const state = createPacerState();
  const text = 'a'.repeat(5000);
  // Run for exactly 1 real second (60 frames of 16.667ms), well past the
  // initial buffer window.
  run(state, text, 60);
  // Allow small slack for the initial-buffer window eating a few ms of the
  // first second, and for floor()-truncation losing fractional chars.
  assert.ok(
    state.revealedLen <= MAX_REVEAL_CHARACTERS_PER_SECOND + 2,
    `revealed ${state.revealedLen} chars in ~1s, cap is ${MAX_REVEAL_CHARACTERS_PER_SECOND}/s`,
  );
  assert.ok(state.revealedLen > MAX_REVEAL_CHARACTERS_PER_SECOND * 0.7, 'should still get close to the cap, not far under it');
});

test('a slow provider (below the cap) is shown essentially immediately — the cap never becomes the bottleneck', () => {
  const state = createPacerState();
  // Simulate text arriving one word at a time, far slower than the cap.
  const words = ['The', 'quick', 'brown', 'fox', 'jumps'];
  let arrived = '';
  let now = 0;
  for (const word of words) {
    arrived += (arrived ? ' ' : '') + word;
    // Real gap between provider chunks: 300ms — much slower than 180 char/s
    // could ever fall behind on a few-character word.
    for (let i = 0; i < Math.round(300 / FRAME_MS); i += 1) {
      now += FRAME_MS;
      tickPacer(state, arrived, now, FRAME_MS);
    }
    // Well after the initial buffer window and multiple 300ms gaps in, the
    // pacer must have fully caught up to each slow arrival before the next
    // word lands — nothing artificially withheld.
    if (now > INITIAL_BUFFER_MS + 300) {
      assert.equal(state.revealedLen, arrived.length, `should have caught up to "${arrived}" by now=${now}`);
    }
  }
});

test('a fast burst (provider faster than the cap) is buffered and drained smoothly, never dumped in one frame', () => {
  const state = createPacerState();
  const text = 'x'.repeat(2000); // the "whole answer lands in one IPC tick" case
  let now = 0;
  let frames = 0;
  const perFrameDeltas = [];
  while (state.revealedLen < text.length && frames < 2000) {
    now += FRAME_MS;
    const prev = state.revealedLen;
    tickPacer(state, text, now, FRAME_MS);
    perFrameDeltas.push(state.revealedLen - prev);
    frames += 1;
  }
  assert.equal(state.revealedLen, text.length);
  const maxDelta = Math.max(...perFrameDeltas);
  // No single frame should ever reveal more than a couple of frames' worth
  // of the rate cap (small slack for the initial-buffer catch-up frame).
  assert.ok(maxDelta <= Math.ceil(MAX_REVEAL_CHARS_PER_MS * FRAME_MS) + 2, `no frame should dump far more than the per-frame cap (saw ${maxDelta})`);
  assert.ok(frames > 50, 'a 2000-char burst at 180 chars/sec should take multiple seconds worth of frames, not a handful');
});

test('reducedMotion reveals everything on the very first tick, bypassing buffer/cap/pauses', () => {
  const state = createPacerState();
  const text = 'a whole paragraph of streamed text with punctuation. And more!';
  tickPacer(state, text, 0, FRAME_MS, { reducedMotion: true });
  assert.equal(state.revealedLen, text.length);
});

test('punctuation hold: a sentence-ending period pauses the reveal for SENTENCE_END_PAUSE_MS without losing budget to a burst on release', () => {
  const state = createPacerState();
  const text = 'Hi.' + 'x'.repeat(200);
  // Run long enough to clear the initial buffer and reach the period.
  let now = 0;
  while (state.revealedLen < 3 && now < 5000) {
    now += FRAME_MS;
    tickPacer(state, text, now, FRAME_MS);
  }
  assert.equal(state.revealedLen, 3, 'should have stopped right at/after the period');
  const pausedAt = now;
  // Immediately after crossing the period, no forward progress until the
  // hold elapses.
  now += FRAME_MS;
  tickPacer(state, text, now, FRAME_MS);
  assert.equal(state.revealedLen, 3, 'must hold at the punctuation boundary');
  // Advance past the hold.
  now = pausedAt + SENTENCE_END_PAUSE_MS + FRAME_MS;
  tickPacer(state, text, now, FRAME_MS);
  assert.ok(state.revealedLen > 3, 'should resume after the hold elapses');
  // The frame that resumes must not dump a giant banked burst (the pause
  // must not have accumulated budget while frozen).
  const resumedDelta = state.revealedLen - 3;
  assert.ok(resumedDelta <= Math.ceil(MAX_REVEAL_CHARS_PER_MS * FRAME_MS) + 2, `resume frame revealed ${resumedDelta} chars — pause must not bank budget`);
});

test('clause punctuation (comma) gets the shorter CLAUSE_PAUSE_MS hold, not the sentence-end one', () => {
  assert.ok(CLAUSE_PAUSE_MS < SENTENCE_END_PAUSE_MS, 'clause pause should be shorter than sentence-end pause');
});

test('a punctuation mark crossed MID-TICK (not landing exactly at the tick boundary) still triggers the pause', () => {
  // Regression: the pause check used to only examine the single last
  // character revealed by a tick (fullText[snapped - 1]). A tick spanning
  // several characters (a large budget after the initial buffer closes, or
  // catching up from a burst) can jump PAST a period/comma without landing
  // exactly on it, silently skipping the reading-rhythm hold.
  const state = createPacerState();
  // "Hi. World" — period at index 2. Force a single huge tick (a giant
  // deltaMs) that reveals the whole string in one call, well past the
  // period, so `snapped` lands at the end, not on the period itself.
  const text = 'Hi. World';
  // Clear the initial buffer first with a zero-effect tiny tick, then a
  // single huge tick that reveals everything at once.
  tickPacer(state, text, 1, 1);
  const beforeHugeTick = state.pauseUntilMs;
  tickPacer(state, text, 10_000, 10_000 - 1);
  assert.equal(state.revealedLen, text.length, 'the huge tick should reveal the whole string in one shot');
  assert.ok(
    state.pauseUntilMs > beforeHugeTick,
    'a period crossed mid-tick must still arm a pause, even though revealedLen landed at the end, not on the period',
  );
});

test('no idle credit: a long silence before a burst does not let the burst reveal faster than the cap', () => {
  const stateAfterSilence = createPacerState();
  const stateNoSilence = createPacerState();
  const text = 'y'.repeat(500);
  // stateAfterSilence: sit idle (empty text) for a long time first.
  tickPacer(stateAfterSilence, '', 5000, FRAME_MS); // 5s of "nothing arrived yet"
  // stateNoSilence: no idle period at all.
  // Now both see the same burst arrive at t=5000 (or t=0) and are compared
  // frame-for-frame afterward using a fresh, comparable clock baseline.
  let now = 5000;
  let now2 = 0;
  const deltasA = [];
  const deltasB = [];
  for (let i = 0; i < 20; i += 1) {
    now += FRAME_MS;
    now2 += FRAME_MS;
    const prevA = stateAfterSilence.revealedLen;
    const prevB = stateNoSilence.revealedLen;
    tickPacer(stateAfterSilence, text, now, FRAME_MS);
    tickPacer(stateNoSilence, text, now2, FRAME_MS);
    deltasA.push(stateAfterSilence.revealedLen - prevA);
    deltasB.push(stateNoSilence.revealedLen - prevB);
  }
  assert.deepEqual(deltasA, deltasB, 'a preceding idle silence must not let the subsequent burst reveal any faster than an identical burst with no silence before it');
});

test('snapRevealBoundary is a no-op at the live edge of arrival (no buffered text beyond candidate)', () => {
  const text = 'Hello wor';
  assert.equal(snapRevealBoundary(text, text.length, 0), text.length);
});

test('snapRevealBoundary holds back a partial word when the rest of it is already buffered', () => {
  const text = 'Hello interview panel';
  const candidateLen = 'Hello interv'.length;
  const result = snapRevealBoundary(text, candidateLen, 0);
  assert.equal(result, 'Hello '.length, 'should hold back to the start of "interview" rather than reveal the fragment');
});

test('snapRevealBoundary holds back a trailing markdown delimiter run when more text is buffered beyond it', () => {
  const text = 'Hello **bold** world';
  const candidateLen = 'Hello **'.length;
  const result = snapRevealBoundary(text, candidateLen, 0);
  assert.equal(result, 'Hello '.length, 'should trim back to before the ** run');
});

test('snapRevealBoundary never returns below minLen, and reveals through when no valid holdback point exists above it', () => {
  // "**" is a 2-char delimiter run with minLen=1 already inside it (one "*"
  // already shown last frame) — trimming the whole run would land at 0,
  // which is below minLen. There is no word-boundary to hold at either
  // (the whole span from minLen to candidateLen is inside the delimiter
  // run). Forward progress wins: reveal through to the raw candidate (2)
  // rather than freeze at minLen forever.
  const text = '**bold** more text follows';
  const result = snapRevealBoundary(text, 2, 1);
  assert.equal(result, 2, 'no valid holdback point above minLen exists — must reveal through, not stall');
  assert.ok(result >= 1, 'never below minLen');
});

test('snapRevealBoundary does not touch a candidate that already sits at a clean word boundary', () => {
  const text = 'Hello world, more text follows';
  const candidateLen = 'Hello world'.length;
  assert.equal(snapRevealBoundary(text, candidateLen, 0), candidateLen);
});

test('snapRevealBoundary always makes forward progress while backlog remains (never stalls, RAG-shrinking-window shape)', () => {
  const corpus = 'Some **bold** and `code` and [a](b) and ~~x~~ and # head and _em_ text and interview panel';
  for (let r = 0; r < corpus.length; r += 1) {
    assert.ok(snapRevealBoundary(corpus, corpus.length, r) > r || corpus.length === r, `stalled at minLen=${r}`);
  }
  // RAG path shape: minLen always 0 against a shrinking rolling window that
  // may be JUST a stuck fragment like "**bo" or "interv".
  for (let n = 1; n <= 14; n += 1) {
    const win = corpus.slice(0, n);
    assert.ok(snapRevealBoundary(win, win.length, 0) > 0, `stalled on window "${win}"`);
  }
});

test('tickPacer forward-progress invariant: any frame with spendable budget reveals at least one character', () => {
  const state = createPacerState();
  const text = 'Some **bold** and interview panel text that keeps going and going';
  // Clear the initial buffer first.
  let now = 0;
  while (state.buffering) {
    now += FRAME_MS;
    tickPacer(state, text, now, FRAME_MS);
  }
  while (state.revealedLen < text.length) {
    const prev = state.revealedLen;
    now += FRAME_MS;
    // Skip frames sitting inside a punctuation hold — those are SUPPOSED to
    // make zero progress by design.
    if (now < state.pauseUntilMs) continue;
    tickPacer(state, text, now, FRAME_MS);
    assert.ok(state.revealedLen > prev, `stalled at revealedLen=${prev} (now=${now})`);
  }
});

test('estimateRevealDurationMs matches the configured rate', () => {
  assert.equal(estimateRevealDurationMs(180), 1000); // 180 chars at 180 chars/sec = 1s
  assert.equal(estimateRevealDurationMs(1800), 10000);
});

test('a full stream (buffer -> steady reveal -> punctuation holds) eventually reaches the full text with no stalls', () => {
  const state = createPacerState();
  const text = 'Based on the project requirements, I outlined the critical path. '
    + 'Next, we should confirm the timeline; then, ship it. Sound good?';
  let now = 0;
  let frames = 0;
  while (state.revealedLen < text.length && frames < 10000) {
    now += FRAME_MS;
    tickPacer(state, text, now, FRAME_MS);
    frames += 1;
  }
  assert.equal(state.revealedLen, text.length);
});
