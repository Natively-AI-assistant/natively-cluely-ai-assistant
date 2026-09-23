// electron/audio/__tests__/RealtimeSilenceTail2026_09_23.test.mjs
//
// After speech ends, the native suppressor streams its hangover (600 ms system
// audio / 500 ms mic) and then ONE 20 ms zero frame per 100 ms. Every provider
// endpointer counts silence in audio time, so a silence window longer than the
// hangover took ~5× its length in wall time to elapse (OpenAI's 1000 ms VAD
// window → final ~3 s after speech end). RealtimeSilenceTail tops the stream up
// to real time for a bounded window, filling only the DEFICIT.
//
// Driven with an injected clock: the timing claims are exact, not sleeps.
//
// Platform: pure arithmetic over byte counts — one run covers darwin and win32
// (both platforms' native DSP share the suppressor and keepalive cadence).
//
// Run: npm run build:electron && node --test electron/audio/__tests__/RealtimeSilenceTail2026_09_23.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const distDir = path.resolve(__dirname, '../../../dist-electron/electron/audio');
const { RealtimeSilenceTail } = require(path.join(distDir, 'realtimeSilenceTail.js'));
const { OpenAILiveTranscriptItems } = require(path.join(distDir, 'openaiLiveTranscriptItems.js'));

const RATE = 16000;
const BYTES_PER_MS = (RATE * 2) / 1000; // mono int16

function fakeClock() {
  let t = 0;
  let id = 0;
  const timers = new Map();
  return {
    now: () => t,
    setInterval: (fn, ms) => { const h = ++id; timers.set(h, { fn, ms, next: t + ms }); return h; },
    clearInterval: (h) => { timers.delete(h); },
    /** Advance time, firing interval callbacks in order. */
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let nh = null; let nt = Infinity;
        for (const [h, v] of timers) if (v.next < nt) { nt = v.next; nh = h; }
        if (nh === null || nt > end) break;
        t = nt;
        const v = timers.get(nh);
        v.next += v.ms;
        v.fn();
      }
      t = end;
    },
  };
}

/** A provider stand-in: counts audio bytes, native and injected alike. */
function harness(tailMs, { channels = 1 } = {}) {
  const clock = fakeClock();
  const sent = { bytes: 0, chunks: [] };
  const tail = new RealtimeSilenceTail({
    tailMs,
    format: () => ({ sampleRate: RATE, channels }),
    sink: (pcm) => { sent.bytes += pcm.length; sent.chunks.push(pcm); },
    clock,
  });
  /** The native side delivering one chunk: the provider sends it and the tail observes it. */
  const native = (ms, fill = 0) => {
    const chunk = Buffer.alloc(Math.round(ms * BYTES_PER_MS * channels), fill);
    tail.observe(chunk);
    sent.bytes += chunk.length;
  };
  return { clock, tail, sent, native };
}

/** Native keepalive cadence (20 ms of zeros per 100 ms) for `wallMs`. */
function keepaliveFor(h, wallMs) {
  for (let t = 0; t < wallMs; t += 100) { h.clock.advance(100); h.native(20); }
}

describe('THE BUG: the keepalive cadence runs the audio clock at 1/5 speed', () => {
  test('without a tail, 1 s of wall-clock silence reaches the provider as 200 ms', () => {
    const h = harness(0);
    h.tail.start();
    keepaliveFor(h, 1000);
    assert.equal(h.sent.bytes / BYTES_PER_MS, 200);
  });
});

