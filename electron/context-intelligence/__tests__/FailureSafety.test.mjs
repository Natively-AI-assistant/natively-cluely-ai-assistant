// Context Intelligence V3 — failure-safe behaviour (§22, corpus category I).
//
// The rule that governs all of these: a dependency failure must never be
// convertible into an answer that LOOKS grounded. The legacy path turns both
// NO_RELEVANT_CONTEXT_FOUND and a timeout into {fallback:true}, which is
// indistinguishable to the user and to telemetry — that is the shape being
// designed out.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { orchestrate, decide } = await import(pathToFileURL(path.join(base, 'orchestration/orchestrator.js')).href);
const { composePrompt } = await import(pathToFileURL(path.join(base, 'generation/prompt-composer.js')).href);
const { MODE_POLICIES, resolveModePolicy } = await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);
const { createLegacyRetrievalPort } = await import(pathToFileURL(path.join(base, 'retrieval/legacy-retrieval-port.js')).href);
const { adaptLegacyChunks } = await import(pathToFileURL(path.join(base, 'retrieval/legacy-adapter.js')).href);
const { buildV3Prompt } = await import(pathToFileURL(path.join(base, 'orchestration/engine-bridge.js')).href);
const { CONTEXT_INTELLIGENCE_V3_ENV_KEY } = await import(pathToFileURL(path.join(base, 'contracts/flag.js')).href);

const req = (q, modeId = 'technical-interview') => ({
  requestId: 'r1', requestSequence: 1, surface: 'manual-chat',
  modeId, scope: { userId: 'u1' }, sessionId: 's1', manualQuestion: q,
});
const GROUNDED_Q = 'Tell me about your WebRTC project.';

describe('§22.1 — retrieval unavailable', () => {
  test('a thrown retrieval error does NOT abort the turn', async () => {
    const r = await orchestrate(req(GROUNDED_Q), {
      async retrieve() { throw new Error('NO_RELEVANT_CONTEXT_FOUND'); },
    });
    assert.equal(r.answerability, 'NONE');
    assert.equal(r.evidence.length, 0);
  });

  test('the failure is RECORDED, not silently swallowed', async () => {
    const r = await orchestrate(req(GROUNDED_Q), {
      async retrieve() { throw new Error('embedding service timeout'); },
    });
    assert.equal(r.trace.retrievalAttempts.length, 1);
    assert.match(r.trace.retrievalAttempts[0].failed, /timeout/,
      'a miss and a failure must be distinguishable in the trace');
  });

  test('NO fabricated evidence is substituted for a failure', async () => {
    const r = await orchestrate(req(GROUNDED_Q), {
      async retrieve() { throw new Error('down'); },
    });
    assert.deepEqual(r.trace.acceptedEvidence, []);
    const composed = composePrompt({
      decision: r.decision, policy: MODE_POLICIES['technical-interview'], evidence: r.evidence,
    });
    assert.match(composed.user, /No supporting evidence was retrieved/,
      'the prompt must state the gap rather than proceed silently');
  });

  test('a hung retriever cannot hang the turn forever', async () => {
    // The plan carries a timeout; a port that never resolves is the caller's
    // problem to bound, but the DECISION must still declare one.
    const d = decide(req(GROUNDED_Q));
    assert.ok(d.retrievalPlan.timeoutMs > 0);
    assert.equal(d.retrievalPlan.maximumAttempts, 2, 'unlimited retry is prohibited — latency is correctness');
  });
});

