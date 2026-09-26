// electron/llm/__tests__/SharedRepairAcceptance2026_08_07.test.mjs
//
// PR #427 "Manual path / WTA path post-processing duplication" (§1.4).
//
// The duplication is not cosmetic — it has already DRIFTED into a real
// behavioral divergence. Both paths regenerate an answer when validation finds
// a critical violation, then decide whether to accept the regeneration. The WTA
// path (IntelligenceEngine.ts) rejects a repair that:
//   1. re-leaks an internal artifact (isLeakedAnswerArtifact) — the repair
//      prompt is the SAME <rewrite_instructions> shape already proven to leak
//      back verbatim, so a regeneration is at least as exposed as the original;
//   2. is a drastic length downgrade vs the answer it replaces (a "repair" that
//      throws away most of the content is not an improvement).
//
// The manual-chat path (ipcHandlers.ts) has NEITHER guard, even though the WTA
// source comment at IntelligenceEngine.ts:3225 claims the length floor
// "mirrors the same guard added to ipcHandlers.ts's manual-chat regen path".
// It does not exist there. A manual-chat profile repair that comes back as a
// leaked tag block is accepted and shipped to the user.
//
// Fix: ONE shared acceptance policy both paths call, so the guards cannot drift
// again. These tests pin the policy itself.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { acceptRepairedAnswer } from '../../../dist-electron/electron/llm/index.js';

const LEAKED_TAG_BLOCK = '<rewrite_instructions note="follow these">Answer directly and specifically.</rewrite_instructions>';

describe('acceptRepairedAnswer — shared WTA/manual repair acceptance policy', () => {
  test('accepts a clean, substantive repair', () => {
    const verdict = acceptRepairedAnswer({
      original: 'I have no access to that information whatsoever, sorry about this.',
      repaired: 'I led the checkout migration at Stripe, cutting p99 latency from 1.2s to 300ms.',
    });
    assert.equal(verdict.accepted, true, JSON.stringify(verdict));
  });

  test('rejects a repair that re-leaks an internal tag block (WTA had this guard, manual did not)', () => {
    const verdict = acceptRepairedAnswer({
      original: 'I have no access to that information whatsoever, sorry about this.',
      repaired: LEAKED_TAG_BLOCK,
    });
    assert.equal(verdict.accepted, false, JSON.stringify(verdict));
    assert.equal(verdict.reason, 'leaked_artifact');
  });

  test('rejects a drastic length downgrade when the original had substance', () => {
    const original = 'x'.repeat(400);
    // Comfortably above the too-short floor, so this isolates the LENGTH rule.
    const verdict = acceptRepairedAnswer({ original, repaired: 'Yes, that is correct.' });
    assert.equal(verdict.accepted, false, JSON.stringify(verdict));
    assert.equal(verdict.reason, 'length_downgrade');
  });

  test('a short original has nothing to regress from — a short repair is fine', () => {
    // Original below the 150-char substance floor: the length rule must not fire.
    const verdict = acceptRepairedAnswer({ original: 'No.', repaired: 'Yes, in 2024.' });
    assert.equal(verdict.accepted, true, JSON.stringify(verdict));
  });

  test('rejects an empty or near-empty repair', () => {
    assert.equal(acceptRepairedAnswer({ original: 'a'.repeat(200), repaired: '   ' }).accepted, false);
    assert.equal(acceptRepairedAnswer({ original: 'a'.repeat(200), repaired: 'ok' }).reason, 'too_short');
  });

  test('a caller-supplied validator can veto (profile/doc-grounded re-checks)', () => {
    const verdict = acceptRepairedAnswer({
      original: 'I have no access to that information whatsoever, sorry about this.',
      repaired: 'I led the checkout migration at Stripe and cut p99 latency substantially.',
      stillInvalid: true,
    });
    assert.equal(verdict.accepted, false, JSON.stringify(verdict));
    assert.equal(verdict.reason, 'still_invalid');
  });

  test('the length floor uses the documented 150-char / 0.6-ratio thresholds', () => {
    const original = 'y'.repeat(150);
    // 0.6 * 150 = 90 — at/above the ratio is kept, below is rejected.
    assert.equal(acceptRepairedAnswer({ original, repaired: 'y'.repeat(90) }).accepted, true);
    assert.equal(acceptRepairedAnswer({ original, repaired: 'y'.repeat(89) }).reason, 'length_downgrade');
  });

  test('never throws on nullish input — acceptance must not break the answer path', () => {
    assert.doesNotThrow(() => acceptRepairedAnswer({ original: undefined, repaired: undefined }));
    assert.equal(acceptRepairedAnswer({ original: undefined, repaired: undefined }).accepted, false);
  });

  // Code review 2026-08-07: acceptRepairedAnswer checked length_downgrade BEFORE
  // stillInvalid, so a repair that a caller's domain re-check confirmed FIXED the
  // critical violation was rejected purely for being shorter than the flagged-bad
  // original — and the confirmed-invalid original shipped instead. Live-reproduced
  // against real DeepSeek v4-flash: a false "I don't have access to your name"
  // refusal (200 chars) correctly repaired to "My name is Priya Nair." (22 chars,
  // ratio 0.11) was rejected as length_downgrade even though stillInvalid was false.
  test('a repair the caller confirmed FIXED the violation is accepted even when drastically shorter', () => {
    const original = 'I don\'t have access to your specific resume details or personal information loaded ' +
      'right now, so I can\'t share your name or speak to any particulars about who you are.';
    const verdict = acceptRepairedAnswer({ original, repaired: 'My name is Priya Nair.', stillInvalid: false });
    assert.equal(verdict.accepted, true, JSON.stringify(verdict));
  });

  test('without a caller domain check (stillInvalid omitted), the length floor still protects against a lazy repair', () => {
    const original = 'a'.repeat(200);
    const verdict = acceptRepairedAnswer({ original, repaired: 'Not sure, honestly.' });
    assert.equal(verdict.accepted, false, JSON.stringify(verdict));
    assert.equal(verdict.reason, 'length_downgrade');
  });

  test('stillInvalid:true still rejects regardless of length (domain check outranks the length floor either way)', () => {
    const original = 'a'.repeat(200);
    const verdict = acceptRepairedAnswer({ original, repaired: 'Still wrong, but concise.', stillInvalid: true });
    assert.equal(verdict.accepted, false, JSON.stringify(verdict));
    assert.equal(verdict.reason, 'still_invalid');
  });
});
