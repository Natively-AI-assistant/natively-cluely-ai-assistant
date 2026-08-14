// electron/llm/__tests__/RefinementFollowUp2026_06_15.test.mjs
//
// Phase 8 (task 2026-06-15, bug #3): refinement/editing follow-ups ("make that shorter",
// "make it more confident", "remove the exaggeration", "give me the final spoken version")
// carry content words so they are NOT bare follow-ups — the manual path previously only
// pulled conversation memory for BARE follow-ups, so a refinement re-dumped a fresh full
// answer. isRefinementFollowUp / isSameSessionFollowUp close that gap. Compiled-path test.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  isRefinementFollowUp,
  isBareFollowUp,
  isSameSessionFollowUp,
} from '../../../dist-electron/electron/llm/index.js';

describe('isRefinementFollowUp — edits that operate on the prior answer', () => {
  const refinements = [
    'Make that shorter.',
    'Make it more confident.',
    'Remove the exaggeration.',
    'Give me the final spoken version.',
    'Shorten it.',
    'Rewrite that.',
    'Say it differently.',
    'Make it punchier',
    'Trim it down.',
    'Simplify that.',
    'Make it less formal.',
    'The final version please.',
    'In one sentence.',
    'As bullets.',
  ];
  for (const q of refinements) {
    test(`refinement: "${q}"`, () => assert.equal(isRefinementFollowUp(q), true));
  }
});

describe('isRefinementFollowUp — NOT a refinement (new, self-contained tasks)', () => {
  const notRefinements = [
    'Make a REST API in Node.',          // new imperative, no prior reference
    'Write a function to reverse a linked list.',
    'Why should we hire you?',
    'What is my name?',
    'Tell me about your experience with Python.',
    'Build a dashboard for the sales team.',
    'Explain BFS.',
    'Add caching to the database layer of our production payment service.', // long, self-contained
    // SHORT imperatives with "the <noun>" — code-review HIGH 2026-06-15: these must NOT
    // be refinements just because they contain "the <generic noun>". Previously misfired.
    'Add caching to the payment service.',
    'Fix the bug in the auth handler.',
    'Reduce the latency of the search endpoint.',
    'Change the database to postgres.',
    'Simplify the onboarding flow.',
    'Summarize the quarterly report.',
    'Rewrite the landing page copy.',
    'Improve the signup conversion.',
  ];
  for (const q of notRefinements) {
    test(`not a refinement: "${q}"`, () => assert.equal(isRefinementFollowUp(q), false));
  }
});

describe('isSameSessionFollowUp — union of bare + refinement', () => {
  test('a bare follow-up qualifies', () => {
    assert.equal(isBareFollowUp('why?'), true);
    assert.equal(isSameSessionFollowUp('why?'), true);
  });
  test('a refinement qualifies even though it is not bare', () => {
    assert.equal(isBareFollowUp('make that shorter'), false);
    assert.equal(isRefinementFollowUp('make that shorter'), true);
    assert.equal(isSameSessionFollowUp('make that shorter'), true);
  });
  test('a brand-new question does not qualify', () => {
    assert.equal(isSameSessionFollowUp('What is the capital of France?'), false);
  });
});
