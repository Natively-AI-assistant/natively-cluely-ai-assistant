// electron/llm/__tests__/ProfileAnswerTypeRouting.test.mjs
//
// Spec §1-§4 + §8: the answer-type classifier must route each question class to
// the right answerType, and the per-type context layers must include/exclude the
// right context. Plain node (pure planAnswer, no DB/LLM).

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { planAnswer } from '../../../dist-electron/electron/llm/AnswerPlanner.js';
import { buildContextRoute } from '../../../dist-electron/electron/llm/contextRoute.js';

const plan = (question, source = 'manual_input', speakerPerspective) =>
  planAnswer({ question, source, speakerPerspective });

const route = (question, source, sp) => buildContextRoute(plan(question, source, sp));

describe('Spec: answer-type classification', () => {
  const cases = [
    // identity (both my/your name — §1, §11.1/2)
    ['What is my name?', 'identity_answer'],
    ['What is your name?', 'identity_answer'],
    ['Who are you?', 'identity_answer'],
    ['Tell me about yourself.', 'identity_answer'],
    // resume / project / experience
    ['What projects have you done?', 'project_answer'],
    ['Tell me about your internship.', 'experience_answer'],
    // skill-experience (§Case F exception — profile, NOT coding/technical)
    ['Have you worked with WebRTC?', 'skill_experience_answer'],
    ['Have you used AWS?', 'skill_experience_answer'],
    ['Do you know Python?', 'skill_experience_answer'],
    ['Are you familiar with Kubernetes?', 'skill_experience_answer'],
    // jd fit
    ['Why are you a good fit for this role?', 'jd_fit_answer'],
    // behavioral
    ['Tell me about a time you handled a crisis.', 'behavioral_interview_answer'],
    // salary
    ['What salary are you expecting?', 'negotiation_answer'],
    ['What is your current CTC?', 'negotiation_answer'],
    // coding (write/implement) vs DSA (named problem) vs technical concept (explain)
    ['Write a function to reverse a string', 'coding_question_answer'],
    ['Solve Two Sum.', 'dsa_question_answer'],
    ['Can you solve two sum?', 'dsa_question_answer'],
    ['Explain BFS.', 'technical_concept_answer'],
    ['What is a deadlock?', 'technical_concept_answer'],
    ['Explain amortized analysis.', 'technical_concept_answer'],
    ['What is the difference between TCP and UDP?', 'technical_concept_answer'],
    // sales
    ['Why is your product expensive?', 'sales_answer'],
    ['How does your product compare to competitor X?', 'sales_answer'],
    // lecture
    ['What did the professor mean by this slide?', 'lecture_answer'],
    ['Explain this lecture slide.', 'lecture_answer'],
  ];
  for (const [q, expected] of cases) {
    test(`"${q}" → ${expected}`, () => {
      assert.equal(plan(q).answerType, expected);
    });
  }
});

describe('Spec §8: context inclusion/exclusion per answer type', () => {
  test('coding excludes resume/jd/negotiation (no profile in coding)', () => {
    const r = route('Write a function to reverse a string');
    for (const layer of ['resume', 'jd', 'negotiation', 'custom_context']) {
      assert.ok(r.excludedLayers.includes(layer), `coding must exclude ${layer}`);
    }
  });

  test('technical_concept excludes all profile (spec §8.3)', () => {
    const r = route('Explain BFS.');
    for (const layer of ['resume', 'jd', 'negotiation', 'custom_context']) {
      assert.ok(r.excludedLayers.includes(layer), `technical_concept must exclude ${layer}`);
    }
  });

  test('skill_experience INCLUDES resume but excludes jd/negotiation', () => {
    const r = route('Have you used WebRTC?');
    assert.ok(r.selectedLayers.includes('resume'), 'skill_experience must include resume');
    assert.ok(r.excludedLayers.includes('jd'));
    assert.ok(r.excludedLayers.includes('negotiation'));
  });

  test('negotiation INCLUDES negotiation, jd; excludes reference_files', () => {
    const r = route('What salary are you expecting?');
    assert.ok(r.selectedLayers.includes('negotiation'));
    assert.ok(r.selectedLayers.includes('jd'));
  });

  test('sales excludes resume/jd/negotiation (spec Case G)', () => {
    const r = route('Why is your product expensive?');
    for (const layer of ['resume', 'jd', 'negotiation']) {
      assert.ok(r.excludedLayers.includes(layer), `sales must exclude ${layer}`);
    }
  });

  test('lecture excludes resume/jd/negotiation (spec Case H)', () => {
    const r = route('What did the professor mean by this slide?');
    for (const layer of ['resume', 'jd', 'negotiation']) {
      assert.ok(r.excludedLayers.includes(layer), `lecture must exclude ${layer}`);
    }
  });

  test('jd_fit INCLUDES resume + jd; excludes negotiation', () => {
    const r = route('Why are you a good fit for this role?');
    assert.ok(r.selectedLayers.includes('resume'));
    assert.ok(r.selectedLayers.includes('jd'));
    assert.ok(r.excludedLayers.includes('negotiation'));
  });

  test('identity INCLUDES stable_identity + resume; excludes negotiation', () => {
    const r = route('What is my name?');
    assert.ok(r.selectedLayers.includes('stable_identity'));
    assert.ok(r.excludedLayers.includes('negotiation'));
  });
});

describe('Spec §5: answer perspective', () => {
  test('profile question from interviewer → first_person_candidate', () => {
    assert.equal(plan('What projects have you done?', 'what_to_answer', 'interviewer').outputPerspective, 'first_person_candidate');
  });
  test('skill_experience from interviewer → first_person_candidate', () => {
    assert.equal(plan('Have you used WebRTC?', 'what_to_answer', 'interviewer').outputPerspective, 'first_person_candidate');
  });
  test('technical_concept from interviewer → NOT candidate voice', () => {
    assert.notEqual(plan('Explain BFS.', 'what_to_answer', 'interviewer').outputPerspective, 'first_person_candidate');
  });
  test('coding from interviewer → NOT candidate voice', () => {
    assert.notEqual(plan('Write two sum', 'what_to_answer', 'interviewer').outputPerspective, 'first_person_candidate');
  });
  test('sales → NOT candidate voice', () => {
    assert.notEqual(plan('Why is your product expensive?', 'what_to_answer', 'interviewer').outputPerspective, 'first_person_candidate');
  });
});
