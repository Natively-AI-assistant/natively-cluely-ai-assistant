// Coding answers scale with what was asked (2026-09-29).
//
// Every coding turn used to get the six sections of CODING_CONTRACT: "write the
// code for odd even" came back as Approach / Technique / Code / Dry Run /
// Complexity / Interviewer Follow-up Points (measured live: 53 of 92 benchmark
// answers had all six headings), and the post-stream repair rebuilt shorter
// answers into the template with placeholder code ("// The model did not return
// code") and "O(?)" complexity. codingShape.ts now decides WHAT the turn asked
// for; the prompt contract and the validator both read that one value.
//
// Pinned at four levels: the detector, the resolver (precedence), the composed
// v2 prompt, and the validator; plus source-level wiring at every call site.
//
// Platform: pure string logic, identical on macOS and Windows.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  detectCodingShape,
  resolveCodingPromptSignals,
  screenPromotedCodingSignals,
  buildSystemPromptV2,
  validateAnswerStructure,
  planAnswer,
  formatAnswerPlanForPrompt,
  CODING_SHAPES,
  CODING_SHAPE_CONTRACTS,
} from '../../../dist-electron/electron/llm/index.js';
import { buildCodingContractPrompt } from '../../../dist-electron/electron/llm/codingFollowup.js';

const SRC = (rel) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
const build = (over = {}) => buildSystemPromptV2({ mode: 'general', action: 'answer', tier: 'cloud', surface: 'live', codingTask: true, ...over });
const contractOf = (prompt) => (prompt.match(/<coding_contract>[\s\S]*?<\/coding_contract>/) || [''])[0];

const BRUTE = '```python\ndef two_sum(nums, target):\n    for i in range(len(nums)):\n        for j in range(i + 1, len(nums)):\n            if nums[i] + nums[j] == target:\n                return [i, j]\n    return []\n```';
const DP = 'Solve this: given an array of coin denominations and an amount, return the fewest coins needed to make up that amount, or -1 if it cannot be made.';

// The requested cases, verbatim or as a user would type them.
const REQUESTED = [
  ['write the code for odd even', 'code'],
  ['write Fibonacci', 'code'],
  ["what's the brute-force approach?", 'brute_force'],
  ['optimise this', 'optimize'],
  ["what's the time complexity?", 'complexity'],
  ['dry run this input: nums = [3, 2, 4], target = 6', 'dry_run'],
  [`explain this code:\n${BRUTE}`, 'explain'],
  ['solve Two Sum', 'solve'],
  [DP, 'solve'],
  ['walk me through the solution', 'walkthrough'],
  ['what data structure would you use?', 'approach'],
];

describe('detectCodingShape: the shape follows the request', () => {
  for (const [q, want] of REQUESTED) {
    test(`${JSON.stringify(q.split('\n')[0].slice(0, 50))} → ${want}`, () => {
      assert.equal(detectCodingShape(q), want);
    });
  }

  test('more phrasings from the spec and the benchmark', () => {
    const more = [
      ['give me the brute force first', 'brute_force'],
      ['what approach should I use?', 'approach'],
      ['solve this LeetCode problem: merge overlapping intervals', 'solve'],
      ['Can you write a function that checks if a number is odd or even?', 'code'],
      ['implement an LRU cache', 'code'],
      ['can you do better?', 'optimize'],
      ['write an optimized version', 'optimize'],
      ['what does this code do?', 'explain'],
      ['walk me through your code', 'walkthrough'],
      ['explain the approach', 'approach'],
      ['give me a hint', 'approach'],
      ['trace it with [1, 2]', 'dry_run'],
      ['what is the big-O', 'complexity'],
      [`Why does this hang? Fix it:\n${BRUTE}`, 'debug'],
      ['fix the off-by-one', 'debug'],
      ['Give me the full walkthrough with dry run and follow-up points.', 'full'],
    ];
    for (const [q, want] of more) assert.equal(detectCodingShape(q), want, q);
  });

  test('a question that asks for a solution stays a solution when it also names the complexity or a dry run', () => {
    for (const q of ['Solve Two Sum and give me the time complexity.', 'solve two sum and dry run it with [2,7,11,15]', 'write binary search and give me the big-o']) {
      assert.ok(['solve', 'code'].includes(detectCodingShape(q)), q);
    }
  });

  test('words inside pasted code never vote', () => {
    // The code mentions "fix", "optimise" and "write"; the ask is an explanation.
    const code = '```python\n# TODO: fix and optimise; write tests\ndef f(x):\n    return x\n```';
    assert.equal(detectCodingShape(`what does this code do?\n${code}`), 'explain');
  });

  test('no words (a blind press or a bare screenshot) means solve what is in front of the user', () => {
    for (const q of ['', '   ', null, undefined, 'Solve this.', 'What should I say?']) assert.equal(detectCodingShape(q), 'solve', String(q));
  });
});

