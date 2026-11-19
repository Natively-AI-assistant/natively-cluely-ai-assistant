// Per-platform local STT tuning (electron/audio/whisper/localSttTuning.ts).
// macOS keeps the values it shipped with before PR #764; Windows has the PR's values.
// Both branches are exercised from whichever OS runs this, because the platform is an argument.
//
// Loads the compiled CommonJS output from dist-electron/ (build first).
//   node --test electron/audio/whisper/__tests__/LocalSttTuning2026_11_19.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const dist = (f) => path.join(repoRoot, 'dist-electron', 'electron', 'audio', 'whisper', f);
const { localSttTuningFor, DARWIN_TUNING, WIN32_TUNING } = require(dist('localSttTuning.js'));
const { LOGPROB_FLOOR } = require(dist('whisperSilenceGuard.js'));
const { VadProcessor } = require(dist('vadProcessor.js'));

const WINDOW = 480;
const frames = (n, amp) => new Float32Array(n * WINDOW).fill(amp);
const concat = (...p) => { const o = new Float32Array(p.reduce((a, x) => a + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };

describe('localSttTuningFor', () => {
  test('darwin and win32 map to their own profiles', () => {
    assert.equal(localSttTuningFor('darwin'), DARWIN_TUNING);
    assert.equal(localSttTuningFor('win32'), WIN32_TUNING);
  });

  test('any other platform throws instead of borrowing a profile', () => {
    for (const p of ['linux', 'freebsd', 'aix']) assert.throws(() => localSttTuningFor(p), /unsupported platform/);
  });

  test('macOS is what shipped before PR #764: fixed 0.008 gate, 300 ms hangover, no pre-roll, no extension, no floor', () => {
    assert.deepEqual(DARWIN_TUNING, {
      vad: { threshold: { kind: 'fixed', rms: 0.008 }, hangoverFrames: 10, shortPhraseFrames: null, preRollFrames: 0 },
      logprobFloor: null,
    });
  });

  test('Windows is the PR #764 tuning: noise-floor gate in [0.002, 0.008], 600 ms hangover, 1.2 s for under 1.5 s, 300 ms pre-roll, -4 floor', () => {
    assert.deepEqual(WIN32_TUNING, {
      vad: { threshold: { kind: 'noise-floor', min: 0.002, max: 0.008, frames: 67, multiplier: 3 }, hangoverFrames: 20, shortPhraseFrames: 50, preRollFrames: 10 },
      logprobFloor: -4,
    });
    assert.equal(WIN32_TUNING.logprobFloor, LOGPROB_FLOOR);
  });
});

describe('the same audio behaves per platform', () => {
  test('a quiet phrase (RMS 0.004) opens a segment on Windows and not on macOS', () => {
    const quiet = concat(frames(20, 0.0005), frames(20, 0.004), frames(40, 0)); // a quiet room, then a quiet voice
    assert.equal(new VadProcessor(WIN32_TUNING.vad).push(quiet).length, 1);
    assert.equal(new VadProcessor(DARWIN_TUNING.vad).push(quiet).length, 0);
  });

  test('a 1 s phrase closes after 300 ms of silence on macOS but still waits at 300 ms on Windows', () => {
    const phrase = frames(33, 0.1);
    const mac = new VadProcessor(DARWIN_TUNING.vad);
    mac.push(phrase);
    assert.equal(mac.push(frames(10, 0)).length, 1);
    const win = new VadProcessor(WIN32_TUNING.vad);
    win.push(phrase);
    assert.deepEqual(win.push(frames(10, 0)), []);
    assert.equal(win.isInSpeech(), true);
  });

  test('macOS keeps no audio from before speech; Windows keeps 300 ms', () => {
    const lead = frames(10, 0.001);
    const mac = new VadProcessor(DARWIN_TUNING.vad).push(concat(lead, frames(10, 0.1), frames(20, 0)));
    const win = new VadProcessor(WIN32_TUNING.vad).push(concat(lead, frames(10, 0.1), frames(40, 0)));
    assert.equal(mac[0].durationMs, (10 + 10) * 30);
    assert.equal(win[0].durationMs, (10 + 10 + 40) * 30);
  });

  test('the default profile is the running platform\'s', () => {
    const expected = localSttTuningFor(process.platform).vad;
    const quiet = concat(frames(20, 0.0005), frames(20, 0.004), frames(40, 0));
    const viaDefault = new VadProcessor().push(quiet).length;
    assert.equal(viaDefault, new VadProcessor(expected).push(quiet).length);
  });
});

describe('the Whisper worker uses the platform floor', () => {
  test('it reads the floor from the tuning, scores only when there is one, and never from a constant', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(path.join(repoRoot, 'electron/audio/whisper/whisperWorker.ts'), 'utf8');
    assert.match(src, /const logprobFloor = localSttTuningFor\(process\.platform\)\.logprobFloor;/);
    assert.doesNotMatch(src, /LOGPROB_FLOOR/);
  });
});
