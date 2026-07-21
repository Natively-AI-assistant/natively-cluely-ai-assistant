// electron/llm/__tests__/CodingContractExplicit2026_06_15.test.mjs
//
// Regression coverage for the manual-session coding bugs (task Phase 11, 2026-06-15):
//   #5/#7  "Write code only for Two Sum in Python" returned the full six-section DSA
//          template, because the prompt always injected the six-section contract AND the
//          post-stream repair always forced every heading back in.
//   #6     "Give time and space complexity" after a Two Sum answer lost the prior problem.
//
// These tests pin the deterministic decision layer (codingFollowup.ts) and the
// contract-aware repair (AnswerValidator.validateAnswerStructure) against the compiled
// dist-electron output — the same artifact the live ipcHandlers path runs.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  detectExplicitCodingContract,
  isCodingContinuation,
  buildCodingContractPrompt,
  buildPriorCodingContextBlock,
  explicitContractProducesCode,
  validateAnswerStructure,
} from '../../../dist-electron/electron/llm/index.js';

describe('detectExplicitCodingContract — explicit format constraints', () => {
  const cases = [
    ['Write code only for Two Sum in Python.', 'code_only'],
    ['Just the code please.', 'code_only'],
    ['Only give me the code.', 'code_only'],
    ['code and nothing else', 'code_only'],
    ['Give time and space complexity.', 'complexity_only'],
    ['What is the time and space complexity?', 'complexity_only'],
    ['complexity?', 'complexity_only'],
    ['big-O?', 'complexity_only'],
    ['Dry run this with [2,7,11,15], target 9.', 'dry_run_only'],
    ['Trace through the code.', 'dry_run_only'],
    ['Walk me through the execution.', 'dry_run_only'],
    ['Explain BFS without code.', 'explain_only'],
    ["Don't write code, just explain.", 'explain_only'],
    ['Explain it conceptually.', 'explain_only'],
    // No explicit constraint → default six-section contract governs.
    ['Solve the Two Sum problem.', null],
    ['Write a function to reverse a linked list.', null],
    ['How would you find the longest substring without repeating characters?', null],
  ];
  for (const [q, expected] of cases) {
    test(`"${q}" → ${expected}`, () => {
      assert.equal(detectExplicitCodingContract(q), expected);
    });
  }
});

describe('isCodingContinuation — coding follow-up shape', () => {
  const followups = [
    'Give time and space complexity.',
    'Dry run this with [2,7,11,15], target 9.',
    'Now optimize it.',
    'Make it iterative.',
    'Can you make it more efficient?',
    'Handle duplicates.',
    'Without extra space?',
    'code only',
  ];
  for (const q of followups) {
    test(`continuation: "${q}"`, () => assert.equal(isCodingContinuation(q), true));
  }

  const notFollowups = [
    'Solve the Two Sum problem.',
    'Write a function to reverse a linked list.',
    'What is your name?',
    'Tell me about your experience with Python.',
    // Generic verbs in NON-coding asks — code-review MEDIUM 2026-06-15: "optimize"/
    // "improve"/"rewrite" must NOT be coding continuations without a back-reference.
    'improve our onboarding email open rates',
    'rewrite the marketing landing page copy',
    'what is the best way to improve team morale',
    'optimize the sales funnel',
  ];
  for (const q of notFollowups) {
    test(`NOT continuation: "${q}"`, () => assert.equal(isCodingContinuation(q), false));
  }

  test('loose verbs ARE continuations WITH a back-reference', () => {
    assert.equal(isCodingContinuation('now optimize it'), true);
    assert.equal(isCodingContinuation('rewrite it in place'), true);
    assert.equal(isCodingContinuation('make it faster'), true);
  });
});

