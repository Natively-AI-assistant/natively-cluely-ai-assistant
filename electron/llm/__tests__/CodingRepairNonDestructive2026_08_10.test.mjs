// electron/llm/__tests__/CodingRepairNonDestructive2026_08_10.test.mjs
//
// USER-REPORTED, reproduced against the LIVE natively-api backend: a correct,
// complete coding answer is replaced by one that is strictly WORSE.
//
// This is NOT the deadline case (DeadlineTruncatedCodingNoScaffold2026_08_10).
// It happens on a perfectly healthy ~1.7s answer with no timeout at all: the
// model simply wrote good prose in its OWN format instead of the six-heading
// coding contract, so validateAnswerStructure "repaired" it — and the repair is
// LOSSY. Measured on live output (2 of 3 live coding answers hit it):
//
//   * the second fenced code block was DROPPED — the "**Python implementation:**"
//     heading was left followed by nothing;
//   * the model's own correct "runs in O(n) time and O(1) space" was replaced by
//     the "O(?)" placeholder, because extractComplexityText only inspects the
//     PREAMBLE and this answer stated its bound after a heading;
//   * a generic "Trace a small sample input..." dry-run the model never wrote
//     was inserted.
//
// repairCodingMarkdown documents itself as "NON-DESTRUCTIVE". These tests hold
// it to that: a repair may reorder and add headings, but it must never delete
// content the model actually produced, and must never overwrite a real,
// model-stated complexity with a placeholder.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { repairCodingMarkdown, validateAnswerStructure } from '../../../dist-electron/electron/llm/index.js';

// Verbatim shape of the live answer that regressed (trimmed for readability;
// the structural features that matter — inline complexity prose, two fenced
// blocks, bold pseudo-headings instead of `##` — are preserved exactly).
const LIVE_ANSWER = `Here's the approach:

**Approach: Iterative reversal using three pointers**

1. Use three pointers: \`prev\`, \`current\`, and \`next\`.
2. Initialize \`prev\` to \`None\` and \`current\` to the head of the list.
3. Continue until \`current\` becomes \`None\`. At that point, \`prev\` is the new head.

This runs in **O(n)** time and **O(1)** space, since we only rearrange pointers without extra memory.

---

**Python implementation:**

\`\`\`python
def reverse_linked_list(head):
    prev = None
    current = head
    while current is not None:
        next_node = current.next
        current.next = prev
        prev = current
        current = next_node
    return prev
\`\`\`

**Usage (assuming a simple Node class):**

\`\`\`python
class Node:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next
\`\`\`

The function mutates the original list in place and returns the new head.`;

describe('repairCodingMarkdown is non-destructive on a complete answer', () => {
  const repaired = repairCodingMarkdown(LIVE_ANSWER, 'reverse a linked list', 'python');

  test('the model\'s real complexity is not replaced by an O(?) placeholder', () => {
    assert.ok(/O\(n\)/.test(LIVE_ANSWER), 'precondition: the source states O(n)');
    assert.ok(
      !/O\(\?\)/.test(repaired),
      `the model stated O(n)/O(1) but the repair emitted the O(?) placeholder:\n${repaired}`,
    );
  });

  test('no fenced code block the model produced is dropped', () => {
    const srcBlocks = (LIVE_ANSWER.match(/```/g) || []).length / 2;
    const outBlocks = (repaired.match(/```/g) || []).length / 2;
    assert.ok(
      outBlocks >= srcBlocks,
      `source had ${srcBlocks} code block(s), repaired output has ${outBlocks}`,
    );
  });

  test('the implementation body survives verbatim', () => {
    assert.ok(
      repaired.includes('def reverse_linked_list(head):'),
      `the primary implementation was lost:\n${repaired}`,
    );
    assert.ok(
      repaired.includes('class Node:'),
      `the second code block (usage example) was dropped:\n${repaired}`,
    );
  });

  test('no fabricated dry-run reaches the user for a complete answer', () => {
    // repairCodingMarkdown ALWAYS fills a missing Dry Run with a neutral line —
    // that is intended for an answer it genuinely has to scaffold. The fix is
    // that a complete answer never reaches the repair at all, so assert the
    // real contract (what the user ends up with) rather than the raw helper.
    const result = validateAnswerStructure('dsa_question_answer', LIVE_ANSWER);
    const delivered = result.repaired ?? LIVE_ANSWER;
    assert.ok(
      !/Trace a small sample input through the code/.test(delivered),
      `a dry-run the model never wrote reached the user:\n${delivered}`,
    );
  });
});

describe('a complete answer is not "repaired" at all', () => {
  // The strongest form of the fix: an answer that already carries code AND a
  // stated complexity is COMPLETE. Reformatting it into the six-heading contract
  // can only lose content — there is no benefit to weigh against that risk.
  test('validateAnswerStructure leaves a complete coding answer alone', () => {
    const result = validateAnswerStructure('coding_question_answer', LIVE_ANSWER);
    assert.ok(
      result.ok || !result.repaired,
      'an answer containing both code and a stated complexity must not be rewritten',
    );
  });

  test('a DSA answer with NO code at all is still repaired', () => {
    // The repair must keep working where it genuinely helps. `dsa_question_answer`
    // is the type that enforces the full six-section contract (the live regression
    // routed here); `coding_question_answer` deliberately only checks for a
    // language-tagged block, so it is not the right type for this assertion.
    const proseOnly = 'You could walk the list and flip each pointer as you go, keeping a previous reference.';
    const result = validateAnswerStructure('dsa_question_answer', proseOnly);
    assert.ok(!result.ok, 'a code-less DSA answer must still fail validation');
    assert.ok(result.repaired, 'a code-less DSA answer must still be repaired');
  });

  test('the live-regression answer is left alone under the DSA contract too', () => {
    // This is the exact type the live failure routed to.
    const result = validateAnswerStructure('dsa_question_answer', LIVE_ANSWER);
    assert.ok(
      !result.repaired,
      `a complete answer was still rewritten under the DSA contract:\n${result.repaired}`,
    );
  });
});
