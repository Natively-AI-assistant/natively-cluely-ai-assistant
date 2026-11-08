// electron/audio/whisper/__tests__/MoonshineTokenBudget2026_10_14.test.mjs
//
// Moonshine is the recommended default local model. transformers.js gives it a
// generation budget of `Math.floor(seconds) * 6` tokens when the caller passes
// none — ZERO for anything under a second. Measured on the real model
// (moonshine-base, crops of the known-phrase fixture, 2026-10-14):
//
//   0.40 s   library: "The"                      now: "The quick."
//   0.99 s   library: "The"                      now: "The quick brown fox."
//   1.90 s   library: "The quick brown fox j"    now: "...jumps over the leaves."
//
// Platform-independent arithmetic; the same on macOS and Windows.
//
// Run: npm run build:electron && node --test electron/audio/whisper/__tests__/MoonshineTokenBudget2026_10_14.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../../..');
const { moonshineMaxNewTokens, MOONSHINE_MIN_NEW_TOKENS } = await import(
  pathToFileURL(path.join(repo, 'dist-electron/electron/audio/whisper/moonshineTokenBudget.js')).href
);

const libraryBudget = (samples) => Math.floor(samples / 16000) * 6;
const at = (seconds) => Math.round(seconds * 16000);

test('RED STATE: the library budget is zero for every sub-second utterance', () => {
  for (const s of [0.2, 0.4, 0.7, 0.99]) assert.equal(libraryBudget(at(s)), 0);
  assert.equal(libraryBudget(at(1.9)), 6, 'and six tokens — about four words — for a 1.9 s answer');
});

test('a sub-second utterance gets a real budget', () => {
  for (const s of [0.2, 0.4, 0.7, 0.99]) {
    assert.ok(moonshineMaxNewTokens(at(s)) >= MOONSHINE_MIN_NEW_TOKENS, `${s}s`);
    assert.ok(moonshineMaxNewTokens(at(s)) > libraryBudget(at(s)), `${s}s`);
  }
});

test('the budget follows the REAL duration at six tokens a second', () => {
  assert.equal(moonshineMaxNewTokens(at(0.99)), 6);
  assert.equal(moonshineMaxNewTokens(at(1.5)), 9);
  assert.equal(moonshineMaxNewTokens(at(1.9)), 12);
  assert.equal(moonshineMaxNewTokens(at(2.46)), 15);
  assert.equal(moonshineMaxNewTokens(at(14)), 84);
});

test('it never exceeds the paper\'s repetition guard by more than rounding', () => {
  // Extra headroom was measured and rejected: on a window that ends mid-word
  // the spare tokens repeat the cut word ("The quick br br br br").
  for (let s = 0.5; s <= 15; s += 0.25) {
    assert.ok(moonshineMaxNewTokens(at(s)) <= Math.ceil(s * 6) + 0, `${s}s`);
  }
});

test('junk input falls back to the floor instead of NaN or zero', () => {
  for (const bad of [0, -5, NaN, undefined, Infinity]) {
    assert.equal(moonshineMaxNewTokens(bad), MOONSHINE_MIN_NEW_TOKENS);
  }
  assert.equal(moonshineMaxNewTokens(16000, 0), MOONSHINE_MIN_NEW_TOKENS);
});

test('the worker passes the budget for Moonshine, and only for Moonshine', () => {
  const src = fs.readFileSync(path.join(repo, 'electron/audio/whisper/whisperWorker.ts'), 'utf8');
  assert.match(
    src,
    /if \(isMoonshineModel\(loadedModelId\)\) \{\s*opts\.max_new_tokens = moonshineMaxNewTokens\(msg\.audio\?\.length \?\? 0, 16000\);\s*\}/,
  );
  assert.equal(src.split('max_new_tokens').length - 1, 1, 'Whisper keeps the library default');
  // First pipeline call (2026-10-21: a reuse-the-encoder branch comes first, then the plain call).
  const call = src.indexOf('result = await pipe(msg.audio');
  assert.ok(call > 0, 'fixture: the pipeline call moved');
  assert.ok(src.indexOf('opts.max_new_tokens') < call, 'the budget must be set before the pipeline is called');
});
