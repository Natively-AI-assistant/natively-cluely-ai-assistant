import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  planAnswer,
  buildContextRoute,
  isLayerAllowed,
  shouldScaffold,
  formatAnswerPlanForPrompt,
} from '../../../dist-electron/electron/llm/index.js';

const SEMINAR_MODE = {
  id: 'mode_seminar_presentation',
  templateType: 'general',
  name: 'Seminar Presentation Assistant',
  isCustom: true,
  hasReferenceFiles: true,
  hasCustomPrompt: true,
  documentGrounded: true,
  documentGroundedCustomModeActive: true,
};

function seminarPlan(question) {
  return planAnswer({
    question,
    source: 'what_to_answer',
    speakerPerspective: 'interviewer',
    activeMode: SEMINAR_MODE,
  });
}

describe('documentGroundedCustomModeActive planner guard', () => {
  test('four-part runtime flag changes normal thesis questions to document/lecture grounding', () => {
    const plan = seminarPlan('What problem is this thesis trying to solve?');
    assert.equal(plan.documentGroundedCustomModeActive, true);
    assert.equal(plan.answerType, 'lecture_answer');
    assert.equal(isLayerAllowed(plan, 'reference_files'), true);
    assert.equal(shouldScaffold(plan.answerType), false);
  });

  const nonCodingThesisQuestions = [
    'What problem is this thesis trying to solve?',
    'What are the four main phases of the project?',
    'Explain the MSE metric in the AgenticVLA evaluation',
    'What is Success Rate as a performance metric?',
    'Describe the ROS# middleware integration',
    'Summarize the AgenticVLA architecture',
    'What is LoRA fine-tuning?',
    'What happened in the prompt complexity analysis?',
  ];

  for (const question of nonCodingThesisQuestions) {
    test(`${question}: no coding contract, profile suppression, reference required`, () => {
      const plan = seminarPlan(question);
      const route = buildContextRoute(plan);
      assert.notEqual(plan.answerType, 'coding_question_answer');
      assert.notEqual(plan.answerType, 'dsa_question_answer');
      assert.equal(shouldScaffold(plan.answerType), false);
      assert.equal(plan.shouldShowImmediateScaffold, false);
      assert.ok(route.selectedLayers.includes('reference_files'), 'reference_files must be selected');
      for (const layer of ['resume', 'jd', 'negotiation']) {
        assert.equal(isLayerAllowed(plan, layer), false, `${layer} must be suppressed`);
        assert.ok(route.excludedLayers.includes(layer), `${layer} must be excluded`);
      }
      const prompt = formatAnswerPlanForPrompt(plan, false);
      assert.match(prompt, /uploaded\/reference files/i);
      assert.doesNotMatch(prompt, /## Approach|## Code|## Dry Run|## Complexity/);
    });
  }

  test('explicit code asks may remain coding but still allow reference files in document-grounded custom mode', () => {
    const plan = seminarPlan('Can you write code for the algorithm described in the uploaded thesis?');
    assert.ok(['coding_question_answer', 'dsa_question_answer', 'source_code_evidence_answer', 'lecture_answer'].includes(plan.answerType));
    assert.equal(isLayerAllowed(plan, 'reference_files'), true);
  });

  test('profile context is only allowed when explicitly requested', () => {
    const plan = seminarPlan('How does this compare with my resume projects?');
    assert.equal(plan.documentGroundedCustomModeActive, true);
    assert.equal(isLayerAllowed(plan, 'reference_files'), true);
    assert.equal(isLayerAllowed(plan, 'resume'), true, 'explicit resume request may use resume');
  });
});
