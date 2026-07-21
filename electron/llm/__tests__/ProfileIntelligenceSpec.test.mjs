// electron/llm/__tests__/ProfileIntelligenceSpec.test.mjs
//
// Spec §11 (the 21 required cases) + §12 (acceptance criteria) for the Profile
// Intelligence decision layer. Pure: drives decideProfileIntelligence + planAnswer
// + buildContextRoute + validateProfileOutput — NO DB, NO LLM — so it runs under
// plain `node --test`.
//
// Build first: `npm run build:electron`, then
//   node --test electron/llm/__tests__/ProfileIntelligenceSpec.test.mjs
//
// Assertions are ROBUST: they check the decision object's booleans and the
// profileContextTypes / excludedContextTypes arrays (includes/excludes), not
// brittle string matches. Where the spec label is ambiguous (e.g. "Why this
// company?" may be jd_fit or company), we assert the BEHAVIORAL invariant
// (includes job_description, shouldUseProfile=true) and/or membership in an
// accepted answerType set.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  decideProfileIntelligence,
  planAnswer,
  buildContextRoute,
  validateProfileOutput,
} from '../../../dist-electron/electron/llm/index.js';

// ---- helpers ---------------------------------------------------------------

const decide = (question, opts = {}) =>
  decideProfileIntelligence({
    question,
    source: opts.source ?? 'what_to_answer',
    speakerPerspective: opts.speakerPerspective,
    activeMode: opts.activeMode,
    profileAvailable: opts.profileAvailable ?? true,
    jdAvailable: opts.jdAvailable ?? true,
  });

const includesAll = (arr, items) => items.every(i => arr.includes(i));
const includesNone = (arr, items) => items.every(i => !arr.includes(i));

// The full set of profileContextTypes that count as "profile" leakage in a
// generic (coding/technical/sales/lecture/meeting) answer.
const PROFILE_LEAK_TYPES = [
  'identity', 'resume_summary', 'experience', 'projects', 'skills', 'education',
  'achievements', 'star_stories', 'job_description', 'company_context',
  'gap_analysis', 'negotiation_strategy', 'salary_context',
];

// Every answerType the planner can emit (for the cross-product matrix).
const ALL_ANSWER_TYPES = [
  'identity_answer', 'profile_fact_answer', 'project_answer', 'skills_answer',
  'skill_experience_answer', 'experience_answer', 'jd_fit_answer',
  'behavioral_interview_answer', 'coding_question_answer', 'dsa_question_answer',
  'technical_concept_answer', 'system_design_answer', 'debugging_question_answer',
  'negotiation_answer', 'sales_answer', 'lecture_answer', 'follow_up_answer',
  'general_meeting_answer', 'unknown_answer',
];

// A representative question that the planner routes to each answerType, so the
// cross-product matrix exercises real decisions (not synthesized plans).
const TYPE_PROBE = {
  identity_answer: 'What is your name?',
  project_answer: 'What projects have you done?',
  skills_answer: 'List your skills.',
  skill_experience_answer: 'Have you worked with WebRTC?',
  experience_answer: 'Tell me about your internship.',
  jd_fit_answer: 'Why are you a good fit for this role?',
  behavioral_interview_answer: 'Tell me about a time you handled a crisis.',
  coding_question_answer: 'write a function to reverse a string',
  dsa_question_answer: 'Solve Two Sum.',
  technical_concept_answer: 'Explain BFS.',
  system_design_answer: 'Design a URL shortener.',
  debugging_question_answer: 'Why is this service crashing?',
  negotiation_answer: 'What salary are you expecting?',
  sales_answer: 'Why is your product expensive?',
  lecture_answer: 'Explain this lecture slide.',
  general_meeting_answer: 'What are the action items from the meeting?',
};

// ===========================================================================
// §11 — the 21 required cases
// ===========================================================================

