// electron/llm/__tests__/CodingHeadingStyleAndFenceBlindness2026_08_12.test.mjs
//
// Code review 2026-08-12, two defects in the coding validator/repairer that the
// 2026-08-10 non-destructive work left open:
//
//  1. `usesCanonicalHeadings` was widened to "any ONE recognized section", but
//     `sectionHeader` matches a BOLD `**Approach**` as readily as `## Approach`
//     (its `#{0,3}` prefix is optional on purpose, so completeness checks see
//     the model's own format). So a complete, correct answer written in bold
//     headings — the single most common LLM formatting choice — was classified
//     as "using our canonical format", lost the non-destructive exemption, and
//     went back through the LOSSY repair. That is the exact 2026-08-10
//     regression the exemption exists to prevent.
//
//  2. `repairCodingMarkdown`'s last-resort complexity lookup scanned the WHOLE
//     answer including fenced code, so a Big-O written in a comment about a
//     DISCARDED approach was lifted out of the fence and published as the
//     shipped code's official Complexity section.
//
// The fix keeps both intents intact: an answer that genuinely started the
// canonical `##` scaffold and dropped out is still repaired.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { repairCodingMarkdown, validateCodingMarkdown } from '../../../dist-electron/electron/llm/index.js';

// Complete answer in the MODEL's own format: bold pseudo-headings, real code,
// real complexity stated as prose. Nothing here needs repair.
const BOLD_HEADING_COMPLETE = `**Approach**
Walk the array once with two pointers and swap inward.

**Code**
\`\`\`python
def reverse(a):
    i, j = 0, len(a) - 1
    while i < j:
        a[i], a[j] = a[j], a[i]
        i += 1
        j -= 1
    return a
\`\`\`

**Complexity**
Runs in O(n) time and O(1) space.`;

// The SAME answer using our canonical markdown headings but abandoning the
// scaffold partway (no Technique / Dry Run / Follow-ups). This one must still
// be repaired — that was the point of the 2026-08-12 widening.
const CANONICAL_PARTIAL = `## Approach
Walk the array once with two pointers and swap inward.

## Code
\`\`\`python
def reverse(a):
    return a[::-1]
\`\`\`

## Complexity
Runs in O(n) time and O(1) space.`;

describe('non-destructive exemption keys on heading STYLE, not just recognition', () => {
  test('a complete answer in the model\'s own bold headings is NOT rewritten', () => {
    const result = validateCodingMarkdown(BOLD_HEADING_COMPLETE);
    assert.equal(result.repaired, undefined,
      `a complete bold-heading answer must keep the non-destructive exemption, got a repair:\n${result.repaired}`);
  });

  test('a single bold heading does not make an answer "canonical"', () => {
    const oneSection = BOLD_HEADING_COMPLETE.replace('**Approach**', '**How it works**');
    assert.equal(validateCodingMarkdown(oneSection).repaired, undefined);
  });

  test('an answer that STARTED the canonical scaffold and dropped out IS repaired', () => {
    const result = validateCodingMarkdown(CANONICAL_PARTIAL);
    assert.ok(result.repaired, 'a half-finished canonical answer must still be repaired');
  });

  test('canonical headings inside a code fence do not count as our format', () => {
    // A markdown-generating answer can legitimately print "## Code" INSIDE a
    // fence; that is the model's sample output, not its heading style.
    const fencedHashes = `**Approach**
Emit a report.

**Code**
\`\`\`python
print("## Code")
print("## Complexity")
\`\`\`

**Complexity**
O(1) time and O(1) space.`;
    assert.equal(validateCodingMarkdown(fencedHashes).repaired, undefined);
  });
});

describe('the repairer never lifts a complexity bound out of a code fence', () => {
  const DISCARDED_BOUND_IN_FENCE = `## Approach
Use a hash map for the lookup.

## Code
\`\`\`python
# brute force is O(n^2), too slow
def two_sum(nums, target):
    seen = {}
    for i, n in enumerate(nums):
        if target - n in seen:
            return [seen[target - n], i]
        seen[n] = i
\`\`\``;

  test('a bound stated only in a discarded-approach comment is not published as the answer\'s complexity', () => {
    const repaired = repairCodingMarkdown(DISCARDED_BOUND_IN_FENCE);
    const complexitySection = repaired.split(/^## Complexity\s*$/m)[1] || '';
    assert.ok(!/O\(n\^2\)/.test(complexitySection),
      `the rejected algorithm's bound must not become the shipped code's complexity:\n${complexitySection}`);
  });

  test('the discarded-approach comment itself survives inside the code', () => {
    // Non-destructive: we stop READING the fence, we never edit it.
    const repaired = repairCodingMarkdown(DISCARDED_BOUND_IN_FENCE);
    assert.ok(repaired.includes('# brute force is O(n^2), too slow'), repaired);
  });

  test('a bound the model stated in PROSE is still used verbatim', () => {
    const prose = `## Approach
Two pointers, swapping inward. Runs in O(n) time and O(1) space.

## Code
\`\`\`python
def reverse(a):
    return a[::-1]
\`\`\``;
    const repaired = repairCodingMarkdown(prose);
    assert.ok(/O\(n\)/.test(repaired), repaired);
    assert.ok(!/O\(\?\)/.test(repaired), `a real stated bound must not be replaced by the placeholder:\n${repaired}`);
  });
});