describe('resolveCodingPromptSignals: the shape rides on every coding turn, with the right precedence', () => {
  test('a routed coding turn carries its shape', () => {
    const s = resolveCodingPromptSignals({ answerType: 'coding_question_answer', question: 'write the code for odd even', userInstructions: null });
    assert.equal(s.codingTask, true);
    assert.equal(s.codingShape, 'code');
    assert.equal(s.codingFormat, undefined);
  });

  test('a non-coding turn carries none (shapes never make a turn a coding turn)', () => {
    const s = resolveCodingPromptSignals({ answerType: 'behavioral_answer', question: 'tell me about a time you optimised something', userInstructions: null });
    assert.equal(s.codingTask, false);
    assert.equal(s.codingShape, undefined);
  });

  test('an explicit format in the question still outranks the shape', () => {
    const s = resolveCodingPromptSignals({ answerType: 'dsa_question_answer', question: 'solve two sum, just the code', userInstructions: null });
    assert.equal(s.codingFormat, 'code_only');
    assert.match(contractOf(build(s)), /stated the output format explicitly/);
  });

  test("the mode's standing format still outranks the shape", () => {
    const s = resolveCodingPromptSignals({
      answerType: 'dsa_question_answer',
      question: 'solve two sum',
      userInstructions: 'For coding questions respond in exactly this format: Idea, then Code, then Big-O.',
    });
    assert.equal(s.codingFormat, 'custom_format');
    assert.match(contractOf(build(s)), /stated the output format explicitly/);
  });

  test('a follow-up that asks for a solution keeps its code even after a prior coding turn', () => {
    const s = resolveCodingPromptSignals({
      answerType: 'dsa_question_answer', question: 'solve three sum and give me the time complexity',
      priorCodingTurnExists: true, userInstructions: null,
    });
    assert.equal(s.codingFormat, undefined);
    assert.equal(s.codingShape, 'solve');
  });

  test('a promoted follow-up (prior problem recalled) gets a shape, not the six-section default', () => {
    const s = resolveCodingPromptSignals({
      answerType: 'unknown_answer', question: "what's the brute-force approach?",
      codingTurnPromoted: true, priorCodingTurnExists: true, userInstructions: null,
    });
    assert.equal(s.codingTask, true);
    assert.equal(s.codingShape, 'brute_force');
  });

  test('a stub pasted into the question is promoted with the shape of the words around it', () => {
    const s = resolveCodingPromptSignals({ answerType: 'unknown_answer', question: `Complete:\n${BRUTE}`, userInstructions: null });
    assert.equal(s.codingTask, true);
    assert.ok(s.codingShape, 'no shape on a stub promotion');
  });
});

describe('"walk me through the solution" is a walkthrough, and still a coding follow-up', () => {
  test('it is not a dry run any more, but it still continues the prior coding problem', async () => {
    const { detectExplicitCodingContract, isCodingContinuation } = await import('../../../dist-electron/electron/llm/codingFollowup.js');
    assert.equal(detectExplicitCodingContract('Walk me through the solution.'), null);
    assert.equal(detectExplicitCodingContract('Walk me through the execution.'), 'dry_run_only');
    assert.equal(isCodingContinuation('Walk me through the solution.'), true);
    assert.equal(isCodingContinuation('Walk me through your code.'), true);
    // Exactly the old coverage: a bare "walk me through it / that" can follow a
    // behavioural answer just as easily, so it is not a coding follow-up.
    assert.equal(isCodingContinuation('Walk me through that decision.'), false);
    assert.equal(isCodingContinuation('walk me through it'), false);
    assert.equal(isCodingContinuation('walk me through your onboarding plan for new hires next quarter'), false);
    assert.equal(detectCodingShape('Walk me through the solution.'), 'walkthrough');
  });
});

describe('screenshots ground the problem, the words decide the shape', () => {
  const cases = [
    ['Solve this.', 'solve'],
    ['', 'solve'],
    ["What's the complexity of this?", 'complexity'],
    ['Explain this.', 'explain'],
    ['Optimise this.', 'optimize'],
    ['dry run this input', 'dry_run'],
    ['what is wrong with this?', 'debug'],
    ['why does this crash?', 'debug'],
  ];
  for (const [q, want] of cases) {
    test(`screenshot + ${JSON.stringify(q)} → ${want}`, () => {
      const s = screenPromotedCodingSignals(q);
      assert.equal(s.codingTask, true);
      assert.equal(s.codingShape, want);
    });
  }
});

