// electron/llm/__tests__/CodingContract.test.mjs
//
// Release-blocking coding-structure coverage (Phase 14/15). Proves the single
// canonical coding contract holds end-to-end across:
//   - codingContract: the shared section source of truth,
//   - AnswerValidator: validate / repair / render / scaffold,
//   - AnswerPlanner: routing + scaffold flag + forbidden-layer isolation,
// for the full required problem list (odd/even, two-sum, reverse linked list,
// binary search, valid parentheses, longest substring, palindrome, prime,
// factorial, fibonacci, system design, debugging).

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  planAnswer,
  isCodingAnswerType,
  shouldScaffold,
  validateCodingMarkdown,
  validateAnswerStructure,
  repairCodingMarkdown,
  renderCodingAnswerMarkdown,
  buildCodingScaffold,
  CODING_CONTRACT,
  CODING_CONTRACT_TINY,
  CODING_SECTIONS,
  CODING_SECTION_HEADINGS,
} from '../../../dist-electron/electron/llm/index.js';

const REQUIRED_HEADINGS = [
  '## Approach',
  '## Technique / Data Structure / Algorithm Used',
  '## Code',
  '## Dry Run',
  '## Complexity',
  '## Interviewer Follow-up Points',
];

function assertContract(md, label) {
  for (const h of REQUIRED_HEADINGS) {
    assert.ok(md.includes(h), `${label}: missing heading "${h}"`);
  }
  const positions = REQUIRED_HEADINGS.map((h) => md.indexOf(h));
  for (let i = 1; i < positions.length; i++) {
    assert.ok(positions[i - 1] < positions[i], `${label}: "${REQUIRED_HEADINGS[i - 1]}" must precede "${REQUIRED_HEADINGS[i]}"`);
  }
  assert.ok(!/^\s*```/.test(md), `${label}: must not start with a code fence`);
  assert.ok(/^##\s+Approach/m.test(md), `${label}: Approach must be a heading`);
}

const planFor = (question, source = 'what_to_answer') => planAnswer({
  question,
  source,
  speakerPerspective: source === 'what_to_answer' ? 'interviewer' : 'user',
});

// ── 1. Single source of truth ───────────────────────────────────────────────
describe('canonical coding contract', () => {
  test('CODING_SECTIONS has exactly the six required sections', () => {
    assert.deepEqual([...CODING_SECTIONS], [
      'Approach', 'Technique / Data Structure / Algorithm Used', 'Code',
      'Dry Run', 'Complexity', 'Interviewer Follow-up Points',
    ]);
  });
  test('CODING_SECTION_HEADINGS are the ## form', () => {
    assert.deepEqual([...CODING_SECTION_HEADINGS], REQUIRED_HEADINGS);
  });
  test('CODING_CONTRACT contains every ## heading verbatim', () => {
    for (const h of REQUIRED_HEADINGS) assert.ok(CODING_CONTRACT.includes(h), `contract missing ${h}`);
  });
  test('CODING_CONTRACT forbids starting with code', () => {
    assert.match(CODING_CONTRACT, /Do NOT start the answer with code/i);
  });
  test('tiny contract names every section and the ## form', () => {
    for (const s of CODING_SECTIONS) assert.ok(CODING_CONTRACT_TINY.includes(`## ${s}`), `tiny contract missing ## ${s}`);
  });
});

