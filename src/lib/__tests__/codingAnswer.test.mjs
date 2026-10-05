// Usage tab answer layout (MeetingDetails › UsageInteraction / CodingAnswerBlock),
// plus the notes' follow-up draft and title.
//
// Each case is a shape found in real stored answers, pinned so the layout keeps
// showing what the model wrote: bullets stay bullets, a bracket is not lost, a
// section that only says "N/A" is dropped, the answer meant to be spoken is not
// buried inside the Follow-up pill, and the model's reasoning, stray [[GIST]]
// lines and markdown chrome never print. Pure functions; no DOM, no platform.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  leadingItem, techniqueLabel, extractComplexity, isNotApplicable, splitTrailingAnswer,
  plainTitle, breakGluedLines, fixBoldSpacing, latexParensToDollars, TECHNIQUE_MAX,
  stripLeadingReasoning, stripStrayGistLines, plainEmailText, plainMeetingTitle, reflowFlattenedList, latexToPlain,
  techniqueFromApproach,
} from '../codingAnswer.mjs';
import fs from 'node:fs';
import path from 'node:path';

describe('leadingItem — the one-line thesis', () => {
  test('first bullet only, marker stripped, bold kept for the markdown renderer', () => {
    const body = '- Classic **TSP**: given n cities and a matrix of pairwise distances, find the shortest tour that visits every city exactly once and returns to the start.\n- **Hard problem**: brute force checks all (n-1)!/2 tours, which blows up fast.';
    assert.equal(leadingItem(body), 'Classic **TSP**: given n cities and a matrix of pairwise distances, find the shortest tour that visits every city exactly once and returns to the start.');
  });
  test('a bullet that wraps onto a second line stays whole', () => {
    assert.equal(leadingItem('- Classic TSP: given n cities,\n  find the shortest tour. Then more.\n- second'), 'Classic TSP: given n cities, find the shortest tour.');
  });
  test('prose and numbered lists', () => {
    assert.equal(leadingItem('Use a hash map. Then scan once.'), 'Use a hash map.');
    assert.equal(leadingItem('1. Sort first. Then two pointers.'), 'Sort first.');
  });
  test('leading blank lines are skipped; empty is empty', () => {
    assert.equal(leadingItem('\n\n- One idea.'), 'One idea.');
    assert.equal(leadingItem('  \n'), '');
  });
});

describe('techniqueLabel — the chip in the code header', () => {
  test('list marker removed, first line only', () => {
    assert.equal(techniqueLabel('- Bitmask dynamic programming (Held–Karp)\n- another'), 'Bitmask dynamic programming (Held–Karp)');
  });
  test('a long parenthetical is dropped before anything is cut', () => {
    const label = techniqueLabel('- Bitmask dynamic programming with a very long qualifying phrase here (Held-Karp algorithm for TSP)');
    assert.ok(!label.includes('('), label);
  });
  test('never cut mid-word, never over the cap', () => {
    const label = techniqueLabel('- A very long technique name without any parenthetical whatsoever, going on and on and on');
    assert.ok(label.length <= TECHNIQUE_MAX, label);
    assert.ok(label.endsWith('…'), label);
    assert.match(label.slice(0, -1), /\S$/);
    assert.ok('A very long technique name without any parenthetical whatsoever, going on and on and on'.startsWith(label.slice(0, -1)), label);
  });
});

describe('extractComplexity — the cost chip', () => {
  test('nested brackets keep their closing bracket', () => {
    assert.equal(extractComplexity('- Time: O(n log(k))\n- Space: O(n)'), 'O(n log(k)) time · O(n) space');
    assert.equal(extractComplexity('Time: O(n * (m+k)), space O(1)'), 'O(n * (m+k)) time · O(1) space');
  });
  test('the ordinary forms', () => {
    assert.equal(extractComplexity('- Time complexity: O(n) average, O(n²) worst\n- Space: O(1)'), 'O(n) time · O(1) space');
    assert.equal(extractComplexity('O(n) and O(log n)'), 'O(n) · O(log n)');
  });
  test('LaTeX in the complexity becomes plain characters', () => {
    assert.equal(
      extractComplexity('- **Time Complexity:** $O(N \\log K)$ overall, where $N$ is the total.\n- **Space Complexity:** $O(T \\times K)$, where $T$ is the total.'),
      'O(N log K) time · O(T × K) space',
    );
    assert.equal(extractComplexity('- Time: $O(n^{2})$\n- Space: $O(1)$'), 'O(n^2) time · O(1) space');
  });
  test('no Big-O means no chip (there is no Complexity pill to fall back to)', () => {
    assert.equal(extractComplexity('N/A'), null);
    assert.equal(extractComplexity('Linear time, constant space'), null);
  });
});

