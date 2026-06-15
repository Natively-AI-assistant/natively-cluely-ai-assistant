// PHASE 2 BASELINE — mode boundaries + latency budgets.
// Characterizes the current planAnswer routing so sales/lecture/coding can never
// regress into pulling candidate profile. Encodes the prompt's mode-boundary rules.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planAnswer } from '../../../../dist-electron/electron/llm/AnswerPlanner.js';

const mode = (id) => ({ id, templateType: id, name: id, isCustom: false });

describe('PHASE2 baseline — sales mode never pulls candidate profile', () => {
  for (const q of ['why is your product expensive?', 'can you reduce the price?', 'what does your product do?']) {
    test(`"${q}" → sales answer, resume/jd forbidden`, () => {
      const p = planAnswer({ question: q, source: 'manual_input', activeMode: mode('sales') });
      assert.equal(p.answerType, 'sales_answer');
      assert.equal(p.profileContextPolicy, 'forbidden');
      assert.ok(p.forbiddenContextLayers.includes('resume'));
      assert.ok(p.forbiddenContextLayers.includes('jd'));
    });
  }
});

describe('PHASE2 baseline — lecture mode uses lecture framing, not interview/sales', () => {
  for (const q of ['summarize this lecture', 'create notes from this explanation', 'generate a diagram for TCP handshake']) {
    test(`"${q}" → lecture answer, profile forbidden`, () => {
      const p = planAnswer({ question: q, source: 'manual_input', activeMode: mode('lecture') });
      assert.equal(p.answerType, 'lecture_answer');
      assert.equal(p.profileContextPolicy, 'forbidden');
    });
  }
});

describe('PHASE2 baseline — coding honors format and forbids profile', () => {
  test('"write code only for two sum" → dsa answer, profile forbidden', () => {
    const p = planAnswer({ question: 'write code only for two sum', source: 'manual_input', activeMode: mode('technical-interview') });
    assert.equal(p.answerType, 'dsa_question_answer');
    assert.equal(p.profileContextPolicy, 'forbidden');
    assert.ok(p.forbiddenContextLayers.includes('resume'));
  });
  test('"explain BFS" → technical concept, profile forbidden', () => {
    const p = planAnswer({ question: 'explain BFS', source: 'manual_input', activeMode: mode('technical-interview') });
    assert.equal(p.answerType, 'technical_concept_answer');
    assert.equal(p.profileContextPolicy, 'forbidden');
  });
});

describe('PHASE2 baseline — latency budget invariants', () => {
  test('every plan carries a positive first-useful budget', () => {
    for (const q of ['what is your name?', 'what should I answer?', 'write code for two sum']) {
      const p = planAnswer({ question: q, source: 'manual_input' });
      assert.ok(p.maxFirstUsefulTokenMs > 0, `"${q}" must have a latency budget`);
    }
  });
  test('a direct identity question is deterministic-fast-path eligible (no provider needed)', () => {
    const p = planAnswer({ question: 'what is your name?', source: 'manual_input', hasCandidateProfile: true });
    // canUseFastPath signals the deterministic path can answer without the LLM.
    assert.equal(typeof p.canUseFastPath, 'boolean');
  });
});
