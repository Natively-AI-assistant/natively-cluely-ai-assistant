// electron/llm/__tests__/TurnPlanner.test.mjs
//
// Campaign 3 (fix/answer-policy-engine, 2026-07-19) — TurnPlanner unit tests.
// Verifies the single per-turn decision site produces correct question_kind,
// evidence-probe ordering, and groundingProfile for the founder's acceptance
// micro-suite + the cross-product of {profile, jd, coding, general, no-availability}.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const {
  planTurn,
  DEFAULT_GROUNDING_PROFILE,
  SEMINAR_GROUNDING_PROFILE,
} = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/TurnPlanner.js')).href);

const FULL_AVAILABILITY = {
  hasReferenceFiles: true,
  hasProfileFacts: true,
  hasJobDescription: true,
  hasLiveTranscript: true,
};
const NO_AVAILABILITY = {
  hasReferenceFiles: false,
  hasProfileFacts: false,
  hasJobDescription: false,
  hasLiveTranscript: false,
};

describe('TurnPlanner: campaign3 acceptance micro-suite', () => {
  test("C3M-001 'What's your name?' routes to profile_question with profile+jd probe", () => {
    const plan = planTurn({ question: "What's your name?", availability: FULL_AVAILABILITY });
    assert.equal(plan.questionKind, 'profile_question');
    assert.ok(plan.evidenceSourcesToProbe.includes('profile_resume'));
    assert.equal(plan.answerDirectives.seedCandidateBackground, true);
    assert.equal(plan.reasonCode, 'turnPlanner:regex_identity');
  });

  test("C3M-002 'What is the job regarding?' routes to jd_question with JD probe FIRST", () => {
    const plan = planTurn({ question: 'What is the job regarding?', availability: FULL_AVAILABILITY });
    assert.equal(plan.questionKind, 'jd_question');
    assert.equal(plan.evidenceSourcesToProbe[0], 'profile_jd',
      'jd_question MUST probe profile_jd first (the question is about the role, not the candidate)');
    assert.equal(plan.answerDirectives.seedCandidateBackground, true);
    assert.equal(plan.reasonCode, 'turnPlanner:regex_jd_summary');
  });

  test("C3M-003 'What skills are required for this role?' routes to jd_question via JD requirements cue", () => {
    const plan = planTurn({ question: 'What skills are required for this role?', availability: FULL_AVAILABILITY });
    assert.equal(plan.questionKind, 'jd_question');
    assert.equal(plan.evidenceSourcesToProbe[0], 'profile_jd');
  });

  test("C3M-004 'Why should we hire you?' routes to general; profile+Jd still probed; background NOT seeded", () => {
    const plan = planTurn({ question: 'Why should we hire you?', availability: FULL_AVAILABILITY });
    assert.equal(plan.questionKind, 'general');
    // Even general questions probe profile/jd so a content match gets grounded.
    assert.ok(plan.evidenceSourcesToProbe.includes('profile_resume'));
    assert.ok(plan.evidenceSourcesToProbe.includes('profile_jd'));
    assert.equal(plan.answerDirectives.seedCandidateBackground, false,
      'general questions (including "why hire you") must NOT auto-seed candidate background — director prose from profile facts only when the evidence probe finds a match');
  });

  test("C3M-005 'salary expectation' routes to general with seedCandidateBackground=false (seeder-leash)", () => {
    const plan = planTurn({ question: "What's your salary expectation?", availability: FULL_AVAILABILITY });
    assert.equal(plan.questionKind, 'general');
    assert.equal(plan.answerDirectives.seedCandidateBackground, false,
      'CRITICAL: salary/negotiation/unroutable asks must NOT auto-seed candidate background — closes the founder\'s "salary → bio" complaint');
    assert.equal(plan.answerDirectives.labelGeneral, true,
      'default profile labels general answers for source transparency');
  });
});

