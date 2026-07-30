// Context Intelligence V3 — flag + legacy adapter.
//
// The flag test encodes the ONE rule that the whole rebuild depends on: the
// default must not vary by environment. That split is what let composePrompt be
// built, tested, and never run for a user.
//
// The adapter tests encode the measured requirement: a superseded version is
// REJECTED, not ranked lower (54.8% stale-version rate on semantic ranking).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { isContextIntelligenceV3Enabled, whenV3Enabled, DEFAULT_ENABLED, CONTEXT_INTELLIGENCE_V3_ENV_KEY } =
  await import(pathToFileURL(path.join(base, 'contracts/flag.js')).href);
const { adaptLegacyChunks, evidenceForClaim } =
  await import(pathToFileURL(path.join(base, 'retrieval/legacy-adapter.js')).href);

describe('flag — must not vary by environment', () => {
  test('defaults to false, and the default is a single constant', () => {
    assert.equal(DEFAULT_ENABLED, false);
    assert.equal(isContextIntelligenceV3Enabled({ env: {} }), false);
  });

  test('resolves identically under dev, test and production markers', () => {
    // The exact conditions isInternalDevTestContext keys on. If any of these
    // flipped the answer, we would have rebuilt the disease.
    const envs = [
      {}, { NODE_ENV: 'test' }, { NODE_ENV: 'development' }, { NODE_ENV: 'production' },
      { NATIVELY_INTERNAL: '1' }, { NATIVELY_DEV: '1' }, { BENCHMARK_MODEL: 'gemini' },
    ];
    for (const env of envs) {
      assert.equal(isContextIntelligenceV3Enabled({ env }), false,
        `flag must stay false under ${JSON.stringify(env)}`);
    }
  });

  test('explicit env enables and disables', () => {
    for (const v of ['1', 'true', 'on', 'yes', 'enabled']) {
      assert.equal(isContextIntelligenceV3Enabled({ env: { [CONTEXT_INTELLIGENCE_V3_ENV_KEY]: v } }), true, v);
    }
    for (const v of ['0', 'false', 'off', 'no', 'disabled']) {
      assert.equal(isContextIntelligenceV3Enabled({ env: { [CONTEXT_INTELLIGENCE_V3_ENV_KEY]: v } }), false, v);
    }
  });

  test('env beats a persisted setting in BOTH directions', () => {
    assert.equal(isContextIntelligenceV3Enabled({ env: { [CONTEXT_INTELLIGENCE_V3_ENV_KEY]: '0' }, setting: true }), false);
    assert.equal(isContextIntelligenceV3Enabled({ env: { [CONTEXT_INTELLIGENCE_V3_ENV_KEY]: '1' }, setting: false }), true);
  });

  test('whenV3Enabled returns legacy untouched when off — rollback is a flag flip', () => {
    assert.equal(whenV3Enabled(false, () => 'v3', () => 'legacy'), 'legacy');
    assert.equal(whenV3Enabled(true, () => 'v3', () => 'legacy'), 'v3');
  });
});

