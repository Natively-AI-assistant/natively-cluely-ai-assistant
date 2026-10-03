// Unit tests for electron/audio/whisper/vadProcessor.ts — the energy-based
// VAD (30 ms / 480-sample windows at 16 kHz, RMS threshold 0.008, 10-frame
// hangover, 15 s force-flush) that cuts mic/system audio into speech segments
// for local Whisper.
//
// Loads the compiled CommonJS output from dist-electron/ (build first).
// Run from the repo root:
//   node --test electron/audio/whisper/__tests__/VadProcessor.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const { VadProcessor } = require(
  path.join(repoRoot, 'dist-electron', 'electron', 'audio', 'whisper', 'vadProcessor.js'),
);

const WINDOW = 480;        // samples per 30 ms frame
const FRAME_MS = 30;
const HANGOVER = 10;       // silent frames that close a segment
const MAX_FRAMES = 500;    // 15000 ms / 30 ms

/** `n` frames filled with a constant amplitude (RMS === |amp|). */
function frames(n, amp) {
  return new Float32Array(n * WINDOW).fill(amp);
}
const speech = (n, amp = 0.1) => frames(n, amp);
const silence = (n) => frames(n, 0);

function concat(...parts) {
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

describe('VadProcessor — initial state and trivial input', () => {
  test('a fresh processor is idle', () => {
    const vad = new VadProcessor();
    assert.equal(vad.isInSpeech(), false);
    assert.equal(vad.currentSegmentId(), 0);
    assert.equal(vad.peekOpenSegment(), null);
    assert.equal(vad.softCommit(), null);
    assert.deepEqual(vad.flush(), []);
  });

  test('an empty buffer produces nothing and changes nothing', () => {
    const vad = new VadProcessor();
    assert.deepEqual(vad.push(new Float32Array(0)), []);
    assert.equal(vad.isInSpeech(), false);
    assert.equal(vad.currentSegmentId(), 0);
  });

  test('pure silence never opens a segment', () => {
    const vad = new VadProcessor();
    assert.deepEqual(vad.push(silence(50)), []);
    assert.equal(vad.isInSpeech(), false);
    assert.equal(vad.currentSegmentId(), 0);
    assert.deepEqual(vad.flush(), []);
  });
});

describe('VadProcessor — energy threshold', () => {
  test('a frame just below the RMS threshold is not speech', () => {
    const vad = new VadProcessor();
    vad.push(frames(1, 0.007));
    assert.equal(vad.isInSpeech(), false);
  });

  test('a frame just above the RMS threshold is speech', () => {
    const vad = new VadProcessor();
    vad.push(frames(1, 0.009));
    assert.equal(vad.isInSpeech(), true);
    assert.equal(vad.currentSegmentId(), 1);
  });

  test('negative amplitudes count the same as positive ones', () => {
    const vad = new VadProcessor();
    vad.push(frames(1, -0.1));
    assert.equal(vad.isInSpeech(), true);
  });

  test('energy is RMS over the whole window, not peak', () => {
    // One 0.1 spike in an otherwise silent frame: rms = 0.1/sqrt(480) ~ 0.00456 < 0.008.
    const spike = silence(1);
    spike[100] = 0.1;
    const quiet = new VadProcessor();
    quiet.push(spike);
    assert.equal(quiet.isInSpeech(), false);

    // Four such spikes: rms = 0.1*sqrt(4/480) ~ 0.00913 >= 0.008.
    const four = silence(1);
    four[0] = four[100] = four[200] = four[300] = 0.1;
    const loud = new VadProcessor();
    loud.push(four);
    assert.equal(loud.isInSpeech(), true);
  });
});

describe('VadProcessor — segment close on hangover', () => {
  test('speech followed by 10 silent frames closes one segment including the hangover', () => {
    const vad = new VadProcessor();
    assert.deepEqual(vad.push(speech(5)), []);
    assert.equal(vad.isInSpeech(), true);

    // 9 silent frames: still inside the hangover.
    assert.deepEqual(vad.push(silence(HANGOVER - 1)), []);
    assert.equal(vad.isInSpeech(), true);

    // The 10th silent frame closes it.
    const out = vad.push(silence(1));
    assert.equal(out.length, 1);
    const seg = out[0];
    assert.equal(seg.durationMs, (5 + HANGOVER) * FRAME_MS);
    assert.ok(seg.samples instanceof Float32Array);
    assert.equal(seg.samples.length, (5 + HANGOVER) * WINDOW);
    assert.deepEqual(seg.samples, concat(speech(5), silence(HANGOVER)));
    assert.equal(vad.isInSpeech(), false);
    assert.equal(vad.peekOpenSegment(), null);
  });

  test('the same audio in one push yields the same segment', () => {
    const vad = new VadProcessor();
    const out = vad.push(concat(speech(5), silence(HANGOVER)));
    assert.equal(out.length, 1);
    assert.equal(out[0].durationMs, 15 * FRAME_MS);
    assert.equal(out[0].samples.length, 15 * WINDOW);
  });

  test('speech resuming inside the hangover keeps the segment open and re-arms the hangover', () => {
    const vad = new VadProcessor();
    vad.push(speech(4));
    vad.push(silence(HANGOVER - 1));
    vad.push(speech(1));                       // re-arms
    assert.deepEqual(vad.push(silence(HANGOVER - 1)), []);
    assert.equal(vad.isInSpeech(), true);
    assert.equal(vad.currentSegmentId(), 1);   // still the same segment

    const out = vad.push(silence(1));
    assert.equal(out.length, 1);
    const total = 4 + 9 + 1 + 10;
    assert.equal(out[0].durationMs, total * FRAME_MS);
    assert.equal(out[0].samples.length, total * WINDOW);
  });

  test('silence after a closed segment is not buffered into the next one', () => {
    const vad = new VadProcessor();
    vad.push(concat(speech(4), silence(HANGOVER + 20)));
    assert.equal(vad.isInSpeech(), false);
    const out = vad.push(concat(speech(4, 0.2), silence(HANGOVER)));
    assert.equal(out.length, 1);
    assert.equal(out[0].samples.length, (4 + HANGOVER) * WINDOW);
    assert.ok(Math.abs(out[0].samples[0] - 0.2) < 1e-6, 'second segment starts at its own first speech frame');
  });

  test('two utterances in a single push yield two segments and two ids', () => {
    const vad = new VadProcessor();
    const out = vad.push(concat(
      speech(4, 0.1), silence(HANGOVER),
      speech(6, 0.2), silence(HANGOVER),
    ));
    assert.equal(out.length, 2);
    assert.equal(out[0].durationMs, (4 + HANGOVER) * FRAME_MS);
    assert.equal(out[1].durationMs, (6 + HANGOVER) * FRAME_MS);
    assert.ok(Math.abs(out[0].samples[0] - 0.1) < 1e-6);
    assert.ok(Math.abs(out[1].samples[0] - 0.2) < 1e-6);
    assert.equal(vad.isInSpeech(), false);
    // isInSpeech() was false before and after — only the id reveals both opens.
    assert.equal(vad.currentSegmentId(), 2);
  });

  test('emitted segments are copies: mutating the input afterwards does not change them', () => {
    const vad = new VadProcessor();
    const input = concat(speech(4), silence(HANGOVER));
    const [seg] = vad.push(input);
    input.fill(0.9);
    assert.ok(Math.abs(seg.samples[0] - 0.1) < 1e-6);
    assert.equal(seg.samples[seg.samples.length - 1], 0);
  });
});

describe('VadProcessor — sub-window carry buffer', () => {
  test('a partial window is held until the rest arrives', () => {
    const vad = new VadProcessor();
    assert.deepEqual(vad.push(new Float32Array(WINDOW - 1).fill(0.1)), []);
    assert.equal(vad.isInSpeech(), false, '479 samples is not a full frame yet');
    vad.push(new Float32Array(1).fill(0.1));
    assert.equal(vad.isInSpeech(), true);
    assert.equal(vad.peekOpenSegment().samples.length, WINDOW);
  });

  test('remainders accumulate across several small pushes', () => {
    const vad = new VadProcessor();
    for (let i = 0; i < 3; i++) vad.push(new Float32Array(100).fill(0.1));   // 300
    assert.equal(vad.isInSpeech(), false);
    vad.push(new Float32Array(200).fill(0.1));                              // 500 -> 1 frame + 20 carried
    assert.equal(vad.isInSpeech(), true);
    assert.equal(vad.peekOpenSegment().durationMs, FRAME_MS);
    vad.push(new Float32Array(460).fill(0.1));                              // 20 + 460 -> 2nd frame
    assert.equal(vad.peekOpenSegment().durationMs, 2 * FRAME_MS);
  });

  test('odd chunk sizes produce the same segment as frame-aligned input', () => {
    const audio = concat(speech(6), silence(HANGOVER));
    const aligned = new VadProcessor().push(audio);

    const vad = new VadProcessor();
    const out = [];
    for (let off = 0; off < audio.length; off += 333) {
      out.push(...vad.push(audio.subarray(off, Math.min(off + 333, audio.length))));
    }
    assert.equal(out.length, 1);
    assert.equal(out[0].durationMs, aligned[0].durationMs);
    assert.deepEqual(out[0].samples, aligned[0].samples);
  });

  test('flush() discards a carried partial window', () => {
    const vad = new VadProcessor();
    vad.push(new Float32Array(WINDOW - 1).fill(0.1));
    assert.deepEqual(vad.flush(), []);
    vad.push(new Float32Array(1).fill(0.1));
    assert.equal(vad.isInSpeech(), false, 'the 479 carried samples must be gone');
  });

  test('reset() discards a carried partial window', () => {
    const vad = new VadProcessor();
    vad.push(new Float32Array(WINDOW - 1).fill(0.1));
    vad.reset();
    vad.push(new Float32Array(1).fill(0.1));
    assert.equal(vad.isInSpeech(), false);
  });
});

describe('VadProcessor — max-duration force flush', () => {
  test('continuous speech is cut at exactly 15000 ms', () => {
    const vad = new VadProcessor();
    assert.deepEqual(vad.push(speech(MAX_FRAMES - 1)), []);
    assert.equal(vad.peekOpenSegment().durationMs, 14970);

    const out = vad.push(speech(1));
    assert.equal(out.length, 1);
    assert.equal(out[0].durationMs, 15000);
    assert.equal(out[0].samples.length, MAX_FRAMES * WINDOW);
    assert.equal(vad.isInSpeech(), false);
    assert.equal(vad.currentSegmentId(), 1);
  });

  test('speech continuing past the cut opens a new segment with a new id', () => {
    const vad = new VadProcessor();
    const out = vad.push(speech(MAX_FRAMES + 3));
    assert.equal(out.length, 1);
    assert.equal(vad.isInSpeech(), true);
    assert.equal(vad.currentSegmentId(), 2);
    assert.equal(vad.peekOpenSegment().durationMs, 3 * FRAME_MS);
  });

  test('1000 frames of speech yield two full 15 s segments', () => {
    const vad = new VadProcessor();
    const out = vad.push(speech(2 * MAX_FRAMES));
    assert.deepEqual(out.map((s) => s.durationMs), [15000, 15000]);
    assert.equal(vad.isInSpeech(), false);
  });
});

describe('VadProcessor — peekOpenSegment', () => {
  test('returns the open audio without closing the segment', () => {
    const vad = new VadProcessor();
    vad.push(speech(3));
    const peek = vad.peekOpenSegment();
    assert.equal(peek.durationMs, 90);
    assert.deepEqual(peek.samples, speech(3));
    assert.equal(vad.isInSpeech(), true);
    assert.equal(vad.currentSegmentId(), 1);
    // Peeking again gives the same thing.
    assert.deepEqual(vad.peekOpenSegment().samples, speech(3));
  });

  test('includes hangover silence frames while the segment is still open', () => {
    const vad = new VadProcessor();
    vad.push(concat(speech(2), silence(3)));
    const peek = vad.peekOpenSegment();
    assert.equal(peek.durationMs, 150);
    assert.deepEqual(peek.samples, concat(speech(2), silence(3)));
  });

  test('the returned buffer is caller-owned: mutating it does not corrupt the segment', () => {
    const vad = new VadProcessor();
    vad.push(speech(2));
    const a = vad.peekOpenSegment();
    a.samples.fill(0.5);
    const b = vad.peekOpenSegment();
    assert.notEqual(a.samples, b.samples);
    assert.deepEqual(b.samples, speech(2));
    const [seg] = vad.push(silence(HANGOVER));
    assert.deepEqual(seg.samples, concat(speech(2), silence(HANGOVER)));
  });

  test('is null again once the segment closes', () => {
    const vad = new VadProcessor();
    vad.push(concat(speech(4), silence(HANGOVER)));
    assert.equal(vad.peekOpenSegment(), null);
  });
});

describe('VadProcessor — softCommit', () => {
  test('returns null and does not bump the id when idle', () => {
    const vad = new VadProcessor();
    vad.push(silence(5));
    assert.equal(vad.softCommit(), null);
    assert.equal(vad.currentSegmentId(), 0);
  });

  test('emits the open audio and carries the last 10 frames into a new segment', () => {
    const vad = new VadProcessor();
    // 15 frames with distinct amplitudes so the tail can be identified.
    const amps = Array.from({ length: 15 }, (_, i) => 0.1 + i * 0.01);
    vad.push(concat(...amps.map((a) => frames(1, a))));
    assert.equal(vad.currentSegmentId(), 1);

    const seg = vad.softCommit();
    assert.equal(seg.durationMs, 450);
    assert.equal(seg.samples.length, 15 * WINDOW);

    assert.equal(vad.isInSpeech(), true);
    assert.equal(vad.currentSegmentId(), 2, 'tail-keep is a new logical segment');
    const tail = vad.peekOpenSegment();
    assert.equal(tail.durationMs, 300);
    assert.equal(tail.samples.length, 10 * WINDOW);
    assert.deepEqual(tail.samples, seg.samples.subarray(5 * WINDOW));
  });

  test('with fewer than 10 frames open the whole buffer is carried', () => {
    const vad = new VadProcessor();
    vad.push(speech(3));
    const seg = vad.softCommit();
    assert.equal(seg.durationMs, 90);
    const tail = vad.peekOpenSegment();
    assert.equal(tail.durationMs, 90);
    assert.deepEqual(tail.samples, seg.samples);
  });

  test('the carried tail is followed by a full hangover before closing', () => {
    const vad = new VadProcessor();
    vad.push(concat(speech(12), silence(8)));   // 8 frames into the hangover
    const seg = vad.softCommit();
    assert.equal(seg.durationMs, 600);
    // Hangover was re-armed to 10: 9 more silent frames do not close it...
    assert.deepEqual(vad.push(silence(HANGOVER - 1)), []);
    assert.equal(vad.isInSpeech(), true);
    // ...the 10th does, and the segment is tail (10) + silence (10).
    const out = vad.push(silence(1));
    assert.equal(out.length, 1);
    assert.equal(out[0].durationMs, 20 * FRAME_MS);
    assert.equal(vad.isInSpeech(), false);
  });

  test('speech pushed after a soft-commit appends to the carried tail', () => {
    const vad = new VadProcessor();
    vad.push(speech(12, 0.1));
    vad.softCommit();
    vad.push(speech(2, 0.3));
    assert.equal(vad.currentSegmentId(), 2, 'no extra bump: the tail segment was already open');
    const peek = vad.peekOpenSegment();
    assert.equal(peek.durationMs, 12 * FRAME_MS);
    assert.ok(Math.abs(peek.samples[0] - 0.1) < 1e-6);
    assert.ok(Math.abs(peek.samples[peek.samples.length - 1] - 0.3) < 1e-6);
  });

  test('the carried duration still counts toward the 15 s cap', () => {
    const vad = new VadProcessor();
    vad.push(speech(20));
    vad.softCommit();                              // 10 frames (300 ms) carried
    assert.deepEqual(vad.push(speech(MAX_FRAMES - 11)), []);
    const out = vad.push(speech(1));
    assert.equal(out.length, 1);
    assert.equal(out[0].durationMs, 15000);
  });
});

describe('VadProcessor — flush and reset', () => {
  test('flush() emits an open segment of at least 4 frames and goes idle', () => {
    const vad = new VadProcessor();
    vad.push(speech(4));
    const out = vad.flush();
    assert.equal(out.length, 1);
    assert.equal(out[0].durationMs, 120);
    assert.deepEqual(out[0].samples, speech(4));
    assert.equal(vad.isInSpeech(), false);
    assert.equal(vad.peekOpenSegment(), null);
    assert.deepEqual(vad.flush(), [], 'a second flush has nothing left');
  });

  test('flush() drops an open segment shorter than 4 frames', () => {
    for (const n of [1, 2, 3]) {
      const vad = new VadProcessor();
      vad.push(speech(n));
      assert.deepEqual(vad.flush(), [], `${n} frame(s) is below the minimum`);
      assert.equal(vad.isInSpeech(), false);
    }
  });

  test('flush() counts hangover frames toward the 4-frame minimum', () => {
    const vad = new VadProcessor();
    vad.push(concat(speech(2), silence(2)));
    const out = vad.flush();
    assert.equal(out.length, 1);
    assert.equal(out[0].durationMs, 120);
  });

  test('reset() drops the open segment without emitting it', () => {
    const vad = new VadProcessor();
    vad.push(speech(20));
    vad.reset();
    assert.equal(vad.isInSpeech(), false);
    assert.equal(vad.peekOpenSegment(), null);
    assert.deepEqual(vad.flush(), []);
    assert.deepEqual(vad.push(silence(HANGOVER)), [], 'no stale hangover closes a ghost segment');
  });

  test('the segment id is monotonic across flush() and reset()', () => {
    const vad = new VadProcessor();
    vad.push(speech(4));
    assert.equal(vad.currentSegmentId(), 1);
    vad.flush();
    assert.equal(vad.currentSegmentId(), 1, 'stable after close until the next open');
    vad.push(speech(1));
    assert.equal(vad.currentSegmentId(), 2);
    vad.reset();
    assert.equal(vad.currentSegmentId(), 2);
    vad.push(speech(1));
    assert.equal(vad.currentSegmentId(), 3);
  });

  test('the processor is reusable after flush()', () => {
    const vad = new VadProcessor();
    vad.push(speech(4, 0.1));
    vad.flush();
    const out = vad.push(concat(speech(4, 0.3), silence(HANGOVER)));
    assert.equal(out.length, 1);
    assert.equal(out[0].samples.length, (4 + HANGOVER) * WINDOW);
    assert.ok(Math.abs(out[0].samples[0] - 0.3) < 1e-6, 'nothing from before the flush leaks in');
  });

  test('instances do not share state', () => {
    const a = new VadProcessor();
    const b = new VadProcessor();
    a.push(speech(5));
    assert.equal(a.isInSpeech(), true);
    assert.equal(b.isInSpeech(), false);
    assert.equal(b.currentSegmentId(), 0);
  });
});