describe('TurnPlanner: question_kind taxonomy + answerType signal', () => {
  test('identity answerType routes to profile_question', () => {
    const plan = planTurn({ question: 'introduce yourself', answerType: 'identity_answer', availability: FULL_AVAILABILITY });
    assert.equal(plan.questionKind, 'profile_question');
    assert.equal(plan.reasonCode, 'turnPlanner:answerType=identity_answer');
  });

  test('jd_summary_answer routes to jd_question via answerType signal', () => {
    const plan = planTurn({ question: 'what is this role', answerType: 'jd_summary_answer', availability: FULL_AVAILABILITY });
    assert.equal(plan.questionKind, 'jd_question');
    assert.equal(plan.reasonCode, 'turnPlanner:answerType=jd_summary_answer');
  });

  test('coding_question_answer routes to coding_question', () => {
    const plan = planTurn({ question: 'reverse a linked list', answerType: 'coding_question_answer', availability: FULL_AVAILABILITY });
    assert.equal(plan.questionKind, 'coding_question');
  });

  test('lecture_answer routes to doc_question', () => {
    const plan = planTurn({ question: 'summarize today', answerType: 'lecture_answer', availability: FULL_AVAILABILITY });
    assert.equal(plan.questionKind, 'doc_question');
  });
});

describe('TurnPlanner: availability-gated probe ordering', () => {
  test('profile_question with no profile/JD loaded → empty probe (general knowledge answer expected)', () => {
    const plan = planTurn({ question: "what's your name", availability: NO_AVAILABILITY });
    assert.equal(plan.questionKind, 'profile_question');
    assert.deepEqual(plan.evidenceSourcesToProbe, [],
      'no profile available → nothing to probe; assembly falls back to general knowledge (labeled) per on_no_evidence=answer_general_labeled');
  });

  test('jd_question with profile but no JD → still routes jd_question (probe profile only)', () => {
    const plan = planTurn({ question: 'what is the job regarding', availability: {
      ...NO_AVAILABILITY,
      hasProfileFacts: true,
    } });
    assert.equal(plan.questionKind, 'jd_question');
    assert.deepEqual(plan.evidenceSourcesToProbe, ['profile_resume'],
      'jd_question routing is by question_kind; with no JD loaded, only profile probe is attempted');
  });

  test('doc_question with reference files routes to reference_files probe', () => {
    const plan = planTurn({ question: 'summarize the deck', availability: {
      ...NO_AVAILABILITY, hasReferenceFiles: true,
    } });
    assert.equal(plan.questionKind, 'doc_question');
    assert.deepEqual(plan.evidenceSourcesToProbe, ['reference_files']);
  });
});

describe('TurnPlanner: groundingProfile', () => {
  test('default profile is preferred / answer_general_labeled (matches founder spec for 7 built-in modes)', () => {
    const plan = planTurn({ question: 'hello', availability: NO_AVAILABILITY });
    assert.equal(plan.groundingProfile.evidencePreference, 'preferred');
    assert.equal(plan.groundingProfile.onNoEvidence, 'answer_general_labeled');
  });

  test('seminar profile is required / say_not_found_then_answer_general (founder spec for 8th mode)', () => {
    assert.equal(SEMINAR_GROUNDING_PROFILE.evidencePreference, 'required');
    assert.equal(SEMINAR_GROUNDING_PROFILE.onNoEvidence, 'say_not_found_then_answer_general');
  });
});

