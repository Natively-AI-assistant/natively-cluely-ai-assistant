// electron/llm/__tests__/DocGroundedGateAgreement2026_08_13.test.mjs
//
// Four separate gates decide "this turn answers from documents", and they had
// drifted apart:
//
//   1. forced retrieval  — IntelligenceEngine `docGroundedEnforcementActive`
//                          (R1): strict contract OR doc mode WITH files
//   2. answer-shape routing — AnswerPlanner
//   3. the grounding instruction in the prompt — AnswerPlanner policyLine
//   4. the post-stream zero-fabrication validator — needs (1) AND files AND a
//      doc-shaped answerType from (2)
//
// Measured on main before this suite existed, for a template-seeded mode the
// user had uploaded a file into (origin stays 'default_new_mode' so strict is
// false, but files exist so enforcement is true):
//
//   lecture:    retrieval ON, doc shape ON (via the mode fallback), validator
//               ON — and the grounding instruction OFF. The model was handed a
//               document context block and graded by the zero-fabrication
//               validator while its prompt never told it to ground anything.
//   team_meet:  retrieval ON, doc shape OFF, validator OFF. R1's own stated
//               goal — restoring the validator for seeded modes WITH files —
//               was unmet, because the validator also needs a doc-shaped
//               answerType that routing never produced.
//
// The invariant below is the one that matters and the one that was false:
// a turn is told to answer from documents exactly when it is made to retrieve
// them. Isolation is deliberately NOT part of this: it stays authority-only
// (true before the first upload) and is asserted separately.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planAnswer, formatAnswerPlanForPrompt } from '../../../dist-electron/electron/llm/index.js';
import { isDocGroundedAnswerType } from '../../../dist-electron/electron/llm/documentGroundedPrompt.js';

const mode = (o) => ({ id: 'm', name: 'M', isCustom: false, hasCustomPrompt: false, ...o });

/** The engine's predicate, mirrored so drift in either copy fails here. */
const enforcementOf = (m) => m.strictDocumentGroundedActive === true
  || (m.documentGroundedCustomModeActive === true && m.hasReferenceFiles === true);

const CASES = [
  ['template-seeded lecture WITH an uploaded file', mode({
    templateType: 'lecture', hasReferenceFiles: true, documentGrounded: true,
    documentGroundedCustomModeActive: true, strictDocumentGroundedActive: false,
  })],
  ['template-seeded lecture with NO files', mode({
    templateType: 'lecture', hasReferenceFiles: false, documentGrounded: false,
    documentGroundedCustomModeActive: true, strictDocumentGroundedActive: false,
  })],
  ['template-seeded team_meet WITH an uploaded file', mode({
    templateType: 'team_meet', hasReferenceFiles: true, documentGrounded: true,
    documentGroundedCustomModeActive: true, strictDocumentGroundedActive: false,
  })],
  ['template-seeded team_meet with NO files', mode({
    templateType: 'team_meet', hasReferenceFiles: false, documentGrounded: false,
    documentGroundedCustomModeActive: true, strictDocumentGroundedActive: false,
  })],
  ['user-selected strict contract WITH files', mode({
    templateType: 'lecture', hasReferenceFiles: true, documentGrounded: true,
    documentGroundedCustomModeActive: true, strictDocumentGroundedActive: true,
  })],
  ['a non-document mode', mode({
    templateType: 'general', hasReferenceFiles: false, documentGrounded: false,
    documentGroundedCustomModeActive: false, strictDocumentGroundedActive: false,
  })],
];

const QUESTION = {
  question: 'What does the paper say about batch size?',
  source: 'manual_input',
  speakerPerspective: 'user',
};

const GROUNDING_LINE = /uploaded\/reference files/;

describe('the doc-grounding gates agree with each other', () => {
  for (const [name, m] of CASES) {
    test(`${name}: the prompt instructs grounding exactly when retrieval is forced`, () => {
      const plan = planAnswer({ ...QUESTION, activeMode: m });
      const prompt = formatAnswerPlanForPrompt(plan);
      assert.equal(
        GROUNDING_LINE.test(prompt), enforcementOf(m),
        enforcementOf(m)
          ? 'retrieval is forced for this mode, so the model must be told to ground its answer'
          : 'nothing is retrieved for this mode, so the prompt must not claim uploaded material exists',
      );
    });
  }

  test('the plan publishes the enforcement predicate for downstream consumers', () => {
    for (const [name, m] of CASES) {
      const plan = planAnswer({ ...QUESTION, activeMode: m });
      assert.equal(plan.docGroundedEnforcementActive, enforcementOf(m), name);
    }
  });

  test('a doc mode WITH files reaches a doc-shaped answer, so the validator can run', () => {
    // The post-stream zero-fabrication validator needs enforcement AND files
    // AND a doc-shaped answerType. team_meet is the case that failed: routing
    // keyed on strict, which a template seed never sets.
    for (const templateType of ['lecture', 'team_meet', 'seminar']) {
      const plan = planAnswer({ ...QUESTION, activeMode: mode({
        templateType, hasReferenceFiles: true, documentGrounded: true,
        documentGroundedCustomModeActive: true, strictDocumentGroundedActive: false,
      }) });
      assert.ok(isDocGroundedAnswerType(plan.answerType),
        `${templateType} with files must reach a doc-grounded shape, got ${plan.answerType}`);
    }
  });

  test('ISOLATION stays authority-only — it must NOT wait for an upload', () => {
    // The 2026-07-15 invariant, and the thing two separate fixes have broken.
    // A doc mode suppresses résumé/JD from the moment it exists.
    const plan = planAnswer({ ...QUESTION, activeMode: mode({
      templateType: 'team_meet', hasReferenceFiles: false, documentGrounded: false,
      documentGroundedCustomModeActive: true, strictDocumentGroundedActive: false,
    }) });
    assert.equal(plan.documentGroundedCustomModeActive, true,
      'plan-level isolation must stay broad — narrowing it re-opens résumé injection');
  });

  test('a fileless doc mode is never told to refuse against uploaded material', () => {
    // Bug 001 (2026-08-05). This is the failure the strict gate was introduced
    // to prevent, and it must survive the reconciliation above.
    for (const templateType of ['lecture', 'team_meet', 'seminar']) {
      const plan = planAnswer({ ...QUESTION, activeMode: mode({
        templateType, hasReferenceFiles: false, documentGrounded: false,
        documentGroundedCustomModeActive: true, strictDocumentGroundedActive: false,
      }) });
      assert.doesNotMatch(formatAnswerPlanForPrompt(plan), /not in the uploaded material/i,
        `${templateType} with zero files must not carry the uploaded-material refusal instruction`);
    }
  });

  test('a mode-blind turn is unaffected', () => {
    const plan = planAnswer({ ...QUESTION, activeMode: null });
    assert.equal(plan.docGroundedEnforcementActive, false);
    assert.doesNotMatch(formatAnswerPlanForPrompt(plan), GROUNDING_LINE);
  });
});
