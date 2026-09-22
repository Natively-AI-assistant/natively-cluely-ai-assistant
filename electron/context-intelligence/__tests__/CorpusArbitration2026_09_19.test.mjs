// Corpus arbitration (2026-09-19, retrieval-scale campaign). Measured with
// experiments/retrieval-scale: with a handbook attached, "What is
// ledger.compaction.window_minutes set to?" and "What is step 6 of the regional
// failover runbook?" took the no-retrieval path at every file size — the
// classifier decides from grammar and cannot see the material. The orchestrator
// now asks the retrieval port whether a chunk holds the question's distinctive
// terms together, and decides the turn again when it does. Also: an AMBIGUOUS
// question with documents attached retrieved nothing ("retrieve conservatively"
// was only a comment).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = (p) => import(pathToFileURL(path.resolve(process.cwd(), 'dist-electron/electron', p)).href);
const { orchestrate, decide } = await dist('context-intelligence/orchestration/orchestrator.js');
const { combineRetrievalPorts } = await dist('context-intelligence/retrieval/meeting-retrieval-port.js');
const { buildLexicalStats, corpusAnchorsQuestion } = await dist('services/modes/lexicalTokens.js');

const req = (q, extra = {}) => ({
  requestId: 'r', requestSequence: 1, surface: 'manual_chat', modeId: 'general', scope: { userId: 'u' },
  sessionId: `s-${q.length}-${Math.random()}`, manualQuestion: q, hasAttachedDocuments: true,
  attachedFileNames: ['handbook.md'], ...extra,
});
const portWith = (anchored) => {
  const calls = { probe: [], retrieve: 0 };
  return { calls, port: {
    probeAnchors: (q) => { calls.probe.push(q); return anchored; },
    retrieve: async () => { calls.retrieve++; return { evidence: [], attempts: [] }; },
  } };
};

// 40 same-shaped service sections plus the two facts the questions ask for.
const CORPUS = [
  ...Array.from({ length: 40 }, (_, i) => `Service atlas-api-${i} is owned by Growth Platform. Availability target 99.${i}%. It uses Kafka, Redis and Kubernetes; p99 latency budget ${100 + i} ms. atlas.api.${i}.timeout_ms = ${200 + i}`),
  'Service: ledger-compactor. Configuration: ledger.compaction.window_minutes = 45 and ledger.compaction.max_segments = 12',
  'Runbook: regional failover. 5. Freeze deploys in the failing region. 6. Drain the write queue before promoting the replica. 7. Flip the traffic weight.',
];
const stats = buildLexicalStats(CORPUS);

describe('corpusAnchorsQuestion', () => {
  for (const q of ['What is ledger.compaction.window_minutes set to?', 'What is step 6 of the regional failover runbook?']) {
    test(`anchored: ${q}`, () => assert.equal(corpusAnchorsQuestion(q, stats), true));
  }
  for (const q of ['What is a mutex?', 'What is the difference between TCP and UDP?', 'Reverse a linked list in Python',
    'Explain the CAP theorem', 'What is Kubernetes?', 'How does Kafka guarantee ordering?', 'How do I center a div in CSS?']) {
    test(`not anchored: ${q}`, () => assert.equal(corpusAnchorsQuestion(q, stats), false));
  }
  test('one shared word is never enough', () => {
    assert.equal(corpusAnchorsQuestion('Tell me about failover in PostgreSQL clusters generally', stats), false);
  });
});

describe('orchestrate() asks the port only when the classifier declined to retrieve', () => {
  const Q = 'What is ledger.compaction.window_minutes set to?';
  test('the grammar alone sends this question down the no-retrieval path', () => {
    assert.equal(decide(req(Q)).retrievalPlan.shouldRetrieve, false);
  });
  test('an anchored question is decided again as a document lookup, and retrieval runs', async () => {
    const { port, calls } = portWith(true);
    const r = await orchestrate(req(Q), port);
    assert.equal(calls.probe.length, 1);
    assert.equal(r.decision.retrievalPlan.shouldRetrieve, true);
    assert.ok(r.decision.claimRequirements.some((c) => c.claimType === 'DOCUMENT_FACT'), JSON.stringify(r.decision.claimRequirements));
    assert.equal(calls.retrieve, 1);
  });
  test('an un-anchored question keeps the fast path', async () => {
    const { port, calls } = portWith(false);
    const r = await orchestrate(req('What is a mutex?'), port);
    assert.equal(calls.probe.length, 1);
    assert.equal(r.decision.retrievalPlan.shouldRetrieve, false);
    assert.equal(calls.retrieve, 0);
  });
  test('no probe when the turn already retrieves, or when nothing is attached', async () => {
    const a = portWith(true);
    await orchestrate(req('What is the burst limit per tenant on the public API?'), a.port);
    assert.equal(a.calls.probe.length, 0);
    const b = portWith(true);
    await orchestrate(req(Q, { hasAttachedDocuments: false, attachedFileNames: [] }), b.port);
    assert.equal(b.calls.probe.length, 0);
  });
  test('a probe that throws leaves the first decision standing', async () => {
    const port = { probeAnchors: () => { throw new Error('boom'); }, retrieve: async () => ({ evidence: [], attempts: [] }) };
    const r = await orchestrate(req(Q), port);
    assert.equal(r.decision.retrievalPlan.shouldRetrieve, false);
  });
  test('a caller cannot assert the verdict in a mode that holds no documents', () => {
    const d = decide(req(Q, { hasAttachedDocuments: false, attachedFileNames: [], corpusAnchored: true }));
    assert.equal(d.retrievalPlan.shouldRetrieve, false);
  });
  test('combined ports: anchored when ANY port is; a port without the method is skipped', () => {
    const none = { retrieve: async () => ({ evidence: [], attempts: [] }) };
    assert.equal(combineRetrievalPorts([none, portWith(false).port]).probeAnchors('q'), false);
    assert.equal(combineRetrievalPorts([none, portWith(true).port]).probeAnchors('q'), true);
  });
});

describe('an AMBIGUOUS question retrieves when documents are attached', () => {
  const Q = 'Will they help me move countries and pay for it?';
  test('with documents: retrieves from the document pool', () => {
    const d = decide(req(Q));
    assert.ok(d.questionTypes.includes('AMBIGUOUS'), d.questionTypes.join(','));
    assert.equal(d.retrievalPlan.shouldRetrieve, true);
  });
  test('without documents: unchanged — nothing to look in', () => {
    const d = decide(req(Q, { hasAttachedDocuments: false, attachedFileNames: [] }));
    assert.equal(d.retrievalPlan.shouldRetrieve, false);
  });
});