describe('Spec §11: the 21 required cases', () => {
  // 1. "What is my name?" → identity, use profile, first_person_user (manual)
  test('Case 1: "What is my name?" (manual) → identity, profile, first_person_user', () => {
    const d = decide('What is my name?', { source: 'manual_input' });
    assert.equal(d.answerType, 'identity_answer');
    assert.equal(d.shouldUseProfile, true);
    assert.equal(d.answerPerspective, 'first_person_user');
    assert.ok(d.profileContextTypes.includes('identity'));
  });

  // 2. "What is your name?" (interviewer) → identity, use profile, first_person_user
  test('Case 2: "What is your name?" (interviewer) → identity, profile, first_person_user', () => {
    const d = decide('What is your name?', { source: 'what_to_answer', speakerPerspective: 'interviewer' });
    assert.equal(d.answerType, 'identity_answer');
    assert.equal(d.shouldUseProfile, true);
    assert.equal(d.answerPerspective, 'first_person_user');
  });

  // 3. "Tell me about yourself." → identity, includes resume_summary/experience/projects
  test('Case 3: "Tell me about yourself." → identity, includes resume_summary/experience/projects', () => {
    const d = decide('Tell me about yourself.', { source: 'what_to_answer', speakerPerspective: 'interviewer' });
    assert.equal(d.answerType, 'identity_answer');
    assert.equal(d.shouldUseProfile, true);
    assert.ok(includesAll(d.profileContextTypes, ['resume_summary', 'experience', 'projects']),
      `expected resume_summary/experience/projects, got ${d.profileContextTypes.join(',')}`);
  });

  // 4. "What projects have you done?" → project, includes projects
  test('Case 4: "What projects have you done?" → project, includes projects', () => {
    const d = decide('What projects have you done?', { source: 'what_to_answer', speakerPerspective: 'interviewer' });
    assert.equal(d.answerType, 'project_answer');
    assert.equal(d.shouldUseProfile, true);
    assert.ok(d.profileContextTypes.includes('projects'));
  });

  // 5. "Have you worked with WebRTC?" → skill_experience, includes skills, EXCLUDES job_description
  test('Case 5: "Have you worked with WebRTC?" → skill_experience, includes skills, excludes job_description', () => {
    const d = decide('Have you worked with WebRTC?', { source: 'what_to_answer', speakerPerspective: 'interviewer' });
    assert.equal(d.answerType, 'skill_experience_answer');
    assert.equal(d.shouldUseProfile, true);
    assert.ok(d.profileContextTypes.includes('skills'));
    assert.ok(d.excludedContextTypes.includes('job_description'));
    assert.ok(!d.profileContextTypes.includes('job_description'));
  });

  // 6. "Why are you a good fit for this role?" → jd_fit, includes resume + job_description
  test('Case 6: "Why are you a good fit for this role?" → jd_fit, includes resume_summary + job_description', () => {
    const d = decide('Why are you a good fit for this role?', { source: 'what_to_answer', speakerPerspective: 'interviewer' });
    assert.equal(d.answerType, 'jd_fit_answer');
    assert.equal(d.shouldUseProfile, true);
    assert.ok(d.profileContextTypes.includes('resume_summary'));
    assert.ok(d.profileContextTypes.includes('job_description'));
  });

  // 7. "What salary are you expecting?" → negotiation, sensitive=true, includes negotiation_strategy/salary_context
  test('Case 7: "What salary are you expecting?" → negotiation, sensitive=true, includes negotiation_strategy/salary_context', () => {
    const d = decide('What salary are you expecting?', { source: 'what_to_answer', speakerPerspective: 'interviewer' });
    assert.equal(d.answerType, 'negotiation_answer');
    assert.equal(d.shouldUseProfile, true);
    assert.equal(d.sensitiveContextAllowed, true);
    assert.ok(includesAll(d.profileContextTypes, ['negotiation_strategy', 'salary_context']));
  });

  // 8. "Solve Two Sum." → dsa/coding, use=FALSE, generic_ai, EXCLUDES all profile
  test('Case 8: "Solve Two Sum." → dsa, no profile, generic_ai, excludes all profile context', () => {
    const d = decide('Solve Two Sum.', { source: 'what_to_answer', speakerPerspective: 'interviewer' });
    assert.ok(['dsa_question_answer', 'coding_question_answer'].includes(d.answerType));
    assert.equal(d.shouldUseProfile, false);
    assert.equal(d.answerPerspective, 'generic_ai');
    assert.ok(includesNone(d.profileContextTypes,
      ['resume_summary', 'experience', 'projects', 'skills', 'job_description', 'negotiation_strategy']),
      `dsa leaked profile: ${d.profileContextTypes.join(',')}`);
    assert.ok(includesAll(d.excludedContextTypes,
      ['resume_summary', 'experience', 'projects', 'skills', 'job_description', 'negotiation_strategy']));
  });

  // 9. "Explain BFS." → technical_concept, use=FALSE, generic_ai, excludes profile
  test('Case 9: "Explain BFS." → technical_concept, no profile, generic_ai, excludes profile', () => {
    const d = decide('Explain BFS.', { source: 'what_to_answer', speakerPerspective: 'interviewer' });
    assert.equal(d.answerType, 'technical_concept_answer');
    assert.equal(d.shouldUseProfile, false);
    assert.equal(d.answerPerspective, 'generic_ai');
    assert.ok(includesNone(d.profileContextTypes,
      ['resume_summary', 'experience', 'projects', 'skills', 'job_description']));
  });

  // 10. "Tell me about a time you handled a crisis." → behavioral, includes star_stories
  test('Case 10: behavioral → includes star_stories, use profile', () => {
    const d = decide('Tell me about a time you handled a crisis.', { source: 'what_to_answer', speakerPerspective: 'interviewer' });
    assert.equal(d.answerType, 'behavioral_interview_answer');
    assert.equal(d.shouldUseProfile, true);
    assert.ok(d.profileContextTypes.includes('star_stories'));
  });

  // 11. "Why this company?" → jd_fit (or company), includes job_description/company_context
  test('Case 11: "Why this company?" → uses profile, includes job_description + company_context', () => {
    const d = decide('Why this company?', { source: 'what_to_answer', speakerPerspective: 'interviewer' });
    // Behavioral invariant (spec label ambiguous: jd_fit or company).
    assert.equal(d.shouldUseProfile, true);
    assert.ok(['jd_fit_answer'].includes(d.answerType),
      `expected a JD/company answer type, got ${d.answerType}`);
    assert.ok(d.profileContextTypes.includes('job_description'));
    assert.ok(d.profileContextTypes.includes('company_context'));
  });

  // 12. "What are the action items from the meeting?" → general_meeting, use=FALSE
  test('Case 12: meeting action items → no profile', () => {
    const d = decide('What are the action items from the meeting?', { source: 'system' });
    assert.equal(d.shouldUseProfile, false);
    assert.ok(['general_meeting_answer', 'unknown_answer'].includes(d.answerType));
    assert.ok(includesNone(d.profileContextTypes, ['resume_summary', 'job_description', 'negotiation_strategy']));
  });

  // 13. "Explain this lecture slide." → lecture, use=FALSE, excludes resume/jd/negotiation
  test('Case 13: lecture → no profile, excludes resume/jd/negotiation', () => {
    const d = decide('Explain this lecture slide.', { source: 'what_to_answer', speakerPerspective: 'interviewer' });
    assert.equal(d.answerType, 'lecture_answer');
    assert.equal(d.shouldUseProfile, false);
    assert.ok(includesAll(d.excludedContextTypes,
      ['resume_summary', 'job_description', 'negotiation_strategy', 'salary_context']));
  });

  // 14. "Why is your product expensive?" → sales, use=FALSE, excludes resume/jd/negotiation
  test('Case 14: sales pricing → no profile, excludes resume/jd/negotiation', () => {
    const d = decide('Why is your product expensive?', { source: 'what_to_answer', speakerPerspective: 'interviewer' });
    assert.equal(d.answerType, 'sales_answer');
    assert.equal(d.shouldUseProfile, false);
    assert.ok(includesAll(d.excludedContextTypes,
      ['resume_summary', 'job_description', 'negotiation_strategy', 'salary_context']));
  });

  // 15. Generic coding WITH profileAvailable=true → use=FALSE, resume excluded
  test('Case 15: generic coding with profile loaded → profile NOT used, resume excluded', () => {
    const d = decide('write a function to reverse a string', {
      source: 'what_to_answer', speakerPerspective: 'interviewer', profileAvailable: true,
    });
    assert.ok(['coding_question_answer', 'dsa_question_answer'].includes(d.answerType));
    assert.equal(d.shouldUseProfile, false);
    assert.ok(d.excludedContextTypes.includes('resume_summary'));
    assert.ok(!d.profileContextTypes.includes('resume_summary'));
  });

  // 16. Salary → negotiation_strategy + salary_context INCLUDED, sensitive=true
  test('Case 16: salary → negotiation_strategy + salary_context included, sensitive=true', () => {
    const d = decide('What compensation are you looking for?', { source: 'what_to_answer', speakerPerspective: 'interviewer' });
    assert.equal(d.answerType, 'negotiation_answer');
    assert.equal(d.sensitiveContextAllowed, true);
    assert.ok(includesAll(d.profileContextTypes, ['negotiation_strategy', 'salary_context']));
  });

  // 17. Sales pricing → does NOT include resume/job_description/negotiation
  test('Case 17: sales pricing → excludes resume/job_description/negotiation_strategy', () => {
    const d = decide('How much does your product cost?', { source: 'what_to_answer', speakerPerspective: 'interviewer' });
    assert.equal(d.answerType, 'sales_answer');
    assert.ok(includesNone(d.profileContextTypes,
      ['resume_summary', 'job_description', 'negotiation_strategy', 'salary_context']));
  });

  // 18. Missing profile fallback: identity, profileAvailable=false
  test('Case 18: identity with profileAvailable=false → fallbackBehavior=profile_missing_admit_no_data, still shouldUseProfile=true', () => {
    const d = decide('What is your name?', {
      source: 'what_to_answer', speakerPerspective: 'interviewer', profileAvailable: false,
    });
    assert.equal(d.answerType, 'identity_answer');
    assert.equal(d.shouldUseProfile, true); // type is profile; not a hard refusal
    assert.equal(d.fallbackBehavior, 'profile_missing_admit_no_data');
  });

  // 19. Profile exists + active mode technical-interview → profile question still uses profile.
  //     (mode-gating is a SEPARATE premium-intercept layer; the decision layer is mode-agnostic.)
  test('Case 19: activeMode=technical-interview, profile question → still uses profile, right type/perspective', () => {
    const d = decide('What projects have you done?', {
      source: 'what_to_answer', speakerPerspective: 'interviewer', activeMode: 'technical-interview',
    });
    assert.equal(d.answerType, 'project_answer');
    assert.equal(d.shouldUseProfile, true);
    assert.equal(d.answerPerspective, 'first_person_user');
  });

  // 20. Profile exists + active mode lecture → a lecture question is no-profile.
  test('Case 20: activeMode=lecture, lecture question → no profile', () => {
    const d = decide('Explain this lecture slide.', {
      source: 'what_to_answer', speakerPerspective: 'interviewer', activeMode: 'lecture',
    });
    assert.equal(d.answerType, 'lecture_answer');
    assert.equal(d.shouldUseProfile, false);
  });

  // 21. Profile exists + active mode custom → a profile question still uses profile.
  test('Case 21: activeMode=custom, profile question → still uses profile', () => {
    const d = decide('What is your name?', {
      source: 'what_to_answer', speakerPerspective: 'interviewer', activeMode: 'custom',
    });
    assert.equal(d.answerType, 'identity_answer');
    assert.equal(d.shouldUseProfile, true);
  });
});

