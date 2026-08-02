// Context Intelligence V3 — orchestrator.
//
// End-to-end through the decision layer with an injected retrieval port.
// These are the invariants the mission exists to establish.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { decide, orchestrate, evaluateAnswerability, propertyHeadTerms } =
  await import(pathToFileURL(path.join(base, 'orchestration/orchestrator.js')).href);
const { adaptLegacyChunks } = await import(pathToFileURL(path.join(base, 'retrieval/legacy-adapter.js')).href);
const { clearConversationState } = await import(pathToFileURL(path.join(base, 'question/conversation-state-store.js')).href);

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
  // Declared, not omitted: the adapter fails closed on an unknown chunk version.
  chunkVersions: new Map([['resume-1', 'v2'], ['jd-1', 'v1']]),
  assumeInScopeWhenUnknown: true,
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
    // 2026-07-31: the presence check now plans BOTH sides as a comparison, and
    // the JD side IS supported ("Postgres required" answers "what does the job
    // want"). PARTIAL — with the user side disclosed as unsupported — is the
    // honest verdict; NONE previously routed this to GENERAL_KNOWLEDGE. The
    // contamination invariant is the claim plan: the USER_SKILL claim must
    // never gain direct evidence from a JD.
    assert.equal(r.answerability, 'PARTIAL',
      'the JD supports only the job side; the user side stays unsupported');
    assert.equal(r.trace.fallbackUsed, 'PARTIAL_SUPPORT');
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
    // Renamed label (deep-run 2, issue 14): the general-knowledge fallback for
    // a DOCUMENT-SPECIFIC miss is DOCUMENT_FACT_NOT_FOUND — same behaviour,
    // honest telemetry.
    assert.equal(r.trace.fallbackUsed, 'DOCUMENT_FACT_NOT_FOUND');
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

// ── Regressions from the 2026-07-30 golden-live measurement ──────────────────
//
// Both were found only after `answerabilityMatchesExpected` started being
// asserted. It had been recorded by three harnesses and checked by none.

describe('answerability is judged per SUBJECT, not per claim requirement', () => {
  const claim = (claimType, subject) => ({
    claimId: `c-${claimType}`, claimType, subject,
    authority: 'PRIVATE_SOURCE_REQUIRED', description: claimType,
  });
  const decision = (claimRequirements) => ({
    resolvedQuestion: 'who owns the events table migration?',
    claimRequirements,
    retrievalPlan: { shouldRetrieve: true, path: 'GROUNDED', queries: [], sourceTypes: [] },
  });
  const ev = (over = {}) => ({
    sourceId: 's1', versionId: 'v1', retrievedVersionId: 'v1',
    acceptedFor: ['MEETING_STATEMENT'],
    content: 'Meera owns the events table migration rollout plan.',
    ...over,
  });

  // One clause, several claim types because the MODE authorizes several source
  // types that could answer it. Requiring ALL of them made PARTIAL unavoidable
  // for the whole class: measured on H-02 and H-04, where a fully-answered
  // question reported PARTIAL because no reference document existed to satisfy
  // the DOCUMENT_FACT alternative.
  test('alternative routes to ONE clause do not force PARTIAL', () => {
    const subject = 'who owns the events table migration?';
    const d = decision([claim('MEETING_STATEMENT', subject), claim('DOCUMENT_FACT', subject)]);
    assert.equal(evaluateAnswerability(d, [ev()]), 'FULL',
      'a transcript answering the clause is enough; DOCUMENT_FACT is an alternative, not an additional requirement');
  });

  // The strictness that matters is preserved: genuinely multi-part questions.
  test('two DISTINCT clauses still require both', () => {
    const d = decision([
      claim('USER_PROJECT', 'tell me about your pricex project'),
      claim('GENERAL_TECHNICAL', 'explain how webrtc establishes a connection'),
    ]);
    const supported = ev({ acceptedFor: ['USER_PROJECT'], content: 'Built PriceX, a price-comparison website.' });
    assert.equal(evaluateAnswerability(d, [supported]), 'PARTIAL',
      'one clause supported out of two must stay PARTIAL — this is the §22.8 case');
  });

  test('no clause supported is still NONE', () => {
    const subject = 'who owns the events table migration?';
    const d = decision([claim('MEETING_STATEMENT', subject)]);
    const unrelated = ev({ content: 'We ship the async fraud-scoring change in September.' });
    assert.equal(evaluateAnswerability(d, [unrelated]), 'NONE');
  });
});

describe('term matching folds inflections', () => {
  const d = {
    resolvedQuestion: 'what year did the candidate graduate?',
    claimRequirements: [{
      claimId: 'c1', claimType: 'USER_EDUCATION', authority: 'PRIVATE_SOURCE_REQUIRED',
      subject: 'what year did the candidate graduate?', description: 'education',
    }],
    retrievalPlan: { shouldRetrieve: true, path: 'GROUNDED', queries: [], sourceTypes: [] },
  };

  // G-01. The correct chunk was retrieved and the superseded revision had
  // already been rejected; exact token comparison then treated "graduate" and
  // "graduated" as unrelated terms and reported the turn unanswerable.
  test('"graduate" matches "Graduated" — the G-01 failure', () => {
    const evidence = [{
      sourceId: 's1', versionId: '2026', retrievedVersionId: '2026',
      acceptedFor: ['USER_EDUCATION'],
      content: '## Education **B.Tech, Computer Science — NIT Surathkal** Graduated **2017**. CGPA 8.7/10.',
    }];
    assert.equal(evaluateAnswerability(d, evidence), 'FULL');
  });

  // Stemming must not become a licence to match anything.
  test('an unrelated section still fails — stemming is not a wildcard', () => {
    const evidence = [{
      sourceId: 's1', versionId: '2026', retrievedVersionId: '2026',
      acceptedFor: ['USER_EDUCATION'],
      content: 'Built the webhook delivery service in Go with exponential backoff.',
    }];
    assert.equal(evaluateAnswerability(d, evidence), 'NONE');
  });
});

