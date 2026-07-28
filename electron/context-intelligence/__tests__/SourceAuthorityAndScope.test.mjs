// Context Intelligence V3 — source authority + scope/version filtering.
//
// These assert the two rules Phase 1 and Phase 2 identified as load-bearing:
//   * a JD can never evidence a user skill (measured contamination 7.1–16.7%)
//   * a superseded version is NOT RETRIEVABLE, not merely ranked lower
//     (measured stale-version rate 54.8% on semantic ranking)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = (p) => pathToFileURL(path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence', p)).href;

const { CLAIM_AUTHORITY, isAuthoritativeFor, isProhibitedFor, authorityOf, filterByScopeAndVersion } =
  await import(dist('policies/source-authority-policy.js'));
const { freezeTurnDecision, scopeKey } = await import(dist('contracts/types.js'));

describe('source authority', () => {
  test('a JD is PROHIBITED from evidencing any user-owned claim', () => {
    for (const claim of ['USER_EMPLOYMENT', 'USER_PROJECT', 'USER_SKILL', 'USER_EDUCATION']) {
      assert.equal(isProhibitedFor('JOB_DESCRIPTION', claim), true, `${claim} must prohibit JD`);
      assert.equal(isAuthoritativeFor('JOB_DESCRIPTION', claim), false);
    }
  });

  test('a resume cannot state what a job requires (the symmetric rule)', () => {
    for (const claim of ['JOB_RESPONSIBILITY', 'JOB_REQUIRED_SKILL', 'JOB_PREFERRED_SKILL']) {
      assert.equal(isProhibitedFor('RESUME', claim), true);
      assert.equal(isAuthoritativeFor('JOB_DESCRIPTION', claim), true);
    }
  });

  test('general knowledge claims have NO authoritative private source', () => {
    for (const claim of ['GENERAL_TECHNICAL', 'GENERAL_INDUSTRY', 'RECOMMENDATION']) {
      assert.deepEqual(CLAIM_AUTHORITY[claim].authoritative, []);
    }
  });

  test('a resume is authoritative for exactly the user-owned claims', () => {
    const claims = authorityOf('RESUME').sort();
    assert.deepEqual(claims, ['USER_EDUCATION', 'USER_EMPLOYMENT', 'USER_PROJECT', 'USER_SKILL']);
  });

  test('every ClaimType has an authority entry (exhaustiveness)', () => {
    for (const [claim, entry] of Object.entries(CLAIM_AUTHORITY)) {
      assert.ok(Array.isArray(entry.authoritative), `${claim} missing authoritative`);
      assert.ok(Array.isArray(entry.prohibited), `${claim} missing prohibited`);
    }
  });
});

describe('scope + version filtering', () => {
  const authorized = [{
    sourceType: 'RESUME', sourceId: 'resume-1', versionId: 'v2',
    scopeId: 'u:user-1', authorityFor: ['USER_SKILL'], priority: 1, metadataFilters: {},
  }];
  const input = { scope: { userId: 'user-1' }, authorized };

  test('the ACTIVE version is admitted', () => {
    const r = filterByScopeAndVersion(
      [{ sourceId: 'resume-1', versionId: 'v2', scopeId: 'u:user-1', sourceType: 'RESUME' }], input);
    assert.equal(r.admitted.length, 1);
    assert.equal(r.rejected.length, 0);
  });

  test('a SUPERSEDED version is rejected outright, not ranked lower', () => {
    const r = filterByScopeAndVersion(
      [{ sourceId: 'resume-1', versionId: 'v1', scopeId: 'u:user-1', sourceType: 'RESUME' }], input);
    assert.equal(r.admitted.length, 0, 'v1 must not be retrievable at all');
    assert.equal(r.rejected[0].reason, 'SUPERSEDED_VERSION');
  });

  test('another user\'s scope is rejected', () => {
    const r = filterByScopeAndVersion(
      [{ sourceId: 'resume-1', versionId: 'v2', scopeId: 'u:user-2', sourceType: 'RESUME' }], input);
    assert.equal(r.admitted.length, 0);
    assert.equal(r.rejected[0].reason, 'OUT_OF_SCOPE');
  });

  test('an unauthorized source is rejected', () => {
    const r = filterByScopeAndVersion(
      [{ sourceId: 'jd-9', versionId: 'v1', scopeId: 'u:user-1', sourceType: 'JOB_DESCRIPTION' }], input);
    assert.equal(r.admitted.length, 0);
    assert.equal(r.rejected[0].reason, 'UNAUTHORIZED_SOURCE');
  });

  test('rejections carry a REASON — "nothing matched" must be distinguishable from "matched and excluded"', () => {
    const r = filterByScopeAndVersion([
      { sourceId: 'resume-1', versionId: 'v2', scopeId: 'u:user-1', sourceType: 'RESUME' },
      { sourceId: 'resume-1', versionId: 'v1', scopeId: 'u:user-1', sourceType: 'RESUME' },
    ], input);
    assert.equal(r.admitted.length, 1);
    assert.equal(r.rejected.length, 1);
    assert.ok(r.rejected[0].reason);
  });
});

describe('TurnDecision immutability', () => {
  test('is deep-frozen — downstream cannot reinterpret the turn', () => {
    const d = freezeTurnDecision({
      requestId: 'r1', requestSequence: 1, sessionId: 's1',
      modeId: 'technical-interview', modePolicyVersion: '1.0.0',
      rawQuestion: 'q', resolvedQuestion: 'q', isFollowUp: false,
      questionTypes: ['PERSONAL_PROJECT'], claimRequirements: [],
      scope: { userId: 'u1' }, authorizedSources: [],
      requiredSourceTypes: ['RESUME'], optionalSourceTypes: [],
      groundingPolicy: 'SOURCE_FIRST', generalKnowledgeAllowed: true,
      personalClaimsRequireEvidence: true, documentClaimsRequireEvidence: true,
      meetingClaimsRequireEvidence: true, jobClaimsRequireJdEvidence: true,
      retrievalPlan: {
        path: 'GROUNDED', shouldRetrieve: true, sourceTypes: ['RESUME'],
        queries: ['q'], entities: [], useSemanticSearch: true, useKeywordSearch: true,
        useHeadingSearch: false, useExactEntitySearch: false, usePreviousSourceContinuity: false,
        retrieveAdjacentContext: false, maximumAttempts: 2, maximumCandidates: 20,
        maximumAcceptedEvidence: 6, timeoutMs: 1200,
      },
      createdAt: 0,
    });

    assert.throws(() => { d.groundingPolicy = 'OPEN_KNOWLEDGE'; }, TypeError);
    assert.throws(() => { d.retrievalPlan.shouldRetrieve = false; }, TypeError, 'nested objects must be frozen too');
    assert.throws(() => { d.requiredSourceTypes.push('JOB_DESCRIPTION'); }, TypeError, 'arrays must be frozen too');
  });

  test('scopeKey is stable and order-independent of optional fields', () => {
    assert.equal(scopeKey({ userId: 'u1' }), 'u:u1');
    assert.equal(scopeKey({ userId: 'u1', meetingId: 'm1' }), 'u:u1|m:m1');
  });
});