// ===========================================================================
// §12 — acceptance criteria
// ===========================================================================

describe('Spec §12: acceptance criteria', () => {
  // Profile questions never produce generic_ai perspective.
  test('§12: profile answer types never produce generic_ai perspective', () => {
    const profileQuestions = [
      'What is your name?', 'Tell me about yourself.', 'What projects have you done?',
      'Have you worked with WebRTC?', 'Why are you a good fit for this role?',
      'Tell me about a time you handled a crisis.', 'What salary are you expecting?',
    ];
    for (const q of profileQuestions) {
      const d = decide(q, { source: 'what_to_answer', speakerPerspective: 'interviewer' });
      assert.notEqual(d.answerPerspective, 'generic_ai', `${q} (${d.answerType}) must not be generic_ai`);
    }
  });

  // Coding/technical/sales/lecture never produce first_person_user.
  test('§12: coding/technical/sales/lecture never produce first_person_user', () => {
    const genericQuestions = [
      'Solve Two Sum.', 'write a function to reverse a string', 'Explain BFS.',
      'What is a deadlock?', 'Why is your product expensive?', 'Explain this lecture slide.',
    ];
    for (const q of genericQuestions) {
      const d = decide(q, { source: 'what_to_answer', speakerPerspective: 'interviewer' });
      assert.notEqual(d.answerPerspective, 'first_person_user', `${q} (${d.answerType}) must not be first_person_user`);
    }
  });

  // negotiation context only when answerType=negotiation.
  test('§12: negotiation_strategy NOT in profileContextTypes for identity/skills/jd_fit', () => {
    for (const q of ['What is your name?', 'List your skills.', 'Why are you a good fit for this role?']) {
      const d = decide(q, { source: 'what_to_answer', speakerPerspective: 'interviewer' });
      assert.ok(!d.profileContextTypes.includes('negotiation_strategy'),
        `${q} (${d.answerType}) leaked negotiation_strategy`);
      assert.ok(!d.profileContextTypes.includes('salary_context'),
        `${q} (${d.answerType}) leaked salary_context`);
    }
  });

  // sensitiveContextAllowed false for all non-negotiation answers.
  test('§12: sensitiveContextAllowed is false for non-negotiation answers', () => {
    for (const q of ['What is your name?', 'What projects have you done?', 'Solve Two Sum.',
      'Explain BFS.', 'Why is your product expensive?', 'Why are you a good fit for this role?']) {
      const d = decide(q, { source: 'what_to_answer', speakerPerspective: 'interviewer' });
      if (d.answerType !== 'negotiation_answer') {
        assert.equal(d.sensitiveContextAllowed, false, `${q} (${d.answerType}) wrongly allowed sensitive context`);
      }
    }
  });

  // job_description only for jd_fit/negotiation (NOT identity/skills/coding).
  test('§12: job_description NOT in profileContextTypes for identity/skills/coding', () => {
    const probes = [
      ['What is your name?', 'identity_answer'],
      ['List your skills.', 'skills_answer'],
      ['Have you worked with WebRTC?', 'skill_experience_answer'],
      ['Solve Two Sum.', null],
      ['write a function to reverse a string', null],
    ];
    for (const [q] of probes) {
      const d = decide(q, { source: 'what_to_answer', speakerPerspective: 'interviewer' });
      assert.ok(!d.profileContextTypes.includes('job_description'),
        `${q} (${d.answerType}) leaked job_description`);
    }
  });

  // Cross-product matrix: for each answerType, sensitiveContextAllowed true ONLY for negotiation.
  test('§12 matrix: sensitiveContextAllowed is true ONLY for negotiation_answer', () => {
    for (const [type, q] of Object.entries(TYPE_PROBE)) {
      const d = decide(q, { source: 'what_to_answer', speakerPerspective: 'interviewer' });
      // Confirm the probe actually routes to the expected type (guards against
      // planner drift silently weakening this matrix).
      assert.equal(d.answerType, type, `probe "${q}" expected ${type}, routed ${d.answerType}`);
      const expectSensitive = type === 'negotiation_answer';
      assert.equal(d.sensitiveContextAllowed, expectSensitive,
        `${type}: sensitiveContextAllowed should be ${expectSensitive}`);
    }
  });

  // Cross-product matrix: generic answer types never leak any profile context type.
  test('§12 matrix: coding/dsa/technical/system_design/debugging/sales/lecture/meeting leak NO profile context', () => {
    const genericTypes = [
      'coding_question_answer', 'dsa_question_answer', 'technical_concept_answer',
      'system_design_answer', 'debugging_question_answer', 'sales_answer',
      'lecture_answer', 'general_meeting_answer',
    ];
    for (const type of genericTypes) {
      const q = TYPE_PROBE[type];
      const d = decide(q, { source: 'what_to_answer', speakerPerspective: 'interviewer' });
      assert.equal(d.answerType, type, `probe "${q}" expected ${type}, routed ${d.answerType}`);
      assert.equal(d.shouldUseProfile, false, `${type} should not use profile`);
      assert.ok(includesNone(d.profileContextTypes, PROFILE_LEAK_TYPES),
        `${type} leaked profile context: ${d.profileContextTypes.filter(t => PROFILE_LEAK_TYPES.includes(t)).join(',')}`);
    }
  });

  // Cross-product matrix: profile answer types always use profile + a candidate/coach voice.
  test('§12 matrix: profile answer types use profile and never generic_ai', () => {
    const profileTypes = [
      'identity_answer', 'project_answer', 'skills_answer', 'skill_experience_answer',
      'experience_answer', 'jd_fit_answer', 'behavioral_interview_answer', 'negotiation_answer',
    ];
    for (const type of profileTypes) {
      const q = TYPE_PROBE[type];
      const d = decide(q, { source: 'what_to_answer', speakerPerspective: 'interviewer' });
      assert.equal(d.answerType, type, `probe "${q}" expected ${type}, routed ${d.answerType}`);
      assert.equal(d.shouldUseProfile, true, `${type} should use profile`);
      assert.notEqual(d.answerPerspective, 'generic_ai', `${type} must not be generic_ai`);
    }
  });
});