describe('RealtimeSilenceTail', () => {
  test('tops the stream up to real time until the window is covered', () => {
    const h = harness(700);
    h.tail.start();
    keepaliveFor(h, 1000);
    const deliveredMs = h.sent.bytes / BYTES_PER_MS;
    // 700 ms of silence reached the provider within ~1 s of wall time —
    // instead of the ~3.5 s the keepalive alone would take.
    assert.ok(deliveredMs >= 700, `delivered ${deliveredMs} ms`);
    assert.ok(deliveredMs <= 700 + 3 * 20, `no runaway injection (${deliveredMs} ms)`);
    assert.equal(h.tail.active, false, 'the window closes by itself');
  });

  test('the window is reached by tailMs + lag allowance, not ~5× later', () => {
    const h = harness(700);
    h.tail.start();
    let reachedAt = null;
    for (let t = 0; t < 3000 && reachedAt === null; t += 20) {
      h.clock.advance(20);
      if (t % 100 === 80) h.native(20);
      if (h.sent.bytes >= 700 * BYTES_PER_MS) reachedAt = h.clock.now();
    }
    assert.ok(reachedAt !== null && reachedAt <= 700 + 120 + 40, `reached at ${reachedAt} ms`);
  });

  test('injects NOTHING while real audio flows at real time (speech resumed, noise above the gate)', () => {
    const h = harness(1200);
    h.tail.start();
    // The native side batches 3 × 20 ms frames per callback.
    for (let t = 0; t < 1500; t += 60) { h.clock.advance(60); h.native(60, 7); }
    const injected = h.tail.injectedBytes;
    assert.equal(injected, 0, `injected ${injected} bytes into live audio`);
  });

  test('speech resuming mid-window ends it: no zeros ever land BETWEEN speech frames', () => {
    const h = harness(1200);
    h.tail.start();
    keepaliveFor(h, 300);                 // silence: the tail fills it
    assert.ok(h.tail.injectedBytes > 0);
    h.clock.advance(60); h.native(60, 9); // first real frames after the gap
    const atResume = h.tail.injectedBytes;
    assert.equal(h.tail.active, false, 'a non-silent chunk ends the window');
    for (let t = 0; t < 600; t += 60) { h.clock.advance(60); h.native(60, 9); }
    assert.equal(h.tail.injectedBytes, atResume, 'nothing injected once speech is flowing');
  });

  test('the last hangover batch landing just after start() does NOT end the window (grace)', () => {
    const h = harness(700);
    h.tail.start();
    h.clock.advance(40); h.native(60, 5); // late hangover batch, non-silent
    assert.equal(h.tail.active, true);
    keepaliveFor(h, 1200);
    assert.ok(h.sent.bytes >= 700 * BYTES_PER_MS);
  });

  test('tailMs <= 0 is a no-op (providers that must never receive silence: Google)', () => {
    const h = harness(0);
    h.tail.start();
    assert.equal(h.tail.active, false);
    h.clock.advance(2000);
    assert.equal(h.sent.bytes, 0);
  });

  test('cancel() stops injection immediately (stop / finalize / reconnect)', () => {
    const h = harness(1200);
    h.tail.start();
    h.clock.advance(300);
    const before = h.sent.bytes;
    h.tail.cancel();
    h.clock.advance(2000);
    assert.equal(h.sent.bytes, before);
    assert.equal(h.tail.active, false);
  });

  test('a new speech end restarts the window', () => {
    const h = harness(500);
    h.tail.start();
    keepaliveFor(h, 1000);
    const first = h.sent.bytes;
    h.tail.start();
    keepaliveFor(h, 1000);
    assert.ok(h.sent.bytes - first >= 500 * BYTES_PER_MS);
  });

  test('injected blocks are whole frames and all-zero (identical to the native keepalive)', () => {
    const h = harness(700, { channels: 2 });
    h.tail.start();
    h.clock.advance(1500);
    assert.ok(h.sent.chunks.length > 0);
    for (const c of h.sent.chunks) {
      assert.equal(c.length % 4, 0, 'stereo int16 frame alignment');
      assert.ok(c.every((b) => b === 0));
    }
  });

  test('observe() outside a window is ignored', () => {
    const h = harness(700);
    h.native(500, 3);
    h.tail.start();
    h.clock.advance(1500);
    assert.equal(h.tail.injectedBytes, 700 * BYTES_PER_MS, 'pre-window audio does not count against the tail');
  });
});

describe('OpenAILiveTranscriptItems (gpt-live-transcribe: final = the item\'s completed event)', () => {
  test('deltas preview, completed finalizes with the server transcript', () => {
    const items = new OpenAILiveTranscriptItems();
    assert.equal(items.onDelta('a', 'Why did'), 'Why did');
    assert.equal(items.onDelta('a', ' you'), 'Why did you');
    assert.equal(items.onCompleted('a', 'Why did you choose Postgres?'), 'Why did you choose Postgres?');
    assert.equal(items.preview(), null);
  });

  test('falls back to the assembled deltas when completed carries no transcript', () => {
    const items = new OpenAILiveTranscriptItems();
    items.onDelta('a', 'Tell me');
    items.onDelta('a', ' more');
    assert.equal(items.onCompleted('a', ''), 'Tell me more');
  });

  test('THE INTERLEAVE: the next item\'s deltas never leak into the previous final', () => {
    const items = new OpenAILiveTranscriptItems();
    items.onDelta('a', 'First question');
    items.onDelta('b', 'And second');       // speaker resumed before a completed
    assert.equal(items.preview(), 'First question And second');
    assert.equal(items.onCompleted('a', 'First question.'), 'First question.');
    assert.equal(items.preview(), 'And second');
    assert.equal(items.onCompleted('b', 'And second one?'), 'And second one?');
  });

  test('flush() returns everything pending, in order, and empties', () => {
    const items = new OpenAILiveTranscriptItems();
    items.onDelta('a', 'one');
    items.onDelta('b', 'two');
    assert.equal(items.flush(), 'one two');
    assert.equal(items.flush(), null);
  });

  test('missing item_id is tolerated', () => {
    const items = new OpenAILiveTranscriptItems();
    items.onDelta(undefined, 'hi');
    assert.equal(items.onCompleted(undefined, ''), 'hi');
  });
});
