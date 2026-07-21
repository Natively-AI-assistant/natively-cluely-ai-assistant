import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compiledPath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/utils/rollingTranscriptState.js',
);

if (!fs.existsSync(compiledPath)) {
  throw new Error(
    `Compiled file not found: ${compiledPath}\n` +
      `Run 'npm run build:electron' before this test suite.`,
  );
}

const {
  mergeRollingTranscriptPartial,
  mergeRollingTranscriptFinal,
  capRollingTranscript,
  ROLLING_TRANSCRIPT_MAX_CHARS,
} = await import(pathToFileURL(compiledPath).href);

test('partial updates replace in-progress tail without clearing committed segments', () => {
  let bar = mergeRollingTranscriptPartial('', 'hello');
  assert.equal(bar, 'hello');
  bar = mergeRollingTranscriptPartial(bar, 'hello world');
  assert.equal(bar, 'hello world');

  bar = mergeRollingTranscriptFinal(bar, 'hello world');
  assert.equal(bar, 'hello world');

  bar = mergeRollingTranscriptPartial(bar, 'next');
  assert.equal(bar, 'hello world  ·  next');
  bar = mergeRollingTranscriptPartial(bar, 'next segment');
  assert.equal(bar, 'hello world  ·  next segment');
});

test('final matching in-progress preview does not duplicate segment', () => {
  let bar = mergeRollingTranscriptPartial('', 'how are you');
  assert.equal(bar, 'how are you');
  bar = mergeRollingTranscriptFinal(bar, 'how are you');
  assert.equal(bar, 'how are you');
  bar = mergeRollingTranscriptFinal(bar, 'how are you');
  assert.equal(bar, 'how are you');
});

test('coalescer-style partial growth then speech_stopped final', () => {
  let bar = '';
  bar = mergeRollingTranscriptPartial(bar, 'and');
  bar = mergeRollingTranscriptPartial(bar, 'and space');
  bar = mergeRollingTranscriptPartial(bar, 'and space from the');
  bar = mergeRollingTranscriptFinal(bar, 'and space from the');
  assert.equal(bar, 'and space from the');
});

test('final replaces prefix-matching in-progress partial', () => {
  let bar = mergeRollingTranscriptPartial('', 'hello wor');
  bar = mergeRollingTranscriptFinal(bar, 'hello world');
  assert.equal(bar, 'hello world');
});

// ── Bounded rolling transcript (audit finding #7) ─────────────────────────────

test('capRollingTranscript leaves a within-budget string unchanged', () => {
  const s = 'short  ·  line';
  assert.equal(capRollingTranscript(s), s);
  assert.equal(capRollingTranscript('', 10), '');
});

test('capRollingTranscript drops whole leading segments, never splitting a word', () => {
  // 5 segments of "seg<i>" joined by the separator; cap so only the last ~2 fit.
  const seg = (i) => `segment-number-${i}`;
  const full = [0, 1, 2, 3, 4].map(seg).join('  ·  ');
  const capped = capRollingTranscript(full, 40);
  assert.ok(capped.length <= 40 || capped.indexOf('  ·  ') === -1,
    'within budget OR a single (already-bounded) trailing segment');
  // The visible tail (latest segment) is always intact.
  assert.ok(capped.endsWith(seg(4)), `tail must be preserved, got: ${capped}`);
  // No partial leading segment: result starts at a real segment boundary.
  assert.ok(/^segment-number-\d/.test(capped), 'no mid-word leading cut');
});

test('capRollingTranscript keeps the final segment even if it alone exceeds the cap', () => {
  const big = 'x'.repeat(100);
  const out = capRollingTranscript('a  ·  ' + big, 10);
  assert.equal(out, big, 'never truncates the single visible segment mid-word');
});

test('mergeRollingTranscriptFinal stays bounded over a long meeting', () => {
  let bar = '';
  for (let i = 0; i < 5000; i++) {
    bar = mergeRollingTranscriptFinal(bar, `This is utterance number ${i} in a very long meeting.`);
  }
  assert.ok(bar.length <= ROLLING_TRANSCRIPT_MAX_CHARS,
    `rolling transcript must stay <= ${ROLLING_TRANSCRIPT_MAX_CHARS}, was ${bar.length}`);
  // The most recent utterance is still visible at the tail.
  assert.ok(bar.includes('utterance number 4999'), 'latest utterance must survive the cap');
});
