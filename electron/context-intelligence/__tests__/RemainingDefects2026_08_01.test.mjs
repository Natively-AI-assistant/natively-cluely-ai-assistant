// Deep-run 2 (2026-08-01, natively_debug(1).log — 151 verbose turns):
// regression suite for the remaining Context Intelligence defects.
//
// Every failing question below is taken verbatim from a failing
// context_turn_complete record; each previously produced an empty/FAST plan
// with answerability FULL and zero evidence, a wrong source role, a one-sided
// comparison, retired-over-current ranking, or an over-broad plan.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const load = (p) => import(pathToFileURL(path.join(base, p)).href);

const { classifyTurn } = await load('question/turn-classifier.js');
const { MODE_POLICIES } = await load('policies/mode-policy-registry.js');
const { CLAIM_AUTHORITY } = await load('policies/source-authority-policy.js');
const { decide, evaluateAnswerability, evidenceSupportsClaim, propertyQualifierTerms } = await load('orchestration/orchestrator.js');
const { createLegacyRetrievalPort } = await load('retrieval/legacy-retrieval-port.js');

const classify = (q, modeId, over = {}) =>
  classifyTurn({ resolvedQuestion: q, policy: MODE_POLICIES[modeId], isFollowUp: false, ...over });

const hasPrivate = (r) => r.claimTypes.some((c) => (CLAIM_AUTHORITY[c]?.authoritative ?? []).length > 0);

// ── Issue 1: no more unexplained empty plans ────────────────────────────────

describe('issue 1: every document-backed question from the failing set now plans sources', () => {
  const cases = [
    ['technical-interview', 'How long did the incident last?'],
    ['technical-interview', 'Explain the source-precedence decision.'],
    ['recruiting', 'What is the scorecard weight for distributed-systems reasoning?'],
    ['recruiting', 'Give one tailored distributed-systems interview question.'],
    ['sales', 'What is default retention?'],
    ['sales', 'Can I promise zero hallucinations?'],
    ['lecture', 'Compare low-level and high-level frequencies.'],
    ['lecture', 'How does a heartbeat failure get detected?'],
  ];
  for (const [mode, q] of cases) {
    test(`${mode}: "${q}" retrieves with a private claim`, () => {
      const r = classify(q, mode);
      assert.equal(r.shouldRetrieve, true, `${q} → path=${r.path} (${r.reason})`);
      assert.ok(r.requiredSourceTypes.length > 0, `planned empty: ${r.reason}`);
      assert.ok(hasPrivate(r), `no private claim: ${JSON.stringify(r.claimTypes)}`);
    });
  }

  test('team-meet with attachments: "Compare the target routing accuracy with the measured value" retrieves', () => {
    const r = classify('Compare the target routing accuracy with the measured value.', 'team-meet',
      { hasAttachedDocuments: true });
    assert.equal(r.shouldRetrieve, true, r.reason);
    assert.ok(r.requiredSourceTypes.includes('REFERENCE_FILE'), JSON.stringify(r.requiredSourceTypes));
  });

  test('NON-REGRESSION: concept/coding questions keep the FAST path', () => {
    for (const [mode, q] of [
      ['technical-interview', 'What is a mutex?'],
      ['team-meet', 'What is the goal of dependency injection?'],
      ['general', 'What is idempotency in an HTTP API?'],
      ['technical-interview', 'What is the difference between TCP and UDP?'],
    ]) {
      const r = classify(q, mode);
      assert.equal(r.path, 'FAST', `"${q}" in ${mode} → ${r.path} (${r.reason})`);
    }
  });

  test('assistant meta-question is never a profile claim', () => {
    const r = classify('Why did you refuse?', 'lecture');
    assert.ok(!r.claimTypes.includes('USER_MOTIVATION'), JSON.stringify(r.claimTypes));
  });
});

// ── Issue 2: source-role selection ──────────────────────────────────────────

