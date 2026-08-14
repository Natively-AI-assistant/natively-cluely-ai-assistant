// electron/llm/__tests__/ProfileRoutingMatrix.test.mjs
//
// Phase 11: the full routing matrix — answerType + voicePerspective +
// profileContextPolicy for every category in the improvement spec. Proves BOTH
// inclusion (profile answers ground) AND exclusion (coding/technical/sales/
// lecture forbid profile), plus the keystone voice/policy split:
//   "how would you use GraphQL?"  → candidate voice, profile FORBIDDEN
//   "how have you used GraphQL?"   → candidate voice, profile REQUIRED

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { planAnswer } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/AnswerPlanner.js')).href
);

const p = (q, source = 'what_to_answer', speaker = 'interviewer') =>
  planAnswer({ question: q, source, speakerPerspective: speaker });

const forbids = (plan, layer) => plan.forbiddenContextLayers.includes(layer);

describe('matrix: identity & intro', () => {
  for (const q of ['What is my name?', 'What is your name?', 'Who are you?', 'Tell me about yourself.', 'Walk me through your background.']) {
    test(`"${q}" → identity, first-person, profile required`, () => {
      const r = p(q);
      assert.equal(r.answerType, 'identity_answer');
      assert.equal(r.voicePerspective, 'first_person_candidate');
      assert.equal(r.profileContextPolicy, 'required');
    });
  }
});

describe('matrix: projects + project follow-ups', () => {
  test('"Which is your best project?" → project_answer (dedicated template), required', () => {
    const r = p('Which is your best project?');
    assert.equal(r.answerType, 'project_answer');
    assert.equal(r.profileContextPolicy, 'required');
    assert.ok(/Best \/ Relevant Project|My Role|What I Built/.test(r.responseTemplate), 'uses project template, not STAR');
    assert.ok(forbids(r, 'negotiation'));
  });
  test('"What projects have you done?" → project_answer', () => {
    assert.equal(p('What projects have you done?').answerType, 'project_answer');
  });
  for (const q of ['How is Natively developed?', 'What was your role in Natively?', 'What was the hardest part of that project?', 'What tech stack did you use?', 'Why did you build it?', 'What did you learn from that project?']) {
    test(`"${q}" → project_followup, required, no negotiation/JD`, () => {
      const r = p(q);
      assert.equal(r.answerType, 'project_followup_answer', `got ${r.answerType}`);
      assert.equal(r.profileContextPolicy, 'required');
      assert.equal(r.voicePerspective, 'first_person_candidate');
      assert.ok(forbids(r, 'negotiation') && forbids(r, 'jd'));
    });
  }
  test('explicit entity is resolved', () => {
    assert.equal(p('How is Natively developed?').resolvedEntity, 'Natively');
  });
});

describe('matrix: JD-fit (casual phrasings)', () => {
  for (const q of ['How good are you for this job?', 'Are you good for this job?', 'Why should we hire you?', 'What makes you suitable for this position?', 'Why are you the right candidate?', 'How does your background match this role?']) {
    test(`"${q}" → jd_fit, first-person, required, no negotiation`, () => {
      const r = p(q);
      assert.equal(r.answerType, 'jd_fit_answer', `got ${r.answerType}`);
      assert.equal(r.voicePerspective, 'first_person_candidate');
      assert.equal(r.profileContextPolicy, 'required');
      assert.ok(forbids(r, 'negotiation'));
    });
  }
});

describe('matrix: hypothetical technical vs profile experience (the keystone)', () => {
  test('"How would you use GraphQL?" → candidate VOICE, profile FORBIDDEN', () => {
    const r = p('How would you use GraphQL?');
    assert.equal(r.voicePerspective, 'first_person_candidate');
    assert.equal(r.profileContextPolicy, 'forbidden');
    assert.ok(forbids(r, 'resume') && forbids(r, 'jd'));
  });
  test('"How have you used GraphQL?" → profile REQUIRED', () => {
    const r = p('How have you used GraphQL?');
    assert.equal(r.profileContextPolicy, 'required');
    assert.ok(!forbids(r, 'resume'));
  });
  test('"Have you used WebRTC?" → skill_experience, required', () => {
    const r = p('Have you used WebRTC?');
    assert.equal(r.answerType, 'skill_experience_answer');
    assert.equal(r.profileContextPolicy, 'required');
  });
  test('"Explain GraphQL." → assistant voice, profile forbidden', () => {
    const r = p('Explain GraphQL.');
    assert.equal(r.voicePerspective, 'assistant_explanation');
    assert.equal(r.profileContextPolicy, 'forbidden');
  });
  test('"Explain BFS." → assistant voice, profile forbidden', () => {
    const r = p('Explain BFS.');
    assert.equal(r.voicePerspective, 'assistant_explanation');
    assert.equal(r.profileContextPolicy, 'forbidden');
  });
});

