// Deviation from the task brief: the brief's import reads '../tokenizer.js'.
// This repo's electron/tsconfig.json compiles electron/**/*.ts to
// dist-electron/ (not in place next to the source — see melFrontend.test.mjs
// for the established precedent). There is no tokenizer.js sitting next to
// tokenizer.ts, and Node does not fall back from a '.js' specifier to a
// sibling '.ts' file (confirmed empirically: ERR_MODULE_NOT_FOUND). Node
// 25's type-stripping support *does* load a '.ts' file directly, unflagged,
// so importing '../tokenizer.ts' here is the smallest change that makes
// `node --test electron/audio/whisper/nemotron/__tests__/tokenizer.test.mjs`
// actually run standalone (no prior `tsc` build step), while keeping this
// task independently testable as the brief intends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { decodeWithVocab } from '../tokenizer.ts';

test('decodeWithVocab joins pieces and turns the ▁ marker into a space', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nemotron-vocab-'));
  fs.writeFileSync(path.join(tmp, 'vocab.txt'), ['▁hello', '▁world', '▁there'].join('\n'));
  const decode = decodeWithVocab(path.join(tmp, 'vocab.txt'));
  assert.equal(decode([0, 1, 2]), 'hello world there');
});

test('decodeWithVocab glues a continuation piece (no leading ▁) onto the previous word', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nemotron-vocab-'));
  fs.writeFileSync(path.join(tmp, 'vocab.txt'), ['▁un', 'happy'].join('\n'));
  const decode = decodeWithVocab(path.join(tmp, 'vocab.txt'));
  assert.equal(decode([0, 1]), 'unhappy');
});

test('decodeWithVocab skips unknown ids rather than throwing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nemotron-vocab-'));
  fs.writeFileSync(path.join(tmp, 'vocab.txt'), ['▁hi'].join('\n'));
  const decode = decodeWithVocab(path.join(tmp, 'vocab.txt'));
  assert.equal(decode([0, 999]), 'hi');
});
