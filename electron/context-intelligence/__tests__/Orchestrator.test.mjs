// Context Intelligence V3 — orchestrator.
//
// End-to-end through the decision layer with an injected retrieval port.
// These are the invariants the mission exists to establish.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { decide, orchestrate, evaluateAnswerability } =
  await import(pathToFileURL(path.join(base, 'orchestration/orchestrator.js')).href);
const { adaptLegacyChunks } = await import(pathToFileURL(path.join(base, 'retrieval/legacy-adapter.js')).href);

const req = (over = {}) => ({
  requestId: 'r1', requestSequence: 1, surface: 'manual-chat',
  modeId: 'technical-interview', scope: { userId: 'u1' }, sessionId: 's1',
  ...over,
});

// A retrieval port backed by the real adapter, so evidence carries genuine
// scope/version/authority rather than hand-built fixtures.
const portFrom = (chunks, opts) => ({
  async retrieve() {
    const { evidence } = adaptLegacyChunks(chunks, opts);
    return { evidence, attempts: [] };
  },
});

const ADAPT = {
  scope: { userId: 'u1' },
  sourceTypes: new Map([['resume-1', 'RESUME'], ['jd-1', 'JOB_DESCRIPTION']]),
  activeVersions: new Map([['resume-1', 'v2'], ['jd-1', 'v1']]),
};

describe('one decision, frozen', () => {
  test('decide() returns a deep-frozen object', () => {
    const d = decide(req({ manualQuestion: 'Tell me about your WebRTC project.' }));
    assert.throws(() => { d.groundingPolicy = 'OPEN_KNOWLEDGE'; }, TypeError);
    assert.throws(() => { d.retrievalPlan.shouldRetrieve = false; }, TypeError);
  });

  test('manual input beats transcript — resolution happens once', () => {
    const d = decide(req({ manualQuestion: 'What is a mutex?', transcriptQuestion: 'tell me about your project' }));
    assert.equal(d.resolvedQuestion, 'What is a mutex?');
  });

  test('an unknown mode FAILS CLOSED', () => {
    assert.throws(() => decide(req({ modeId: 'nope', manualQuestion: 'hi' })), /Unknown modeId/);
  });

  test('the same request yields the same decision', () => {
    const a = decide(req({ manualQuestion: 'Tell me about your WebRTC project.' }));
    const b = decide(req({ manualQuestion: 'Tell me about your WebRTC project.' }));
    assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  });
});

describe('fast path does not retrieve', () => {
  test('a general question skips retrieval entirely', async () => {
    let called = false;
    const port = { async retrieve() { called = true; return { evidence: [], attempts: [] }; } };
    const r = await orchestrate(req({ manualQuestion: 'What is idempotency in an HTTP API?' }), port);
    assert.equal(r.decision.retrievalPlan.path, 'FAST');
    assert.equal(called, false, 'the retriever must not even be consulted');
    assert.equal(r.answerability, 'FULL', 'a general question is fully answerable without evidence');
    assert.equal(r.trace.fallbackUsed, 'NONE');
  });
});

describe('grounded path and claim support', () => {
  test('a personal question with resume evidence is FULL', async () => {
    const port = portFrom([{ sourceId: 'resume-1', text: 'Built a WebRTC pipeline', chunkIndex: 0, score: 0.9 }], ADAPT);
    const r = await orchestrate(req({ manualQuestion: 'Tell me about your WebRTC project.' }), port);
    assert.equal(r.decision.retrievalPlan.path, 'GROUNDED');
    assert.equal(r.answerability, 'FULL');
    assert.equal(r.trace.fallbackUsed, 'NONE');
  });

  test('a personal question with NO evidence is NONE and discloses rather than fabricating', async () => {
    const port = portFrom([], ADAPT);
    const r = await orchestrate(req({ manualQuestion: 'Tell me about your Kubernetes experience.' }), port);
    assert.equal(r.answerability, 'NONE');
    assert.equal(r.trace.claimPlan.find((c) => c.claimType === 'USER_SKILL')?.support, 'UNSUPPORTED');
  });

  test('THE contamination case: a JD cannot make a user-skill claim answerable', async () => {
    // "Postgres required" is in the JD and NOWHERE in the resume.
    const port = portFrom([{ sourceId: 'jd-1', text: 'Postgres required', chunkIndex: 0, score: 0.95 }], ADAPT);
    const r = await orchestrate(req({ manualQuestion: 'Do you have experience with Postgres?' }), port);
    assert.equal(r.answerability, 'NONE',
      'the JD scored highest, and still cannot evidence what the candidate has');
    assert.ok(!r.trace.claimPlan.some((c) => c.claimType === 'USER_SKILL' && c.support === 'DIRECT_EVIDENCE'));
  });

  test('a SUPERSEDED resume version cannot make a claim answerable', async () => {
    const port = portFrom(
      [{ sourceId: 'resume-1', text: 'Managed a team of 4 engineers', chunkIndex: 0, score: 0.99 }],
      { ...ADAPT, chunkVersions: new Map([['resume-1', 'v1']]) },
    );
    const r = await orchestrate(req({ manualQuestion: 'Tell me about your team leadership experience.' }), port);
    assert.equal(r.answerability, 'NONE',
      'the stale chunk scored 0.99 — version is a filter, not a ranking signal');
    assert.equal(r.trace.acceptedEvidence.length, 0);
  });
});

describe('grounding policy governs fallback, not source selection', () => {
  test('SOURCE_FIRST falls back to general knowledge when unsupported', async () => {
    const r = await orchestrate(req({ modeId: 'technical-interview', manualQuestion: 'Tell me about your Rust experience.' }), portFrom([], ADAPT));
    assert.equal(r.decision.generalKnowledgeAllowed, true);
    assert.equal(r.trace.fallbackUsed, 'GENERAL_KNOWLEDGE');
  });

  test('seminar labels rather than refusing — over-refusal is forbidden', async () => {
    const r = await orchestrate(req({ modeId: 'seminar', manualQuestion: 'What does the document say about attention?' }), portFrom([], ADAPT));
    assert.equal(r.decision.generalKnowledgeAllowed, true);
    assert.notEqual(r.trace.fallbackUsed, 'STRICT_NOT_FOUND');
  });
});

describe('trace', () => {
  test('carries evidence identity and version, never content', async () => {
    const port = portFrom([{ sourceId: 'resume-1', text: 'Built a WebRTC pipeline at Acme', chunkIndex: 0, score: 0.9 }], ADAPT);
    const r = await orchestrate(req({ manualQuestion: 'Tell me about your WebRTC project.' }), port);
    const e = r.trace.acceptedEvidence[0];
    assert.equal(e.versionId, 'v2');
    assert.equal(e.contentLength, 31);
    assert.equal(e.content, undefined, 'the trace must never carry source text');
    assert.equal(r.trace.engine, 'v3');
  });
});

describe('answerability is not a similarity threshold', () => {
  test('zero required claims is FULL regardless of evidence', () => {
    const d = decide(req({ manualQuestion: 'What is a bloom filter?' }));
    assert.equal(evaluateAnswerability(d, []), 'FULL');
  });
});