// ── E-01/E-02: an unresolved referent cannot be answered confidently ──────────

describe('a bare follow-up with no antecedent is not FULL', () => {
  const port = (chunks = []) => portFrom(chunks, ADAPT);

  test('"Why?" with no conversation state is NONE and asks for clarification', async () => {
    // Six unrelated evidence items used to carry this to FULL: the subject had
    // no salient terms, so everything "supported" it, and the model was licensed
    // to answer a context-free "Why?" confidently.
    clearConversationState('s1');
    const r = await orchestrate(req({ manualQuestion: 'Why?' }), port(
      [{ sourceId: 'resume-1', text: 'Built a WebRTC pipeline', chunkIndex: 0, score: 0.9 }],
    ));
    assert.equal(r.answerability, 'NONE');
    assert.equal(r.trace.fallbackUsed, 'CLARIFICATION',
      'an unresolved referent is a clarification case, not a knowledge gap — general knowledge cannot answer "Why?" either');
  });

  test('"Would that scale?" is PARTIAL — the scaling judgement is general knowledge', async () => {
    // Conversation state is REAL now (process-global store, advanced by every
    // orchestrate call in this file). This test models a turn with no
    // antecedent, so it must start from a clean session.
    clearConversationState('s1');
    const r = await orchestrate(req({ manualQuestion: 'Would that scale?' }), port());
    assert.equal(r.answerability, 'PARTIAL');
    assert.equal(r.trace.fallbackUsed, 'PARTIAL_SUPPORT');
  });

  test('a bare follow-up WITH conversation state resolves and answers (the zero-caller gap)', async () => {
    // conversation-state.ts shipped with zero production callers; "Why not?"
    // and "Can you explain it generally instead?" failed live in four modes.
    // With the store wired into orchestrate, the prior turn's topic becomes
    // the referent and the bare-follow-up CLARIFICATION cap self-disables.
    clearConversationState('s1');
    await orchestrate(req({ manualQuestion: 'Tell me about the Kubernetes migration' }), port(
      [{ sourceId: 'resume-1', text: 'Led the Kubernetes migration for the pipeline', chunkIndex: 0, score: 0.9 }],
    ));
    const r = await orchestrate(req({ manualQuestion: 'Would that scale?' }), port(
      [{ sourceId: 'resume-1', text: 'Led the Kubernetes migration for the pipeline', chunkIndex: 0, score: 0.9 }],
    ));
    assert.ok(r.decision.resolvedQuestion.includes('referring to'),
      `expected a resolved referent, got: ${r.decision.resolvedQuestion}`);
    assert.notEqual(r.trace.fallbackUsed, 'CLARIFICATION',
      'with a resolvable referent the clarification cap must self-disable');
    clearConversationState('s1');
  });

  test('the cap self-disables once resolution produces a real question', async () => {
    // A resolver that expands the follow-up against conversation state yields a
    // non-bare resolvedQuestion, and the cap must not fire. isFollowUp stays
    // true — it is the BARENESS that signals failure, not follow-up-ness.
    const r = await orchestrate(req({
      manualQuestion: 'Why did you choose WebRTC for the pipeline project?', isFollowUp: true,
    }), port([{ sourceId: 'resume-1', text: 'Built a WebRTC pipeline', chunkIndex: 0, score: 0.9 }]));
    assert.notEqual(r.answerability, 'NONE');
    assert.notEqual(r.trace.fallbackUsed, 'CLARIFICATION');
  });
});

// ── Live-log regression (2026-08-02): self-presentation grading + remedy ─────
//
// "Can you tell me about yourself?" in looking-for-work retrieved and USED the
// résumé (evidence admitted, answer grounded in the user's real background) —
// yet graded answerability NONE / DOCUMENT_FACT_NOT_FOUND, because
// propertyHeadTerms took the reflexive tail "yourself" as the requested
// property and demanded the résumé literally contain that word. A reflexive
// denotes the PERSON; a whole-person request has no property head.

describe('self-presentation questions grade on claim authority, not a pronoun term-match', () => {
  const introDecision = () => decide(req({
    modeId: 'looking-for-work',
    manualQuestion: 'Can you tell me about yourself?',
  }));
  const resumeEv = (over = {}) => ({
    evidenceId: 'e1', sourceId: 'psrc_x', sourceType: 'RESUME',
    versionId: 'v1', retrievedVersionId: 'v1',
    acceptedFor: ['USER_EMPLOYMENT'],
    content: 'Rohan Varma. Backend engineer. Built APIs at Acme, led GraphQL schema design. Kochi, India.',
    scope: { userId: 'u1' }, metadata: {},
    ...over,
  });

  test('résumé evidence FULLY supports the intro turn', () => {
    assert.equal(evaluateAnswerability(introDecision(), [resumeEv()]), 'FULL');
  });

  test('no evidence still grades NONE — honesty preserved', () => {
    assert.equal(evaluateAnswerability(introDecision(), []), 'NONE');
  });

  test('propertyHeadTerms: reflexive tail = whole-person request = no heads', () => {
    for (const q of ['can you tell me about yourself', 'introduce yourself', 'describe yourself']) {
      assert.deepEqual(propertyHeadTerms(q), [], q);
    }
  });

  test('property lookups keep their heads (control)', () => {
    assert.ok(propertyHeadTerms('what are the RTO and RPO in the dossier').length >= 2);
  });
});