describe('isNotApplicable', () => {
  for (const body of ['N/A', 'N/A,  this is a system design discussion, not an algorithm.', '- Not applicable, conceptual question.', 'Not applicable, conceptual question.', 'None', '  ', '']) {
    test(JSON.stringify(body), () => assert.equal(isNotApplicable(body), true));
  }
  for (const body of ['Time: O(n)', '- Walk the array once and keep a running maximum.', 'Nothing special about the recursion, but note the base case.', 'National average lookup via a hash map.', 'None of the elements repeat, so a set works.'.repeat(6)]) {
    test('kept: ' + body.slice(0, 40), () => assert.equal(isNotApplicable(body), false));
  }
});

describe('splitTrailingAnswer — the spoken answer after the last section', () => {
  test('behind a horizontal rule', () => {
    const body = '- Why not PostgreSQL? Append-only and versioned.\n- Results are write-heavy.\n\n---\n\nYes, I\'d put several things into object storage. Code snapshots, for one. They\'re versioned and append-only per edit.';
    const { body: head, tail } = splitTrailingAnswer(body);
    assert.equal(head, '- Why not PostgreSQL? Append-only and versioned.\n- Results are write-heavy.');
    assert.match(tail, /^Yes, I'd put several things/);
  });
  test('plain paragraphs after the bullet list', () => {
    const body = '- Difference between a counting semaphore and a binary one.\n\nA semaphore is a counter that controls how many threads can access a resource at the same time.\n\nThe key difference from a mutex is that any thread can release it.';
    const { body: head, tail } = splitTrailingAnswer(body);
    assert.equal(head, '- Difference between a counting semaphore and a binary one.');
    assert.match(tail, /^A semaphore is a counter/);
    assert.match(tail, /any thread can release it\.$/);
  });
  test('a list whose items are separated by blank lines is not split', () => {
    const body = '- First follow-up question about the approach.\n\n- Second follow-up question about the edge cases.\n\n- Third follow-up question about scaling.';
    assert.deepEqual(splitTrailingAnswer(body), { body, tail: '' });
  });
  test('an indented continuation of a bullet is not a tail', () => {
    const body = '- First follow-up question about the approach,\n\n  which continues here after a blank line and is still part of it.';
    assert.deepEqual(splitTrailingAnswer(body), { body, tail: '' });
  });
  test('prose-only follow-up, and a rule inside a code fence, are left alone', () => {
    const prose = 'Ask about the retry policy and how the queue behaves when the consumer is slow.';
    assert.deepEqual(splitTrailingAnswer(prose), { body: prose, tail: '' });
    const fenced = '- Config:\n```yaml\na: 1\n---\nb: 2\n```';
    assert.deepEqual(splitTrailingAnswer(fenced), { body: fenced, tail: '' });
  });
  test('a tiny tail is not worth splitting out', () => {
    const body = '- One follow-up.\n\n---\n\nOk.';
    assert.deepEqual(splitTrailingAnswer(body), { body, tail: '' });
  });
});

describe('plainTitle', () => {
  test('markdown emphasis is not printed', () => {
    assert.equal(plainTitle('**Key Design Decisions**'), 'Key Design Decisions');
    assert.equal(plainTitle('How `it` works'), 'How it works');
  });
});

describe('breakGluedLines', () => {
  test('bold-label lines under a prose line end it with a hard break', () => {
    const src = '**Strong answer structure:**\n**Present role:** "I\'m …"\n**Proof point:** "One thing …"\n\n**What makes a good answer:**\n- **Keep it short.** Yes.';
    const out = breakGluedLines(src);
    assert.equal(out, '**Strong answer structure:**  \n**Present role:** "I\'m …"  \n**Proof point:** "One thing …"\n\n**What makes a good answer:**\n- **Keep it short.** Yes.');
  });
  test('worked-example lines that each end a thought stay on their own lines', () => {
    assert.equal(
      breakGluedLines('Test (5,5,5): sorted, max(0,-5)=0 ✓\n(4,6,9): c-a-b = 9-4-6 = -1.\nBut answer is 5. Hmm.'),
      'Test (5,5,5): sorted, max(0,-5)=0 ✓  \n(4,6,9): c-a-b = 9-4-6 = -1.  \nBut answer is 5. Hmm.',
    );
    assert.equal(breakGluedLines('Path = A, C, F.\nSpace Complexity: O(n).'), 'Path = A, C, F.  \nSpace Complexity: O(n).');
  });
  test('a sentence wrapped mid-clause is not split', () => {
    const src = 'The algorithm walks the array once and keeps a running\nmaximum so that each element is compared exactly one time.';
    assert.equal(breakGluedLines(src), src);
  });
  test('lists, blank-separated paragraphs, code and existing hard breaks are untouched', () => {
    for (const src of ['- item\n**Bold** after a list item', '- item.\nNext sentence after a list item.', 'Text\n\n**Bold** after a blank line', '```\nx.\nNext\n**not a label**\n```', 'Line  \n**Bold**', 'Line\\\n**Bold**', 'Intro:\n1. First\n2. Second', '| a | b |\n| c | d |']) {
      assert.equal(breakGluedLines(src), src);
    }
  });
  test('a very long line is prose, not a written-out step', () => {
    const long = 'x'.repeat(170) + '.';
    assert.equal(breakGluedLines(long + '\nNext sentence.'), long + '\nNext sentence.');
  });
});

describe('fixBoldSpacing', () => {
  test('a space inside the ** … ** is closed so it renders as bold', () => {
    assert.equal(fixBoldSpacing('* ** Kafka:** Ingests events.'), '* **Kafka:** Ingests events.');
    assert.equal(fixBoldSpacing('Use **Kafka: ** here.'), 'Use **Kafka:** here.');
  });
  test('well-formed bold, maths and code are left alone', () => {
    for (const src of ['**ok** fine', 'Compute 2 ** 3 ** 4 in Python.', '`** x **` stays', '```\n** x **\n```']) assert.equal(fixBoldSpacing(src), src);
  });
});

describe('stripLeadingReasoning — a leaked <think> block', () => {
  test('the block goes, the answer stays', () => {
    assert.equal(stripLeadingReasoning('\n<think>\nThe user said "hi".\nThe active mode is `team_meet`.\n</think>\n\nHi there. How can I help?'), 'Hi there. How can I help?');
  });
  test('the generation-side tag set: thinking, reasoning, namespaced', () => {
    assert.equal(stripLeadingReasoning('<thinking>x</thinking> A'), 'A');
    assert.equal(stripLeadingReasoning('<reasoning effort="low">x</reasoning>\nA'), 'A');
    assert.equal(stripLeadingReasoning('<mm:think>x</mm:think> A'), 'A');
  });
  test('never blank, never mid-answer, never an unclosed block', () => {
    assert.equal(stripLeadingReasoning('<think>only reasoning</think>'), '<think>only reasoning</think>');
    assert.equal(stripLeadingReasoning('<think>never closed... text'), '<think>never closed... text');
    const discuss = 'The <think> tag wraps reasoning </think> in some models.';
    assert.equal(stripLeadingReasoning(discuss), discuss);
    assert.equal(stripLeadingReasoning('<div>x</div> A'), '<div>x</div> A');
  });
});

describe('stripStrayGistLines — [[GIST]] in the middle of a multi-part answer', () => {
  test('whole marker lines go and the parts stay separated', () => {
    assert.equal(stripStrayGistLines('First part.\n\n[[GIST]] gist one\nSecond part.\n\n[[GIST]] gist two'), 'First part.\n\nSecond part.');
    assert.equal(stripStrayGistLines('A.\n\n- [[GIST]] bulleted marker\n\nB.'), 'A.\n\nB.');
  });
  test('a marker inside a sentence, or no marker, is untouched', () => {
    assert.equal(stripStrayGistLines('You sort them [[GIST]] first, then subtract.'), 'You sort them [[GIST]] first, then subtract.');
    assert.equal(stripStrayGistLines('No marker here.\n\nSecond.'), 'No marker here.\n\nSecond.');
  });
});

describe('plainEmailText — the follow-up draft is an email', () => {
  test('emphasis, code and heading marks go; hyphen bullets stay', () => {
    assert.equal(plainEmailText('**Problem:**\n\nThe candidate was asked to design it.\n\n- a **b** and `c`\n## Next steps'), 'Problem:\n\nThe candidate was asked to design it.\n\n- a b and c\nNext steps');
  });
  test('plain text is untouched', () => {
    const src = 'Hi team,\n\nThanks for today.\n\n- one\n- two\n\nBest,\nEvin';
    assert.equal(plainEmailText(src), src);
    assert.equal(plainEmailText(undefined), '');
  });
});

describe('plainMeetingTitle', () => {
  test('list and heading chrome are removed', () => {
    assert.equal(plainMeetingTitle('- Summary was missing and got corrected'), 'Summary was missing and got corrected');
    assert.equal(plainMeetingTitle('## **Q4 planning**'), 'Q4 planning');
    assert.equal(plainMeetingTitle('— Roadmap review'), 'Roadmap review');
  });
  test('ordinary titles, inner dashes and a chrome-only title are kept', () => {
    assert.equal(plainMeetingTitle('Weekly sync'), 'Weekly sync');
    assert.equal(plainMeetingTitle('Sprint 12 - planning'), 'Sprint 12 - planning');
    assert.equal(plainMeetingTitle('- '), '- ');
  });
});

describe('latexParensToDollars', () => {
  test('inline math becomes $…$', () => {
    assert.equal(latexParensToDollars('The speed of light, \\(c\\), is large and \\( E = mc^2 \\) holds.'), 'The speed of light, $c$, is large and $E = mc^2$ holds.');
  });
  test('code spans and fences are left alone', () => {
    const src = 'Regex `\\(a\\)` and\n```js\nconst r = /\\(x\\)/;\n```';
    assert.equal(latexParensToDollars(src), src);
  });
  test('a $ inside the parens is not turned into math', () => {
    const src = 'Costs \\(a $5 fee\\).';
    assert.equal(latexParensToDollars(src), src);
  });
});

describe('reflowFlattenedList — lists whose newlines were collapsed to spaces', () => {
  test('a flattened bullet list, numbered list and bold-item list are re-broken', () => {
    assert.equal(reflowFlattenedList("Here's the plan: - Build it. - Test it."), "Here's the plan:\n- Build it.\n- Test it.");
    assert.equal(reflowFlattenedList('- Build it. - Test it. - Ship it.'), '- Build it.\n- Test it.\n- Ship it.');
    assert.equal(reflowFlattenedList('Steps: 1. Do x. 2. Do y. 3. Ship it.'), 'Steps:\n1. Do x.\n2. Do y.\n3. Ship it.');
    assert.equal(reflowFlattenedList('Use the map. - **Fast:** O(1). - **Small:** O(n).'), 'Use the map.\n- **Fast:** O(1).\n- **Small:** O(n).');
  });

  // Each of these was rewritten by the loose version, from real stored answers.
  test('a number ending a sentence is not a list marker ("move left to 1. `left_max`")', () => {
    for (const src of [
      'Since `left_max < right_max`, move `left` to 1. `left_max` becomes 1. `water += 1 - 1 = 0`.',
      'That has range 1. From (4,6,9), replace 9 with 4+6=10 → (4,6,10), range 6. Replace 4 with 6+9=15.',
      'Remove 2. Its index is 1. Last element is 3. We put 3 at index 1, so the list becomes [1, 3, 3].',
      'At index 1, num is 7, complement is 2, which is in the map at index 0. Return [0, 1].',
      'Pointers start at 0 and 3. `height[0]` is 0, `height[3]` is 2. Since 0 < 2, move left.',
    ]) assert.equal(reflowFlattenedList(src), src);
  });
  test('maths and formulas with a dash or star are not bullets', () => {
    for (const src of [
      '- The known solution: answer = max(0, c - a - b) after sorting ascending? Let me test.',
      '- Result: The range of this new set is $(a+b) - a$, which simplifies to $b$.',
      '- Space: O(number_of_tenants * K), one bounded heap per tenant.',
    ]) assert.equal(reflowFlattenedList(src), src);
  });
  test('numbers must run 1, 2, 3 in order', () => {
    const src = 'Values: 3. Three things. 4. Four things.';
    assert.equal(reflowFlattenedList(src), src);
  });
  test('headings, tables, quotes and code are never touched', () => {
    for (const src of ['## 1. Basic Query', '### 2. Nested Query (Relationships)', '| a. - B. | c |', '> Plan: - Build it. - Test it.', '```\nPlan: - Build it. - Test it.\n```', 'Use `a. - B. - C.` here.']) {
      assert.equal(reflowFlattenedList(src), src);
    }
  });
  test('a real list next to a math line keeps both as written', () => {
    const src = 'Steps:\n- First step.\n- Second step.\n\nSo answer = max(0, c - a - b) here.';
    assert.equal(reflowFlattenedList(src), src);
  });
});

describe('latexToPlain', () => {
  test('common commands', () => {
    assert.equal(latexToPlain('O(N \\log K)'), 'O(N log K)');
    assert.equal(latexToPlain('O(T \\times K)'), 'O(T × K)');
    assert.equal(latexToPlain('O(\\sqrt{n})'), 'O(√n)');
    assert.equal(latexToPlain('O(n^{2} \\cdot 2^{n})'), 'O(n^2 · 2^n)');
    assert.equal(latexToPlain('O(\\text{n log n})'), 'O(n log n)');
  });
  test('plain text is returned untouched', () => {
    assert.equal(latexToPlain('O(n log(k))'), 'O(n log(k))');
  });
});

describe('techniqueFromApproach — the chip when there is no Technique section', () => {
  // Coding answers are written to a shape since 2026-09-29; the usual solve
  // answer is Approach / Code / Complexity and names its technique in the
  // Approach's first sentence. These are real first sentences from that run.
  const REAL = [
    ['I use a **hash map** to store each number and its index as I iterate through the array.', 'Hash map'],
    ['Use a hash map from value to index. For each number, check whether its complement is in the map.', 'Hash map'],
    ["I'll use dynamic programming to solve this by building an array where each index represents the minimum coins needed.", 'Dynamic programming'],
    ['This is the classic coin change problem, solved with bottom-up dynamic programming.', 'Bottom-up dynamic programming'],
    ['I will sort the intervals by their start times to ensure that any overlapping intervals are adjacent.', 'Sorting'],
    ['Sort the intervals by start time, then sweep through them once.', 'Sorting + linear sweep'],
    ['To merge overlapping intervals, I first sort the array by the start time of each interval.', 'Sorting'],
  ];
  for (const [approach, chip] of REAL) {
    test(`${JSON.stringify(approach.slice(0, 48))} → ${chip}`, () => assert.equal(techniqueFromApproach(approach), chip));
  }

  test('a first sentence that only names the problem falls back to the second', () => {
    assert.equal(techniqueFromApproach('This is the classic coin change problem. Use bottom-up dynamic programming: build an array where `dp[i]` is the fewest coins.'), 'Bottom-up dynamic programming');
    assert.equal(techniqueFromApproach('This is the classic coin change problem. Build a DP array where dp[i] is the fewest coins to make i.'), 'Dynamic programming');
  });

  test('a bullet approach reads its first item', () => {
    assert.equal(techniqueFromApproach('- Keep a **min-heap** of size k.\n- Pop when it grows past k.'), 'Min-heap');
  });

  test('no recognised technique gives no chip, never a guess', () => {
    assert.equal(techniqueFromApproach('Check each pair and return it.'), '');
    assert.equal(techniqueFromApproach(''), '');
    // Inline code never votes (a `dp` variable is not the DP technique).
    assert.equal(techniqueFromApproach('Use `dp[i]` to hold the answer. Then return it.'), '');
  });

  test('an adjective is not a technique: "the sorted array" is the input, not a sort', () => {
    assert.equal(techniqueFromApproach('Use two pointers from both ends of the sorted array.'), 'Two pointers');
  });

  test('a longer mention wins over the word inside it, and at most two are joined', () => {
    assert.equal(techniqueFromApproach('Walk the graph with a BFS, level by level, using a queue and a hash set.'), 'BFS + queue');
    assert.equal(techniqueFromApproach('Push each value onto a monotonic stack.'), 'Monotonic stack');
  });

  test('the Usage tab falls back to it only when the answer has no Technique section', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/components/MeetingDetails.tsx'), 'utf8');
    assert.match(src, /const techniqueChip = technique\s*\?\s*techniqueLabel\(technique\.body\)\s*:\s*\(approach \? techniqueFromApproach\(approach\.body\) : ''\);/);
  });
});
