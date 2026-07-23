// Canonical-turn migration seam parity tests.
//
// Run with:
//   npm run build:electron && node --test electron/llm/__tests__/ResolveCanonicalTurnParity.test.mjs
//
// This suite intentionally exercises the compiled pure facade only. Production
// surfaces still use their legacy helpers until a later staged migration.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../../../dist-electron/electron');
const load = (relativePath) => import(pathToFileURL(path.join(distDir, relativePath)).href);

const [
  { resolveCanonicalTurn },
  { planAnswer },
  { planTurn },
  { resolveTurnSourceDecision },
] = await Promise.all([
  load('llm/resolveCanonicalTurn.js'),
  load('llm/AnswerPlanner.js'),
  load('llm/TurnPlanner.js'),
  load('llm/turnSourceDecision.js'),
]);

const AVAILABLE = {
  hasReferenceFiles: true,
  hasProfileFacts: true,
  hasJobDescription: true,
  hasLiveTranscript: true,
  hasMeetingRag: true,
};

const SOURCE_CONTRACT = {
  defaultOwner: 'reference_files',
  sourceAuthority: 'reference_files_primary',
  allowedExplicitSwitches: ['profile', 'job_description', 'transcript', 'reference_files'],
};

function directTurn(input) {
  const answerPlan = planAnswer(input.answerInput);
  const turnSourceDecision = input.sourceContract
    ? resolveTurnSourceDecision({
      sourceContract: input.sourceContract,
      explicitRequest: input.explicitRequest,
      explicitRequests: input.explicitRequests,
      availability: input.availability,
    })
    : null;
  const turnPlan = planTurn({
    question: answerPlan.question,
    answerType: answerPlan.answerType,
    intent: input.answerInput.intentResult?.intent ?? null,
    turnSourceDecision,
    sourceContract: input.sourceContract
      ? {
        sourceAuthority: input.sourceContract.sourceAuthority,
        groundingProfile: input.sourceContract.groundingProfile,
        templateType: input.sourceContract.templateType,
      }
      : null,
    availability: {
      hasReferenceFiles: input.availability.hasReferenceFiles,
      hasProfileFacts: input.availability.hasProfileFacts,
      hasJobDescription: input.availability.hasJobDescription,
      hasLiveTranscript: input.availability.hasLiveTranscript,
    },
  });
  return { answerPlan, turnSourceDecision, turnPlan };
}

function input(question, source = 'manual_input', overrides = {}) {
  return {
    answerInput: {
      question,
      source,
      hasCandidateProfile: true,
      hasJobDescription: true,
    },
    sourceContract: SOURCE_CONTRACT,
    availability: AVAILABLE,
    ...overrides,
  };
}

describe('resolveCanonicalTurn: direct-helper parity across answer surfaces', () => {
  const cases = [
    {
      name: 'manual identity answer',
      input: input("What's your name?"),
      answerType: 'identity_answer',
      questionKind: 'profile_question',
      seedCandidateBackground: true,
    },
    {
      name: 'WTA project answer',
      input: input('Tell me about your projects.', 'what_to_answer'),
      answerType: 'project_answer',
      questionKind: 'profile_question',
      seedCandidateBackground: true,
    },
    {
      name: 'phone-mirror JD requirement answer',
      input: input('What skills are required for this role?', 'transcript'),
      answerType: 'jd_requirements_answer',
      questionKind: 'jd_question',
      seedCandidateBackground: true,
    },
    {
      name: 'manual salary answer keeps the seeder leash',
      input: input("What's your salary expectation?"),
      answerType: 'negotiation_answer',
      questionKind: 'general',
      seedCandidateBackground: false,
    },
    {
      name: 'current Rust experience uses profile evidence',
      input: input('Have you used Rust before?', 'what_to_answer'),
      answerType: 'skill_experience_answer',
      questionKind: 'profile_question',
      seedCandidateBackground: true,
    },
    {
      name: 'hypothetical Rust answer excludes profile facts',
      input: input('How would you use Rust for a command-line tool?', 'what_to_answer'),
      answerType: 'technical_concept_answer',
      questionKind: 'general',
      seedCandidateBackground: false,
    },
    {
      name: 'coding question retains the coding contract',
      input: input('Write a function that reverses a linked list.', 'what_to_answer'),
      answerType: 'dsa_question_answer',
      questionKind: 'coding_question',
      seedCandidateBackground: false,
    },
  ];

  for (const scenario of cases) {
    test(scenario.name, () => {
      const expected = directTurn(scenario.input);
      const actual = resolveCanonicalTurn(scenario.input);

      assert.deepEqual(actual.answerPlan, expected.answerPlan);
      assert.deepEqual(actual.turnSourceDecision, expected.turnSourceDecision);
      assert.deepEqual(actual.turnPlan, expected.turnPlan);
      assert.equal(actual.answerPlan.answerType, scenario.answerType);
      assert.equal(actual.turnPlan.questionKind, scenario.questionKind);
      assert.equal(actual.turnPlan.answerDirectives.seedCandidateBackground, scenario.seedCandidateBackground);
      assert.deepEqual(actual.allowedEvidenceKinds, expected.turnSourceDecision.allowedEvidenceKinds);
      assert.deepEqual(actual.requiredEvidenceKinds, expected.turnSourceDecision.requiredEvidenceKinds);
      assert.equal(actual.sourceAuthority, expected.turnSourceDecision.sourceAuthority);
    });
  }
});

