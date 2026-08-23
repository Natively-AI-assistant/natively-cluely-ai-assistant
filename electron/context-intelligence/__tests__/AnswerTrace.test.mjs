// Context Intelligence V3 — AnswerTrace.
//
// Two properties are load-bearing and both are tested here:
//   1. a trace NEVER carries private source content (only identity + lengths)
//   2. shadow mode can diff legacy vs v3 DECISIONS without a model call

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { redactTrace, compareDecisions, decisionsMatch } = await import(pathToFileURL(path.resolve(
  process.cwd(), 'dist-electron/electron/context-intelligence/observability/answer-trace.js')).href);

const baseTrace = (over = {}) => ({
  requestId: 'r1', requestSequence: 1,
  scope: { userId: 'u1', meetingId: 'm1' },
  surface: 'manual-chat',
  originalQuestion: 'why did you use webrtc', resolvedQuestion: 'Why did you choose WebRTC?',
  resolutionConfidence: 0.9,
  modeId: 'technical-interview', modePolicyVersion: '1.0.0',
  questionTypes: ['PERSONAL_PROJECT'], groundingPolicy: 'SOURCE_FIRST',
  authorizedSources: [{ sourceType: 'RESUME', sourceId: 'res-1', versionId: 'v2', scopeId: 'u:u1' }],
  prohibitedSources: [{ sourceType: 'JOB_DESCRIPTION', sourceId: 'jd-1', versionId: 'v1', scopeId: 'u:u1' }],
  retrievalPath: 'GROUNDED', retrievalAttempts: [],
  acceptedEvidence: [{ evidenceId: 'ev-1', sourceType: 'RESUME', sourceId: 'res-1', versionId: 'v2', scopeId: 'u:u1', finalScore: 0.8, contentLength: 120 }],
  rejectedEvidence: [], answerability: 'FULL', claimPlan: [], fallbackUsed: 'NONE',
  promptTokenEstimate: 900,
  latency: { normalizationMs: 1, questionResolutionMs: 2, policyResolutionMs: 1, classificationMs: 3,
    retrievalMs: 11, rerankingMs: 0, evidenceEvaluationMs: 2, promptCompositionMs: 1, providerTtfbMs: 300, totalMs: 340 },
  providerAttempts: [], status: 'COMPLETED', errorCodes: [], engine: 'v3',
  ...over,
});

describe('redaction — a trace must never hold private content', () => {
  test('replaces content-bearing keys with lengths', () => {
    const r = redactTrace({
      evidenceId: 'ev-1',
      content: 'Developed a WebRTC pipeline at Acme handling 5.1M transactions',
      nested: { text: 'secret resume line', score: 0.9 },
    });
    assert.equal(r.content, undefined, 'raw content must not survive redaction');
    assert.equal(r.contentLength, 62);
    assert.equal(r.nested.text, undefined);
    assert.equal(r.nested.textLength, 18);
    assert.equal(r.nested.score, 0.9, 'non-content fields are preserved');
    assert.equal(r.evidenceId, 'ev-1', 'identity is preserved — that is the point');
  });

  test('redacts through arrays', () => {
    const r = redactTrace({ items: [{ content: 'abc' }, { content: 'defgh' }] });
    assert.deepEqual(r.items.map((i) => i.contentLength), [3, 5]);
    assert.ok(r.items.every((i) => i.content === undefined));
  });

  test('a fully-populated trace survives redaction with identity intact', () => {
    const r = redactTrace(baseTrace());
    assert.equal(r.acceptedEvidence[0].evidenceId, 'ev-1');
    assert.equal(r.acceptedEvidence[0].versionId, 'v2', 'version must survive — it is the top measured risk');
    assert.equal(r.acceptedEvidence[0].scopeId, 'u:u1');
  });
});

describe('shadow-mode decision diffing', () => {
  test('identical decisions produce no divergence', () => {
    assert.deepEqual(compareDecisions(baseTrace({ engine: 'legacy' }), baseTrace()), []);
    assert.equal(decisionsMatch(baseTrace({ engine: 'legacy' }), baseTrace()), true);
  });

  test('ignores latency and provider differences — decisions only', () => {
    const legacy = baseTrace({
      engine: 'legacy',
      latency: { ...baseTrace().latency, totalMs: 9999, retrievalMs: 800 },
      providerAttempts: [{ provider: 'gemini', model: 'flash', ok: true }],
      promptTokenEstimate: 4321,
    });
    assert.equal(decisionsMatch(legacy, baseTrace()), true,
      'shadow mode proves the same DECISION, not the same timing');
  });

  test('detects a grounding-policy divergence', () => {
    const d = compareDecisions(baseTrace({ engine: 'legacy', groundingPolicy: 'OPEN_KNOWLEDGE' }), baseTrace());
    assert.equal(d.length, 1);
    assert.equal(d[0].field, 'groundingPolicy');
  });

  test('detects a different accepted-evidence set', () => {
    const legacy = baseTrace({
      engine: 'legacy',
      acceptedEvidence: [{ ...baseTrace().acceptedEvidence[0], evidenceId: 'ev-9' }],
    });
    assert.ok(compareDecisions(legacy, baseTrace()).some((x) => x.field === 'acceptedEvidence'));
  });

  test('detects a STALE VERSION divergence — the top measured risk', () => {
    const legacy = baseTrace({
      engine: 'legacy',
      authorizedSources: [{ sourceType: 'RESUME', sourceId: 'res-1', versionId: 'v1', scopeId: 'u:u1' }],
    });
    const d = compareDecisions(legacy, baseTrace());
    assert.ok(d.some((x) => x.field === 'authorizedSources'),
      'a v1-vs-v2 difference must surface — 54.8% of semantic retrievals hit the stale version');
  });

  test('question-type ordering does not create false divergence', () => {
    const a = baseTrace({ engine: 'legacy', questionTypes: ['MIXED', 'PERSONAL_PROJECT'] });
    const b = baseTrace({ questionTypes: ['PERSONAL_PROJECT', 'MIXED'] });
    assert.equal(decisionsMatch(a, b), true);
  });

  test('detects a retrieval-path divergence (fast vs grounded)', () => {
    const legacy = baseTrace({ engine: 'legacy', retrievalPath: 'FAST' });
    assert.ok(compareDecisions(legacy, baseTrace()).some((x) => x.field === 'retrievalPath'));
  });
});
