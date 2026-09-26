// electron/llm/__tests__/HistoryGrantExhaustiveness2026_07_25.test.mjs
//
// Phase 6 Slice 2 (context-rebuild) pre-required tests, parts 3 and 4 of the
// slice's "what changes" list:
//
//   (3) compile-time/test exhaustiveness check: isLayerAllowed's fail-closed
//       rule for `prior_assistant_responses` (contextRoute.ts) must hold for
//       EVERY real AnswerType — no answerType may silently fall through to
//       fail-open allow just because it's absent from both
//       forbiddenContextLayers and requiredContextLayers.
//   (4) regression guard: answer types that LEGITIMATELY need
//       prior_assistant_responses (project_followup_answer; follow_up_answer
//       when NOT document-grounded) must still be granted it — the fail-
//       closed flip must not silently break real pronoun follow-up
//       continuity (Baseline §4.2 row 9, "What about its scaling limits?").
//
// requiredLayersFor/forbiddenLayersFor were exported from AnswerPlanner.ts
// specifically to make this exhaustive, direct iteration possible (see their
// export comments) — reverse-engineering a question per AnswerType via
// planAnswer would be fragile and indirect for a check that needs to cover
// every one of the 38 real AnswerType values.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);
const { requiredLayersFor, forbiddenLayersFor } = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/llm/AnswerPlanner.js'));
const { isLayerAllowed } = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/llm/contextRoute.js'));

// The full, real AnswerType union (AnswerPlanner.ts:9-58) — kept as an
// explicit literal list (not re-derived) so this test independently confirms
// coverage rather than trusting the same source it is checking.
const ALL_ANSWER_TYPES = [
  'identity_answer', 'profile_fact_answer', 'project_answer', 'skills_answer',
  'skill_experience_answer', 'experience_answer', 'jd_fit_answer', 'gap_analysis_answer',
  'jd_summary_answer', 'jd_requirements_answer', 'jd_fact_answer',
  'resume_jd_fit_answer', 'resume_jd_gap_answer', 'resume_jd_intro_answer',
  'behavioral_interview_answer', 'project_followup_answer',
  'coding_question_answer', 'dsa_question_answer', 'technical_concept_answer',
  'system_design_answer', 'debugging_question_answer',
  'negotiation_answer', 'sales_answer', 'product_candidate_mix_answer',
  'lecture_answer', 'definitional_answer', 'list_answer', 'exact_numeric_answer',
  'document_structure_answer', 'document_absent_fact_refusal', 'document_followup_answer',
  'follow_up_answer', 'unknown_answer', 'general_meeting_answer',
  'project_link_answer', 'source_code_evidence_answer', 'ethical_usage_answer',
  'project_about_answer',
];

// Answer types with a LEGITIMATE, explicit need for prior_assistant_responses
// (requiredLayersFor lists it). project_followup_answer always requires it;
// follow_up_answer requires it only when NOT document-grounded.
const LEGITIMATE_NEED = new Set(['project_followup_answer', 'follow_up_answer']);

function buildPlan(answerType, documentGroundedCustomModeActive = false) {
  return {
    answerType,
    requiredContextLayers: requiredLayersFor(answerType, documentGroundedCustomModeActive),
    forbiddenContextLayers: forbiddenLayersFor(answerType),
    documentGroundedCustomModeActive,
  };
}

describe('exhaustiveness: isLayerAllowed(plan, "prior_assistant_responses") is decisive for every real AnswerType', () => {
  test('the literal ALL_ANSWER_TYPES list matches AnswerPlanner.ts\'s real union size (38) — a drift guard for this file itself', () => {
    assert.equal(ALL_ANSWER_TYPES.length, 38, 'update this list if AnswerType gains/loses members in AnswerPlanner.ts');
  });

  for (const answerType of ALL_ANSWER_TYPES) {
    if (LEGITIMATE_NEED.has(answerType)) continue; // covered by the "legitimate need" describe block below
    test(`${answerType}: prior_assistant_responses is NOT allowed by default (fail-closed, no silent fail-open)`, () => {
      const plan = buildPlan(answerType);
      assert.equal(
        isLayerAllowed(plan, 'prior_assistant_responses'),
        false,
        `${answerType} has no explicit need for prior_assistant_responses — isLayerAllowed must fail closed, not fall through to allow`,
      );
    });
  }
});

describe('legitimate need: answer types that explicitly require prior_assistant_responses still get it', () => {
  test('project_followup_answer is granted prior_assistant_responses (drill-in on "it"/"that")', () => {
    const plan = buildPlan('project_followup_answer');
    assert.ok(plan.requiredContextLayers.includes('prior_assistant_responses'));
    assert.equal(isLayerAllowed(plan, 'prior_assistant_responses'), true);
  });

  test('project_followup_answer stays granted even inside a document-grounded custom mode (its requirement does not depend on that flag)', () => {
    const plan = buildPlan('project_followup_answer', true);
    assert.equal(isLayerAllowed(plan, 'prior_assistant_responses'), true);
  });

  test('follow_up_answer (NOT document-grounded) is granted prior_assistant_responses — the real pronoun-follow-up path (Baseline §4.2 row 9)', () => {
    const plan = buildPlan('follow_up_answer', false);
    assert.ok(plan.requiredContextLayers.includes('prior_assistant_responses'));
    assert.equal(isLayerAllowed(plan, 'prior_assistant_responses'), true);
  });

  test('follow_up_answer INSIDE a document-grounded custom mode is now correctly DENIED prior_assistant_responses — a second RC3-shaped gap this exhaustiveness check discovered', () => {
    // requiredLayersFor deliberately drops prior_assistant_responses from the
    // follow_up_answer required set when documentGroundedCustomModeActive is
    // true (AnswerPlanner.ts's own comment: "otherwise become truth on the
    // next follow-up"), but forbiddenLayersFor never added it to forbidden
    // for this case either — so before this slice's isLayerAllowed fix, this
    // exact combination silently fell through to fail-open ALLOW, directly
    // contradicting the code's own stated intent. The fail-closed rule now
    // makes the enforcement match the documented intent.
    const plan = buildPlan('follow_up_answer', true);
    assert.ok(!plan.requiredContextLayers.includes('prior_assistant_responses'));
    assert.equal(isLayerAllowed(plan, 'prior_assistant_responses'), false);
  });
});
