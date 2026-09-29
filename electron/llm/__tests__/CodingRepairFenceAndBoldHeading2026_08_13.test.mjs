// electron/llm/__tests__/CodingRepairFenceAndBoldHeading2026_08_13.test.mjs
//
// Code-review 2026-08-13, two defects in AnswerValidator that this branch's new
// output caps make routine rather than exotic. Both are driven through the REAL
// exported validator/repairer, not a re-implementation of their regexes — the
// first round of verification for these fixes asserted on a local copy of the
// patterns, which proves the reasoning and not the shipped code.
//
// DEFECT 1 (stripFencedCode, AnswerValidator:~430)
//   `answer.replace(/```[\s\S]*?```/g, ' ')` needs a CLOSING fence to match, so
//   an answer cut off inside its code block kept the entire block in what every
//   caller treats as prose. MAX_STREAM_OUTPUT_CHARS (client) and
//   AI_STREAM_MAX_OUTPUT_TOKENS (server) both cut mid-token, and a coding answer
//   is usually inside a fence at that point. Measured at HEAD: a truncated
//   answer whose only Big-O was a comment about a DISCARDED approach
//   ("# brute force is O(n^2), too slow") had that bound lifted out of the fence
//   and published as the shipped answer's official Complexity section.
//
// DEFECT 2 (the substantivelyComplete exemption, AnswerValidator:~521)
//   The guard was two INDEPENDENT terms — (any canonical label, in any style)
//   AND (any `##` heading anywhere) — which two DIFFERENT lines could satisfy
//   between them. A model writing `## Solution` in its own words plus a bold
//   `**Complexity**` satisfied both separately, so a complete, correctly
//   formatted answer was fed into the lossy repair.
//
//   Note on the original report, which overstated the harm: the repair does NOT
//   drop the second code block. Measured at HEAD, both blocks survive — but the
//   answer is RESTRUCTURED, and the second block is misfiled under `## Approach`
//   while the first becomes `## Code`. The model's own `## Solution` heading is
//   discarded. That is the defect being pinned here: a complete answer must pass
//   through untouched, not be rearranged.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  validateCodingMarkdown,
  repairCodingMarkdown,
} from '../../../dist-electron/electron/llm/index.js';

const countCodeBlocks = (s) => (s.match(/```[a-zA-Z0-9+#-]*\n[\s\S]*?```/g) || []).length;

describe('a Big-O inside an UNTERMINATED fence is not published as the complexity', () => {
  // Exactly the shape the output caps produce: cut mid-token inside the fence.
  const truncated = [
    '## Approach',
    'Start with brute force, then optimize.',
    '',
    '```python',
    '# brute force is O(n^2), too slow',
    'for i in range(n):',
    '    for j in range(n):',
  ].join('\n');

  test('the discarded brute-force bound does NOT become the Complexity section', () => {
    const repaired = repairCodingMarkdown(truncated);
    const complexity = /##\s*Complexity\s*\n+([^\n#]*)/.exec(repaired)?.[1]?.trim() ?? '';
    assert.ok(
      !/O\(n\^2\)/.test(complexity),
      `a bound from inside a code fence was published as the answer's complexity: ${complexity}`,
    );
  });

  test('it falls back to the honest placeholder rather than inventing a bound', () => {
    const repaired = repairCodingMarkdown(truncated);
    const complexity = /##\s*Complexity\s*\n+([^\n#]*)/.exec(repaired)?.[1]?.trim() ?? '';
    assert.match(complexity, /O\(\?\)/, 'an unknown bound must stay visibly unknown');
  });

  test('a bound the model really did state in PROSE is still lifted', () => {
    // The narrowing must not cost the feature: a closed fence plus a real prose
    // bound must still populate the section.
    const withProse = [
      '## Approach', 'Hash map lookup.', '',
      '```python', 'def f(): pass', '```', '',
      'This runs in O(n) time and O(1) space.',
    ].join('\n');
    const repaired = repairCodingMarkdown(withProse);
    const complexity = /##\s*Complexity\s*\n+([^\n#]*)/.exec(repaired)?.[1]?.trim() ?? '';
    assert.match(complexity, /O\(n\)/, 'a genuine prose bound must still be used');
  });
});

describe('a complete answer in the model OWN format is left alone', () => {
  // `## Solution` is our SYNTAX with the model's own WORDS, so it is not a
  // canonical section; `**Complexity**` on its own line is the model's own
  // style. Neither means "the model started our scaffold".
  const completeOwnFormat = [
    '## Solution', '',
    'Use a hash map for O(1) lookups.', '',
    '```python',
    'def two_sum(nums, target):',
    '    seen = {}',
    '```', '',
    '```python',
    'def verify():',
    '    assert two_sum([2, 7, 11, 15], 9) == [0, 1]',
    '```', '',
    '**Complexity**',
    'O(n) time and O(1) space.',
  ].join('\n');

  test('it is NOT sent to the repairer', () => {
    const result = validateCodingMarkdown(completeOwnFormat, 'coding_question_answer');
    assert.equal(
      result.repaired,
      undefined,
      'a complete, model-formatted answer must be exempt from the restructuring repair',
    );
  });

  test('both code blocks survive, in their original positions', () => {
    const result = validateCodingMarkdown(completeOwnFormat, 'coding_question_answer');
    const final = result.repaired ?? completeOwnFormat;
    assert.equal(countCodeBlocks(final), 2, 'both code blocks must survive');
    assert.ok(
      final.indexOf('def two_sum') < final.indexOf('def verify'),
      'the solution must still precede its verification block — the repair reorders them',
    );
    assert.match(final, /## Solution/, "the model's own heading must not be discarded");
  });
});

describe('the exemption stays NARROW — a half-finished canonical scaffold is still repaired', () => {
  // This is the case the widened test was added for on 2026-08-12. Fixing the
  // bold-heading false positive must not re-exempt it.
  const halfCanonical = [
    '## Approach', 'Use a hash map.', '',
    '## Code',
    '```python', 'def f(): pass', '```', '',
    '## Complexity', 'O(n) time and O(1) space.',
  ].join('\n');

  test('an answer that started OUR scaffold and dropped out is repaired', () => {
    const result = validateCodingMarkdown(halfCanonical, 'coding_question_answer');
    assert.ok(
      result.repaired !== undefined,
      'a partially canonical answer must still be completed, not exempted',
    );
  });

  test('a canonical heading appearing only INSIDE a code fence does not count', () => {
    // stripFencedCode runs before the canonical-heading scan, so a fence that
    // merely quotes `## Approach` must not read as "the model used our format".
    const headingInFence = [
      '## Solution', '',
      '```markdown', '## Approach', '```', '',
      '**Complexity**', 'O(n) time and O(1) space.',
    ].join('\n');
    const result = validateCodingMarkdown(headingInFence, 'coding_question_answer');
    assert.equal(result.repaired, undefined, 'a heading inside a fence is not our scaffold');
  });
});