describe('matrix: coding excludes profile', () => {
  for (const q of ['Solve Two Sum.', 'Write code for valid parentheses.', 'Implement an LRU cache.']) {
    test(`"${q}" → coding/dsa, profile/JD/negotiation forbidden`, () => {
      const r = p(q);
      assert.ok(['coding_question_answer', 'dsa_question_answer'].includes(r.answerType), `got ${r.answerType}`);
      assert.equal(r.profileContextPolicy, 'forbidden');
      assert.ok(forbids(r, 'resume') && forbids(r, 'jd') && forbids(r, 'negotiation') && forbids(r, 'custom_context'));
    });
  }
});

describe('matrix: negotiation only for compensation', () => {
  for (const q of ['What salary are you expecting?', 'Can you accept this offer?', 'Our budget is lower.']) {
    test(`"${q}" → negotiation`, () => {
      assert.equal(p(q).answerType, 'negotiation_answer');
    });
  }
  test('a non-comp profile answer does NOT include negotiation', () => {
    assert.ok(forbids(p('What projects have you done?'), 'negotiation'));
    assert.ok(forbids(p('Why should we hire you?'), 'negotiation'));
  });
});

describe('matrix: sales & lecture isolation', () => {
  for (const q of ['Why is your product expensive?', 'Can you reduce pricing?', 'How do you compare to competitors?']) {
    test(`"${q}" → sales, resume/JD/negotiation forbidden`, () => {
      const r = p(q);
      assert.equal(r.answerType, 'sales_answer');
      assert.ok(forbids(r, 'resume') && forbids(r, 'jd') && forbids(r, 'negotiation'));
    });
  }
  for (const q of ['Explain this lecture slide.', 'What did the professor mean?']) {
    test(`"${q}" → lecture, resume/JD/negotiation forbidden`, () => {
      const r = p(q);
      assert.equal(r.answerType, 'lecture_answer');
      assert.ok(forbids(r, 'resume') && forbids(r, 'jd') && forbids(r, 'negotiation'));
    });
  }
});

describe('matrix: over-capture regression guards', () => {
  test('"how would you optimize a stack?" stays TECHNICAL (hypothetical), not project_followup', () => {
    const r = p('how would you optimize a stack?');
    assert.equal(r.answerType, 'technical_concept_answer');
    assert.equal(r.profileContextPolicy, 'forbidden');
  });
  test('"how did you optimize the pipeline?" IS project_followup (past tense, candidate did it)', () => {
    assert.equal(p('how did you optimize the pipeline?').answerType, 'project_followup_answer');
  });
  test('"how would you design a scalable system?" stays system_design (not project_followup)', () => {
    assert.equal(p('how would you design a scalable system?').answerType, 'system_design_answer');
  });
  test('"what is the project budget?" is NOT negotiation', () => {
    assert.notEqual(p('what is the project budget?').answerType, 'negotiation_answer');
  });
  test('"what tech stack did you use?" is project_followup, not DSA (the `stack` collision)', () => {
    assert.equal(p('what tech stack did you use?').answerType, 'project_followup_answer');
  });
});

describe('matrix: natural recruiter phrasing (benchmark 2026-06-05)', () => {
  const expect = {
    'Give me a quick introduction.': 'identity_answer',
    'How would you describe yourself professionally?': 'identity_answer',
    'Can you summarize who you are as a candidate?': 'identity_answer',
    'Just to confirm, what should I call you?': 'identity_answer',
    'What do you currently do?': 'experience_answer',
    'Where did you study?': 'profile_fact_answer',
    'What role are you applying for?': 'profile_fact_answer',
    'What are your main technical skills?': 'skills_answer',
    'What programming languages do you know?': 'skill_experience_answer',
    'Why do you want this job?': 'jd_fit_answer',
    'What excites you about this role?': 'jd_fit_answer',
    'How can you contribute to this team?': 'jd_fit_answer',
    'What value can you bring to this role?': 'jd_fit_answer',
    'What makes you confident you can do this job?': 'jd_fit_answer',
    'So what do you think about this job?': 'jd_fit_answer',
    'Rate your Python skills out of 10.': 'skill_experience_answer',
    'What is your biggest strength?': 'behavioral_interview_answer',
    'What is your weakness?': 'behavioral_interview_answer',
  };
  for (const [q, want] of Object.entries(expect)) {
    test(`"${q}" → ${want} (not unknown)`, () => {
      const r = p(q);
      assert.equal(r.answerType, want, `got ${r.answerType}`);
      assert.notEqual(r.answerType, 'unknown_answer');
    });
  }
});

describe('matrix: manual vs interviewer voice', () => {
  test('manual "what is my name?" → second person to the user', () => {
    assert.equal(p('what is my name?', 'manual_input', 'user').voicePerspective, 'second_person_user');
  });
  test('interviewer "what is your name?" → first person candidate', () => {
    assert.equal(p('what is your name?', 'what_to_answer', 'interviewer').voicePerspective, 'first_person_candidate');
  });
});
