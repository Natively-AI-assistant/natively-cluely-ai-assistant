// Context Intelligence V3 — legacy retrieval port.
//
// These assert the rules the legacy retrieval path never had, applied on top of
// the legacy retriever's own output.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { createLegacyRetrievalPort } = await import(pathToFileURL(path.join(base, 'retrieval/legacy-retrieval-port.js')).href);
const { decide, orchestrate } = await import(pathToFileURL(path.join(base, 'orchestration/orchestrator.js')).href);

const registry = () => ({
  sourceTypes: new Map([['resume-1', 'RESUME'], ['jd-1', 'JOB_DESCRIPTION']]),
  activeVersions: new Map([['resume-1', 'v2'], ['jd-1', 'v1']]),
});

const req = (q, over = {}) => ({
  requestId: 'r1', requestSequence: 1, surface: 'manual-chat',
  modeId: 'technical-interview', scope: { userId: 'u1' }, sessionId: 's1',
  manualQuestion: q, ...over,
});

const port = (chunks, reg = registry(), opts = {}) => createLegacyRetrievalPort({
  retrieve: async () => chunks, registry: reg, ...opts,
});

describe('does not retrieve when the decision says not to', () => {
  test('a FAST turn never calls the legacy retriever', async () => {
    let called = false;
    const p = createLegacyRetrievalPort({
      retrieve: async () => { called = true; return []; }, registry: registry(),
    });
    const r = await p.retrieve({ decision: decide(req('What is idempotency in an HTTP API?')) });
    assert.equal(called, false);
    assert.deepEqual(r.evidence, []);
    assert.deepEqual(r.attempts, []);
  });
});

describe('applies scope and version rules the legacy path lacked', () => {
  test('a superseded version is rejected even when the legacy retriever returns it', async () => {
    const reg = registry();
    reg.chunkVersions = new Map([['resume-1', 'v1']]);   // stale
    const p = port([{ sourceId: 'resume-1', text: 'Managed a team of 4', chunkIndex: 0, score: 0.99 }], reg);
    const r = await p.retrieve({ decision: decide(req('Tell me about your team leadership experience.')) });
    assert.equal(r.evidence.length, 0, 'top-scoring but stale must not survive');
    assert.equal(r.attempts[0].rejectedByScopeFilter, 1);
    assert.equal(r.attempts[0].candidateCount, 1, 'the rejection is visible, not hidden');
  });

  test('an unknown source is rejected rather than guessed', async () => {
    const p = port([{ sourceId: 'mystery', text: 'x', chunkIndex: 0, score: 0.9 }]);
    const r = await p.retrieve({ decision: decide(req('Tell me about your WebRTC project.')) });
    assert.equal(r.evidence.length, 0);
    assert.equal(r.attempts[0].rejectedByScopeFilter, 1);
  });
});

describe('claim authority filtering', () => {
  test('a JD chunk cannot satisfy a user-skill claim', async () => {
    const p = port([
      { sourceId: 'jd-1', text: 'Postgres required', chunkIndex: 0, score: 0.99 },
      { sourceId: 'resume-1', text: 'Go, Kafka', chunkIndex: 0, score: 0.4 },
    ]);
    const r = await p.retrieve({ decision: decide(req('Do you have experience with Postgres?')) });
    assert.ok(!r.evidence.some((e) => e.sourceType === 'JOB_DESCRIPTION'),
      'the JD scored highest and must still be excluded — it states what the EMPLOYER wants');
  });

  test('a JD chunk DOES satisfy a job-requirement claim', async () => {
    const p = port([{ sourceId: 'jd-1', text: 'Postgres required', chunkIndex: 0, score: 0.9 }]);
    const r = await p.retrieve({ decision: decide(req('What are the required skills for this role?')) });
    assert.equal(r.evidence.length, 1);
    assert.equal(r.evidence[0].sourceType, 'JOB_DESCRIPTION');
  });
});

describe('caps and ordering', () => {
  test('respects maximumAcceptedEvidence and orders by score', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      sourceId: 'resume-1', text: `chunk ${i}`, chunkIndex: i, score: i / 100,
    }));
    const p = port(many);
    const d = decide(req('Tell me about your WebRTC project.'));
    const r = await p.retrieve({ decision: d });
    assert.ok(r.evidence.length <= d.retrievalPlan.maximumAcceptedEvidence);
    for (let i = 1; i < r.evidence.length; i++) {
      assert.ok(r.evidence[i - 1].finalScore >= r.evidence[i].finalScore, 'must be score-ordered');
    }
  });
});

describe('failure is recorded, never disguised as success', () => {
  test('a retriever throw is captured on the attempt', async () => {
    const p = createLegacyRetrievalPort({
      retrieve: async () => { throw new Error('NO_RELEVANT_CONTEXT_FOUND'); }, registry: registry(),
    });
    const r = await p.retrieve({ decision: decide(req('Tell me about your WebRTC project.')) });
    assert.equal(r.evidence.length, 0);
    assert.match(r.attempts[0].failed, /NO_RELEVANT_CONTEXT_FOUND/,
      'the legacy path converts this to {fallback:true}, indistinguishable from a grounded answer');
  });

  test('a failed retrieval yields answerability NONE, not a confident answer', async () => {
    const p = createLegacyRetrievalPort({
      retrieve: async () => { throw new Error('timeout'); }, registry: registry(),
    });
    const r = await orchestrate(req('Tell me about your WebRTC project.'), p);
    assert.equal(r.answerability, 'NONE');
  });
});

describe('end to end through the orchestrator', () => {
  test('a grounded question with valid evidence is FULL', async () => {
    const p = port([{ sourceId: 'resume-1', text: 'Built a WebRTC pipeline', chunkIndex: 0, score: 0.9 }]);
    const r = await orchestrate(req('Tell me about your WebRTC project.'), p);
    assert.equal(r.answerability, 'FULL');
    assert.equal(r.trace.acceptedEvidence[0].versionId, 'v2');
    assert.equal(r.trace.retrievalAttempts.length, 1);
  });

  test('the trace carries the scope-filter counts', async () => {
    const reg = registry();
    reg.chunkVersions = new Map([['resume-1', 'v1']]);
    const p = port([{ sourceId: 'resume-1', text: 'stale', chunkIndex: 0, score: 0.9 }], reg);
    const r = await orchestrate(req('Tell me about your WebRTC project.'), p);
    assert.equal(r.trace.retrievalAttempts[0].rejectedByScopeFilter, 1);
    assert.equal(r.answerability, 'NONE');
  });
});
