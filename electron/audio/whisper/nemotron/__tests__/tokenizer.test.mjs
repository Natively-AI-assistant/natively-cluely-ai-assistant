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

test('control tokens (<unk>, language tags) are stripped from decoded text', () => {
  // The vocab embeds one language-tag token per locale plus <unk> at id 0,
  // and the model re-emits a tag at utterance boundaries MID-stream —
  // observed live as "lazy dog. <en-US> The quick brown". joinPieces strips
  // them for both decode paths.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nemotron-vocab-'));
  fs.writeFileSync(
    path.join(tmp, 'vocab.txt'),
    ['<unk>', '<en-US>', '▁lazy', '▁dog.', '▁The', '▁quick'].join('\n'),
  );
  const decode = decodeWithVocab(path.join(tmp, 'vocab.txt'));
  assert.equal(decode([2, 3, 1, 4, 5]), 'lazy dog. The quick', 'mid-stream tag must be stripped');
  assert.equal(decode([1, 2, 3]), 'lazy dog.', 'leading tag must be stripped');
  assert.equal(decode([0, 2]), 'lazy', '<unk> must be stripped');
});

test('exact-shape strip only: angle-bracket text that is not a control token survives', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nemotron-vocab-'));
  fs.writeFileSync(path.join(tmp, 'vocab.txt'), ['▁a', '<b', '>', '▁<notatag12>'].join('\n'));
  const decode = decodeWithVocab(path.join(tmp, 'vocab.txt'));
  assert.equal(decode([0, 1, 2]), 'a<b>', 'split angle brackets are not a control token');
  assert.equal(decode([0, 3]), 'a <notatag12>', 'wrong-shape tag is not stripped');
});
