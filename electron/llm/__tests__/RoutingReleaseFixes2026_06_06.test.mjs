// electron/llm/__tests__/RoutingReleaseFixes2026_06_06.test.mjs
//
// Release 2026-06-06, Issues 4–7. The baseline 300-question run had 14
// route-mismatch failures, all elliptical / meta-directive fragments that the
// dataset (interview context, profile + Data-Analyst JD loaded) expects routed
// to a concrete candidate answer type — but which fell to the generic
// follow_up_answer floor (or a wrong concrete type) and, worse, sometimes pulled
// the profile when they should not (veryhard_038 "what about data?" leak).
//
// These tests pin the corrected routing. They run against the SAME planAnswer
// the product uses (compiled dist-electron) with source='manual_input' (the
// benchmark's manual surface). The equivalence classes used by the benchmark
// scorer are mirrored where the dataset accepts a class rather than one type.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { planAnswer, cleanTranscript } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/index.js')).href
);
const plan = (q) => planAnswer({ question: q, source: 'manual_input', speakerPerspective: 'user' });

// Mirror of benchmark ANSWER_TYPE_EQUIVALENCE (types.ts) so a class-accepting
// expectation is checked the same way the scorer checks it.
const EQUIV = [
  ['coding_question_answer', 'dsa_question_answer'],
  ['technical_concept_answer', 'system_design_answer', 'debugging_question_answer'],
  ['project_answer', 'project_followup_answer', 'experience_answer', 'behavioral_interview_answer'],
  ['profile_fact_answer', 'skills_answer', 'skill_experience_answer', 'experience_answer', 'identity_answer'],
  ['skill_experience_answer', 'skills_answer'],
  ['sales_answer', 'product_candidate_mix_answer'],
];
const equiv = (exp, act) => exp === act || EQUIV.some((c) => c.includes(exp) && c.includes(act));
const routeOk = (q, exp) => {
  const p = plan(q);
  assert.ok(equiv(exp, p.answerType), `"${q}" expected ${exp}-class, got ${p.answerType}`);
  return p;
};

describe('Issue 4: bare skill topic-shifts route to skill_experience (not follow_up floor)', () => {
  test('"Hmm right, and Python?" → skill_experience', () => routeOk('Hmm right, and Python?', 'skill_experience_answer'));
  test('"And what about SQL?" → skill_experience', () => routeOk('And what about SQL?', 'skill_experience_answer'));
  test('profile is REQUIRED for a named-skill topic shift', () => {
    assert.equal(plan('And what about SQL?').profileContextPolicy, 'required');
  });
});

describe('Issue 4/6: "what about <X>" splits by topic — work-noun uses profile, generic does not', () => {
  test('"What about stakeholders?" → experience-class WITH profile', () => {
    const p = routeOk('What about stakeholders?', 'skill_experience_answer');
    assert.equal(p.profileContextPolicy, 'required');
  });
  test('"What about complexity?" → technical_concept, profile FORBIDDEN', () => {
    const p = routeOk('What about complexity?', 'technical_concept_answer');
    assert.equal(p.profileContextPolicy, 'forbidden');
  });
});

describe('Issue 6: ambiguous bare follow-ups never dump the profile', () => {
  test('"What about data?" → follow_up_answer, profile FORBIDDEN (no résumé dump)', () => {
    const p = plan('What about data?');
    assert.equal(p.answerType, 'follow_up_answer', `→ ${p.answerType}`);
    assert.notEqual(p.profileContextPolicy, 'required');
    assert.ok(p.forbiddenContextLayers.includes('resume'), 'bare follow-up must forbid resume');
  });
  test('"What should I answer?" → follow_up_answer, profile not required', () => {
    const p = plan('What should I answer?');
    assert.equal(p.answerType, 'follow_up_answer', `→ ${p.answerType}`);
    assert.notEqual(p.profileContextPolicy, 'required');
  });
});

describe('Issue 5: voice/evidence-control directives route to a candidate answer (never follow_up floor, never assistant voice)', () => {
  test('"Answer like a candidate, not like an assistant." → experience-class', () => {
    const p = routeOk('Answer like a candidate, not like an assistant.', 'experience_answer');
    assert.equal(p.profileContextPolicy, 'required');
  });
  test('"Say what I should say, but in my voice." → experience-class', () =>
    routeOk('Say what I should say, but in my voice.', 'experience_answer'));
  test('"If no metric is there, answer without fake metric." → project-class', () =>
    routeOk('If no metric is there, answer without fake metric.', 'project_answer'));
  test('"Make it sound confident but don\'t lie." → jd_fit (selling fit)', () => {
    const p = plan("Make it sound confident but don't lie.");
    assert.equal(p.answerType, 'jd_fit_answer', `→ ${p.answerType}`);
  });
});

describe('Issue 5: generic-steer POLARITY — "don\'t make it generic" is not a request for a generic answer', () => {
  test('"Tell me about pressure, but don\'t make it generic." → behavioral-class WITH profile', () => {
    const p = routeOk('Tell me about pressure, but don\'t make it generic.', 'behavioral_interview_answer');
    assert.equal(p.profileContextPolicy, 'required');
  });
  test('affirmative "explain SQL generally" still → technical_concept (profile forbidden)', () => {
    const p = plan('Explain SQL but explain it generally.');
    assert.equal(p.answerType, 'technical_concept_answer', `→ ${p.answerType}`);
    assert.equal(p.profileContextPolicy, 'forbidden');
  });
});