// ── 2. Scaffold ──────────────────────────────────────────────────────────────
describe('buildCodingScaffold', () => {
  test('scaffold itself satisfies the heading contract and order', () => {
    assertContract(buildCodingScaffold(), 'scaffold');
  });
  test('scaffold does not start with code and has placeholder prose', () => {
    const s = buildCodingScaffold();
    assert.ok(!/^\s*```/.test(s));
    assert.match(s, /Working on the approach/i);
  });
});

// ── 3. renderCodingAnswerMarkdown ────────────────────────────────────────────
describe('renderCodingAnswerMarkdown', () => {
  test('renders a full CodingAnswer object into the contract', () => {
    const md = renderCodingAnswerMarkdown({
      approach: 'Use modulo.',
      technique: 'Modulo operator.',
      language: 'python',
      code: 'def f(n):\n    return n % 2 == 0',
      dryRun: 'f(4) -> True',
      complexity: 'Time: O(1). Space: O(1).',
      interviewerFollowUpPoints: ['Negative numbers', 'Return vs print'],
    });
    assertContract(md, 'render');
    assert.match(md, /```python/);
  });
  test('defaults language to python and supplies a follow-up when none given', () => {
    const md = renderCodingAnswerMarkdown({
      approach: 'x', technique: 'y', language: '', code: 'print(1)', dryRun: 'z',
      complexity: 'Time: O(1). Space: O(1).', interviewerFollowUpPoints: [],
    });
    assert.match(md, /```python/);
    assert.match(md, /## Interviewer Follow-up Points/);
  });
});

// ── 4. The required problem list — repair must always produce the contract ───
const REQUIRED_PROBLEMS = [
  'what is the code for odd even',
  'odd even in python',
  'write code to check if a number is odd or even',
  'can you solve two sum',
  'two sum problem',
  'reverse a linked list',
  'reverse linked list in java',
  'binary search',
  'implement binary search',
  'valid parentheses',
  'check valid parentheses',
  'longest substring without repeating characters',
  'check if a string is a palindrome',
  'palindrome check',
  'prime number check',
  'is this a prime number',
  'factorial of a number',
  'compute factorial',
  'fibonacci sequence',
  'nth fibonacci number',
  'fizzbuzz',
  'merge two sorted arrays',
  'find the maximum subarray sum',
  'detect a cycle in a linked list',
  'level order traversal of a binary tree',
];

describe('repairCodingMarkdown re-sections every required problem under the six headings', () => {
  for (const q of REQUIRED_PROBLEMS) {
    test(`repair("${q}") → full six-section contract`, () => {
      // Simulate the worst case: model returned code-first content with no headings.
      const raw = '```python\ndef solve(n):\n    return n\n```\nThat is the answer.';
      const repaired = repairCodingMarkdown(raw, q);
      assertContract(repaired, `repair:${q}`);
    });
    test(`repair("${q}") has all six sections in order and a code block`, () => {
      const repaired = repairCodingMarkdown('here is code\n```js\nx=1\n```', q);
      const v = validateCodingMarkdown(repaired);
      // Repaired output must have all sections in order. (It may still report
      // ok=false because, by design, repair does NOT fabricate a Big-O when the
      // model gave none — it emits an O(?) "fill this in" placeholder instead.)
      assert.equal(v.missingSections.length, 0, `repair:${q} missing ${v.missingSections.join(',')}`);
    });
  }
});

// ── 5. repair NEVER fabricates algorithmic content (anti-hardcode contract) ──
describe('repair re-sections without fabricating', () => {
  test('odd/even repair does NOT inject a hardcoded check_odd_even template', () => {
    // The model returned its OWN (different) code; repair must preserve it and
    // must NOT substitute a canned odd/even solution.
    const raw = '```python\nprint("odd" if n & 1 else "even")\n```';
    const md = repairCodingMarkdown(raw, 'what is the code for odd even');
    assertContract(md, 'oddeven');
    assert.match(md, /n & 1/, "must preserve the model's own code, not a canned template");
    assert.doesNotMatch(md, /check_odd_even/, 'no hardcoded check_odd_even template');
  });
  test("repair preserves the model's own complexity instead of overwriting with O(n)", () => {
    const raw = '```python\ndef f(x):\n  return x*x\n```\nTime Complexity: O(1). Space Complexity: O(1).';
    const md = repairCodingMarkdown(raw, 'square a number');
    assertContract(md, 'preserve-complexity');
    assert.match(md, /O\(1\)/, "must keep the model's O(1), not fabricate O(n)");
    assert.doesNotMatch(md, /O\(n\)/, 'must not inject a generic O(n)');
  });
  test('repair emits a neutral O(?) placeholder (not a fabricated bound) when complexity is absent', () => {
    const md = repairCodingMarkdown('```python\nx=1\n```', 'some problem');
    assertContract(md, 'no-complexity');
    assert.match(md, /O\(\?\)/, 'absent complexity → visible O(?) placeholder, never a fabricated value');
  });
  test('repair preserves a multi-term complexity O(n log n) verbatim (no collapse to O(n))', () => {
    const raw = '```python\nnums.sort()\n```\nTime Complexity: O(n log n). Space Complexity: O(n).';
    const md = repairCodingMarkdown(raw, 'sort an array');
    assertContract(md, 'nlogn');
    assert.match(md, /O\(n log n\)/, 'the log n term must survive');
    // Must not have lost the log n (i.e., a bare "Time ... O(n) because" with no log).
    assert.doesNotMatch(md, /Time Complexity:\s*O\(n\)\s*[.\n]/i, 'must not collapse O(n log n) to O(n)');
  });
  test('repair preserves O(V + E) (plus sign inside parens survives)', () => {
    const raw = '```python\nbfs(graph)\n```\nTime: O(V + E). Space: O(V).';
    const md = repairCodingMarkdown(raw, 'graph traversal');
    assertContract(md, 'graph');
    assert.match(md, /O\(V \+ E\)/, 'V + E must survive');
  });
  test('repair keeps approach prose when complexity is on the SAME sentence (no dangling connective)', () => {
    // The classic combined sentence — repair must lift the complexity CLAUSE
    // into Complexity and KEEP a clean "We scan the array once" in Approach,
    // with NO stranded connector ("which is and"). Regression for the re-review.
    const cases = [
      ['```python\nfor x in nums: ...\n```\nWe scan the array once, which is O(n) time and O(1) space.', /scan the array once/i],
      ['```python\nbfs(g)\n```\nBFS over the graph runs in O(V + E) time and O(V) space.', /BFS over the graph/i],
      ['```python\nnums.sort()\n```\nSort then sweep, giving O(n log n) time and O(n) space.', /Sort then sweep/i],
      ['```python\nseen={}\n```\nUse a hash map. Track complements as we go. This runs in O(n) time and O(n) space.', /Track complements as we go/i],
    ];
    for (const [raw, approachRe] of cases) {
      const md = repairCodingMarkdown(raw, 'scan');
      assertContract(md, 'combined');
      const approachBlock = md.split('## Technique')[0];
      const complexityBlock = md.split('## Complexity')[1]?.split('## Interviewer')[0] ?? '';
      assert.match(approachBlock, approachRe, 'approach prose must survive');
      // No dangling connector left in the approach ("which is and", "runs in and", "giving and").
      assert.doesNotMatch(approachBlock, /\b(which is|runs? in|running in|giving|yielding)\s+(and|,)?\s*[.\n]/i,
        'no stranded connector in approach');
      assert.doesNotMatch(approachBlock, /\b(which is|runs in|giving)\s+and\b/i, 'no "<connector> and" debris');
      assert.doesNotMatch(approachBlock, /\.\s*\./, 'no doubled period in approach');
      // The lifted Complexity must NOT carry a connector/subject prefix
      // ("This runs in O(n)…") — it should read as a clean bound.
      assert.doesNotMatch(complexityBlock, /\b(this|it|that)\s+(is\s+)?runs?\s+in\b/i, 'no subject+connector prefix in complexity');
      assert.match(complexityBlock, /O\(/, 'complexity bound preserved');
    }
  });
  // ── PRODUCTION BUG (2026-06-02): repair destroyed a GOOD model answer ──────
  // A real answer used mislabeled headings + LaTeX complexity ($O(N)$). The old
  // repair (a) leaked internal instruction placeholders ("_Name the core data
  // structure used._"), (b) corrupted "$O(N)$" into "$$" (frontend KaTeX soup),
  // and (c) fired at all because hasComplexity didn't recognize LaTeX/bare O().
  describe('regression: repair must not leak placeholders, corrupt LaTeX, or lose sections', () => {
    const GOOD_ANSWER_WITH_LATEX_AND_NONCANONICAL_HEADINGS = `## Approach

Iterate from 1 to 10000 with step 2 to generate odd numbers directly.

Iteration with Step / List Comprehension. Dry run with limit 10: range(1,11,2) yields 1, 3, 5, 7, 9.

## Code
\`\`\`python
def get_odd_numbers(limit):
    return [num for num in range(1, limit + 1, 2)]
\`\`\`

## Complexity
Time Complexity: $O(N)$, where $N$ is the limit. The loop runs $N/2$ times.
Space Complexity: $O(N/2)$ to store the list.

## Interviewer Follow-up Points
- Use a generator for memory.`;

    test('NEVER renders an internal instruction placeholder to the user', () => {
      const md = repairCodingMarkdown(GOOD_ANSWER_WITH_LATEX_AND_NONCANONICAL_HEADINGS, 'odd numbers');
      // These exact italic self-instructions must NEVER reach the user.
      assert.doesNotMatch(md, /_Name the core data structure or algorithm used\._/i, 'technique placeholder leaked');
      assert.doesNotMatch(md, /_Walk through one sample input out loud/i, 'dry-run placeholder leaked');
      assert.doesNotMatch(md, /_State the core idea in one or two interview-speakable sentences\._/i, 'approach placeholder leaked');
    });

    test('NEVER corrupts LaTeX math into empty $$ (frontend KaTeX must not explode)', () => {
      const md = repairCodingMarkdown(GOOD_ANSWER_WITH_LATEX_AND_NONCANONICAL_HEADINGS, 'odd numbers');
      assert.doesNotMatch(md, /\$\$/, 'empty $$ would break rehype-katex');
      // The real complexity must survive in some readable form.
      assert.match(md, /O\(N\)/, 'complexity O(N) preserved');
    });

    test('preserves the model code verbatim', () => {
      const md = repairCodingMarkdown(GOOD_ANSWER_WITH_LATEX_AND_NONCANONICAL_HEADINGS, 'odd numbers');
      assert.match(md, /range\(1, limit \+ 1, 2\)/, 'model code preserved');
    });

    test('a fully-valid answer with LaTeX complexity is NOT flagged invalid (no needless repair)', () => {
      // hasComplexity must recognize $O(N)$ / bare O(N) so validate does not
      // reject a correct answer and trigger destructive repair.
      const valid = `## Approach

Iterate with step 2.

## Technique / Data Structure / Algorithm Used

Range with a step; list comprehension.

## Code
\`\`\`python
def f(n):
    return list(range(1, n + 1, 2))
\`\`\`

## Dry Run

For n=10: range(1,11,2) → 1,3,5,7,9.

## Complexity

Time Complexity: $O(N)$ because the loop runs N/2 times.
Space Complexity: $O(N)$ for the output list.

## Interviewer Follow-up Points

- Use a generator to reduce memory.`;
      const v = validateCodingMarkdown(valid);
      assert.equal(v.hasComplexity, true, 'LaTeX $O(N)$ must count as complexity');
      assert.equal(v.ok, true, `valid LaTeX answer must pass; missing=${v.missingSections} hasComplexity=${v.hasComplexity}`);
    });

    test('hasComplexity recognizes LaTeX and backtick and bare forms', () => {
      // Spot-check the validator predicate via validateCodingMarkdown.ok proxies.
      const forms = [
        'Time Complexity: $O(n)$. Space Complexity: $O(1)$.',
        'Time Complexity: `O(n)`. Space Complexity: `O(1)`.',
        'Time Complexity: O(n). Space Complexity: O(1).',
        'Time: \\(O(n)\\). Space: \\(O(1)\\).',
      ];
      for (const c of forms) {
        const md = `## Approach\n\na\n\n## Technique / Data Structure / Algorithm Used\n\nt\n\n## Code\n\n\`\`\`python\nx=1\n\`\`\`\n\n## Dry Run\n\nd\n\n## Complexity\n\n${c}\n\n## Interviewer Follow-up Points\n\n- f`;
        const v = validateCodingMarkdown(md);
        assert.equal(v.hasComplexity, true, `complexity form not recognized: ${c}`);
      }
    });
  });

  test('repair handles a prose-only answer (no code block) with the MISSING_CODE marker', () => {
    const raw = 'Use a hash map to track complements. Time Complexity: O(n). Space Complexity: O(n).';
    const md = repairCodingMarkdown(raw, 'two sum');
    assertContract(md, 'prose-only');
    assert.match(md, /did not return code|Regenerate/, 'missing-code marker present');
    assert.match(md, /O\(n\)/, 'prose complexity preserved even with no code block');
  });
  test('repair handles a SQL answer (sql fence preserved)', () => {
    const raw = '```sql\nSELECT id FROM users WHERE active = true;\n```';
    const md = repairCodingMarkdown(raw, 'active users', 'sql');
    assertContract(md, 'sql');
    assert.match(md, /```sql/, 'sql language tag preserved');
  });
  test('repair honors requested language (java)', () => {
    const md = repairCodingMarkdown('```java\nint x=1;\n```', 'odd even in java', 'java');
    assert.match(md, /```java/);
  });
  test('repair does NOT leak resume/JD/negotiation context', () => {
    const md = repairCodingMarkdown('```python\nx=1\n```', 'odd even');
    assert.doesNotMatch(md, /\b(resume|job description|salary|compensation|negotiation)\b/i);
  });
});

// ── 6. validateCodingMarkdown rejects bad structure ──────────────────────────
describe('validateCodingMarkdown rejects malformed answers', () => {
  test('code-first answer is invalid', () => {
    const v = validateCodingMarkdown('```python\nprint(1)\n```\n## Approach\nx');
    assert.equal(v.ok, false, 'code-first must fail');
  });
  test('missing sections is invalid and yields a repaired version', () => {
    const v = validateCodingMarkdown('## Approach\njust an approach');
    assert.equal(v.ok, false);
    assert.ok(v.missingSections.length > 0);
    assert.ok(v.repaired, 'should provide a repaired answer');
    assertContract(v.repaired, 'validate-repaired');
  });
  test('wrong heading order is invalid', () => {
    const md = [
      '## Code', '```py\nx=1\n```',
      '## Approach', 'a',
      '## Technique / Data Structure / Algorithm Used', 't',
      '## Dry Run', 'd',
      '## Complexity', 'Time: O(1). Space: O(1).',
      '## Interviewer Follow-up Points', '- f',
    ].join('\n\n');
    const v = validateCodingMarkdown(md);
    assert.equal(v.ok, false, 'out-of-order headings must fail');
  });
  test('a well-formed answer passes', () => {
    const md = renderCodingAnswerMarkdown({
      approach: 'a', technique: 't', language: 'python', code: 'print(1)',
      dryRun: 'd', complexity: 'Time Complexity: O(1) because constant. Space Complexity: O(1) because constant.',
      interviewerFollowUpPoints: ['edge cases'],
    });
    const v = validateCodingMarkdown(md);
    assert.equal(v.ok, true, `well-formed should pass; missing=${v.missingSections}`);
  });
});

// ── 7. validateAnswerStructure is a no-op for non-coding types ───────────────
describe('validateAnswerStructure gating', () => {
  test('non-coding answer types are not forced into the coding contract', () => {
    const v = validateAnswerStructure('identity_answer', 'My name is Alex.');
    assert.equal(v.ok, true);
    assert.deepEqual(v.missingSections, []);
  });
  test('dsa answer type enforces the contract', () => {
    // Six-section enforcement moved to dsa_question_answer. coding_question_answer
    // (general implementation) only requires a code block; prose-only is rejected
    // but not template-repaired.
    const v = validateAnswerStructure('dsa_question_answer', 'just prose, no sections');
    assert.equal(v.ok, false);
    assert.ok(v.repaired);
  });
});

// ── 8. Planner routes coding problems correctly + scaffold flag ──────────────
describe('planAnswer coding routing + scaffold + isolation', () => {
  const codingQs = [
    'what is the code for odd even',
    'can you solve two sum',
    'reverse a linked list',
    'implement binary search',
    'valid parentheses',
    'write a function for fibonacci',
    'longest substring without repeating characters',
  ];
  for (const q of codingQs) {
    test(`"${q}" routes to a coding answer type`, () => {
      const plan = planFor(q);
      assert.ok(
        plan.answerType === 'coding_question_answer' || plan.answerType === 'dsa_question_answer',
        `"${q}" → ${plan.answerType}`,
      );
      assert.ok(isCodingAnswerType(plan.answerType));
      assert.equal(plan.shouldShowImmediateScaffold, true, 'coding should scaffold');
    });
    test(`"${q}" forbids resume/JD/negotiation/custom/reference`, () => {
      const plan = planFor(q);
      for (const layer of ['resume', 'jd', 'negotiation', 'custom_context', 'reference_files']) {
        assert.ok(plan.forbiddenContextLayers.includes(layer), `"${q}" must forbid ${layer}`);
      }
    });
  }

  test('system design + debugging also scaffold', () => {
    assert.equal(shouldScaffold('system_design_answer'), true);
    assert.equal(shouldScaffold('debugging_question_answer'), true);
    assert.equal(planFor('design a url shortener').shouldShowImmediateScaffold, true);
  });

  test('identity / non-coding do NOT scaffold', () => {
    assert.equal(shouldScaffold('identity_answer'), false);
    assert.equal(planFor('what is my name?', 'manual_input').shouldShowImmediateScaffold, false);
  });

  test('maxFirstUsefulTokenMs is set and aliases maxInitialLatencyMs', () => {
    const plan = planFor('two sum');
    assert.equal(typeof plan.maxFirstUsefulTokenMs, 'number');
    assert.equal(plan.maxFirstUsefulTokenMs, plan.maxInitialLatencyMs);
  });
});

// ── 9. CONTEXT-ISOLATION-CODING regression (release-blocking) ────────────────
describe('CONTEXT-ISOLATION-CODING', () => {
  test('coding plans never require resume/jd/negotiation layers', () => {
    for (const q of ['write code for odd even', 'two sum', 'binary search']) {
      const plan = planFor(q, 'manual_input');
      for (const layer of ['resume', 'jd', 'negotiation']) {
        assert.ok(!plan.requiredContextLayers.includes(layer), `"${q}" must not REQUIRE ${layer}`);
      }
    }
  });
});
