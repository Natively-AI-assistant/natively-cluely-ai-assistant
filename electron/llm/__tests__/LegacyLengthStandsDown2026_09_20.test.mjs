// electron/llm/__tests__/LegacyLengthStandsDown2026_09_20.test.mjs
//
// Found by the REAL-WIRING E2E (real engine + real WhatToAnswerLLM, provider
// stubbed) with Context Intelligence V3 switched OFF: the first fix for
// "Answer in 100 words is ignored" only split the length channel on the V3
// composer. The legacy <answer_contract> — V3's fallback, and every surface
// that still assembles through formatAnswerPlanForPrompt — kept sending
//
//   "LENGTH: aim for about 22s spoken — roughly 40 to 60 words ... Hard
//    ceiling: never go past 75 words"
//
// beside the user's own number. Unit tests of the composer could never see it.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjs = createRequire(import.meta.url);
const dist = (p) => path.resolve(__dirname, '../../../dist-electron/electron/llm/', p);
const { registerUserInstructionProvider } = cjs(dist('userInstructionContract.js'));
const { planAnswer, formatAnswerPlanForPrompt, renderLengthDirectiveForPlan } = cjs(dist('AnswerPlanner.js'));

const plan = planAnswer({ question: 'What is your return policy for opened items?', source: 'what_to_answer' });
afterEach(() => registerUserInstructionProvider(null));

describe('the legacy answer contract’s length target is a DEFAULT', () => {
  test('precondition: this plan does carry an app length line', () => {
    assert.match(renderLengthDirectiveForPlan(plan), /roughly \d+ to \d+ words/);
    assert.match(formatAnswerPlanForPrompt(plan), /Hard ceiling/);
  });

  test('a user number silences it', () => {
    registerUserInstructionProvider(() => 'Answer in 100 words.');
    const out = formatAnswerPlanForPrompt(plan);
    assert.doesNotMatch(out, /Hard ceiling/);
    assert.doesNotMatch(out, /roughly \d+ to \d+ words/);
  });

  test('"give detailed answers" silences it too', () => {
    registerUserInstructionProvider(() => 'Give detailed, in-depth answers.');
    assert.doesNotMatch(formatAnswerPlanForPrompt(plan), /Hard ceiling/);
  });

  test('instructions that say nothing about length leave it alone', () => {
    registerUserInstructionProvider(() => 'Use Java only\nBe concise.');
    assert.match(formatAnswerPlanForPrompt(plan), /Hard ceiling/);
  });

  test('a broken provider leaves it alone', () => {
    registerUserInstructionProvider(() => { throw new Error('db closed'); });
    assert.match(formatAnswerPlanForPrompt(plan), /Hard ceiling/);
  });

  test('the raw directive is unchanged — the V3 composer still makes its own decision', () => {
    registerUserInstructionProvider(() => 'Answer in 100 words.');
    assert.match(renderLengthDirectiveForPlan(plan), /roughly \d+ to \d+ words/);
  });
});
