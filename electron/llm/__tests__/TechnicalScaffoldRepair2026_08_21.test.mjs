// electron/llm/__tests__/TechnicalScaffoldRepair2026_08_21.test.mjs
//
// RC-3 regression from live shadow session C (2026-08-21): "Okay. So what's a
// semaphore?" (press 81, technical_concept_answer) shipped 330 words of the
// six-section DSA template, including three literal "Not applicable,
// conceptual question." sections. hasUnrecoveredScaffoldContamination already
// returned TRUE on it — but the repair gate excluded technical_concept_answer
// (TECHNICAL_ANSWER_TYPES_EXCLUDED_FROM_SCAFFOLD_EXTRACTION), so the
// detector's verdict was thrown away. Presses 76 and 80 identical.
//
// The exclusion had a real reason (code-review 2026-07-18 MEDIUM): Big-O /
// complexity vocabulary is legitimate CONTENT for technical answers, so the
// loose fingerprint (complexity notation alone) must not trigger repair there.
// The fix is a STRICT signal for those types: the contract's own unique
// headings ("## Dry Run", "## Technique / Data Structure / Algorithm Used"),
// which never appear in legitimate technical prose.
//
// isScaffoldRegenerationEligible(answerType, answer) is the single policy
// point the engine consults before firing the regeneration repair.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/', p)).href;
const {
  isScaffoldRegenerationEligible,
  hasStrictCodingScaffoldSignal,
} = await import(dist('AnswerValidator.js'));

// Verbatim shape of live press 81 (abridged body, structure exact).
const PRESS_81 = `## Approach
- A semaphore is a synchronization primitive that controls access to a shared resource by maintaining a count.

## Technique / Data Structure / Algorithm Used
- Counting semaphore, blocking queue of waiters, atomic counter with wait and signal operations.

## Code
Not applicable, conceptual question.

## Dry Run
Not applicable, conceptual question.

## Complexity
Not applicable, conceptual question.

## Interviewer Follow-up Points
- Difference between a counting semaphore and a binary semaphore.

A semaphore is a counter that controls how many threads can access a resource at the same time.`;

// Verbatim shape of live press 79 — same answer type, clean prose.
const PRESS_79 = 'A mutex, short for mutual exclusion, is used when multiple threads need to access a shared '
  + 'resource, like a counter, a list, or a file, and at least one of them writes to it. Without it, two '
  + 'threads can interleave their read, modify, and write steps and corrupt the data.';

// A legitimate technical answer that uses recognized-but-generic headings and
// complexity vocabulary as its actual SUBJECT — the false positive the
// original exclusion existed to prevent. Must stay untouched.
const LEGIT_COMPLEXITY_ANSWER = `## Approach
Big-O describes how runtime grows with input size. A hash map lookup is O(1) amortized.

## Complexity
For the full pass the time complexity is O(n) and space is O(n), because each element is visited once and stored once.`;

describe('RC-3: the semaphore-class misfire is now repair-eligible', () => {
  for (const t of ['technical_concept_answer', 'system_design_answer', 'debugging_question_answer']) {
    test(`${t}: the live press-81 scaffold is eligible for regeneration`, () => {
      assert.equal(isScaffoldRegenerationEligible(t, PRESS_81), true);
    });
  }

  test('non-technical types keep their existing (loose) eligibility', () => {
    assert.equal(isScaffoldRegenerationEligible('general_meeting_answer', PRESS_81), true);
  });
});

describe('RC-3: the original false-positive protection is preserved', () => {
  test('clean prose (live press 79) is not eligible', () => {
    assert.equal(isScaffoldRegenerationEligible('technical_concept_answer', PRESS_79), false);
  });

  test('a legit technical answer with generic headings + complexity vocab is NOT eligible', () => {
    assert.equal(isScaffoldRegenerationEligible('technical_concept_answer', LEGIT_COMPLEXITY_ANSWER), false,
      'complexity notation is legitimate content for technical types — only the unique contract headings may trigger');
  });

  test('coding types are never eligible (validateAnswerStructure owns them)', () => {
    assert.equal(isScaffoldRegenerationEligible('dsa_question_answer', PRESS_81), false);
    assert.equal(isScaffoldRegenerationEligible('coding_question_answer', PRESS_81), false);
  });
});

describe('RC-3: hasStrictCodingScaffoldSignal', () => {
  test('true on the contract-unique headings', () => {
    assert.equal(hasStrictCodingScaffoldSignal(PRESS_81), true);
  });
  test('false on generic headings + complexity notation alone', () => {
    assert.equal(hasStrictCodingScaffoldSignal(LEGIT_COMPLEXITY_ANSWER), false);
  });
  test('false on clean prose', () => {
    assert.equal(hasStrictCodingScaffoldSignal(PRESS_79), false);
  });
});