describe('Issue 7: JD-fit mismatches', () => {
  test('"Rate your data analyst fit out of 10." → jd_fit (rating FIT, not a skill)', () => {
    const p = plan('Rate your data analyst fit out of 10.');
    assert.equal(p.answerType, 'jd_fit_answer', `→ ${p.answerType}`);
  });
  test('"I have full-stack, they ask data analyst, what do I say?" → jd_fit (gap-bridge)', () => {
    const p = plan('I have full-stack, they ask data analyst, what do I say?');
    assert.equal(p.answerType, 'jd_fit_answer', `→ ${p.answerType}`);
  });
  test('"I have projects but not pure analyst, answer this." → jd_fit (gap-bridge)', () => {
    const p = plan('I have projects but not pure analyst, answer this.');
    assert.equal(p.answerType, 'jd_fit_answer', `→ ${p.answerType}`);
  });
  test('"Use JD but no salary." → jd_fit, NOT negotiation (salary is negated)', () => {
    const p = plan('Use JD but no salary.');
    assert.equal(p.answerType, 'jd_fit_answer', `→ ${p.answerType}`);
    assert.notEqual(p.profileContextPolicy, 'forbidden');
  });
  test('"Use salary but no project." → negotiation (the negation targets PROJECT, not salary)', () => {
    // Regression: a trailing "no <non-comp-noun>" must NOT suppress negotiation
    // just because a salary word appears earlier (code-review 2026-06-06).
    assert.equal(plan('Use salary but no project.').answerType, 'negotiation_answer');
  });
  test('genuine comp-negations still suppress negotiation toward skill', () => {
    for (const q of ['Rate Python but not salary.', 'Do not give salary, just rate coding.']) {
      assert.match(plan(q).answerType, /skill/, `${q} → ${plan(q).answerType}`);
    }
  });
});

describe('Issue 7 (code-review): metaDirective edge cases do not hijack non-candidate questions', () => {
  test('"explain binary search but don\'t overclaim" stays technical (not profile)', () => {
    const p = plan("explain binary search but don't overclaim");
    assert.ok(['technical_concept_answer', 'dsa_question_answer', 'coding_question_answer'].includes(p.answerType), `→ ${p.answerType}`);
    assert.equal(p.profileContextPolicy, 'forbidden');
  });
  test('generic "I have X, they want Y, what do I say" without a role token is NOT jd_fit', () => {
    assert.notEqual(plan('I have a list, they want it sorted, what do I say?').answerType, 'jd_fit_answer');
  });
});

describe('Issue (WTA): transcript cleaner preserves mid-sentence content words', () => {
  const clean = (text) => cleanTranscript([{ role: 'interviewer', text, timestamp: 1 }])[0]?.text ?? '';
  test('"the right person" keeps "right" (was dropped → broke jd_fit routing)', () => {
    assert.match(clean('Why are you the right person for this position?'), /right person/);
  });
  test('mid-sentence "like" is preserved ("do you like Python")', () => {
    assert.match(clean('Do you like Python and SQL?'), /like/);
  });
  test('LEADING discourse "Right, so" is still stripped', () => {
    const c = clean('Right, so tell me about Python.');
    assert.doesNotMatch(c, /^right/);
    assert.match(c, /python/);
  });
  test('pure noise ("um", "uh") is still dropped mid-sentence', () => {
    assert.doesNotMatch(clean('What is, um, your name?'), /\bum\b/);
  });
});

describe('Issue (WTA): bounded-length intro asks route to identity/intro', () => {
  for (const q of [
    'Give me the 30-second version of who you are.',
    'Give me the elevator pitch of yourself.',
    'Give me the two-minute version of who you are.',
    'Can you give me your background in 30 seconds?',
    'Give me your background quickly.',
  ]) {
    test(`"${q}" → identity/experience class (not unknown/meeting)`, () => {
      const p = plan(q);
      assert.ok(['identity_answer', 'experience_answer', 'profile_fact_answer'].includes(p.answerType), `→ ${p.answerType}`);
      assert.equal(p.profileContextPolicy, 'required');
    });
  }
  test('a DETAILED experience ask is NOT collapsed to the short intro', () => {
    // Regression guard for the intro-pattern broadening: a full "tell me about your
    // work experience" must stay experience, not become the 30-second pitch.
    assert.equal(plan('Tell me about your work experience.').answerType, 'experience_answer');
  });
});

describe('Regression guard: standalone real questions still route correctly (no over-greedy theft)', () => {
  const keep = [
    ['What is your name?', 'identity_answer'],
    ['Solve Two Sum.', 'dsa_question_answer'],
    ['Explain BFS.', 'technical_concept_answer'],
    ['What salary are you expecting?', 'negotiation_answer'],
    ['What are the action items?', 'general_meeting_answer'],
    ['Tell me about Natively.', 'project_answer'],
    ['Rate your Python skills out of 10.', 'skill_experience_answer'],
    ['Why should we hire you?', 'jd_fit_answer'],
    ['Where did you study?', 'profile_fact_answer'],
  ];
  for (const [q, exp] of keep) {
    test(`"${q}" still → ${exp}-class`, () => routeOk(q, exp));
  }
});
