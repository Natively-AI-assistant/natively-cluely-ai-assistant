// electron/llm/__tests__/CodingContinuationLanguageAndSplitConstraint2026_09_23.test.mjs
//
// Issue #539 (salvaged from PR #591, narrowed). Two deterministic seams:
//   1. isCodingContinuation — "show in python" / "show the solution in python" /
//      "show me how you would implement in python" / "implement this" are
//      continuations of the current problem. Live on 2.8.8 all three language
//      asks routed general_meeting_answer. An experience question that names a
//      language must NOT become one (PR #591's version broke exactly that).
//   2. extractLatestQuestion — a pure constraint turn ("You can assume capacity is
//      positive.") is joined to the ask right before it, and nothing else is.
//      PR #591 joined EVERY contiguous interviewer turn, which turned a
//      25-sentence monologue into a 1,654-char "question".
//
// Run against the compiled dist-electron output, like the other codingFollowup tests.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { isCodingContinuation, extractLatestQuestion } from '../../../dist-electron/electron/llm/index.js';

describe('isCodingContinuation — language and direct-action continuations (#539)', () => {
  for (const q of [
    'show in python',
    'show the solution in python',
    'show me how you would implement in python',
    'Show the code in Java.',
    'can you show it in C++',
    'now write the same in golang',
    'implement this',
    'okay, write it',
    'solve that please',
  ]) {
    test(`continuation: ${JSON.stringify(q)}`, () => assert.equal(isCodingContinuation(q), true));
  }

  for (const q of [
    'Tell me about your experience with Python.',
    'Have you worked in go?',
    'How long have you coded in java?',
    'Do you prefer Java or TypeScript?',
    'Why did you choose TypeScript for that?',
    'write a web server in go',
    'Can you write a short intro about yourself',
    'show me your portfolio',
    'implement rate limiting for our public API',
  ]) {
    test(`NOT continuation: ${JSON.stringify(q)}`, () => assert.equal(isCodingContinuation(q), false));
  }
});

describe('extractLatestQuestion — split constraint join (#539)', () => {
  const at = (turns) => turns.map(([role, text, t]) => ({ role, text, timestamp: t }));

  test('a constraint turn is joined to the coding ask right before it', () => {
    const r = extractLatestQuestion(at([
      ['interviewer', 'Implement an LRU cache with get and put.', 1_000],
      ['interviewer', 'You can assume capacity is positive.', 9_000],
    ]));
    assert.match(r.latestQuestion, /LRU cache/);
    assert.match(r.latestQuestion, /capacity is positive/);
  });

  test('a constraint more than 30s after the ask is not joined', () => {
    const r = extractLatestQuestion(at([
      ['interviewer', 'Implement an LRU cache with get and put.', 1_000],
      ['interviewer', 'You can assume capacity is positive.', 45_000],
    ]));
    assert.doesNotMatch(r.latestQuestion, /LRU/);
  });

  test('a constraint after a non-ask is not joined', () => {
    const r = extractLatestQuestion(at([
      ['interviewer', 'We mostly work in Go and Postgres here.', 1_000],
      ['interviewer', 'You can assume the input is sorted.', 5_000],
    ]));
    assert.doesNotMatch(r.latestQuestion, /Postgres/);
  });

  test('a real question after small talk stays the question on its own', () => {
    const r = extractLatestQuestion(at([
      ['interviewer', 'Thanks for joining today, we are really excited.', 1_000],
      ['interviewer', 'Our team builds payment infrastructure at scale.', 4_000],
      ['interviewer', 'So, what is your name?', 7_000],
    ]));
    assert.equal(r.latestQuestion, 'So, what is your name?');
    assert.ok(r.confidence >= 0.9, `confidence ${r.confidence}`);
  });

  test('a long monologue ending in a question is not concatenated', () => {
    const turns = [];
    for (let i = 0; i < 25; i++) turns.push(['interviewer', `Sentence ${i} about the product roadmap.`, i * 2_000]);
    turns.push(['interviewer', 'Any questions?', 60_000]);
    const r = extractLatestQuestion(at(turns));
    assert.equal(r.latestQuestion, 'Any questions?');
  });
});