describe('legacy adapter — scope and version', () => {
  const scope = { userId: 'u1', meetingId: 'm1' };
  const sourceTypes = new Map([['resume-1', 'RESUME'], ['jd-1', 'JOB_DESCRIPTION']]);
  const activeVersions = new Map([['resume-1', 'v2'], ['jd-1', 'v1']]);
  const chunkVersions = new Map([['resume-1', 'v2'], ['jd-1', 'v1']]);
  const chunk = (over = {}) => ({ sourceId: 'resume-1', text: 'Built a WebRTC pipeline', chunkIndex: 0, score: 0.8, ...over });

  test('admits an active-version chunk and stamps scopeId', () => {
    const r = adaptLegacyChunks([chunk()], { scope, sourceTypes, activeVersions, chunkVersions, assumeInScopeWhenUnknown: true });
    assert.equal(r.evidence.length, 1);
    assert.equal(r.evidence[0].scopeId, 'u:u1|m:m1');
    assert.equal(r.evidence[0].versionId, 'v2');
  });

  test('REJECTS a superseded version rather than ranking it lower', () => {
    const r = adaptLegacyChunks([chunk()], {
      scope, sourceTypes, activeVersions,
      chunkVersions: new Map([['resume-1', 'v1']]),
      assumeInScopeWhenUnknown: true,
    });
    assert.equal(r.evidence.length, 0, 'a superseded chunk must not be retrievable at all');
    assert.equal(r.rejected[0].reason, 'SUPERSEDED_VERSION');
  });

  test('fails CLOSED on an unknown source type — never guesses', () => {
    const r = adaptLegacyChunks([chunk({ sourceId: 'mystery' })], { scope, sourceTypes, activeVersions, chunkVersions, assumeInScopeWhenUnknown: true });
    assert.equal(r.evidence.length, 0);
    assert.equal(r.rejected[0].reason, 'UNKNOWN_SOURCE_TYPE');
  });

  test('fails CLOSED when no active version is known', () => {
    const r = adaptLegacyChunks([chunk({ sourceId: 'jd-1' })], {
      scope, sourceTypes, activeVersions: new Map([['resume-1', 'v2']]), assumeInScopeWhenUnknown: true,
    });
    assert.equal(r.rejected[0].reason, 'NO_ACTIVE_VERSION');
  });

  // The version check used to read `chunkVersions?.get(id) ?? active`, so a
  // caller that supplied no chunk versions had every chunk treated as current
  // and the filter was inert while reporting success. A benchmark harness did
  // exactly that and scored version isolation 42/42 against a corpus that
  // contained no superseded document at all.
  test('fails CLOSED when the chunk version is UNKNOWN — the fail-open default is gone', () => {
    const r = adaptLegacyChunks([chunk()], { scope, sourceTypes, activeVersions, assumeInScopeWhenUnknown: true });
    assert.equal(r.evidence.length, 0,
      'an unregistered chunk version must not be assumed current');
    assert.equal(r.rejected[0].reason, 'UNKNOWN_CHUNK_VERSION');
  });

  test('the fail-open path still exists, but only when explicitly requested', () => {
    // The wired manual-chat surface needs this: the legacy mode-reference store
    // has no version column, so there is no chunkVersions map to supply.
    const r = adaptLegacyChunks([chunk()], {
      scope, sourceTypes, activeVersions, assumeCurrentWhenVersionUnknown: true, assumeInScopeWhenUnknown: true,
    });
    assert.equal(r.evidence.length, 1);
    assert.equal(r.evidence[0].retrievedVersionId, 'v2', 'assumed to be the active version');
  });

  test('retrievedVersionId records the chunk’s OWN version, not the active one', () => {
    // This is what makes the orchestrator's version-collision check able to
    // fire. While every admitted item was stamped with the ACTIVE version, two
    // items from one source could not differ, so CONFLICTING was unreachable.
    const r = adaptLegacyChunks([chunk()], {
      scope, sourceTypes, activeVersions, chunkVersions, assumeInScopeWhenUnknown: true,
    });
    assert.equal(r.evidence[0].versionId, 'v2');
    assert.equal(r.evidence[0].retrievedVersionId, 'v2');
  });
});

describe('legacy adapter — carries the dropped signals through', () => {
  const opts = {
    scope: { userId: 'u1' },
    sourceTypes: new Map([['resume-1', 'RESUME']]),
    activeVersions: new Map([['resume-1', 'v2']]),
    chunkVersions: new Map([['resume-1', 'v2']]),
    assumeInScopeWhenUnknown: true,
  };

  test('preserves answerabilityScore and rerankScore that the legacy type discards', () => {
    const r = adaptLegacyChunks([{
      sourceId: 'resume-1', text: 'x', chunkIndex: 0, score: 0.9,
      vectorScore: 0.7, ftsScore: 0.4, rerankScore: 2.1, answerabilityScore: 0.55,
    }], opts);
    const e = r.evidence[0];
    assert.equal(e.answerabilityScore, 0.55, 'structural signal must survive the boundary');
    assert.equal(e.rerankerScore, 2.1);
    assert.equal(e.semanticScore, 0.7);
    assert.equal(e.keywordScore, 0.4);
  });

  test('marks retrieved text untrusted and direct', () => {
    const e = adaptLegacyChunks([{ sourceId: 'resume-1', text: 'x', chunkIndex: 0 }], opts).evidence[0];
    assert.equal(e.trustLevel, 'untrusted_reference', 'retrieved text is DATA, never instructions');
    assert.equal(e.isDirectFact, true);
    assert.equal(e.isInferred, false);
  });
});

describe('claim-level authority filtering', () => {
  const opts = {
    scope: { userId: 'u1' },
    sourceTypes: new Map([['resume-1', 'RESUME'], ['jd-1', 'JOB_DESCRIPTION']]),
    activeVersions: new Map([['resume-1', 'v2'], ['jd-1', 'v1']]),
    chunkVersions: new Map([['resume-1', 'v2'], ['jd-1', 'v1']]),
    assumeInScopeWhenUnknown: true,
  };

  test('a JD is never returned for a USER_SKILL claim — the canonical contamination', () => {
    const { evidence } = adaptLegacyChunks([
      { sourceId: 'resume-1', text: 'Go, PostgreSQL, Kafka', chunkIndex: 0 },
      { sourceId: 'jd-1', text: 'Postgres required', chunkIndex: 0 },
    ], opts);

    const forSkill = evidenceForClaim(evidence, 'USER_SKILL');
    assert.equal(forSkill.length, 1);
    assert.equal(forSkill[0].sourceType, 'RESUME');
    assert.ok(!forSkill.some((e) => e.sourceType === 'JOB_DESCRIPTION'),
      'a JD states what the EMPLOYER wants — it can never evidence what the user has');
  });

  test('and symmetrically, a resume never answers a job-requirement claim', () => {
    const { evidence } = adaptLegacyChunks([
      { sourceId: 'resume-1', text: 'Go, PostgreSQL', chunkIndex: 0 },
      { sourceId: 'jd-1', text: 'Postgres required', chunkIndex: 0 },
    ], opts);
    const forJob = evidenceForClaim(evidence, 'JOB_REQUIRED_SKILL');
    assert.equal(forJob.length, 1);
    assert.equal(forJob[0].sourceType, 'JOB_DESCRIPTION');
  });
});