describe('resolveCanonicalTurn: source-contract parity', () => {
  test('an explicit JD request preserves the canonical JD-only decision', () => {
    const actual = resolveCanonicalTurn(input('What does the JD require?', 'what_to_answer', {
      explicitRequest: 'job_description',
    }));

    assert.equal(actual.turnSourceDecision.outcome, 'explicit_granted');
    assert.deepEqual(actual.allowedEvidenceKinds, ['profile_jd']);
    assert.deepEqual(actual.requiredEvidenceKinds, ['profile_jd']);
  });

  test('an explicit reference-files request preserves the direct source decision', () => {
    const request = input('What do my reference files say about this?', 'what_to_answer', {
      explicitRequest: 'reference_files',
    });
    const expected = directTurn(request);
    const actual = resolveCanonicalTurn(request);

    assert.deepEqual(actual.turnSourceDecision, expected.turnSourceDecision);
    assert.deepEqual(actual.allowedEvidenceKinds, ['reference_files']);
    assert.deepEqual(actual.requiredEvidenceKinds, ['reference_files']);
  });

  test('a strict reference mode fails closed for an explicit profile request', () => {
    const actual = resolveCanonicalTurn(input('What is my background?', 'what_to_answer', {
      sourceContract: {
        defaultOwner: 'reference_files',
        sourceAuthority: 'reference_files_only',
        allowedExplicitSwitches: ['profile'],
      },
      explicitRequest: 'profile',
    }));

    assert.equal(actual.turnSourceDecision.outcome, 'explicit_denied');
    assert.equal(actual.turnSourceDecision.owner, 'clarify');
    assert.equal(actual.turnSourceDecision.reasonCode, 'reference_files_only:strict_mode');
    assert.deepEqual(actual.allowedEvidenceKinds, []);
  });

  test('an explicitly selected unavailable JD remains unavailable without fallback', () => {
    const actual = resolveCanonicalTurn(input('What does the JD require?', 'what_to_answer', {
      explicitRequest: 'job_description',
      availability: { ...AVAILABLE, hasJobDescription: false },
    }));

    assert.equal(actual.turnSourceDecision.outcome, 'source_unavailable');
    assert.equal(actual.turnSourceDecision.reasonCode, 'job_description_unavailable');
    assert.deepEqual(actual.requiredEvidenceKinds, []);
  });

  test('a comparison preserves each requested source family', () => {
    const actual = resolveCanonicalTurn(input('Compare my resume with the JD.', 'what_to_answer', {
      explicitRequests: ['profile', 'job_description'],
    }));

    assert.equal(actual.turnSourceDecision.owner, 'mixed');
    assert.deepEqual(actual.requiredEvidenceKinds, ['profile_resume', 'projects', 'profile_jd']);
  });

  test('no persisted source contract preserves legacy null-decision compatibility', () => {
    const actual = resolveCanonicalTurn(input('What is my name?', 'manual_input', {
      sourceContract: null,
      explicitRequest: 'profile',
    }));

    assert.equal(actual.turnSourceDecision, null);
    assert.deepEqual(actual.allowedEvidenceKinds, []);
    assert.deepEqual(actual.requiredEvidenceKinds, []);
    assert.equal(actual.sourceAuthority, null);
  });
});

describe('resolveCanonicalTurn: snapshot and immutability invariants', () => {
  test('does not freeze or mutate its input, but deep-freezes a cloned decision', () => {
    const request = input('Tell me about your projects.', 'what_to_answer', {
      explicitRequests: ['profile', 'job_description'],
    });
    const original = structuredClone(request);
    const actual = resolveCanonicalTurn(request);

    assert.deepEqual(request, original, 'the facade must not mutate caller-owned snapshots');
    assert.equal(Object.isFrozen(request), false, 'the caller retains its input snapshot');
    assert.equal(Object.isFrozen(actual), true);
    assert.equal(Object.isFrozen(actual.answerPlan), true);
    assert.equal(Object.isFrozen(actual.answerPlan.requiredContextLayers), true);
    assert.equal(Object.isFrozen(actual.turnSourceDecision), true);
    assert.equal(Object.isFrozen(actual.turnSourceDecision.requiredEvidenceKinds), true);
    assert.equal(Object.isFrozen(actual.turnPlan), true);
    assert.equal(Object.isFrozen(actual.turnPlan.answerDirectives), true);

    const originalAuthority = actual.sourceAuthority;
    request.sourceContract.sourceAuthority = 'profile_only';
    request.availability.hasProfileFacts = false;
    request.explicitRequests.push('transcript');
    assert.equal(actual.sourceAuthority, originalAuthority);
    assert.deepEqual(actual.turnSourceDecision.explicitRequests, ['profile', 'job_description']);
    assert.throws(() => actual.allowedEvidenceKinds.push('meeting_rag'), TypeError);
  });
});
