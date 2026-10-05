// electron/intelligence/context-os/__tests__/AssistantClaimsPrecedenceCheck2026_07_25.test.mjs
//
// Phase 6 Slice 7 (context-rebuild, 05_MIGRATION_PLAN.md Slice 7 item 1,
// RC8): pre-required test for the precedence-enforcement gap — "a test
// asserting a candidate-specific answer that restates a claim already
// marked contradicted from an earlier turn is blocked/repaired... this is
// the first test that can exist for this mechanism, since the read path
// has never been wired before." This is that first test, against the pure
// checkAssistantClaimsPrecedence function (built standalone this pass —
// see assistantClaimsPrecedenceCheck.ts's header for why it is not yet
// wired into a live generation path).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const require = createRequire(import.meta.url);
const { checkAssistantClaimsPrecedence } = require(
  path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/assistantClaimsPrecedenceCheck.js'),
);

describe('checkAssistantClaimsPrecedence', () => {
  test('blocks: a draft answer that substantially restates a contradicted claim', () => {
    const contradicted = [
      { claim_id: 'c1', claim_text: 'The role offers a salary range of 120000 to 140000 dollars annually.' },
    ];
    const draft = 'To recap, the salary range for this role is 120000 to 140000 dollars annually.';
    const verdict = checkAssistantClaimsPrecedence(draft, contradicted);
    assert.equal(verdict.restatesContradictedClaim, true);
    assert.equal(verdict.matchedClaimId, 'c1');
  });

  test('allows: a draft answer unrelated to any contradicted claim', () => {
    const contradicted = [
      { claim_id: 'c1', claim_text: 'The role offers a salary range of 120000 to 140000 dollars annually.' },
    ];
    const draft = 'I have five years of experience building distributed systems in Go.';
    const verdict = checkAssistantClaimsPrecedence(draft, contradicted);
    assert.equal(verdict.restatesContradictedClaim, false);
    assert.equal(verdict.matchedClaimId, undefined);
  });

  test('allows: empty contradicted-claims list (no prior contradictions to check against)', () => {
    const verdict = checkAssistantClaimsPrecedence('Any answer text at all.', []);
    assert.equal(verdict.restatesContradictedClaim, false);
  });

  test('allows: empty draft answer', () => {
    const contradicted = [{ claim_id: 'c1', claim_text: 'Some previously contradicted fact about the role.' }];
    const verdict = checkAssistantClaimsPrecedence('', contradicted);
    assert.equal(verdict.restatesContradictedClaim, false);
  });

  test('conservative: partial overlap below the 0.6 threshold does not block', () => {
    const contradicted = [
      { claim_id: 'c1', claim_text: 'The negotiation script recommends countering at 145000 dollars for this senior backend role.' },
    ];
    // Shares only "role" / "backend" — well under 0.6 overlap.
    const draft = 'This is a backend role focused on distributed systems.';
    const verdict = checkAssistantClaimsPrecedence(draft, contradicted);
    assert.equal(verdict.restatesContradictedClaim, false);
  });

  test('checks multiple contradicted claims and returns the first match', () => {
    const contradicted = [
      { claim_id: 'c1', claim_text: 'Totally unrelated prior contradicted claim about company culture values.' },
      { claim_id: 'c2', claim_text: 'The interview process has four stages including a system design round.' },
    ];
    const draft = 'Just to confirm, the interview process has four stages including a system design round.';
    const verdict = checkAssistantClaimsPrecedence(draft, contradicted);
    assert.equal(verdict.restatesContradictedClaim, true);
    assert.equal(verdict.matchedClaimId, 'c2');
  });
});
