// electron/llm/__tests__/HackerRankScreenAssessmentInstruction2026_10_22.test.mjs
//
// Regression test for issue #647:
// [Bug]: Ctrl+H intermittently refuses HackerRank solutions
//
// On screenshot captures (Ctrl+H), vision models see browser chrome, background tabs
// (e.g. "HackerRank Test Login"), timers, and platform headers. Prompt instructions
// must explicitly instruct models to solve coding problems on assessment and practice
// platforms (HackerRank, LeetCode, etc.) without declining as live tests.
// The validator must also flag assessment refusals on coding turns.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  isAssessmentRefusal,
  validateAnswerStructure,
} from '../../../dist-electron/electron/llm/index.js';

const REPO_ROOT = process.cwd();

describe('Issue #647: Assessment and challenge screen solution instructions', () => {
  test('SCREEN_DIRECT_VISION_INSTRUCTION instructs solving assessment and challenge problems', () => {
    const src = fs.readFileSync(path.resolve(REPO_ROOT, 'electron/llm/WhatToAnswerLLM.ts'), 'utf8');
    assert.match(
      src,
      /HackerRank|LeetCode|assessment/i,
      'WhatToAnswerLLM.ts must mention assessment platforms in screen instructions',
    );
    assert.ok(
      src.includes('live test') || src.includes('assessment'),
      'WhatToAnswerLLM.ts must address live tests or assessments',
    );
  });

  test('SCREEN_DOM_INSTRUCTION inherits assessment instructions', () => {
    const src = fs.readFileSync(path.resolve(REPO_ROOT, 'electron/llm/WhatToAnswerLLM.ts'), 'utf8');
    assert.ok(
      src.includes('export const SCREEN_DOM_INSTRUCTION = SCREEN_DIRECT_VISION_INSTRUCTION'),
      'SCREEN_DOM_INSTRUCTION must be derived from SCREEN_DIRECT_VISION_INSTRUCTION',
    );
  });

  test('universalCodingRules instructs solving problems on assessment and practice platforms', () => {
    const src = fs.readFileSync(path.resolve(REPO_ROOT, 'electron/llm/promptSystemV2.ts'), 'utf8');
    assert.match(
      src,
      /assessment.*platform|practice.*platform|HackerRank|LeetCode/i,
      'promptSystemV2.ts universalCodingRules must cover assessment platforms',
    );
  });

  test('prompts.ts security section clarifies coding tasks are not evasion requests', () => {
    const src = fs.readFileSync(path.resolve(REPO_ROOT, 'electron/llm/prompts.ts'), 'utf8');
    assert.match(
      src,
      /HackerRank|LeetCode|live test/i,
      'prompts.ts security block must clarify assessment coding tasks are supported',
    );
  });

  test('isAssessmentRefusal identifies test and assessment refusal phrases', () => {
    const issue647Refusal = "I can't provide a solution for a live HackerRank test. I can explain the dynamic array algorithm or help you practice with a similar problem outside the assessment.";
    const variantRefusal = "I cannot provide solutions during an active LeetCode contest or assessment.";
    const validCodingSolution = [
      '## Approach',
      'Use a 2D dynamic array and compute indices with XOR.',
      '## Code',
      '```python',
      'def dynamicArray(n, queries):',
      '    arr = [[] for _ in range(n)]',
      '    lastAnswer = 0',
      '    answers = []',
      '    return answers',
      '```',
      '## Complexity',
      '- Time Complexity: O(q)',
      '- Space Complexity: O(n + q)',
    ].join('\n');

    assert.equal(isAssessmentRefusal(issue647Refusal), true);
    assert.equal(isAssessmentRefusal(variantRefusal), true);
    assert.equal(isAssessmentRefusal(validCodingSolution), false);
    assert.equal(isAssessmentRefusal(''), false);
  });

  test('validateAnswerStructure rejects assessment refusals on coding turns', () => {
    const issue647Refusal = "I can't provide a solution for a live HackerRank test. I can explain the dynamic array algorithm or help you practice with a similar problem outside the assessment.";
    const resultDsa = validateAnswerStructure('dsa_question_answer', issue647Refusal);
    assert.equal(resultDsa.ok, false);
    assert.equal(resultDsa.hasCodeBlock, false);

    const resultImpl = validateAnswerStructure('coding_question_answer', issue647Refusal);
    assert.equal(resultImpl.ok, false);
    assert.equal(resultImpl.hasCodeBlock, false);

    const resultShaped = validateAnswerStructure('dsa_question_answer', issue647Refusal, null, 'solve');
    assert.equal(resultShaped.ok, false);
    assert.equal(resultShaped.hasCodeBlock, false);
  });

  test('validateAnswerStructure accepts valid coding solutions', () => {
    const validCodingSolution = [
      '## Approach',
      'Use a 2D dynamic array and compute indices with XOR.',
      '## Code',
      '```python',
      'def dynamicArray(n, queries):',
      '    arr = [[] for _ in range(n)]',
      '    lastAnswer = 0',
      '    answers = []',
      '    return answers',
      '```',
      '## Complexity',
      '- Time Complexity: O(q)',
      '- Space Complexity: O(n + q)',
    ].join('\n');

    const result = validateAnswerStructure('dsa_question_answer', validCodingSolution, null, 'solve');
    assert.equal(result.ok, true);
    assert.equal(result.hasCodeBlock, true);
  });

  test('promoted screen coding turns wire effectiveAnswerType in IntelligenceEngine', () => {
    const engineSrc = fs.readFileSync(path.resolve(REPO_ROOT, 'electron/IntelligenceEngine.ts'), 'utf8');
    assert.ok(
      engineSrc.includes('const effectiveAnswerType: AnswerType = (wtaPromotedScreenCoding && !isCodingAnswerType(answerPlan.answerType))'),
      'IntelligenceEngine.ts must compute effectiveAnswerType for promoted turns',
    );
    assert.ok(
      engineSrc.includes('validateAnswerStructure(\n                effectiveAnswerType'),
      'IntelligenceEngine.ts must pass effectiveAnswerType to validateAnswerStructure',
    );
  });

  test('no em dashes in updated prompt files or instructions', () => {
    const filesToCheck = [
      'electron/llm/WhatToAnswerLLM.ts',
      'electron/llm/promptSystemV2.ts',
      'electron/llm/prompts.ts',
      'electron/llm/AnswerValidator.ts',
      'electron/IntelligenceEngine.ts',
    ];
    for (const rel of filesToCheck) {
      const content = fs.readFileSync(path.resolve(REPO_ROOT, rel), 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('HackerRank') || line.includes('live test') || line.includes('effectiveCodingTaskKind')) {
          assert.ok(!line.includes('—'), `Em dash found on line ${i + 1} of ${rel}: ${line}`);
        }
      }
    }
  });
});