describe('buildCodingContractPrompt — minimal vs six-section', () => {
  test('null contract → full six-section CODING_CONTRACT', () => {
    const p = buildCodingContractPrompt(null);
    assert.match(p, /## Approach/);
    assert.match(p, /## Code/);
    assert.match(p, /## Complexity/);
    assert.match(p, /## Interviewer Follow-up Points/);
  });

  test('code_only → minimal, instructs code-only, no real six-section template', () => {
    const p = buildCodingContractPrompt('code_only');
    assert.match(p, /CODE ONLY/i);
    // The only mention of headings is the NEGATION ("NO ... heading"); there is no
    // imperative "## Approach" section instruction telling the model to emit one.
    assert.match(p, /NO[\s\S]*heading/i);
    assert.doesNotMatch(p, /Short, interview-speakable explanation/); // the real Approach body
  });

  test('complexity_only → only complexity, references prior solution', () => {
    const p = buildCodingContractPrompt('complexity_only');
    assert.match(p, /Time Complexity/);
    assert.match(p, /Space Complexity/);
    assert.match(p, /prior turn|already in the conversation/i);
    assert.doesNotMatch(p, /## Code/);
  });

  test('explain_only → no code block, prose explanation', () => {
    const p = buildCodingContractPrompt('explain_only');
    assert.match(p, /NO CODE|Do NOT output any code/i);
  });

  test('all explicit contracts forbid profile/Natively leakage', () => {
    for (const c of ['code_only', 'complexity_only', 'dry_run_only', 'explain_only']) {
      const p = buildCodingContractPrompt(c);
      assert.match(p, /NEVER mention "Natively"/);
      assert.match(p, /Do not include resume, JD/);
    }
  });
});

describe('validateAnswerStructure — repair RESPECTS explicit contract (bug #5/#7)', () => {
  const cleanCode = '```python\ndef twoSum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i\n```';

  test('code_only: clean fenced code is accepted, NOT expanded to six sections', () => {
    const v = validateAnswerStructure('dsa_question_answer', cleanCode, 'code_only');
    assert.equal(v.ok, true);
    assert.equal(v.repaired, undefined);
  });

  test('code_only: prose-wrapped code is reduced to JUST the code (no ## Approach forced)', () => {
    const wrapped = 'Here is the solution:\n\n' + cleanCode + '\n\nThat runs in O(n).';
    const v = validateAnswerStructure('dsa_question_answer', wrapped, 'code_only');
    assert.equal(v.ok, false);
    assert.ok(v.repaired);
    assert.doesNotMatch(v.repaired, /## Approach/);
    assert.match(v.repaired, /def twoSum/);
  });

  test('DEFAULT (null contract): clean code IS expanded to six sections (unchanged legacy)', () => {
    const v = validateAnswerStructure('dsa_question_answer', cleanCode, null);
    assert.equal(v.ok, false);
    assert.match(v.repaired, /## Approach/);
    assert.match(v.repaired, /## Complexity/);
  });

  test('complexity_only: a complexity answer is accepted verbatim (no six-section repair)', () => {
    const ans = 'Time Complexity: O(n), because we scan once.\nSpace Complexity: O(n) for the hash map.';
    const v = validateAnswerStructure('dsa_question_answer', ans, 'complexity_only');
    assert.equal(v.ok, true);
    assert.equal(v.repaired, undefined);
  });

  test('dry_run_only: a trace is accepted verbatim', () => {
    const ans = 'i=0 n=2 seen={} → need 7\ni=1 n=7 → 2 in seen → return [0,1]';
    const v = validateAnswerStructure('dsa_question_answer', ans, 'dry_run_only');
    assert.equal(v.ok, true);
    assert.equal(v.repaired, undefined);
  });

  test('explain_only: no-code prose accepted; a stray code block is stripped', () => {
    const prose = 'BFS explores a graph level by level using a FIFO queue.';
    assert.equal(validateAnswerStructure('dsa_question_answer', prose, 'explain_only').ok, true);

    const withCode = prose + '\n```python\ndef bfs(): pass\n```';
    const v = validateAnswerStructure('dsa_question_answer', withCode, 'explain_only');
    assert.equal(v.ok, false);
    assert.doesNotMatch(v.repaired, /```/);
  });
});

describe('buildPriorCodingContextBlock — coding follow-up inheritance (bug #6)', () => {
  test('embeds the prior question + answer so the follow-up resolves against it', () => {
    const block = buildPriorCodingContextBlock({
      userMessage: 'Solve Two Sum in Python.',
      assistantAnswer: '```python\ndef twoSum(nums, target): ...\n```',
    });
    assert.match(block, /PRIOR CODING PROBLEM/);
    assert.match(block, /Two Sum/);
    assert.match(block, /do not ask which problem/i);
  });
});

describe('explicitContractProducesCode — verification gating', () => {
  test('only null + code_only produce new code', () => {
    assert.equal(explicitContractProducesCode(null), true);
    assert.equal(explicitContractProducesCode('code_only'), true);
    assert.equal(explicitContractProducesCode('complexity_only'), false);
    assert.equal(explicitContractProducesCode('dry_run_only'), false);
    assert.equal(explicitContractProducesCode('explain_only'), false);
  });
});
