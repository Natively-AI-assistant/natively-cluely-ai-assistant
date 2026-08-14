// electron/llm/__tests__/GapAnalysis2026_06_09.test.mjs
//
// Release 2026-06-09 — gap/weakness-for-the-JD questions get a dedicated
// gap_analysis_answer (honest gap + mitigation, first-person candidate), NOT the
// jd_fit fit-summary and NOT a stall.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { planAnswer, formatAnswerPlanForPrompt } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/index.js')).href
);
const plan = (q) => planAnswer({ question: q, source: 'manual_input', speakerPerspective: 'user' });

describe('gap/weakness-for-JD routes to gap_analysis_answer', () => {
  for (const q of [
    'What gap do you have for this role?',
    'Where are you weak for this JD?',
    'What is your weakest match for the JD?',
    'What do you need to improve for this role?',
    'What would you need to learn for this Data Analyst role?',
    'What will you need to learn for this job?',
    'What is missing from your profile for this job?',
    'What part of this JD are you least ready for?',
  ]) {
    test(`"${q}" → gap_analysis_answer`, () => assert.equal(plan(q).answerType, 'gap_analysis_answer'));
  }
});

describe('gap answers stay in the right lane', () => {
  test('gap is profile-REQUIRED, candidate first-person, negotiation-forbidden', () => {
    const p = plan('What gap do you have for this role?');
    assert.equal(p.profileContextPolicy, 'required');
    assert.equal(p.voicePerspective, 'first_person_candidate');
    assert.ok(p.forbiddenContextLayers.includes('negotiation'), 'salary must not leak into a gap answer');
    assert.ok(p.requiredContextLayers.includes('jd'), 'gap is grounded against the JD');
  });
  test('the gap contract instructs gap-first, not a fit-summary, no stall', () => {
    const c = formatAnswerPlanForPrompt(plan('What gap do you have for this role?'), false);
    assert.match(c, /GAP question/i);
    assert.match(c, /The Honest Gap/i);
    assert.match(c, /How I'?d Close It/i);
    // the contract explicitly forbids the stall ("Do not say 'let me come back…'").
    assert.match(c, /Do not say "let me come back to that"/i);
  });
  test('a bare "biggest weakness" stays behavioral (not gap_analysis, not jd_fit)', () => {
    assert.equal(plan('What is your biggest weakness?').answerType, 'behavioral_interview_answer');
  });
  test('"biggest strength" (no JD) stays behavioral, not jd_fit', () => {
    assert.equal(plan('whats your biggest strength').answerType, 'behavioral_interview_answer');
  });
  test('"strongest match for the JD" routes to jd_fit (sell the match)', () => {
    assert.equal(plan('What is your strongest match for the JD?').answerType, 'jd_fit_answer');
  });
});

describe('gap honors adaptive style', () => {
  test('one-sentence gap → one_liner style on the plan', () => {
    assert.equal(plan('What gap do you have for this role, answer in one sentence.').answerStyle, 'one_liner');
  });
  test('bullets gap → bullets style', () => {
    assert.equal(plan('What gap do you have for this role in bullet points.').answerStyle, 'bullets');
  });
});
