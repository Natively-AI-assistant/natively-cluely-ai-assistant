// electron/llm/__tests__/CodeSanityCheck.test.mjs
//
// Deterministic regression tests for FINDING-012 — the post-generation
// sanity check that detects the LLM's intermittent two-sum tuple bug
// (`complement = target, num` instead of `complement = target - num`).
//
// Loads the compiled JS via dist-electron the same way other __tests__ do.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/CodeSanityCheck.js');
const { checkAnswerForCodeBugs } = await import(pathToFileURL(modPath).href);

describe('CodeSanityCheck — subtraction-as-tuple (FINDING-012)', () => {
  test('flags `complement = target, num` inside a python code block', () => {
    const answer = [
      "Here's my approach using a hash map.",
      '',
      '```python',
      'def two_sum(nums, target):',
      '    seen = {}',
      '    for i, num in enumerate(nums):',
      '        complement = target, num',
      '        if complement in seen:',
      '            return [seen[complement], i]',
      '        seen[num] = i',
      '```',
      '',
      'Dry-run: 2 then 7 gives the answer.',
    ].join('\n');

    const result = checkAnswerForCodeBugs(answer);
    assert.equal(result.ok, false, 'should detect the tuple bug');
    assert.ok(
      result.issues.some(i => i.code === 'subtraction_as_tuple'),
      'expected subtraction_as_tuple issue, got: ' + JSON.stringify(result.issues),
    );
  });

  test('does NOT flag the correct `complement = target - num` form', () => {
    const answer = [
      '```python',
      'def two_sum(nums, target):',
      '    seen = {}',
      '    for i, num in enumerate(nums):',
      '        complement = target - num',
      '        if complement in seen:',
      '            return [seen[complement], i]',
      '        seen[num] = i',
      '```',
    ].join('\n');

    const result = checkAnswerForCodeBugs(answer);
    assert.equal(result.ok, true, 'correct subtraction should not be flagged: ' + JSON.stringify(result.issues));
  });

  test('flags the bug across several variable names (diff, remainder, needed)', () => {
    const variants = [
      '```js\ndiff = a, b\n```',
      '```python\nremainder = total, seen\n```',
      '```ts\nneeded = target, current\n```',
      '```python\ngap = end, start\n```',
    ];
    for (const v of variants) {
      const r = checkAnswerForCodeBugs(v);
      assert.equal(r.ok, false, `should flag variant: ${v}`);
      assert.equal(r.issues[0].code, 'subtraction_as_tuple');
    }
  });

  test('does NOT flag prose containing the word "tuple" outside a code fence', () => {
    const answer = [
      'In Python, `complement = target, num` creates a tuple, which is the bug we are guarding against.',
      'The correct form is `complement = target - num`.',
    ].join('\n');
    const result = checkAnswerForCodeBugs(answer);
    // The string appears outside fences, but the regex only scans inside
    // fenced blocks for the tuple shape. Prose discussion is fine.
    assert.equal(result.ok, true, 'prose discussion of the bug must not self-trigger');
  });
});

describe('CodeSanityCheck — assignment-in-conditional', () => {
  test('flags `if x = target:` inside a code block', () => {
    const answer = [
      '```python',
      'if x = target:',
      '    return True',
      '```',
    ].join('\n');
    const r = checkAnswerForCodeBugs(answer);
    assert.equal(r.ok, false);
    assert.ok(r.issues.some(i => i.code === 'assignment_in_conditional'));
  });

  test('does NOT flag `if x == target:` or `if (x === target)`', () => {
    const safeForms = [
      '```python\nif x == target:\n    return True\n```',
      '```ts\nif (x === target) return true;\n```',
      '```js\nif (a !== b) return false;\n```',
    ];
    for (const a of safeForms) {
      const r = checkAnswerForCodeBugs(a);
      assert.equal(r.ok, true, `safe form should pass: ${a} / got ${JSON.stringify(r.issues)}`);
    }
  });
});

describe('CodeSanityCheck — narration-level tuple bug', () => {
  test('flags dry-run prose that reads "calculate 9, 7 = 2"', () => {
    const answer = [
      'If I run through this with target 9 and array [2,7], I see 2, then 7, calculate `9, 7 = 2`, find 2 in the map.',
    ].join('\n');
    const r = checkAnswerForCodeBugs(answer);
    assert.equal(r.ok, false, 'narration-shape bug should be flagged');
    assert.ok(r.issues.some(i => i.code === 'narration_subtraction_as_tuple'));
  });

  test('does NOT flag correct narration "calculate 9 - 7 = 2"', () => {
    const answer = 'I calculate `9 - 7 = 2` and find 2 in the map.';
    const r = checkAnswerForCodeBugs(answer);
    assert.equal(r.ok, true, 'correct subtraction narration must not be flagged');
  });
});

describe('CodeSanityCheck — empty / non-code answers', () => {
  test('returns ok for empty string and non-string input', () => {
    assert.deepEqual(checkAnswerForCodeBugs(''), { ok: true, issues: [] });
    assert.deepEqual(checkAnswerForCodeBugs(undefined), { ok: true, issues: [] });
    assert.deepEqual(checkAnswerForCodeBugs(null), { ok: true, issues: [] });
  });

  test('returns ok for an answer without any code blocks', () => {
    const answer = 'Behavioral STAR story about influence without authority. No code involved.';
    const r = checkAnswerForCodeBugs(answer);
    assert.equal(r.ok, true);
  });
});

describe('CodeSanityCheck — prompt invariant exists in SHARED_CODING_RULES', () => {
  test('SHARED_CODING_RULES contains the anti-pattern guidance for two-sum tuple bug', async () => {
    const promptsPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/prompts.js');
    const prompts = await import(pathToFileURL(promptsPath).href);
    assert.ok(prompts.SHARED_CODING_RULES.includes('SUBTRACTION VS TUPLE'));
    assert.ok(prompts.SHARED_CODING_RULES.includes('complement = target - num'));
    assert.ok(prompts.SHARED_CODING_RULES.includes('complement = target, num'));
  });
});
