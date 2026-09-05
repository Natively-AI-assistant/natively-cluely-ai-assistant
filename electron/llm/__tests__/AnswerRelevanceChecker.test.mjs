// electron/llm/__tests__/AnswerRelevanceChecker.test.mjs
//
// 2026-09-05: checkAnswerRelevance no longer classifies. The shared MobileBERT
// zero-shot session it reused was removed with the intent classifier, and the
// function now returns null, the contract every caller already treats as
// "check unavailable, do not gate on it". The enforcing arm of the guard was
// behind answerRelevanceGuardLive, default OFF, because validation run-032 found
// the classifier could not separate real from hallucinated answers on live
// traffic. The corpus regression pin that lived here tested that classifier and
// went with it. What this file pins now is the contract the callers depend on.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/AnswerRelevanceChecker.js');
const { checkAnswerRelevance } = await import(pathToFileURL(modPath).href);

describe('checkAnswerRelevance — unavailable-by-design contract (2026-09-05)', () => {
  test('returns null for a real question and a real answer, never a verdict', async () => {
    assert.equal(await checkAnswerRelevance('tell me about a project you led', 'Tinroof is a rate limiter I built in Go.'), null);
  });
  test('returns null for an obvious non-answer too: it does not gate anything', async () => {
    assert.equal(await checkAnswerRelevance('tell me about a project you led', 'This turn appears empty.'), null);
  });
  test('returns null (never throws) on empty question or answer', async () => {
    assert.equal(await checkAnswerRelevance('', 'x'), null);
    assert.equal(await checkAnswerRelevance('x', ''), null);
  });
  test('never throws on very long input', async () => {
    assert.equal(await checkAnswerRelevance('q', 'a '.repeat(50_000)), null);
  });
});
