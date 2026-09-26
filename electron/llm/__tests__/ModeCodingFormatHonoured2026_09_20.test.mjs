// electron/llm/__tests__/ModeCodingFormatHonoured2026_09_20.test.mjs
//
// Cause 4 of 6 (see userInstructionContract.ts) — the user report:
//
//   "The coding format resolver correctly resolves pair_programming, but the
//    model sometimes outputs the generic coding/DSA format instead of honoring
//    the contract. What could override the resolved format downstream?"
//
// Reproduced 2026-09-20 against the built validator: an answer that obeyed the
// user's format PERFECTLY was rewritten, after generation, into the six DSA
// headings with fabricated "O(?) — state the actual time bound" lines.
// "Sometimes", because validateAnswerStructure exempts a model-formatted answer
// only when it happens to state its complexity — and the user's format did not
// ask for one. Root: detectExplicitCodingContract reads the QUESTION only, so a
// format written in the MODE never reached the resolver that feeds both the
// prompt and the repair layer.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjs = createRequire(import.meta.url);
const distLlm = (p) => path.resolve(__dirname, '../../../dist-electron/electron/llm/', p);
const { registerUserInstructionProvider } = cjs(distLlm('userInstructionContract.js'));
const { resolveCodingPromptSignals } = cjs(distLlm('codingPromptSignals.js'));
const { validateAnswerStructure } = cjs(distLlm('AnswerValidator.js'));
const { resolveV2SystemPrompt } = cjs(distLlm('promptSystemV2.js'));

const CONTRACT = 'Pair programming contract: for every coding question respond in exactly this format. '
  + 'First restate the problem in one line. Then list the approach as numbered steps. '
  + 'Then give the code in Java. Then give a dry run on one example. '
  + 'Do not use the Approach / Complexity / Edge cases headings.';

// A model answer that follows CONTRACT exactly — and never mentions complexity.
const OBEDIENT = [
  'Problem: return indices of the two numbers that add up to target.', '',
  'Steps:', '1. Walk the array once, keeping a map of value -> index.',
  '2. For each number, look up target minus that number in the map.',
  '3. If it is there, return both indices; otherwise store the current number.', '',
  '```java', 'class Solution {', '    public int[] twoSum(int[] nums, int target) {',
  '        Map<Integer, Integer> seen = new HashMap<>();',
  '        for (int i = 0; i < nums.length; i++) {',
  '            Integer j = seen.get(target - nums[i]);',
  '            if (j != null) return new int[]{j, i};',
  '            seen.put(nums[i], i);', '        }', '        return new int[0];', '    }', '}', '```', '',
  'Example: nums=[2,7,11,15], target=9. i=0 stores 2. i=1 finds 9-7=2 at index 0, returns [0,1].',
].join('\n');

afterEach(() => registerUserInstructionProvider(null));

describe('the mode’s format reaches the ONE resolver that feeds prompt and repair', () => {
  test('a mode-level contract resolves to custom_format on a coding turn', () => {
    registerUserInstructionProvider(() => CONTRACT);
    const s = resolveCodingPromptSignals({ answerType: 'dsa_question_answer', question: 'Solve two sum.' });
    assert.equal(s.codingTask, true);
    assert.equal(s.codingFormat, 'custom_format');
  });

  test('the provider receives the pinned mode id the caller snapshotted', () => {
    let seen;
    registerUserInstructionProvider((id) => { seen = id; return CONTRACT; });
    resolveCodingPromptSignals({ answerType: 'dsa_question_answer', question: 'Solve two sum.', pinnedModeId: 'mode-42' });
    assert.equal(seen, 'mode-42');
  });

  test('what the user says THIS turn still outranks the standing config', () => {
    registerUserInstructionProvider(() => CONTRACT);
    const s = resolveCodingPromptSignals({ answerType: 'dsa_question_answer', question: 'Two sum — just the code please.' });
    assert.equal(s.codingFormat, 'code_only');
  });

  test('a mode-level "code only" works too', () => {
    registerUserInstructionProvider(() => 'For coding questions give only the code, no explanation.');
    assert.equal(resolveCodingPromptSignals({ answerType: 'dsa_question_answer', question: 'Solve two sum.' }).codingFormat, 'code_only');
  });

  test('explicit userInstructions beat the provider; null means "none" (keeps unit tests pure)', () => {
    registerUserInstructionProvider(() => CONTRACT);
    assert.equal(resolveCodingPromptSignals({ answerType: 'dsa_question_answer', question: 'Solve two sum.', userInstructions: null }).codingFormat, undefined);
    registerUserInstructionProvider(() => '');
    assert.equal(resolveCodingPromptSignals({ answerType: 'dsa_question_answer', question: 'Solve two sum.', userInstructions: CONTRACT }).codingFormat, 'custom_format');
  });

  test('a non-coding turn never gains a coding format from the mode', () => {
    registerUserInstructionProvider(() => CONTRACT);
    const s = resolveCodingPromptSignals({ answerType: 'general_meeting_answer', question: 'What does this quarter look like?' });
    assert.equal(s.codingTask, false);
    assert.equal(s.codingFormat, undefined);
  });

  test('a throwing provider can never break a turn', () => {
    registerUserInstructionProvider(() => { throw new Error('db closed'); });
    const s = resolveCodingPromptSignals({ answerType: 'dsa_question_answer', question: 'Solve two sum.' });
    assert.equal(s.codingTask, true);
    assert.equal(s.codingFormat, undefined);
  });

  test('plain constraints ("Use Java only", "Answer in 100 words") do not switch the contract off', () => {
    registerUserInstructionProvider(() => 'Use Java only\nAnswer in 100 words.');
    assert.equal(resolveCodingPromptSignals({ answerType: 'dsa_question_answer', question: 'Solve two sum.' }).codingFormat, undefined);
  });
});

describe('the repair layer stands down for the user’s format', () => {
  test('REPRO INVERTED: the obedient answer is no longer rewritten into six DSA headings', () => {
    registerUserInstructionProvider(() => CONTRACT);
    const { codingFormat } = resolveCodingPromptSignals({ answerType: 'dsa_question_answer', question: 'Solve two sum.' });
    const v = validateAnswerStructure('dsa_question_answer', OBEDIENT, codingFormat ?? null);
    assert.equal(v.ok, true);
    assert.equal(v.repaired, undefined, 'an answer in the user’s own format must reach them untouched');
  });

  test('CONTROL: with no mode format, the same answer is still repaired exactly as before', () => {
    const { codingFormat } = resolveCodingPromptSignals({ answerType: 'dsa_question_answer', question: 'Solve two sum.' });
    assert.equal(codingFormat, undefined);
    const v = validateAnswerStructure('dsa_question_answer', OBEDIENT, codingFormat ?? null);
    assert.equal(v.ok, false);
    assert.match(v.repaired, /## Complexity/);
  });
});

describe('the prompt asks for the user’s format instead of the six sections', () => {
  test('custom_format replaces the mandatory-headings contract', () => {
    const prompt = resolveV2SystemPrompt({ action: 'answer', tier: 'cloud', codingTask: true, codingTaskKind: 'dsa', codingFormat: 'custom_format' });
    assert.ok(prompt, 'v2 prompt resolves');
    assert.match(prompt, /standing instructions/i);
    assert.doesNotMatch(prompt, /Every heading is mandatory/);
  });

  test('CONTROL: without it the six-section contract is still attached', () => {
    const prompt = resolveV2SystemPrompt({ action: 'answer', tier: 'cloud', codingTask: true, codingTaskKind: 'dsa' });
    assert.match(prompt, /Every heading is mandatory/);
  });
});
