// electron/llm/__tests__/CanonicalTurnPrecedenceRule2026_07_25.test.mjs
//
// Phase 6 Slice 3 (context-rebuild, docs/context-rebuild/05_MIGRATION_PLAN.md
// "Slice 3"): pre-required tests for CanonicalTurn's explicit precedence
// rule between `answerPlan.answerType` and `turnPlan.questionKind`, its
// `turnId` field, and the try/catch fallback around the internal `planTurn`
// call (target arch §0 items 1/3).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);
const { resolveCanonicalTurn } = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/llm/resolveCanonicalTurn.js'));
const { mapAnswerTypeToQuestionKind } = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/llm/TurnPlanner.js'));
const { mintTurnId } = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/llm/turnIdentity.js'));

const AVAILABLE = {
  hasReferenceFiles: true,
  hasProfileFacts: true,
  hasJobDescription: true,
  hasLiveTranscript: true,
  hasMeetingRag: true,
};

function baseInput(question, overrides = {}) {
  return {
    answerInput: {
      question,
      source: 'manual_input',
      hasCandidateProfile: true,
      hasJobDescription: true,
    },
    availability: AVAILABLE,
    ...overrides,
  };
}

describe('mapAnswerTypeToQuestionKind (the fallback-branch helper)', () => {
  test('maps each of the 4 direct-bucket families correctly', () => {
    assert.equal(mapAnswerTypeToQuestionKind('identity_answer'), 'profile_question');
    assert.equal(mapAnswerTypeToQuestionKind('jd_fit_answer'), 'jd_question');
    assert.equal(mapAnswerTypeToQuestionKind('coding_question_answer'), 'coding_question');
    assert.equal(mapAnswerTypeToQuestionKind('technical_concept_answer'), 'coding_question');
    assert.equal(mapAnswerTypeToQuestionKind('lecture_answer'), 'doc_question');
  });

  test('returns null for answer types with no direct bucket (e.g. sales_answer, follow_up_answer)', () => {
    assert.equal(mapAnswerTypeToQuestionKind('sales_answer'), null);
    assert.equal(mapAnswerTypeToQuestionKind('follow_up_answer'), null);
  });

  test('returns null for null/undefined input', () => {
    assert.equal(mapAnswerTypeToQuestionKind(null), null);
    assert.equal(mapAnswerTypeToQuestionKind(undefined), null);
  });
});

describe('CanonicalTurn.turnId (target arch §0 item 1)', () => {
  test('a caller-supplied turnId is threaded through verbatim', () => {
    const identity = mintTurnId();
    const turn = resolveCanonicalTurn(baseInput('Tell me about yourself.', { turnId: identity }));
    assert.equal(turn.turnId, identity);
  });

  test('omitting turnId mints a fresh one (legacy callers, e.g. the WTA observe-only path)', () => {
    const a = resolveCanonicalTurn(baseInput('Tell me about yourself.'));
    const b = resolveCanonicalTurn(baseInput('Tell me about yourself.'));
    assert.equal(typeof a.turnId, 'string');
    assert.ok(a.turnId.length > 0);
    assert.notEqual(a.turnId, b.turnId, 'each call without an explicit turnId mints its own');
  });
});

describe('precedence rule: turnPlan.questionKind wins on success (it already reconciles with answerType internally)', () => {
  test('a real question resolves resolvedQuestionKind from the successful turnPlan, sourced turn_plan', () => {
    const turn = resolveCanonicalTurn(baseInput('Implement an LRU cache.'));
    assert.equal(turn.turnPlanFailed, false);
    assert.equal(turn.resolvedQuestionKindSource, 'turn_plan');
    assert.equal(turn.resolvedQuestionKind, turn.turnPlan.questionKind);
  });

  test('the previously-buggy technical_concept_answer case now resolves to coding_question via turnPlan, not general', () => {
    // Regression guard for the CODING_TYPE_SET fix found while building this
    // precedence rule (TurnPlanner.ts was missing 'technical_concept_answer').
    const turn = resolveCanonicalTurn(baseInput('Explain BFS.'));
    assert.equal(turn.answerPlan.answerType, 'technical_concept_answer');
    assert.equal(turn.resolvedQuestionKind, 'coding_question');
    assert.equal(turn.resolvedQuestionKindSource, 'turn_plan');
  });
});

describe('precedence rule: answerPlan.answerType is authoritative when turnPlan computation FAILS', () => {
  test('a malformed availability snapshot (null) makes the internal planTurn call throw; resolveCanonicalTurn does not propagate the throw', () => {
    // No sourceContract, so turnSourceDecision is skipped (never reads
    // `availability`) and answerPlan computes fine (planAnswer does not
    // take availability at all) — the ONLY thing that touches
    // `input.availability` is the internal planTurn() call this precedence
    // rule wraps in a try/catch. A null availability snapshot is a
    // realistic malformed-caller scenario, not a contrived mock.
    const brokenInput = baseInput('Have you used WebRTC?', { availability: null });
    assert.doesNotThrow(() => resolveCanonicalTurn(brokenInput));
  });

  test('when planTurn fails, turnPlanFailed=true and resolvedQuestionKind falls back to answerPlan.answerType via mapAnswerTypeToQuestionKind', () => {
    const brokenInput = baseInput('Have you used WebRTC?', { availability: null });
    const turn = resolveCanonicalTurn(brokenInput);
    assert.equal(turn.turnPlanFailed, true);
    assert.equal(turn.resolvedQuestionKindSource, 'answer_plan_fallback');
    // "Have you used WebRTC?" resolves to skill_experience_answer (a
    // PROFILE_TYPE_SET member) — the fallback must reflect that, not the
    // safe-default TurnPlan's own hardcoded 'general' questionKind field.
    assert.equal(turn.answerPlan.answerType, 'skill_experience_answer');
    assert.equal(turn.resolvedQuestionKind, 'profile_question');
  });

  test('the safe fallback TurnPlan itself is a fully-shaped, non-null object — every field is still readable', () => {
    const brokenInput = baseInput('Have you used WebRTC?', { availability: null });
    const turn = resolveCanonicalTurn(brokenInput);
    assert.equal(turn.turnPlan.questionKind, 'general');
    assert.equal(turn.turnPlan.reasonCode, 'turn_plan_failed_safe_fallback');
    assert.deepEqual(turn.turnPlan.evidenceSourcesToProbe, []);
    assert.equal(turn.turnPlan.answerDirectives.seedCandidateBackground, false);
    assert.equal(turn.turnPlan.groundingProfile.evidencePreference, 'preferred');
  });

  test('a fallback answerType with NO direct bucket (e.g. sales_answer) resolves to general, not a thrown error', () => {
    const brokenInput = baseInput('Why is your product expensive?', { availability: null });
    const turn = resolveCanonicalTurn(brokenInput);
    assert.equal(turn.turnPlanFailed, true);
    assert.equal(turn.answerPlan.answerType, 'sales_answer');
    assert.equal(turn.resolvedQuestionKind, 'general');
  });
});