describe('the composed v2 prompt carries the shape, not six mandatory headings', () => {
  for (const shape of CODING_SHAPES.filter((x) => x !== 'full')) {
    test(`${shape}: its own contract, no "Every heading is mandatory"`, () => {
      const c = contractOf(build({ codingShape: shape, codingTaskKind: 'dsa' }));
      assert.ok(c.includes(`<coding_shape name="${shape}">`), 'shape block missing');
      assert.ok(c.includes(CODING_SHAPE_CONTRACTS[shape]), 'shape text missing');
      assert.ok(!c.includes('Every heading is mandatory'), 'six-section mandate leaked');
      assert.ok(!c.includes('Interviewer Follow-up Points'), 'follow-up section leaked');
      assert.ok(!/never removes the approach, the runnable code, the example or dry run/.test(c), 'the default "never removes" rule contradicts the shape');
    });
  }

  test('full keeps the six-section contract for an explicit ask', () => {
    const c = contractOf(build({ codingShape: 'full', codingTaskKind: 'dsa' }));
    assert.ok(c.includes('Every heading is mandatory'));
    assert.ok(c.includes('## Interviewer Follow-up Points'));
  });

  test('no shape (a caller that predates shapes) keeps the previous contract byte-for-byte', () => {
    const c = contractOf(build({ codingTaskKind: 'dsa' }));
    assert.ok(c.includes('Every heading is mandatory'));
    assert.ok(!c.includes('<coding_shape'));
  });

  test('a build task asking for code keeps the implementation contract', () => {
    const c = contractOf(build({ codingShape: 'code', codingTaskKind: 'impl' }));
    assert.ok(c.includes('IMPLEMENTATION RESPONSE CONTRACT'));
    assert.ok(!c.includes('<coding_shape'));
  });

  test('a build task asking a narrow question gets the narrow shape', () => {
    const c = contractOf(build({ codingShape: 'explain', codingTaskKind: 'impl' }));
    assert.ok(c.includes('<coding_shape name="explain">'));
  });

  test('template-conformance rules ride only on shapes that write code', () => {
    assert.match(contractOf(build({ codingShape: 'code', suppliedTemplate: true })), /TEMPLATE CONFORMANCE/);
    assert.match(contractOf(build({ codingShape: 'solve', suppliedTemplate: true })), /A code template IS present/);
    for (const shape of ['explain', 'complexity', 'dry_run', 'walkthrough', 'approach', 'brute_force']) {
      const c = contractOf(build({ codingShape: shape, suppliedTemplate: true }));
      assert.ok(!/TEMPLATE CONFORMANCE|write your solution into it/i.test(c), `${shape} told to write a solution`);
    }
  });

  test('the solve shape names the technique inside the approach (the Technique section folds into it)', () => {
    assert.match(CODING_SHAPE_CONTRACTS.solve, /naming the technique or data structure in the first sentence/);
    assert.match(CODING_SHAPE_CONTRACTS.solve, /"## Approach", "## Code", "## Complexity"/);
    // Headings are named, not written as "## Approach: <description>" — the
    // model copied that form into its answer as "## Approach:".
    assert.doesNotMatch(CODING_SHAPE_CONTRACTS.solve, /^## \w+:/m);
    assert.match(CODING_SHAPE_CONTRACTS.solve, /Dry Run" between Code and Complexity only when the user asked for one or the logic is genuinely hard to follow/);
  });

  test('the local tier gets the same shape block', () => {
    const c = contractOf(buildSystemPromptV2({ mode: 'general', action: 'answer', tier: 'local', codingTask: true, codingShape: 'complexity' }));
    assert.ok(c.includes('<coding_shape name="complexity">'));
  });
});

describe('validateAnswerStructure never rebuilds a shaped answer into six sections', () => {
  const answers = {
    code: '```python\ndef is_even(n):\n    return n % 2 == 0\n```\nIt checks the remainder when dividing by two.\nTime O(1), space O(1).',
    solve: '## Approach\nUse a hash map from value to index.\n\n## Code\n```python\ndef two_sum(nums, t):\n    seen = {}\n    for i, n in enumerate(nums):\n        if t - n in seen:\n            return [seen[t - n], i]\n        seen[n] = i\n```\n\n## Complexity\nTime O(n), space O(n).',
    approach: "I'd use a hash map from value to index, so each complement lookup is O(1). That gives O(n) time and O(n) space.",
    brute_force: 'Check every pair with two nested loops and return the first pair that sums to the target. That is O(n²) time and O(1) space, which is slow for large inputs.',
    optimize: 'Replace the inner loop with a hash map lookup.\n```python\ndef two_sum(nums, t):\n    seen = {}\n    for i, n in enumerate(nums):\n        if t - n in seen:\n            return [seen[t - n], i]\n        seen[n] = i\n```\nO(n²) time becomes O(n), at the cost of O(n) space.',
    complexity: 'Time O(n²), because the inner loop runs for every element. Space O(1).',
    dry_run: 'Start with an empty map. 3: 6-3=3 not seen, store 3→0. 2: 4 not seen, store 2→1. 4: 2 is at index 1, return [1, 2].',
    explain: 'It returns the first value that appears twice. It keeps a set of values seen so far and stops at the first repeat. O(n) time, O(n) space.',
    debug: 'Setting lo = mid never moves past mid when hi = lo + 1, so the loop spins.\n```python\ndef binary_search(nums, target):\n    lo, hi = 0, len(nums)\n    while lo < hi:\n        mid = (lo + hi) // 2\n        if nums[mid] == target:\n            return mid\n        if nums[mid] < target:\n            lo = mid + 1\n        else:\n            hi = mid\n    return -1\n```\nlo = mid + 1 always shrinks the range.',
    walkthrough: '1. Keep a map from each value to its index.\n2. For each number, look up target minus it.\n3. If it is there, return both indices; otherwise store the number.\nEdge cases: duplicates and no answer. O(n) time and space.',
  };
  for (const [shape, answer] of Object.entries(answers)) {
    test(`${shape}: a well-formed answer comes back unchanged`, () => {
      for (const type of ['dsa_question_answer', 'coding_question_answer']) {
        const r = validateAnswerStructure(type, answer, null, shape);
        assert.equal(r.repaired, undefined, `${type}: rewrote a ${shape} answer`);
        assert.equal(r.ok, true, `${type}: rejected a ${shape} answer`);
      }
    });
  }

  test('the live defect: a spoken dry run is no longer wrapped into a placeholder template', () => {
    // Measured on current main: this exact answer came back as six sections with
    // "// The model did not return code" and "O(?)".
    const spoken = 'We start with an empty hash map. First 3: 6 minus 3 is not in the map, store it at index 0. Then 2, store it at index 1. Then 4: 6 minus 4 is 2, already at index 1, so we return 1 and 2.';
    const before = validateAnswerStructure('dsa_question_answer', spoken);
    assert.ok(before.repaired && /did not return code|O\(\?\)/.test(before.repaired), 'the no-shape path should still show the old repair');
    const after = validateAnswerStructure('dsa_question_answer', spoken, null, 'dry_run');
    assert.equal(after.repaired, undefined);
  });

  test('full keeps the six-section repair', () => {
    const r = validateAnswerStructure('dsa_question_answer', '```python\nx = 1\n```', null, 'full');
    assert.equal(r.ok, false);
    assert.ok(r.repaired && r.repaired.includes('## Interviewer Follow-up Points'));
  });

  test('the fence-tag fix still applies inside a shape', () => {
    const jsx = '```python\nexport default function A() { return <div className="x">hi</div>; }\n```';
    const r = validateAnswerStructure('coding_question_answer', jsx, null, 'code');
    assert.ok(r.repaired && r.repaired.startsWith('```tsx'), 'misfenced JSX not corrected');
  });
});

describe('the planner contract and the legacy chat contract follow the shape too', () => {
  const plan = (q) => planAnswer({ question: q, source: 'manual_input', speakerPerspective: 'user' });

  test('formatAnswerPlanForPrompt swaps the six-section template for the shape', () => {
    const p = plan('solve two sum');
    const shaped = formatAnswerPlanForPrompt(p, false, 'complexity');
    assert.ok(shaped.includes(CODING_SHAPE_CONTRACTS.complexity));
    assert.ok(!shaped.includes('Every heading is mandatory'));
    // No shape, or full: unchanged.
    assert.ok(formatAnswerPlanForPrompt(p, false).includes('Every heading is mandatory'));
    assert.ok(formatAnswerPlanForPrompt(p, false, 'full').includes('Every heading is mandatory'));
  });

  test('the hidden verification spec is only requested when the shape writes code', () => {
    const p = plan('solve two sum');
    assert.match(formatAnswerPlanForPrompt(p, true, 'solve'), /verification_spec/);
    assert.doesNotMatch(formatAnswerPlanForPrompt(p, true, 'complexity'), /verification_spec/);
  });

  test('buildCodingContractPrompt (legacy manual chat) honours the shape', () => {
    const c = buildCodingContractPrompt(null, { codingShape: 'walkthrough' });
    assert.ok(c.includes(CODING_SHAPE_CONTRACTS.walkthrough));
    assert.ok(!c.includes('Every heading is mandatory'));
    assert.ok(buildCodingContractPrompt(null).includes('Every heading is mandatory'));
  });
});

describe('wiring: every surface hands the same shape to its prompt and its validator', () => {
  const engine = SRC('electron/IntelligenceEngine.ts');
  const ipc = SRC('electron/ipcHandlers.ts');
  const wta = SRC('electron/llm/WhatToAnswerLLM.ts');
  const helper = SRC('electron/LLMHelper.ts');
  const answerLlm = SRC('electron/llm/AnswerLLM.ts');

  test('Cmd+Enter persona passes the shape; the repeat-press "complete solution" directive only rides a solve', () => {
    assert.match(engine, /codingShape: _codingShape,/);
    assert.match(engine, /if \(!_promoted \|\| !_base \|\| _codingShape !== 'solve'\) return _base;/);
    assert.doesNotMatch(engine, /coding contract's full section shape/);
  });

  test('the Cmd+Enter post-stream validator reads the shape from the same question as the persona', () => {
    assert.match(engine, /const liveCodingShape = \(require\('\.\/llm\/codingShape'\)[^;]*\.detectCodingShape\(answerPlan\.question\);/);
    assert.match(engine, /validateAnswerStructure\(\s*answerPlan\.answerType, fullAnswer, liveExplicitCodingContract, liveCodingShape,?\s*\)/);
    assert.match(engine, /_manualSignals\.codingShape,/);
  });

  test('typed box: persona, base prompt, legacy contract and legacy validator all carry the shape', () => {
    assert.match(ipc, /codingShape: opts\?\.codingShape,/);
    assert.match(ipc, /codingTurnPromoted: !!priorProblem,/);
    assert.match(ipc, /codingShape: codingSignals\.codingShape\s*\n?\s*\?\?/);
    assert.match(ipc, /formatAnswerPlanForPrompt\(answerPlan, isCodeVerificationEnabled\(\), manualCodingShape\)/);
    assert.match(ipc, /codingShape: manualCodingShape,/);
    assert.match(ipc, /validateAnswerStructure\(validationType, fullResponse, explicitCodingContract, manualCodingShape\)/);
  });

  test('WTA and AnswerLLM hand the shape to the planner contract', () => {
    assert.match(wta, /formatAnswerPlanForPrompt\(answerPlan, isCodeVerificationEnabled\(\), codingSignals\.codingShape\)/);
    assert.match(answerLlm, /formatAnswerPlanForPrompt\(answerPlan, isCodeVerificationEnabled\(\), codingSignals\.codingShape\)/);
  });

  test('every screenshot promotion goes through the one helper (no hardcoded dsa-only signals)', () => {
    assert.equal((helper.match(/return screenPromotedCodingSignals\(message\);/g) || []).length, 2, 'LLMHelper');
    assert.match(wta, /return screenPromotedCodingSignals\(answerPlan\?\.question\);/);
    assert.match(ipc, /screenPromotedCodingSignals\(v3Question\)/);
    assert.match(engine, /screenPromotedCodingSignals\(answerPlan\.question\)/);
    for (const [name, src] of [['engine', engine], ['ipc', ipc], ['wta', wta], ['helper', helper]]) {
      assert.doesNotMatch(src, /return \{ codingTask: true, codingTaskKind: 'dsa'( as const)? \}/, name);
    }
  });

  test('the Code Hint fallback asks for a nudge, not the six sections', () => {
    assert.match(SRC('electron/llm/CodeHintLLM.ts'), /action: 'code_hint', tier: [^\n]*codingShape: 'approach' \}/);
    const c = contractOf(buildSystemPromptV2({ mode: 'general', action: 'code_hint', tier: 'cloud', codingShape: 'approach' }));
    assert.ok(c.includes('<coding_shape name="approach">'));
    assert.ok(!c.includes('Every heading is mandatory'));
  });

  test('the verification retry keeps the answer\'s own format', () => {
    const verify = SRC('electron/llm/codeVerification/verifyCodingAnswer.ts');
    assert.doesNotMatch(verify, /SAME six-section coding format/);
    assert.match(verify, /Keep the SAME format and sections as your previous answer/);
  });
});
