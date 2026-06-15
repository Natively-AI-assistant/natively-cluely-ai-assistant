import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyIntent, planAnswer, validateAnswerStructure } from '../../../dist-electron/electron/llm/index.js';

const planFor = (question, source = 'what_to_answer') => planAnswer({
  question,
  source,
  speakerPerspective: source === 'what_to_answer' ? 'interviewer' : 'user',
});

const REQUIRED_CODING_HEADINGS = [
  '## Approach',
  '## Technique / Data Structure / Algorithm Used',
  '## Code',
  '## Dry Run',
  '## Complexity',
  '## Interviewer Follow-up Points',
];

const assertCodingMarkdownContract = (answer) => {
  for (const heading of REQUIRED_CODING_HEADINGS) {
    assert.ok(answer.includes(heading), `missing heading ${heading}`);
  }

  const positions = REQUIRED_CODING_HEADINGS.map((heading) => answer.indexOf(heading));
  for (let i = 1; i < positions.length; i++) {
    assert.ok(positions[i - 1] < positions[i], `${REQUIRED_CODING_HEADINGS[i - 1]} must appear before ${REQUIRED_CODING_HEADINGS[i]}`);
  }

  assert.match(answer, /^## Approach\b/);
  assert.doesNotMatch(answer.trim(), /^```/);
  assert.match(answer, /```[a-zA-Z0-9+#-]+\n[\s\S]+?```/);
  assert.match(answer, /Time Complexity:\s*`?O\([^)]*\)`?/i);
  assert.match(answer, /Space Complexity:\s*`?O\([^)]*\)`?/i);
};

test('planAnswer detects terse DSA questions as dsa_question_answer', () => {
  const twoSum = planFor('Can you solve two sum?');
  assert.equal(twoSum.answerType, 'dsa_question_answer');
  assert.ok(twoSum.forbiddenContextLayers.includes('resume'));
  assert.ok(twoSum.forbiddenContextLayers.includes('jd'));
  assert.match(twoSum.responseTemplate, /## Approach/);
  assert.match(twoSum.responseTemplate, /## Technique \/ Data Structure \/ Algorithm Used/);
});

test('planAnswer detects system design and debugging answer types', () => {
  assert.equal(planFor('Design a scalable notification system').answerType, 'system_design_answer');
  assert.equal(planFor('How would you debug this production exception?').answerType, 'debugging_question_answer');
});

test('planAnswer routes identity and JD-fit questions with isolated context', () => {
  const identity = planFor('What is my name?');
  assert.equal(identity.answerType, 'identity_answer');
  assert.ok(identity.requiredContextLayers.includes('stable_identity'));
  assert.ok(identity.forbiddenContextLayers.includes('negotiation'));

  const jdFit = planFor('Why are you a good fit for this role?');
  assert.equal(jdFit.answerType, 'jd_fit_answer');
  assert.ok(jdFit.requiredContextLayers.includes('jd'));
  assert.ok(jdFit.forbiddenContextLayers.includes('negotiation'));
});

test('validateAnswerStructure accepts complete coding answer', () => {
  const answer = `## Approach\n\nUse a hash map to check complements as we scan.\n\n## Technique / Data Structure / Algorithm Used\n\nHash map for O(1) average lookup.\n\n## Code\n\n\`\`\`typescript\nfunction twoSum(nums: number[], target: number): number[] {\n  const seen = new Map<number, number>();\n  for (let i = 0; i < nums.length; i++) {\n    const complement = target - nums[i];\n    if (seen.has(complement)) return [seen.get(complement)!, i];\n    seen.set(nums[i], i);\n  }\n  return [];\n}\n\`\`\`\n\n## Dry Run\n\nFor [2,7,11,15] and target 9, 2 is stored, then 7 finds complement 2.\n\n## Complexity\n\nTime Complexity: O(n), because we scan once.\n\nSpace Complexity: O(n), because the map can store all numbers.\n\n## Interviewer Follow-up Points\n\n- Duplicates work because we check before insert.\n- Clarify whether to return indices or values.`;

  const result = validateAnswerStructure('dsa_question_answer', answer);
  assert.equal(result.ok, true);
  assert.deepEqual(result.missingSections, []);
  assert.equal(result.hasCodeBlock, true);
  assert.equal(result.hasComplexity, true);
});

test('validateAnswerStructure repairs unstructured coding answer', () => {
  const result = validateAnswerStructure('coding_question_answer', 'Use a hash map. ```ts\nconst x = 1;\n```');
  assert.equal(result.ok, false);
  assert.ok(result.missingSections.includes('Approach'));
  assertCodingMarkdownContract(result.repaired ?? '');
});

test('classifyIntent prioritizes coding over generic example phrasing', async () => {
  const prompts = [
    'give me an example of a React component in TypeScript',
    'can you give a concrete implementation of binary search in Python?',
  ];

  for (const prompt of prompts) {
    const result = await classifyIntent(prompt, prompt, 0);
    assert.equal(result.intent, 'coding', `${prompt} classified as ${result.intent}`);
  }
});

test('planAnswer classifies required odd/even manual prompts as coding answers', () => {
  const prompts = [
    'what is the code for odd even',
    'odd even code',
    'odd even in python',
    'write code to check odd or even',
    'check whether a number is odd or even',
    'how to find if number is odd or even in python',
    'can you write code to check odd or even?',
    'Interviewer: Can you write code to check whether a number is odd or even?',
    'Interviewer: How would you check whether a number is odd or even?',
  ];

  for (const prompt of prompts) {
    const plan = planFor(prompt, 'manual_input');
    assert.ok(
      plan.answerType === 'coding_question_answer' || plan.answerType === 'dsa_question_answer',
      `${prompt} classified as ${plan.answerType}`,
    );
    assert.ok(plan.forbiddenContextLayers.includes('resume'), `${prompt} should forbid resume context`);
    assert.ok(plan.forbiddenContextLayers.includes('jd'), `${prompt} should forbid JD context`);
    assert.ok(plan.forbiddenContextLayers.includes('negotiation'), `${prompt} should forbid negotiation context`);
  }
});

test('validateAnswerStructure rejects code-first markdown and re-sections it WITHOUT fabricating complexity', () => {
  const badOddEven = `\`\`\`python
def is_even(number):
    return number % 2 == 0
\`\`\`

The approach uses the modulo operator \`%\`.`;

  const result = validateAnswerStructure('coding_question_answer', badOddEven);

  assert.equal(result.ok, false);
  assert.ok(result.repaired, 'expected repaired markdown');
  assertCodingMarkdownContract(result.repaired ?? '');
  // The model's own code is preserved (it really used `% 2`), not replaced by a
  // canned template.
  assert.match(result.repaired ?? '', /number % 2 == 0/);
  assert.doesNotMatch(result.repaired ?? '', /check_odd_even/, 'must not inject a hardcoded odd/even template');
  // The model gave NO complexity, so repair must emit a neutral O(?) placeholder
  // — never a fabricated O(1)/O(n) it cannot justify.
  assert.match(result.repaired ?? '', /O\(\?\)/, 'absent complexity → O(?) placeholder');
  assert.doesNotMatch(result.repaired ?? '', /Time Complexity:\s*`?O\(1\)`?/i, 'must NOT fabricate O(1)');
  assert.doesNotMatch(result.repaired ?? '', /resume|job description|salary|negotiation/i);
  assert.doesNotMatch(result.repaired ?? '', /I am OpenOffer|I'm OpenOffer|as an AI/i);
});

test('validateAnswerStructure requires deterministic markdown heading order for coding answers', () => {
  const wrongOrder = `## Code

\`\`\`python
def check_odd_even(num):
    return 'Even' if num % 2 == 0 else 'Odd'
\`\`\`

## Approach

Use modulo.

## Technique / Data Structure / Algorithm Used

Modulo operator.

## Dry Run

For 7, 7 % 2 is 1, so odd.

## Complexity

Time Complexity: O(1). Space Complexity: O(1).

## Interviewer Follow-up Points

- Negative numbers also work in Python.`;

  const result = validateAnswerStructure('coding_question_answer', wrongOrder);

  assert.equal(result.ok, false);
  assert.ok(result.missingSections.length === 0, 'all headings exist, failure should be ordering/start validation');
  assert.ok(result.repaired, 'wrong-order markdown should be repaired');
  assertCodingMarkdownContract(result.repaired ?? '');
});
