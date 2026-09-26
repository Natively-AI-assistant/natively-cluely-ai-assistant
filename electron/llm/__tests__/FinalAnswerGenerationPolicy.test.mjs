import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  evaluateFinalAnswerPolicy,
  assertNoForbiddenFinalAnswerPath,
  legacyFastPathToForbiddenPath,
  finalAnswerRequiresProvider,
  decideSessionWritePolicy,
} = require('../../../dist-electron/electron/llm/FinalAnswerGenerationPolicy.js');

describe('FinalAnswerGenerationPolicy', () => {
  test('allows JIT user-visible answers only when provider was used and exact question is present', () => {
    const trace = evaluateFinalAnswerPolicy({
      mode: 'jit_llm',
      providerUsed: true,
      exactQuestionIncluded: true,
      userVisible: true,
      usedDeterministicEvidenceSelection: true,
      sourceContractHonored: true,
    });
    assert.equal(trace.finalGenerationMode, 'jit_llm');
    assert.equal(trace.providerUsed, true);
    assert.equal(trace.exactQuestionIncluded, true);
    assert.equal(trace.usedDeterministicEvidenceSelection, true);
    assert.equal(trace.violation, undefined);
  });

  test('rejects deterministic/profile fast-path final answers', () => {
    const trace = evaluateFinalAnswerPolicy({
      mode: 'jit_llm',
      providerUsed: false,
      exactQuestionIncluded: true,
      userVisible: true,
      forbiddenFinalAnswerPath: legacyFastPathToForbiddenPath(true),
    });
    assert.equal(trace.violation, 'forbidden_final_answer_path_detected');
    assert.equal(trace.forbiddenFinalAnswerPath, 'deterministic_fast_path');
    assert.throws(() => assertNoForbiddenFinalAnswerPath({
      mode: 'jit_llm',
      providerUsed: false,
      exactQuestionIncluded: true,
      userVisible: true,
      forbiddenFinalAnswerPath: 'template_final_answer',
    }), /forbidden_final_answer_path_detected/);
  });

  test('JIT modes require provider and exact question; source-safe failures do not', () => {
    assert.equal(finalAnswerRequiresProvider('jit_llm'), true);
    assert.equal(finalAnswerRequiresProvider('jit_llm_repaired'), true);
    assert.equal(finalAnswerRequiresProvider('source_safe_refusal'), false);
    assert.equal(finalAnswerRequiresProvider('provider_error_no_answer'), false);

    assert.equal(evaluateFinalAnswerPolicy({ mode: 'jit_llm', providerUsed: false, exactQuestionIncluded: true, userVisible: true }).violation, 'provider_not_used_for_user_visible_answer');
    assert.equal(evaluateFinalAnswerPolicy({ mode: 'jit_llm', providerUsed: true, exactQuestionIncluded: false, userVisible: true }).violation, 'exact_question_missing_from_final_prompt');
    assert.equal(evaluateFinalAnswerPolicy({ mode: 'source_safe_refusal', providerUsed: false, exactQuestionIncluded: false, userVisible: true }).violation, undefined);
  });

  test('session write policy blocks provider failures and critical validation failures', () => {
    assert.deepEqual(decideSessionWritePolicy({ finalGenerationMode: 'provider_error_no_answer' }), {
      policy: 'do_not_store',
      blockedFromSessionTracker: true,
      reason: 'provider_error_no_answer',
    });

    const critical = decideSessionWritePolicy({ finalGenerationMode: 'jit_llm', validationOk: false, criticalViolations: ['assistant_identity_leak'] });
    assert.equal(critical.policy, 'do_not_store');
    assert.equal(critical.blockedFromSessionTracker, true);
    assert.match(critical.reason, /critical_validation_failed/);

    const ok = decideSessionWritePolicy({ finalGenerationMode: 'jit_llm', validationOk: true, sourceContractHonored: true });
    assert.equal(ok.policy, 'store_conversational_only');
    assert.equal(ok.blockedFromSessionTracker, false);
  });
});