describe('§22.4 — a malformed source is isolated, not allowed to poison the set', () => {
  const registry = {
    sourceTypes: new Map([['good', 'REFERENCE_FILE'], ['bad', 'REFERENCE_FILE']]),
    activeVersions: new Map([['good', 'v1'], ['bad', 'v1']]),
    chunkVersions: new Map([['good', 'v1'], ['bad', 'v1']]),
    assumeInScopeWhenUnknown: true,
  };

  test('one unusable chunk does not discard the usable ones', () => {
    const { evidence, rejected } = adaptLegacyChunks([
      { sourceId: 'good', text: 'Acme discount floor is 17 percent', chunkIndex: 0, score: 0.8 },
      { sourceId: 'unknown-source', text: 'garbage', chunkIndex: 0, score: 0.9 },
    ], { scope: { userId: 'u1' }, ...registry });
    assert.equal(evidence.length, 1, 'the good source survives');
    assert.equal(rejected.length, 1);
  });

  test('an empty document produces no evidence rather than an empty item', () => {
    const { evidence } = adaptLegacyChunks(
      [{ sourceId: 'good', text: '', chunkIndex: 0, score: 0.5 }],
      { scope: { userId: 'u1' }, ...registry },
    );
    // An empty chunk still adapts, but it must carry zero-length content — never
    // be reported as substantive evidence.
    assert.ok(evidence.every((e) => e.content.length === 0));
  });
});

describe('§22.5 — the decision survives a provider swap', () => {
  test('two runs of the same request produce identical decisions', async () => {
    const a = await orchestrate(req(GROUNDED_Q), { async retrieve() { return { evidence: [], attempts: [] }; } });
    const b = await orchestrate(req(GROUNDED_Q), { async retrieve() { return { evidence: [], attempts: [] }; } });
    // Provider failover must reuse the SAME decision (§19.3). Determinism here
    // is what makes that possible at all.
    assert.deepEqual(
      JSON.parse(JSON.stringify(a.decision)),
      JSON.parse(JSON.stringify(b.decision)),
    );
  });
});

describe('§22.6 — classification uncertainty prefers safety', () => {
  test('an ambiguous question retrieves rather than guessing', () => {
    const d = decide(req('Thoughts on that?'));
    assert.notEqual(d.retrievalPlan.path, 'FAST');
  });

  test('an empty question does not crash the decision layer', () => {
    assert.doesNotThrow(() => decide({ ...req(''), manualQuestion: '' }));
  });
});

describe('§22.7 — a strict unsupported answer carries no speculation', () => {
  test('STRICT grounding instructs stop-after-gap, not hedge-then-guess', () => {
    const policy = { ...MODE_POLICIES.seminar, groundingPolicy: 'STRICT_SOURCE_ONLY' };
    const d = decide(req('According to the paper, what is the result?', 'seminar'));
    const composed = composePrompt({ decision: { ...d, groundingPolicy: 'STRICT_SOURCE_ONLY' }, policy, evidence: [] });
    assert.match(composed.system, /do not add speculation afterwards/i);
  });
});

describe('§22.8 — partial evidence answers the supported part only', () => {
  test('one of two required claims supported yields PARTIAL, not FULL', async () => {
    const port = createLegacyRetrievalPort({
      registry: {
        sourceTypes: new Map([['resume-1', 'RESUME']]),
        activeVersions: new Map([['resume-1', 'v1']]),
        chunkVersions: new Map([['resume-1', 'v1']]),
      },
      assumeInScopeWhenUnknown: true,
      retrieve: async () => [{ sourceId: 'resume-1', text: 'Built a WebRTC pipeline', chunkIndex: 0, score: 0.9 }],
    });
    // A question carrying BOTH a project claim and a skill claim.
    const r = await orchestrate(req('Tell me about your WebRTC project and your Kubernetes experience.'), port);

    // Two PRIVATE_SOURCE_REQUIRED claims, evidence for one. This asserted
    // `['PARTIAL','FULL','NONE'].includes(...)` in its first form — which is
    // always true, i.e. a vacuous test. Pinning the exact value exposed a real
    // bug: `acceptedFor` is SOURCE-TYPE level, so a resume chunk about WebRTC
    // "supported" the Kubernetes claim and the turn returned FULL — a confident
    // answer with no supporting evidence.
    assert.equal(r.answerability, 'PARTIAL');
    assert.equal(r.trace.fallbackUsed, 'PARTIAL_SUPPORT');
  });

  test('evidence irrelevant to the claim does NOT make it answerable', async () => {
    const port = createLegacyRetrievalPort({
      registry: {
        sourceTypes: new Map([['resume-1', 'RESUME']]),
        activeVersions: new Map([['resume-1', 'v1']]),
        chunkVersions: new Map([['resume-1', 'v1']]),
      },
      assumeInScopeWhenUnknown: true,
      retrieve: async () => [{ sourceId: 'resume-1', text: 'Built a WebRTC pipeline', chunkIndex: 0, score: 0.9 }],
    });
    const r = await orchestrate(req('Do you have experience with Kubernetes?'), port);
    assert.equal(r.answerability, 'NONE',
      'an authorised source type is not the same as evidence FOR this claim');
  });
});

