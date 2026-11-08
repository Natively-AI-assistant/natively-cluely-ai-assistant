// verify-transformers-upgrade.mjs: the WAV reader and the verdict on a worker
// run. The real-model run itself needs a downloaded model and is done by
// `npm run verify:transformers`, not here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWavMono16k, checkWorkerRun } from '../verify-transformers-upgrade.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtures = path.join(repo, 'electron', 'audio', 'whisper', '__tests__', 'fixtures');

test('the committed clips read as 16 kHz mono speech', () => {
  for (const [file, seconds] of [['auto-detect-fr.wav', 4.27], ['auto-detect-en.wav', 7.3]]) {
    const audio = readWavMono16k(path.join(fixtures, file));
    assert.ok(Math.abs(audio.length / 16000 - seconds) < 0.1, `${file}: ${audio.length / 16000}s`);
    const peak = audio.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    assert.ok(peak > 0.05 && peak <= 1, `${file}: peak ${peak}`);
  }
});

test('a non-16 kHz WAV is refused, not resampled silently', () => {
  const b = fs.readFileSync(path.join(fixtures, 'auto-detect-fr.wav'));
  const copy = Buffer.from(b);
  copy.writeUInt32LE(44100, 24); // fmt sample rate
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'natively-verify-test-')), 'x.wav');
  fs.writeFileSync(file, copy);
  try {
    assert.throws(() => readWavMono16k(file), /expected 16 kHz mono/);
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
});

const good = {
  finals: [
    { text: ' Bonjour, nous allons parler du budget.', encoderRuns: 1 },
    { text: ' Hello, this is a test.', encoderRuns: 2 },
    { text: ' Bonjour, nous allons parler du budget.', encoderRuns: 3 },
  ],
  logs: [
    '[WhisperWorker] Auto Detect: french (100%, was none, Xenova/whisper-tiny)',
    '[WhisperWorker] Auto Detect: english (99%, was french, Xenova/whisper-tiny)',
    '[WhisperWorker] Auto Detect: french (100%, was english, Xenova/whisper-tiny)',
  ],
};

test('a run that detects, transcribes and reuses the encoder passes', () => {
  assert.deepEqual(checkWorkerRun(good).problems, []);
});

test('a second encoder pass per final fails (the reuse stopped working)', () => {
  const run = { ...good, finals: good.finals.map((f, i) => ({ ...f, encoderRuns: (i + 1) * 2 })) };
  assert.match(checkWorkerRun(run).problems.join('\n'), /clip 1: the encoder ran 2 times, expected once/);
});

test('a failed internal fails even when the text looks right', () => {
  const run = { ...good, logs: [...good.logs, '[WhisperWorker] Auto Detect failed, keeping the last language: x is not a function'] };
  assert.match(checkWorkerRun(run).problems.join('\n'), /an internal failed/);
});

test('English where French was spoken fails (the old null-language behaviour)', () => {
  const run = {
    finals: good.finals.map((f, i) => (i === 1 ? f : { ...f, text: ' Today, we are talking about the budget.' })),
    logs: [],
  };
  const problems = checkWorkerRun(run).problems.join('\n');
  assert.match(problems, /detected \[\], expected \["french","english","french"\]/);
  assert.match(problems, /clip 1 \(french\) came back as " Today/);
});