describe('issue 2: factual-time and provenance semantics', () => {
  test('sales: "Are we SOC 2 certified?" claims the reference side too', () => {
    const r = classify('Are we SOC 2 certified?', 'sales');
    assert.ok(r.requiredSourceTypes.includes('REFERENCE_FILE'),
      `security question must reach the FAQ: ${JSON.stringify(r.requiredSourceTypes)} (${r.reason})`);
  });

  test('team-meet: "Who is the proposed owner of source leakage?" claims the risk register side', () => {
    const r = classify('Who is the proposed owner of source leakage?', 'team-meet');
    assert.ok(r.requiredSourceTypes.includes('REFERENCE_FILE'), JSON.stringify(r.requiredSourceTypes));
  });

  test('NON-REGRESSION: bare attribution stays transcript-only in team-meet', () => {
    const r = classify('Who owns the source-contract patch?', 'team-meet');
    assert.deepEqual(r.requiredSourceTypes, ['MEETING_TRANSCRIPT'], r.reason);
  });

  test('NON-REGRESSION: "What did we decide?" stays transcript-only', () => {
    const r = classify('What did we decide?', 'team-meet');
    assert.deepEqual(r.requiredSourceTypes, ['MEETING_TRANSCRIPT'], r.reason);
  });
});

// ── Issue 3: comparisons plan both sides ────────────────────────────────────

describe('issue 3: candidate/JD comparisons are two-sided', () => {
  for (const q of [
    'Does Leena meet every minimum qualification?',
    'Which preferred qualifications are missing?',
  ]) {
    test(`recruiting: "${q}" plans candidate AND JD`, () => {
      const r = classify(q, 'recruiting');
      assert.ok(r.requiredSourceTypes.includes('JOB_DESCRIPTION'), JSON.stringify(r.requiredSourceTypes));
      assert.ok(r.requiredSourceTypes.includes('CANDIDATE_FILE'),
        `candidate side missing: ${JSON.stringify(r.requiredSourceTypes)} (${r.reason})`);
    });
  }

  test('NON-REGRESSION: a plain presence check stays single-sided', () => {
    const r = classify('Has she used Kubernetes?', 'recruiting');
    assert.ok(!r.claimTypes.includes('JOB_REQUIRED_SKILL'), JSON.stringify(r.claimTypes));
  });
});

// ── Issue 4: status precedence in candidate selection ───────────────────────

describe('issue 4: current beats retired at selection time', () => {
  const mkPort = (chunks) => createLegacyRetrievalPort({
    registry: {
      sourceTypes: new Map([['cur', 'REFERENCE_FILE'], ['old', 'REFERENCE_FILE']]),
      activeVersions: new Map([['cur', 'v1'], ['old', 'v1']]),
      chunkVersions: new Map([['cur', 'v1'], ['old', 'v1']]),
      sourceScopes: new Map([['cur', { userId: 'u' }], ['old', { userId: 'u' }]]),
    },
    retrieve: async () => chunks,
  });

  const chunks = [
    { sourceId: 'old', fileName: 'legacy_pricing.md', text: 'Team plan costs $299 per month.', chunkIndex: 0, score: 0.95, metadata: { documentStatus: 'retired' } },
    { sourceId: 'cur', fileName: 'current_pricing.md', text: 'Team plan costs $499 per month.', chunkIndex: 0, score: 0.7, metadata: { documentStatus: 'current' } },
  ];

  const decisionFor = (q) => decide({
    requestId: 'p', requestSequence: 1, surface: 'manual_chat', modeId: 'sales',
    scope: { userId: 'u', modeId: 'sales' }, sessionId: 's', manualQuestion: q,
  });

  test('a higher-scoring retired chunk cannot outrank the current one', async () => {
    const d = decisionFor('What is the current Team price?');
    const { evidence } = await mkPort(chunks).retrieve({ decision: d });
    assert.ok(evidence.length >= 2);
    assert.equal(evidence[0].sourceId, 'cur',
      `retired outranked current: ${evidence.map((e) => e.sourceId).join(',')}`);
  });

  test('explicitly historical questions may lead with the retired source', async () => {
    const d = decisionFor('What was the retired legacy Team price?');
    const { evidence } = await mkPort(chunks).retrieve({ decision: d });
    assert.equal(evidence[0].sourceId, 'old', evidence.map((e) => e.sourceId).join(','));
  });
});

