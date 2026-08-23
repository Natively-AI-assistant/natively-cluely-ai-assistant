// electron/llm/__tests__/AssertLayerUsageAllowedOrThrow2026_07_25.test.mjs
//
// Phase 6 Slice 4 (context-rebuild): pre-required test for item 4 — "A test
// asserting the new dev-mode CI assertion fires on a deliberately-
// constructed violation (a mock retrieval call using a forbidden layer) and
// does not fire on a compliant one — this is the regression guard for the
// 'required, not optional' review requirement."

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);
const { assertLayerUsageAllowedOrThrow } = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/llm/contextRoute.js'));
const { planAnswer } = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/llm/AnswerPlanner.js'));

function clearVerificationMode() {
  delete process.env.NATIVELY_VERIFICATION_MODE;
}

describe('assertLayerUsageAllowedOrThrow — the required (not optional) Slice 4 CI assertion', () => {
  beforeEach(clearVerificationMode);
  afterEach(clearVerificationMode);

  test('is a complete NO-OP when verification mode is off (default) — even on a real violation', () => {
    const plan = planAnswer({ question: 'Solve two sum.', source: 'what_to_answer', speakerPerspective: 'interviewer' });
    assert.equal(plan.answerType, 'dsa_question_answer');
    // resume is forbidden for dsa_question_answer — a genuine violation if used.
    assert.doesNotThrow(() => assertLayerUsageAllowedOrThrow(plan, 'resume', 'test violation'));
  });

  test('THROWS when verification mode is on and a forbidden layer was used (the deliberate violation)', () => {
    process.env.NATIVELY_VERIFICATION_MODE = '1';
    const plan = planAnswer({ question: 'Solve two sum.', source: 'what_to_answer', speakerPerspective: 'interviewer' });
    assert.throws(
      () => assertLayerUsageAllowedOrThrow(plan, 'resume', 'mock retrieval call'),
      /LayerUsageViolation/,
    );
  });

  test('does NOT throw when verification mode is on and the layer IS allowed (compliant case)', () => {
    process.env.NATIVELY_VERIFICATION_MODE = '1';
    const plan = planAnswer({ question: 'Tell me about yourself.', source: 'manual_input', speakerPerspective: 'user' });
    assert.equal(plan.answerType, 'identity_answer');
    // resume IS allowed for identity_answer.
    assert.doesNotThrow(() => assertLayerUsageAllowedOrThrow(plan, 'resume', 'compliant retrieval'));
  });

  test('the thrown error message names the layer and answerType (actionable, not opaque)', () => {
    process.env.NATIVELY_VERIFICATION_MODE = '1';
    const plan = planAnswer({ question: 'Explain BFS.', source: 'what_to_answer', speakerPerspective: 'interviewer' });
    assert.throws(() => assertLayerUsageAllowedOrThrow(plan, 'resume'), (err) => {
      assert.match(err.message, /resume/);
      assert.match(err.message, /technical_concept_answer/);
      return true;
    });
  });

  test('NATIVELY_VERIFICATION_MODE=0 (explicit off) is also a no-op, mirroring assertVerificationFlagsOrThrow\'s convention', () => {
    process.env.NATIVELY_VERIFICATION_MODE = '0';
    const plan = planAnswer({ question: 'Solve two sum.', source: 'what_to_answer', speakerPerspective: 'interviewer' });
    assert.doesNotThrow(() => assertLayerUsageAllowedOrThrow(plan, 'resume'));
  });
});