// ===========================================================================
// Internal consistency: excludedContextTypes is the exact complement of
// profileContextTypes over the full vocabulary (no silent gaps / overlaps).
// ===========================================================================

describe('Decision object invariants', () => {
  test('profileContextTypes and excludedContextTypes are disjoint and exhaustive', () => {
    const ALL = [
      'identity', 'resume_summary', 'experience', 'projects', 'skills', 'education',
      'achievements', 'star_stories', 'job_description', 'company_context',
      'gap_analysis', 'mock_questions', 'negotiation_strategy', 'salary_context',
      'custom_context_pinned', 'custom_context_searchable', 'custom_context_sensitive',
      'reference_files', 'live_transcript', 'screen_context', 'ai_persona_style',
    ];
    for (const q of ['What is your name?', 'Solve Two Sum.', 'What salary are you expecting?',
      'Why are you a good fit for this role?', 'Explain this lecture slide.']) {
      const d = decide(q, { source: 'what_to_answer', speakerPerspective: 'interviewer' });
      const overlap = d.profileContextTypes.filter(t => d.excludedContextTypes.includes(t));
      assert.equal(overlap.length, 0, `${q}: overlap ${overlap.join(',')}`);
      const union = new Set([...d.profileContextTypes, ...d.excludedContextTypes]);
      for (const t of ALL) assert.ok(union.has(t), `${q}: missing ${t} from union`);
    }
  });

  test('confidence is a number in [0,1] and reason is non-empty', () => {
    const d = decide('What is your name?', { source: 'what_to_answer', speakerPerspective: 'interviewer' });
    assert.ok(typeof d.confidence === 'number' && d.confidence >= 0 && d.confidence <= 1);
    assert.ok(typeof d.reason === 'string' && d.reason.length > 0);
  });

  test('every probe routes to a known answerType', () => {
    for (const q of Object.values(TYPE_PROBE)) {
      const d = decide(q, { source: 'what_to_answer', speakerPerspective: 'interviewer' });
      assert.ok(ALL_ANSWER_TYPES.includes(d.answerType), `${q} → unknown type ${d.answerType}`);
    }
  });
});

