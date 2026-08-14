// electron/services/__tests__/ModeAdaptiveThreshold.test.mjs
//
// Regression test for FINDING-001: the lexical retriever's MIN_RELEVANCE_SCORE
// of 0.18 was calibrated for the combined query+transcript path. A bare typed
// question (no transcript yet) with 3-5 unique tokens could land at score
// ~0.10 even when every query token matched the chunk — because the
// denominator sqrt(querySize * chunkSize) doesn't shrink with the query.
//
// Fix: scale the floor by `min(1, querySize/5)` when no transcript is
// supplied. Production mid-session calls (transcript present) keep the full
// 0.18 floor, so noise tolerance for established sessions is unchanged.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { runScenario, makeMode, asReferenceFiles } from '../../../tests/utils/scenarioRunner.mjs';
import { loadReferenceFiles } from '../../../tests/utils/referenceFileFactory.mjs';

describe('FIX-001: Adaptive threshold rescues short bare queries without transcript', () => {
  test('short bare query "configure audio device" now retrieves the onboarding checklist', () => {
    const mode = makeMode('mode_general_adaptive', 'general', '');
    const files = asReferenceFiles(mode.id, loadReferenceFiles('general'));
    const result = runScenario({
      mode,
      files,
      // 4-token effective query, no transcript. Pre-fix this returned 0
      // snippets because the score landed at ~0.149 < 0.18. The adaptive
      // threshold for a 4-token bare query is 0.18 * 4/5 = 0.144, so 0.149
      // now passes.
      query: 'configure audio device approval',
    });
    assert.ok(
      result.snippets.length > 0,
      'Short bare query should retrieve at least one snippet under the adaptive threshold'
    );
  });

  test('1-token query stays empty (still very weak signal, fallback intentional)', () => {
    const mode = makeMode('mode_general_one_token', 'general', '');
    const files = asReferenceFiles(mode.id, loadReferenceFiles('general'));
    const result = runScenario({
      mode,
      files,
      query: 'audio',
    });
    // A 1-token query against many files would retrieve too aggressively even
    // under the adaptive threshold. We accept either zero results OR a
    // single relevant snippet — what we must NEVER do is panic-retrieve
    // everything. Assert: snippets count is small.
    assert.ok(
      result.snippets.length <= 3,
      `1-token query must not flood retrieval; got ${result.snippets.length} snippets`
    );
  });

  test('long mid-session query with transcript uses the FULL 0.18 floor (no noise increase)', () => {
    const mode = makeMode('mode_general_full', 'general', '');
    const files = asReferenceFiles(mode.id, loadReferenceFiles('general'));
    const result = runScenario({
      mode,
      files,
      query: 'walk me through the Q2 priority and milestones from our roadmap',
      // A non-empty transcript signals "established session" → full
      // threshold applies. The query is rich enough to score well even at
      // 0.18, so retrieval still succeeds.
      transcript: 'PM: lets confirm the Q2 priority — multi-modal copilot beta — and check milestone owners and dates.',
    });
    assert.ok(result.snippets.length > 0);
  });

  test('intentionally unrelated bare query still falls back (adaptive does not break grounding)', () => {
    const mode = makeMode('mode_general_unrelated', 'general', '');
    const files = asReferenceFiles(mode.id, loadReferenceFiles('general'));
    const result = runScenario({
      mode,
      files,
      // No token in the query appears in any general-mode fixture. Adaptive
      // threshold must not rescue irrelevant chunks.
      query: 'xyzzqxq nonsenseword bogusterm',
    });
    assert.equal(result.snippets.length, 0, 'Unrelated bare query must still produce zero snippets');
    assert.equal(result.usedFallback, true);
    assert.equal(result.formattedContext, '');
  });

  test('zero-token query short-circuits to fallback (does NOT flood retrieval)', () => {
    const mode = makeMode('mode_zero_token', 'general', '');
    const files = asReferenceFiles(mode.id, loadReferenceFiles('general'));
    // Every word ≤2 chars or pure punctuation → queryWords.size === 0.
    // Without the short-circuit, the adaptive threshold collapses to 0 and
    // `score < 0` is false, so every chunk would be admitted with score 0,
    // drowning the prompt in noise.
    const inputs = ['a a a a a', '?? !! .. ..', '   ', "' ' '"];
    for (const q of inputs) {
      const result = runScenario({ mode, files, query: q });
      assert.equal(result.snippets.length, 0, `Zero-token query "${q}" must produce 0 snippets`);
      assert.equal(result.usedFallback, true, `Zero-token query "${q}" must mark usedFallback=true`);
      assert.equal(result.formattedContext, '', `Zero-token query "${q}" must produce empty formattedContext`);
    }
  });

  test('previously-failing technical-interview complexity query passes without transcript', () => {
    const mode = makeMode('mode_tech_adaptive', 'technical-interview', '');
    const files = asReferenceFiles(mode.id, loadReferenceFiles('technical-interview'));
    const result = runScenario({
      mode,
      files,
      // 5-token effective query, no transcript. Pre-fix this required a
      // transcript turn to push above threshold; with adaptive threshold
      // (0.18 * 5/5 = 0.18, so threshold unchanged for 5+ tokens) plus the
      // possessive-stripping FIX-002 the query now matches "Interviewer"
      // in the chunk on at least two unique tokens.
      query: "interviewer's complexity preference style code",
    });
    assert.ok(
      result.snippets.length > 0,
      "Possessive bare query about interviewer's complexity must retrieve the preferences fixture"
    );
  });
});