describe('TurnPlanner: groundingProfile resolution order (iter12)', () => {
  // Campaign-3 (2026-07-19): founder §2.3 + §3 step 2 + iter12 polish.
  // The groundingProfileFor() resolver consults four sources in priority
  // order. The tests below pin each tier so a future regression cannot
  // silently reorder them.

  test('tier 1 — sourceContract.groundingProfile override beats everything (even env flag)', () => {
    const prev = process.env.NATIVELY_SEMINAR_MODE;
    process.env.NATIVELY_SEMINAR_MODE = '1'; // also try to flip via env
    try {
      const plan = planTurn({
        question: 'any',
        availability: { hasReferenceFiles: true, hasProfileFacts: true, hasJobDescription: true, hasLiveTranscript: true },
        sourceContract: {
          sourceAuthority: 'reference_files_only',
          templateType: 'general', // would NOT auto-emit seminar
          groundingProfile: {
            evidencePreference: 'optional',
            onNoEvidence: 'refuse',
            labelStyle: 'paragraph',
          },
        },
      });
      assert.equal(plan.groundingProfile.evidencePreference, 'optional');
      assert.equal(plan.groundingProfile.onNoEvidence, 'refuse',
        'tier 1: sourceContract.groundingProfile MUST win over env flag (which would have given say_not_found...)');
    } finally {
      if (prev === undefined) delete process.env.NATIVELY_SEMINAR_MODE;
      else process.env.NATIVELY_SEMINAR_MODE = prev;
    }
  });

  test('tier 2 — sourceContract.templateType === "seminar" emits strict profile without env flag', () => {
    const prev = process.env.NATIVELY_SEMINAR_MODE;
    delete process.env.NATIVELY_SEMINAR_MODE; // ensure env is OFF
    try {
      const plan = planTurn({
        question: 'any',
        availability: { hasReferenceFiles: true, hasProfileFacts: true, hasJobDescription: true, hasLiveTranscript: true },
        sourceContract: {
          sourceAuthority: 'reference_files_primary',
          templateType: 'seminar',
          // no groundingProfile field — templateType alone is the trigger
        },
      });
      assert.equal(plan.groundingProfile.evidencePreference, 'required');
      assert.equal(plan.groundingProfile.onNoEvidence, 'say_not_found_then_answer_general',
        'tier 2: per-mode templateType seminar must emit strict profile even without env flag');
    } finally {
      if (prev === undefined) delete process.env.NATIVELY_SEMINAR_MODE;
      else process.env.NATIVELY_SEMINAR_MODE = prev;
    }
  });

  test('tier 3 — env flag fires only when tiers 1+2 are absent', () => {
    const prev = process.env.NATIVELY_SEMINAR_MODE;
    process.env.NATIVELY_SEMINAR_MODE = '1';
    try {
      // sourceContract absent — both tiers 1+2 fall through.
      const plan = planTurn({
        question: 'any',
        availability: { hasReferenceFiles: true, hasProfileFacts: true, hasJobDescription: true, hasLiveTranscript: true },
        sourceContract: null,
      });
      assert.equal(plan.groundingProfile.evidencePreference, 'required',
        'tier 3: env flag (legacy migration window) still works');
    } finally {
      if (prev === undefined) delete process.env.NATIVELY_SEMINAR_MODE;
      else process.env.NATIVELY_SEMINAR_MODE = prev;
    }
  });

  test('tier 4 — DEFAULT when nothing is set (the 7 built-in modes case)', () => {
    const prev = process.env.NATIVELY_SEMINAR_MODE;
    delete process.env.NATIVELY_SEMINAR_MODE;
    try {
      const plan = planTurn({
        question: 'any',
        availability: { hasReferenceFiles: true, hasProfileFacts: true, hasJobDescription: true, hasLiveTranscript: true },
        sourceContract: { sourceAuthority: 'reference_files_primary' },
        // templateType=undefined, groundingProfile=undefined → tier 4
      });
      assert.equal(plan.groundingProfile.evidencePreference, 'preferred');
      assert.equal(plan.groundingProfile.onNoEvidence, 'answer_general_labeled');
    } finally {
      if (prev === undefined) delete process.env.NATIVELY_SEMINAR_MODE;
      else process.env.NATIVELY_SEMINAR_MODE = prev;
    }
  });
});

describe('TurnPlanner: invariants', () => {
  test('empty question → general', () => {
    const plan = planTurn({ question: '', availability: FULL_AVAILABILITY });
    assert.equal(plan.questionKind, 'general');
  });

  test('always emits a TurnPlan — never refuses (the "never answerless" invariant)', () => {
    for (const q of ['', '?', 'asdfghjkl', '🎉', "What's your name?", 'what is the job regarding']) {
      const plan = planTurn({ question: q, availability: FULL_AVAILABILITY });
      assert.ok(plan, `planner returned null for question ${JSON.stringify(q)}`);
      assert.ok(plan.questionKind, 'questionKind must be set');
    }
  });
});
