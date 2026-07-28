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
  const chunk = (over = {}) => ({ sourceId: 'resume-1', text: 'Built a WebRTC pipeline', chunkIndex: 0, score: 0.8, ...over });

  test('admits an active-version chunk and stamps scopeId', () => {
    const r = adaptLegacyChunks([chunk()], { scope, sourceTypes, activeVersions });
    assert.equal(r.evidence.length, 1);
    assert.equal(r.evidence[0].scopeId, 'u:u1|m:m1');
    assert.equal(r.evidence[0].versionId, 'v2');
  });

  test('REJECTS a superseded version rather than ranking it lower', () => {
    const r = adaptLegacyChunks([chunk()], {
      scope, sourceTypes, activeVersions,
      chunkVersions: new Map([['resume-1', 'v1']]),
    });
    assert.equal(r.evidence.length, 0, 'a superseded chunk must not be retrievable at all');
    assert.equal(r.rejected[0].reason, 'SUPERSEDED_VERSION');
  });

  test('fails CLOSED on an unknown source type — never guesses', () => {
    const r = adaptLegacyChunks([chunk({ sourceId: 'mystery' })], { scope, sourceTypes, activeVersions });
    assert.equal(r.evidence.length, 0);
    assert.equal(r.rejected[0].reason, 'UNKNOWN_SOURCE_TYPE');
  });

  test('fails CLOSED when no active version is known', () => {
    const r = adaptLegacyChunks([chunk({ sourceId: 'jd-1' })], {
      scope, sourceTypes, activeVersions: new Map([['resume-1', 'v2']]),
    });
    assert.equal(r.rejected[0].reason, 'NO_ACTIVE_VERSION');
  });
});

describe('legacy adapter — carries the dropped signals through', () => {
  const opts = {
    scope: { userId: 'u1' },
    sourceTypes: new Map([['resume-1', 'RESUME']]),
    activeVersions: new Map([['resume-1', 'v2']]),
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