// ── F25a — scope isolation, which previously did not exist ───────────────────
//
// `filterByScopeAndVersion` implemented this comparison and had ZERO call sites
// outside its own tests. The adapter stamped every item with `scopeKey(turn)` and
// never compared it against anything, so a record from another meeting was
// admitted and then LABELLED as belonging to the current scope. 06 §4 requires
// the filter specifically because the two meeting transcripts are written with
// high lexical overlap so ranking cannot separate them.

describe('legacy adapter — scope isolation', () => {
  const sourceTypes = new Map([['june', 'MEETING_TRANSCRIPT'], ['sept', 'MEETING_TRANSCRIPT'], ['resume', 'RESUME']]);
  const activeVersions = new Map([['june', 'v1'], ['sept', 'v1'], ['resume', 'v1']]);
  const chunkVersions = new Map([['june', 'v1'], ['sept', 'v1'], ['resume', 'v1']]);
  const sourceScopes = new Map([
    ['june', { userId: 'u1', meetingId: 'm-june' }],
    ['sept', { userId: 'u1', meetingId: 'm-sept' }],
    ['resume', { userId: 'u1' }],                       // user-level, no meeting
  ]);
  const base = { sourceTypes, activeVersions, chunkVersions, sourceScopes };
  const chunk = (sourceId, text) => ({ sourceId, text, chunkIndex: 0, score: 0.9 });
  const septTurn = { userId: 'u1', meetingId: 'm-sept' };

  test('a record from ANOTHER meeting is rejected, however well it scores', () => {
    const r = adaptLegacyChunks(
      [{ ...chunk('june', 'We are moving the ledger to Cassandra'), score: 0.99 }],
      { ...base, scope: septTurn },
    );
    assert.equal(r.evidence.length, 0, 'the June decision must not answer a September turn');
    assert.equal(r.rejected[0].reason, 'OUT_OF_SCOPE');
  });

  test('the current meeting IS admitted', () => {
    const r = adaptLegacyChunks([chunk('sept', 'We are explicitly NOT migrating the ledger')], { ...base, scope: septTurn });
    assert.equal(r.evidence.length, 1);
    assert.equal(r.evidence[0].scopeId, 'u:u1|m:m-sept');
  });

  // CONTAINMENT, not equality — the bug this design nearly shipped. Comparing
  // scope keys as strings gives `u:u1` !== `u:u1|m:m-sept`, which would reject
  // the user's own résumé from every meeting turn.
  test('a USER-level document stays visible inside a meeting turn', () => {
    const r = adaptLegacyChunks([chunk('resume', 'Managed a team of 11 engineers')], { ...base, scope: septTurn });
    assert.equal(r.evidence.length, 1,
      'narrowing to a meeting does not revoke the user’s own material');
  });

  test('a meeting record is NOT visible from a user-level turn', () => {
    const r = adaptLegacyChunks([chunk('sept', 'x')], { ...base, scope: { userId: 'u1' } });
    assert.equal(r.evidence.length, 0, 'a meeting-scoped record must not leak into a general turn');
    assert.equal(r.rejected[0].reason, 'OUT_OF_SCOPE');
  });

  test('another USER is rejected — the strongest isolation case', () => {
    const r = adaptLegacyChunks([chunk('resume', 'someone else')], { ...base, scope: { userId: 'u2' } });
    assert.equal(r.evidence.length, 0);
    assert.equal(r.rejected[0].reason, 'OUT_OF_SCOPE');
  });

  test('fails CLOSED when the source scope is UNKNOWN', () => {
    const r = adaptLegacyChunks([chunk('sept', 'x')], {
      sourceTypes, activeVersions, chunkVersions, scope: septTurn,   // no sourceScopes
    });
    assert.equal(r.evidence.length, 0);
    assert.equal(r.rejected[0].reason, 'UNKNOWN_SOURCE_SCOPE');
  });

  test('the fail-open exists only when explicitly requested', () => {
    // The wired manual-chat surface needs it: mode reference files carry no scope.
    const r = adaptLegacyChunks([chunk('sept', 'x')], {
      sourceTypes, activeVersions, chunkVersions, scope: septTurn, assumeInScopeWhenUnknown: true,
    });
    assert.equal(r.evidence.length, 1);
  });

  test('scope is checked BEFORE version, so the reason is not misattributed', () => {
    // A foreign meeting record that is ALSO stale must report OUT_OF_SCOPE: it is
    // not "a stale version of this meeting", and the wrong reason would send a
    // reader looking at version handling for a scope bug.
    const r = adaptLegacyChunks([chunk('june', 'x')], {
      ...base, scope: septTurn, chunkVersions: new Map([['june', 'v0']]),
    });
    assert.equal(r.rejected[0].reason, 'OUT_OF_SCOPE');
  });
});
