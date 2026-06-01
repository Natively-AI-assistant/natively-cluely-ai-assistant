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
