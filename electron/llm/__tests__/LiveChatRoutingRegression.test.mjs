// electron/llm/__tests__/LiveChatRoutingRegression.test.mjs
//
// Regression for live-meeting misroutes reported 2026-06-05 (real interview chat):
//   - "how much would you rate your expertise in Python?" → routed coding (bare
//     "Python") → no profile → "I didn't catch that". Must be skill_experience.
//   - "What are your coding levels? Out of 10, rate yourself?" → fired the
//     NEGOTIATION salary script. Must be skill_experience (profile), never comp.
//   - "why should we hire you?" → general → refused. Must be jd_fit.
// These assert the deterministic AnswerPlanner routing only (pure, no LLM).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { planAnswer } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/AnswerPlanner.js')).href
);

const typeOf = (q, source = 'what_to_answer') =>
  planAnswer({ question: q, source, speakerPerspective: 'interviewer' });

describe('live regression: skill self-rating → skill_experience (profile, not coding/negotiation)', () => {
  const ratingQs = [
    'how much would you rate your expertise in Python?',
    'how good are you at Python?',
    'What are your coding levels at? Out of 10, how much would you rate yourself?',
    'on a scale of 1 to 10 how proficient are you in React?',
    'how would you rate yourself in JavaScript?',
    'rate your proficiency in AWS',
    'what is your skill level in TypeScript?',
  ];
  for (const q of ratingQs) {
    test(`"${q.slice(0, 50)}" → skill_experience_answer`, () => {
      const p = typeOf(q);
      assert.equal(p.answerType, 'skill_experience_answer', `got ${p.answerType}`);
      // skill_experience uses the resume (profile) and forbids negotiation
      assert.ok(!p.forbiddenContextLayers.includes('resume'), 'resume must NOT be forbidden');
      assert.ok(p.forbiddenContextLayers.includes('negotiation'), 'negotiation MUST be forbidden');
    });
  }

  test('a genuine "write code" request is still coding (rating gate does not over-capture)', () => {
    assert.equal(typeOf('write a function to reverse a linked list in Python').answerType, 'dsa_question_answer');
    assert.equal(typeOf('implement an LRU cache').answerType, 'coding_question_answer');
  });

  test('a genuine salary question is still negotiation (rating gate does not steal comp)', () => {
    assert.equal(typeOf('what are your salary expectations?').answerType, 'negotiation_answer');
    assert.equal(typeOf('can you come down on the base salary?').answerType, 'negotiation_answer');
  });
});

describe('live regression: "why should we hire you" → jd_fit', () => {
  const fitQs = [
    'why should we hire you?',
    'why should I hire you?',
    'why should we hire you over other candidates?',
    'what makes you a good candidate?',
    'what makes you the right fit for this role?',
    'why are you the best candidate for this position?',
  ];
  for (const q of fitQs) {
    test(`"${q.slice(0, 50)}" → jd_fit_answer`, () => {
      const p = typeOf(q);
      assert.equal(p.answerType, 'jd_fit_answer', `got ${p.answerType}`);
      assert.ok(!p.forbiddenContextLayers.includes('resume'), 'resume must NOT be forbidden');
    });
  }
});