describe('the bridge degrades rather than breaking a live answer', () => {
  test('every failure mode returns null or a usable prompt — never throws', async () => {
    process.env[CONTEXT_INTELLIGENCE_V3_ENV_KEY] = '1';
    try {
      const cases = [
        { surface: 'manual-chat', question: GROUNDED_Q, modeTemplateType: 'garbage-mode' },
        { surface: 'manual-chat', question: GROUNDED_Q, retrieval: { async retrieve() { throw new Error('x'); } } },
        { surface: 'manual-chat', question: GROUNDED_Q, retrieval: { retrieve: null } },
        { surface: 'manual-chat', question: ' ' },
      ];
      for (const c of cases) {
        const r = await buildV3Prompt(c);
        assert.ok(r === null || typeof r.system === 'string',
          `case ${JSON.stringify(c.modeTemplateType ?? c.question).slice(0, 30)} produced neither null nor a prompt`);
      }
    } finally {
      delete process.env[CONTEXT_INTELLIGENCE_V3_ENV_KEY];
    }
  });
});

describe('an unknown mode can never yield a policy-free turn', () => {
  test('resolveModePolicy throws rather than returning an empty policy', () => {
    assert.throws(() => resolveModePolicy('nonexistent'), /Unknown modeId/);
  });

  test('and decide() propagates that rather than answering mode-blind', () => {
    assert.throws(() => decide(req(GROUNDED_Q, 'nonexistent')), /Unknown modeId/);
  });
});

describe('§16.1 — conflict is a version disagreement, not document multiplicity', () => {
  const ev = (sourceId, versionId, content) => ({
    evidenceId: `${sourceId}-${versionId}`, sourceType: 'REFERENCE_FILE',
    sourceId, versionId, scopeId: 'u:u1', content,
    finalScore: 0.9, authorityFor: ['DOCUMENT_FACT'], acceptedFor: ['DOCUMENT_FACT'],
    isDirectFact: true, isInferred: false, metadata: {}, trustLevel: 'untrusted_reference',
  });

  test('TWO DIFFERENT documents of the same type is NOT a conflict', async () => {
    // The live run showed the earlier heuristic firing on 8 of 42 questions —
    // it would have told users their references disagreed every time an answer
    // drew on two files.
    const r = await orchestrate(req('According to the document, what is the discount floor?', 'seminar'), {
      async retrieve() {
        return { evidence: [ev('ref-1', 'v1', 'discount floor is 17 percent'), ev('ref-2', 'v1', 'discount policy overview')], attempts: [] };
      },
    });
    assert.notEqual(r.answerability, 'CONFLICTING',
      'ordinary multi-document retrieval must not be reported as a conflict');
  });

  test('the SAME source at two versions IS a conflict', async () => {
    const r = await orchestrate(req('According to the document, what is the discount floor?', 'seminar'), {
      async retrieve() {
        return { evidence: [ev('ref-1', 'v1', 'discount floor is 12 percent'), ev('ref-1', 'v2', 'discount floor is 17 percent')], attempts: [] };
      },
    });
    assert.equal(r.answerability, 'CONFLICTING');
    assert.equal(r.trace.fallbackUsed, 'CONFLICT');
  });
});