// ── Issue 5: narrow plans + per-type diversity ──────────────────────────────

describe('issue 5: retrieval narrowing', () => {
  test('a pure value lookup in technical-interview excludes résumé/JD pools', () => {
    const r = classify('What is the worker batch size?', 'technical-interview');
    assert.ok(!r.requiredSourceTypes.includes('RESUME'), JSON.stringify(r.requiredSourceTypes));
    assert.ok(!r.requiredSourceTypes.includes('JOB_DESCRIPTION'), JSON.stringify(r.requiredSourceTypes));
    assert.ok(r.requiredSourceTypes.includes('PROJECT_FILE'), JSON.stringify(r.requiredSourceTypes));
  });

  test('a coding task with a named language never fans out to identity pools', () => {
    const d = decide({
      requestId: 'p', requestSequence: 1, surface: 'manual_chat', modeId: 'technical-interview',
      scope: { userId: 'u', modeId: 'technical-interview' }, sessionId: 's',
      manualQuestion: 'Reverse a singly linked list in place in Python.',
    });
    assert.ok(!d.retrievalPlan.sourceTypes.includes('RESUME'), JSON.stringify(d.retrievalPlan.sourceTypes));
    assert.ok(!d.retrievalPlan.sourceTypes.includes('JOB_DESCRIPTION'), JSON.stringify(d.retrievalPlan.sourceTypes));
  });

  test('NON-REGRESSION: entity questions still reach the résumé pool', () => {
    const r = classify('How many registered users does SignalNest have?', 'looking-for-work');
    assert.ok(r.requiredSourceTypes.includes('RESUME'), JSON.stringify(r.requiredSourceTypes));
  });

  test('per-type diversity: a flooded type cannot consume every accepted slot', async () => {
    const registry = {
      sourceTypes: new Map([['res', 'RESUME'], ['proj', 'PROJECT_FILE']]),
      activeVersions: new Map([['res', 'v1'], ['proj', 'v1']]),
      chunkVersions: new Map([['res', 'v1'], ['proj', 'v1']]),
      sourceScopes: new Map([['res', { userId: 'u' }], ['proj', { userId: 'u' }]]),
    };
    const chunks = [
      ...Array.from({ length: 8 }, (_, i) => ({ sourceId: 'res', text: `resume experience chunk about projects ${i}`, chunkIndex: i, score: 0.9 - i * 0.01 })),
      { sourceId: 'proj', text: 'QueueForge project summary: WORKER_BATCH_SIZE 64', chunkIndex: 0, score: 0.4 },
    ];
    const port = createLegacyRetrievalPort({ registry, retrieve: async () => chunks });
    const d = decide({
      requestId: 'p', requestSequence: 1, surface: 'manual_chat', modeId: 'technical-interview',
      scope: { userId: 'u', modeId: 'technical-interview' }, sessionId: 's',
      manualQuestion: 'Walk me through QueueForge.',
    });
    const { evidence } = await port.retrieve({ decision: d });
    assert.ok(evidence.some((e) => e.sourceType === 'PROJECT_FILE'),
      `project evidence starved: ${evidence.map((e) => e.sourceType).join(',')}`);
  });
});

// ── Issue 6: impossible answerability states ────────────────────────────────

