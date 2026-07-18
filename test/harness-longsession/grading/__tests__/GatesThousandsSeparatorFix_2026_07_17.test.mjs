// test/harness-longsession/grading/__tests__/DocumentGroundedRetrievalFixes_2026_07_17.test.mjs
//
// Campaign 2 (longsession, 2026-07-17), iteration 20's NEXT ACTION: fix the
// containsFact/normalizeForMatch thousands-separator false-negative flagged as
// open since iteration 13. Live-confirmed on a real 30-minute judged benchmark
// run (run-013): press B10 answered "approximately 37,000 tokens" — an exactly
// correct answer to "What was the shared BPE vocabulary size?" (annotated
// expectedFacts: ["37000"]) — but G3_deterministic still failed, because
// normalizeForMatch's generic punctuation strip turned "37,000" into "37 000"
// (comma -> space), which no longer contains "37000" as a substring.
//
// Fix: strip thousands-separator commas from digit-group patterns (\d{1,3}
// followed by one-or-more ,\d{3} groups) BEFORE the generic punctuation strip
// runs, so "37,000" and "37000" both normalize identically. Pure substring
// matching is preserved — no fuzzy logic introduced.
//
// Run: node --test test/harness-longsession/grading/__tests__/DocumentGroundedRetrievalFixes_2026_07_17.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeForMatch, containsFact } from '../gates.mjs';

describe('normalizeForMatch: thousands-separator commas no longer break substring matching', () => {
  test('a comma-formatted number normalizes the same as its bare digit form', () => {
    assert.equal(normalizeForMatch('37,000'), normalizeForMatch('37000'));
  });

  test('a large comma-formatted number (multiple separator groups) normalizes correctly', () => {
    assert.equal(normalizeForMatch('$1,234,567'), normalizeForMatch('1234567'));
  });

  test('containsFact: an answer using comma-formatting matches a fixture fact WITHOUT commas', () => {
    assert.equal(containsFact('approximately 37,000 tokens', '37000'), true);
  });

  test('containsFact: an answer WITHOUT comma-formatting matches a fixture fact WITH commas', () => {
    assert.equal(containsFact('the vocabulary size was 37000 tokens', '37,000'), true);
  });

  test('containsFact: both sides comma-formatted still matches (regression guard)', () => {
    assert.equal(containsFact('training ran for 300,000 steps', '300,000'), true);
  });

  test('a non-numeric comma (a sentence pause) is NOT affected — normal punctuation stripping still applies', () => {
    // "Kafka, and Flink" — the comma here is a list separator, not a thousands
    // separator (no digit groups around it), so it should still strip to a space
    // exactly as the generic punctuation rule always did.
    assert.equal(normalizeForMatch('Kafka, and Flink'), normalizeForMatch('Kafka and Flink'));
  });

  test('a 1-2 digit trailing group still matches correctly (not over-matched to unrelated numbers)', () => {
    // Regression guard: the digit-group regex requires groups of EXACTLY 3 after
    // the first comma, so "12,3" (malformed / not a real thousands separator)
    // must NOT be silently merged into "123" — normalizeForMatch's generic
    // strip still converts it to "12 3" as before this fix.
    assert.equal(normalizeForMatch('12,3'), '12 3');
  });
});
