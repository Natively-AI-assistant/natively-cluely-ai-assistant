// electron/llm/__tests__/CodingRepairOrphanHeading2026_08_11.test.mjs
//
// Third live regression on the same repair path (natively-api, 2026-08-11).
//
// CodingRepairNonDestructive2026_08_10 exempted answers that are substantively
// complete (code + a stated complexity). This case is NOT exempt and SHOULD be
// repaired: the model wrote a correct BFS solution but never stated any
// complexity bound at all, so scaffolding it is a genuine improvement.
//
// The bug is what the repair does on its way there. It lifts the code out of
// the Approach prose with `stripCodeBlock`, but only removes the fenced block
// itself — the model's own lead-in heading is left dangling:
//
//     **Python implementation:**
//
//     <nothing>
//
//     This returns the shortest path as a list of nodes...
//
// The code is not lost (it is re-emitted under `## Code`), but the user watched
// code appear under "Python implementation:" and then saw it vanish from that
// spot, leaving an empty section. That is the same "my answer changed under me"
// symptom, and it is avoidable: a heading whose only content was the extracted
// block should go with it.
//
// Deliberately NOT asserted here: that the answer is left unrepaired. It has no
// complexity bound, so the six-section scaffold is the right outcome — only the
// orphaned heading is the defect.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { validateAnswerStructure } from '../../../dist-electron/electron/llm/index.js';

// Verbatim structure of the live answer that regressed.
const LIVE_BFS_ANSWER = `Here's the approach first, then the implementation:

**Approach:**
BFS explores a graph level by level. Because we process nodes in order of increasing distance, the first time we reach a target node is guaranteed to be via the shortest path.

**Python implementation:**

\`\`\`python
from collections import deque

def bfs_shortest_path(graph, start, target):
    if start == target:
        return [start]
    visited = {start}
    queue = deque([(start, [start])])
    while queue:
        node, path = queue.popleft()
        for neighbor in graph.get(node, []):
            if neighbor not in visited:
                if neighbor == target:
                    return path + [neighbor]
                visited.add(neighbor)
                queue.append((neighbor, path + [neighbor]))
    return None
\`\`\`

This returns the shortest path as a list of nodes, or \`None\` if the target is unreachable.`;

describe('repairing a code-bearing answer does not leave an orphaned heading', () => {
  const result = validateAnswerStructure('dsa_question_answer', LIVE_BFS_ANSWER);
  const delivered = result.repaired ?? LIVE_BFS_ANSWER;

  test('precondition: this answer IS repaired (it states no complexity)', () => {
    assert.ok(!/O\(/.test(LIVE_BFS_ANSWER), 'fixture must not state a bound');
    assert.ok(result.repaired, 'an answer with no complexity bound should still be scaffolded');
  });

  test('the model\'s code lead-in is not left dangling with no content', () => {
    // The heading exists in the Approach section but its block was lifted out.
    const orphan = /\*\*Python implementation:\*\*\s*\n\s*\n\s*(?:\n|This returns)/.test(delivered);
    assert.ok(!orphan, `"Python implementation:" was left with no code beneath it:\n\n${delivered}`);
  });

  test('the code itself still survives somewhere in the answer', () => {
    assert.ok(
      delivered.includes('def bfs_shortest_path(graph, start, target):'),
      `the implementation was lost entirely:\n\n${delivered}`,
    );
  });

  test('surrounding prose is preserved', () => {
    assert.ok(
      delivered.includes('BFS explores a graph level by level'),
      'approach prose must survive the repair',
    );
    assert.ok(
      delivered.includes('This returns the shortest path'),
      'trailing prose must survive the repair',
    );
  });
});