// ===========================================================================
// End-to-end coherence: the decision's perspective/exclusions agree with what
// the ProfileOutputValidator would FLAG, closing the loop spec→decision→validate.
// ===========================================================================

describe('Decision ↔ ProfileOutputValidator coherence', () => {
  test('a compliant identity answer passes the validator the decision implies', () => {
    const plan = planAnswer({ question: 'What is your name?', source: 'what_to_answer', speakerPerspective: 'interviewer' });
    const res = validateProfileOutput({
      answer: 'My name is Alex Carter. I am a backend engineer.',
      plan, profileAvailable: true, candidateDirected: true,
    });
    assert.equal(res.ok, true, `unexpected violations: ${res.errorCodes.join(',')}`);
  });

  test('a false "I don\'t have access" identity answer is flagged when profile exists', () => {
    const plan = planAnswer({ question: 'What is your name?', source: 'what_to_answer', speakerPerspective: 'interviewer' });
    const res = validateProfileOutput({
      answer: "I don't have access to your name.",
      plan, profileAvailable: true, candidateDirected: true,
    });
    assert.equal(res.ok, false);
    assert.ok(res.errorCodes.includes('false_no_access_refusal'));
  });

  test('a coding answer that leaks the resume is flagged (forbidden layer enforced)', () => {
    const plan = planAnswer({ question: 'write a function to reverse a string', source: 'what_to_answer', speakerPerspective: 'interviewer' });
    // The decision excludes resume; the validator catches a leak of it.
    const d = decide('write a function to reverse a string', { source: 'what_to_answer', speakerPerspective: 'interviewer' });
    assert.ok(d.excludedContextTypes.includes('resume_summary'));
    const res = validateProfileOutput({
      answer: 'Based on my resume and the job description, here is the function.',
      plan, profileAvailable: true, candidateDirected: false,
    });
    assert.equal(res.ok, false);
    assert.ok(res.errorCodes.includes('profile_in_generic_answer'));
  });
});