describe('issue 6: answerability invariants', () => {
  test('zero claims + grounded + zero evidence is never FULL', () => {
    const d = {
      questionTypes: ['AMBIGUOUS'], claimRequirements: [],
      isFollowUp: false, resolvedQuestion: 'End meeting.',
      retrievalPlan: { path: 'GROUNDED', shouldRetrieve: true, sourceTypes: ['REFERENCE_FILE'] },
    };
    assert.notEqual(evaluateAnswerability(d, []), 'FULL');
  });

  test('FAST general questions keep FULL', () => {
    const d = {
      questionTypes: ['GENERAL_TECHNICAL'], claimRequirements: [],
      isFollowUp: false, resolvedQuestion: 'What is a mutex?',
      retrievalPlan: { path: 'FAST', shouldRetrieve: false, sourceTypes: [] },
    };
    assert.equal(evaluateAnswerability(d, []), 'FULL');
  });

  test('document-specific miss carries the honest fallback label', () => {
    // classification-level: the label chain is exercised end-to-end in
    // Orchestrator.test.mjs ("SOURCE_FIRST falls back…" now expects
    // DOCUMENT_FACT_NOT_FOUND); here we pin the classifier precondition.
    const r = classify('Tell me about your Rust experience.', 'technical-interview');
    assert.ok(hasPrivate(r));
  });
});

// ── Issue 7: qualified properties ───────────────────────────────────────────

describe('issue 7: qualified value heads', () => {
  test('the CSV canary does not match the security canary', () => {
    const q = 'What is the CSV canary?';
    assert.equal(evidenceSupportsClaim(
      { acceptedFor: ['DOCUMENT_FACT'], content: 'Security canary: SALES-SEC-CANARY-777' }, 'DOCUMENT_FACT', q,
    ), false, 'a bare head match must not satisfy a qualified value');
    assert.equal(evidenceSupportsClaim(
      { acceptedFor: ['DOCUMENT_FACT'], content: 'CSV canary: SALES-CSV-CANARY-455' }, 'DOCUMENT_FACT', q,
    ), true);
  });

  test('source identity satisfies the qualifier when the text cannot', () => {
    assert.equal(evidenceSupportsClaim(
      {
        acceptedFor: ['DOCUMENT_FACT'], content: 'canary: SALES-CSV-CANARY-455',
        documentTitle: '05_competitor_matrix.csv',
      }, 'DOCUMENT_FACT', 'What is the CSV canary?',
    ), true);
  });

  test('propertyQualifierTerms extracts distinguishing modifiers only', () => {
    assert.deepEqual(propertyQualifierTerms('What is the CSV canary?'), ['csv']);
    assert.deepEqual(propertyQualifierTerms('What is the current Team price?'), ['team']);
    assert.deepEqual(propertyQualifierTerms('What is the salary?'), []);
  });

  test('NON-REGRESSION: descriptive heads keep head-only matching', () => {
    assert.equal(evidenceSupportsClaim(
      { acceptedFor: ['DOCUMENT_FACT'], content: 'Frameworks: React, FastAPI' },
      'DOCUMENT_FACT', 'What backend framework is explicitly documented?',
    ), true);
  });
});

// ── Issue 9: lecture filename-role routing ──────────────────────────────────

describe('issue 9: glossary and formula routing', () => {
  const names = ['01_small_handout.md', '02_large_course_reader.pdf', '03_glossary.txt', '04_formula_sheet.md'];

  test('"Define communication shadow." grounds when a glossary is attached', () => {
    const r = classify('Define communication shadow.', 'lecture', { attachedFileNames: names });
    assert.equal(r.shouldRetrieve, true, r.reason);
    assert.ok(r.claimTypes.includes('DOCUMENT_FACT'), JSON.stringify(r.claimTypes));
  });

  test('threshold/frequency questions ground when a formula sheet is attached', () => {
    const r = classify('How does a heartbeat failure get detected?', 'lecture', { attachedFileNames: names });
    assert.equal(r.shouldRetrieve, true, r.reason);
  });

  test('without such files, definitions keep their general route', () => {
    const r = classify('Define communication shadow.', 'team-meet');
    assert.equal(r.path, 'FAST', r.reason);
  });
});
