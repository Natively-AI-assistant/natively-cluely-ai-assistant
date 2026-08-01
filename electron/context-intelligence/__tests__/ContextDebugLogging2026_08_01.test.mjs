// Context Intelligence Debug Logging (2026-08-01) — unit + integration tests.
//
// Covers: level parsing/precedence, production content rejection, redaction,
// preview truncation, JSONL writer validity/rotation/retention/failure
// isolation, collector correlation + concurrent isolation + missing-stage
// finalization, standard-vs-verbose privacy, precedence serialization,
// rejected-evidence serialization, schema stability, follow-up-resolution
// visibility, ingest events, and the bridge integration (deferred completion).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const load = (p) => import(pathToFileURL(path.join(base, p)).href);

const {
  parseDebugLevel, resolveDebugLevel, resolveContentInclusion,
  bindContextDebugConfig, getContextDebugLevel,
} = await load('debug/debug-config.js');
const { redactSecrets, redactPii, buildPreview, deepRedactStrings, PREVIEW_MAX_CHARS } = await load('debug/redaction.js');
const { ContextDebugJsonlWriter, bindContextDebugLogDirectory, getContextDebugWriter, flushContextDebugWriter } = await load('debug/jsonl-writer.js');
const { beginTurnCollector, getTurnCollector } = await load('debug/turn-collector.js');
const { emitModeFileIngestDebug } = await load('debug/ingest-debug.js');
const { buildV3Prompt } = await load('orchestration/engine-bridge.js');
const { CONTEXT_DEBUG_SCHEMA_VERSION } = await load('debug/debug-types.js');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-debug-test-'));
after(() => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* noop */ } });

const readJsonl = (dir) => {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
  const lines = [];
  for (const f of files) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (line.trim()) lines.push(JSON.parse(line));   // throws on invalid JSON = test failure
    }
  }
  return lines;
};

const identity = (over = {}) => ({
  sessionId: 's1', turnId: 'turn_t1', requestId: `req_${Math.random().toString(36).slice(2)}`,
  conversationGeneration: 1, modeId: 'technical-interview', surface: 'manual_chat', ...over,
});

const sinkTo = (records, prints = []) => ({
  write: (r) => records.push(r),
  print: (t) => prints.push(t),
});

// ── 1-2. Level parsing + precedence + production rejection ──────────────────

describe('debug level resolution', () => {
  test('parseDebugLevel accepts the documented spellings', () => {
    assert.equal(parseDebugLevel('off'), 'off');
    assert.equal(parseDebugLevel('Standard'), 'standard');
    assert.equal(parseDebugLevel('VERBOSE'), 'verbose');
    assert.equal(parseDebugLevel('1'), 'standard');
    assert.equal(parseDebugLevel('garbage'), null);
    assert.equal(parseDebugLevel(undefined), null);
  });

  test('environment variable overrides the stored setting, both directions', () => {
    assert.equal(resolveDebugLevel({ envValue: 'verbose', storedValue: 'off' }), 'verbose');
    assert.equal(resolveDebugLevel({ envValue: 'off', storedValue: 'verbose' }), 'off');
    assert.equal(resolveDebugLevel({ envValue: undefined, storedValue: 'standard' }), 'standard');
    assert.equal(resolveDebugLevel({}), 'off');
    // an unparseable env value falls through to the setting, not to off
    assert.equal(resolveDebugLevel({ envValue: 'bogus', storedValue: 'standard' }), 'standard');
  });

  test('production builds REJECT full-content mode regardless of flags', () => {
    assert.equal(resolveContentInclusion({ envValue: '1', level: 'verbose', isProductionBuild: true }), false);
    assert.equal(resolveContentInclusion({ envValue: '1', level: 'verbose', isProductionBuild: false }), true);
    assert.equal(resolveContentInclusion({ envValue: '1', level: 'standard', isProductionBuild: false }), false);
    assert.equal(resolveContentInclusion({ envValue: '0', level: 'verbose', isProductionBuild: false }), false);
    assert.equal(resolveContentInclusion({ envValue: undefined, level: 'verbose', isProductionBuild: false }), false);
  });

  test('live binding: packaged build ignores the content env flag entirely', async () => {
    const { getContentInclusionEnabled } = await load('debug/debug-config.js');
    bindContextDebugConfig({ readStoredLevel: () => 'verbose', isProductionBuild: true });
    const prev = process.env.NATIVELY_CONTEXT_DEBUG_INCLUDE_CONTENT;
    process.env.NATIVELY_CONTEXT_DEBUG_INCLUDE_CONTENT = '1';
    try {
      assert.equal(getContentInclusionEnabled('verbose'), false);
      bindContextDebugConfig({ readStoredLevel: () => 'verbose', isProductionBuild: false });
      assert.equal(getContentInclusionEnabled('verbose'), true);
    } finally {
      if (prev === undefined) delete process.env.NATIVELY_CONTEXT_DEBUG_INCLUDE_CONTENT;
      else process.env.NATIVELY_CONTEXT_DEBUG_INCLUDE_CONTENT = prev;
      bindContextDebugConfig({ readStoredLevel: () => 'off', isProductionBuild: true });
    }
  });

  test('a stored-reader throw degrades to the env/default, never breaks', () => {
    bindContextDebugConfig({ readStoredLevel: () => { throw new Error('boom'); }, isProductionBuild: true });
    assert.equal(getContextDebugLevel(), 'off');
    bindContextDebugConfig({ readStoredLevel: () => 'standard', isProductionBuild: true });
    assert.equal(getContextDebugLevel(), 'standard');
  });
});

// ── 3-5. Redaction ──────────────────────────────────────────────────────────

describe('redaction', () => {
  test('secrets are scrubbed at every tier', () => {
    const dirty = [
      'api_key: sk-abcdef1234567890abcdef', 'Authorization: Bearer abc.def.ghi12345',
      'AKIAIOSFODNN7EXAMPLE', 'password=SuperSecret9', 'postgres://admin:hunter2@db.internal/x',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----',
    ].join('\n');
    const clean = redactSecrets(dirty);
    for (const leak of ['sk-abcdef1234567890abcdef', 'hunter2', 'SuperSecret9', 'MIIE', 'abc.def.ghi12345']) {
      assert.ok(!clean.includes(leak), `leaked: ${leak}`);
    }
  });

  test('PII is scrubbed for standard/verbose', () => {
    const clean = redactPii('Contact kshtjb3@gmail.com or +919876543210 at 12 Baker Street, London');
    assert.ok(!clean.includes('kshtjb3@gmail.com'));
    assert.ok(!clean.includes('+919876543210'));
    assert.ok(!/Baker Street/.test(clean));
  });

  test('previews are truncated at the cap and marked', () => {
    const p = buildPreview('x'.repeat(1000));
    assert.ok(p.text.length <= PREVIEW_MAX_CHARS + 20);
    assert.match(p.text, /\[truncated\]$/);
    assert.equal(p.truncated, true);
  });

  test('deepRedactStrings scrubs nested fields', () => {
    const out = deepRedactStrings({ a: { b: ['token=abcd1234efgh'] }, keep: 42 });
    assert.ok(!JSON.stringify(out).includes('abcd1234efgh'));
    assert.equal(out.keep, 42);
  });
});

// ── 11-13. JSONL writer ─────────────────────────────────────────────────────

describe('JSONL writer', () => {
  test('every line is standalone valid JSON; file usable without shutdown', async () => {
    const dir = path.join(tmpRoot, 'w1');
    const w = new ContextDebugJsonlWriter({ directory: dir });
    w.append({ a: 1 });
    w.append({ b: 'two' });
    await w.flush();
    const lines = readJsonl(dir);
    assert.equal(lines.length, 2);
    assert.equal(lines[1].b, 'two');
  });

  test('rotates by size', async () => {
    const dir = path.join(tmpRoot, 'w2');
    const w = new ContextDebugJsonlWriter({ directory: dir, maxFileBytes: 200 });
    for (let i = 0; i < 10; i++) w.append({ i, pad: 'x'.repeat(50) });
    await w.flush();
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    assert.ok(files.length > 1, `expected rotation, got ${files.length} file(s)`);
    assert.equal(readJsonl(dir).length, 10);
  });

  test('retention keeps the newest N files', async () => {
    const dir = path.join(tmpRoot, 'w3');
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(dir, `context-debug-2020010${i}T000000Z.jsonl`), '{}\n');
    const w = new ContextDebugJsonlWriter({ directory: dir, retainFiles: 3 });
    w.append({ fresh: true });
    await w.flush();
    // allow the fire-and-forget cleanup to finish
    await new Promise((r) => setTimeout(r, 50));
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    assert.ok(files.length <= 4, `retention did not prune: ${files.length}`);
  });

  test('write failure never throws to the caller', async () => {
    // A FILE where the directory should be → mkdir fails on every write.
    const clash = path.join(tmpRoot, 'not-a-dir');
    fs.writeFileSync(clash, 'occupied');
    const w = new ContextDebugJsonlWriter({ directory: path.join(clash, 'sub') });
    assert.doesNotThrow(() => w.append({ a: 1 }));
    await w.flush();
    assert.ok(w.writeFailures >= 1);
  });

  test('queue bound drops instead of growing unbounded', async () => {
    const dir = path.join(tmpRoot, 'w4');
    const w = new ContextDebugJsonlWriter({ directory: dir, maxPendingWrites: 2 });
    for (let i = 0; i < 50; i++) w.append({ i });
    await w.flush();
    assert.ok(w.droppedRecords > 0);
  });
});

// ── 6-10, 14-16, 19. Collector ──────────────────────────────────────────────

const traceStub = (over = {}) => ({
  requestId: 'r', requestSequence: 1, scope: { userId: 'u' }, surface: 'manual_chat',
  originalQuestion: 'What is the worker batch size?',
  resolvedQuestion: 'What is the worker batch size?',
  resolutionConfidence: 1, modeId: 'technical-interview', modePolicyVersion: '1.1.0',
  questionTypes: ['DOCUMENT_FACT'], groundingPolicy: 'SOURCE_FIRST',
  authorizedSources: [], prohibitedSources: [], plannedSourceTypes: ['PROJECT_FILE', 'CODING_SAMPLE'],
  retrievalPath: 'GROUNDED',
  retrievalAttempts: [{
    attempt: 1, strategy: 'legacy_mode_hybrid', queries: ['What is the worker batch size?'],
    candidateCount: 17, admittedAfterScopeFilter: 12, rejectedByScopeFilter: 5,
    rejections: [{ sourceId: 'f-old', reason: 'PLANNED_TYPE_FILTER' }], durationMs: 12,
  }],
  acceptedEvidence: [], rejectedEvidence: [],
  answerability: 'FULL',
  claimPlan: [{ claimId: 'c0', claimType: 'DOCUMENT_FACT', support: 'DIRECT_EVIDENCE', evidenceIds: ['ev1'], disclosure: 'NONE', action: 'INCLUDE' }],
  fallbackUsed: 'NONE', promptTokenEstimate: 900,
  latency: {}, providerAttempts: [], status: 'COMPLETED', errorCodes: [], engine: 'v3',
  ...over,
});

const decisionStub = () => ({
  rawQuestion: 'What is the worker batch size?', resolvedQuestion: 'What is the worker batch size?',
  isFollowUp: false, questionTypes: ['DOCUMENT_FACT'],
  claimRequirements: [{ claimType: 'DOCUMENT_FACT', authority: 'PRIVATE_SOURCE_REQUIRED', authoritativeSources: ['PROJECT_FILE'], prohibitedSources: [], fallback: 'GENERALIZE' }],
  retrievalPlan: { path: 'GROUNDED', shouldRetrieve: true, sourceTypes: ['PROJECT_FILE', 'CODING_SAMPLE'], queries: [], maximumAcceptedEvidence: 6 },
  groundingPolicy: 'SOURCE_FIRST',
});

const evidenceStub = (over = {}) => ({
  evidenceId: 'ev1', sourceType: 'CODING_SAMPLE', sourceId: 'f-config', versionId: 'legacy',
  scopeId: 'u:u', documentTitle: 'queueforge_config.py', chunkIndex: 0,
  content: 'CACHE_TTL_SECONDS = 420\nWORKER_BATCH_SIZE = 64  # contact admin@queueforge.dev',
  keywordScore: 0.9, semanticScore: 0.7, finalScore: 0.95,
  authorityFor: ['DOCUMENT_FACT'], acceptedFor: ['DOCUMENT_FACT'],
  isDirectFact: true, isInferred: false, trustLevel: 'untrusted_reference', metadata: {},
  ...over,
});

describe('turn collector', () => {
  test('correlation: identity + schema version stable in the emitted record', () => {
    const records = [];
    const id = identity();
    const c = beginTurnCollector(id, { level: 'standard', includeContent: false, ...sinkTo(records) });
    c.recordDecisionTrace({ trace: traceStub(), decision: decisionStub() });
    c.recordAnswer('The current worker batch size is 64 jobs.', true, null);
    c.complete();
    assert.equal(records.length, 1);
    const r = records[0];
    assert.equal(r.schemaVersion, CONTEXT_DEBUG_SCHEMA_VERSION);
    assert.equal(r.event, 'context_turn_complete');
    assert.equal(r.identity.requestId, id.requestId);
    assert.equal(r.question.original, 'What is the worker batch size?');
    assert.equal(r.answer.final, 'The current worker batch size is 64 jobs.');
    assert.equal(r.sourcePlan.plannedRoles.includes('PROJECT_FILE'), true);
    assert.equal(r.evidenceCoverage.answerability, 'FULL');
    assert.equal(r.generation.streamCommitted, true);
  });

  test('concurrent turns stay isolated — no cross-contamination', () => {
    const recA = []; const recB = [];
    const a = beginTurnCollector(identity({ requestId: 'req_A', modeId: 'technical-interview' }),
      { level: 'standard', includeContent: false, ...sinkTo(recA) });
    const b = beginTurnCollector(identity({ requestId: 'req_B', modeId: 'recruiting' }),
      { level: 'standard', includeContent: false, ...sinkTo(recB) });
    // interleave
    a.recordDecisionTrace({ trace: traceStub({ originalQuestion: 'QA' }), decision: decisionStub() });
    b.recordDecisionTrace({ trace: traceStub({ originalQuestion: 'QB' }), decision: decisionStub() });
    assert.equal(getTurnCollector('req_A'), a);
    assert.equal(getTurnCollector('req_B'), b);
    b.recordAnswer('answer B', true, null);
    a.recordAnswer('answer A', true, null);
    b.complete(); a.complete();
    assert.equal(recA[0].question.original, 'QA');
    assert.equal(recA[0].answer.final, 'answer A');
    assert.equal(recB[0].question.original, 'QB');
    assert.equal(recB[0].answer.final, 'answer B');
    assert.equal(recA[0].identity.modeId, 'technical-interview');
    assert.equal(recB[0].identity.modeId, 'recruiting');
  });

  test('missing stages still finalize (retrieval/model failure tolerated)', () => {
    const records = [];
    const c = beginTurnCollector(identity(), { level: 'standard', includeContent: false, ...sinkTo(records) });
    c.recordError({ stage: 'retrieval', message: 'provider down', recoverable: true });
    c.complete();
    assert.equal(records.length, 1);
    assert.equal(records[0].errors[0].stage, 'retrieval');
    assert.equal(records[0].answer.final, '');
  });

  test('complete() is idempotent — one record, ever', () => {
    const records = [];
    const c = beginTurnCollector(identity(), { level: 'standard', includeContent: false, ...sinkTo(records) });
    c.complete(); c.complete(); c.complete();
    assert.equal(records.length, 1);
  });

  test('STANDARD excludes chunk text and previews but keeps question+answer', () => {
    const records = [];
    const c = beginTurnCollector(identity(), { level: 'standard', includeContent: false, ...sinkTo(records) });
    c.recordDecisionTrace({ trace: traceStub(), decision: decisionStub() });
    c.recordEvidenceItems([evidenceStub()]);
    c.recordAnswer('64 jobs.', true, null);
    c.complete();
    const s = JSON.stringify(records[0]);
    assert.ok(!s.includes('CACHE_TTL_SECONDS'), 'standard leaked chunk text');
    assert.ok(!records[0].retrieval.selectedEvidence[0].preview);
    assert.ok(!records[0].retrieval.rejectedEvidence, 'standard must omit rejected evidence detail');
    assert.equal(records[0].answer.final, '64 jobs.');
    assert.equal(records[0].retrieval.selectedEvidence[0].sourceId, 'f-config');
    assert.equal(records[0].retrieval.selectedEvidence[0].lexicalScore, 0.9);
  });

  test('VERBOSE includes redacted previews + rejected evidence + query strings', () => {
    const records = [];
    const c = beginTurnCollector(identity(), { level: 'verbose', includeContent: false, ...sinkTo(records) });
    c.recordDecisionTrace({ trace: traceStub(), decision: decisionStub() });
    c.recordEvidenceItems([evidenceStub()]);
    c.recordAnswer('64 jobs.', true, null);
    c.complete();
    const r = records[0];
    const ev = r.retrieval.selectedEvidence[0];
    assert.ok(ev.preview.includes('WORKER_BATCH_SIZE = 64'));
    assert.ok(!ev.preview.includes('admin@queueforge.dev'), 'preview leaked an email');
    assert.equal(r.retrieval.queries[0].query, 'What is the worker batch size?');
    assert.equal(r.retrieval.rejectedEvidence.length, 1);
    assert.equal(r.retrieval.rejectedEvidence[0].rejectionStage, 'source_role_gate');
    assert.equal(r.retrieval.rejectedEvidence[0].rejectionReason, 'PLANNED_TYPE_FILTER');
  });

  test('privacy fixtures: secrets and PII never reach the record at any level', () => {
    for (const level of ['standard', 'verbose']) {
      const records = [];
      const c = beginTurnCollector(identity(), { level, includeContent: false, ...sinkTo(records) });
      c.recordDecisionTrace({
        trace: traceStub({ originalQuestion: 'My key is sk-abcdef1234567890abcd and mail me at foo@bar.com' }),
        decision: decisionStub(),
      });
      c.recordEvidenceItems([evidenceStub({ content: 'password=Hunter2Secret token=abcd1234efgh call +91 98765 43210' })]);
      c.recordAnswer('ok — write to foo@bar.com with Bearer abc.def.ghi12345', true, null);
      c.complete();
      const s = JSON.stringify(records[0]);
      for (const leak of ['sk-abcdef1234567890abcd', 'foo@bar.com', 'Hunter2Secret', 'abcd1234efgh', 'abc.def.ghi12345']) {
        assert.ok(!s.includes(leak), `${level} leaked: ${leak}`);
      }
    }
  });

  test('source-precedence serialization from status metadata', () => {
    const records = [];
    const c = beginTurnCollector(identity(), { level: 'standard', includeContent: false, ...sinkTo(records) });
    c.recordDecisionTrace({ trace: traceStub(), decision: decisionStub() });
    c.recordAuthorizedSources([
      { id: 'f-config', role: 'CODING_SAMPLE', name: 'queueforge_config.py', status: 'current' },
      { id: 'f-old', role: 'PROJECT_FILE', name: 'legacy_architecture.md', status: 'retired', version: 'v1' },
    ]);
    c.recordEvidenceItems([evidenceStub()]);   // uses only f-config
    c.recordAnswer('64', true, null);
    c.complete();
    const p = records[0].precedence;
    assert.ok(p, 'precedence missing');
    assert.equal(p.selectedSources[0].sourceId, 'f-config');
    assert.equal(p.selectedSources[0].reason, 'ACTIVE_SOURCE');
    assert.equal(p.ignoredSources[0].sourceId, 'f-old');
    assert.equal(p.ignoredSources[0].reason, 'SUPERSEDED_SOURCE');
  });
});

// ── Integration: bridge → collector → writer (deferred completion) ──────────

describe('bridge integration', () => {
  const dir = path.join(tmpRoot, 'bridge');
  let envBefore;
  before(() => {
    envBefore = process.env.NATIVELY_CONTEXT_DEBUG;
    process.env.NATIVELY_CONTEXT_DEBUG = 'verbose';
    bindContextDebugConfig({ readStoredLevel: () => 'off', isProductionBuild: true });
    bindContextDebugLogDirectory(dir);
  });
  after(() => {
    if (envBefore === undefined) delete process.env.NATIVELY_CONTEXT_DEBUG;
    else process.env.NATIVELY_CONTEXT_DEBUG = envBefore;
  });

  const port = (evidence = []) => ({ retrieve: async () => ({ evidence, attempts: [] }) });

  test('a manual-chat turn is one correlated record with question, plan, evidence, answer, timing', async () => {
    const requestId = `it_${Math.random().toString(36).slice(2)}`;
    const r = await buildV3Prompt({
      surface: 'manual-chat', pathTag: 'ipc', question: 'What is the current worker batch size?',
      modeTemplateType: 'technical-interview', modeUniqueId: 'mode_it1', modeName: 'Technical Interview',
      attachedSourceCount: 2, requestId, requestSequence: 7,
      scope: { userId: 'local', sessionId: 'it-session-1' },
      debugSources: [
        { id: 'f-config', role: 'CODING_SAMPLE', name: 'queueforge_config.py', status: 'current' },
        { id: 'f-old', role: 'PROJECT_FILE', name: 'legacy.md', status: 'retired' },
      ],
      deferDebugCompletion: true,
      retrieval: port([evidenceStub()]),
    });
    assert.ok(r, 'bridge returned null');
    assert.equal(r.debugRequestId, requestId);
    const c = getTurnCollector(requestId);
    assert.ok(c, 'collector not registered');
    c.recordGenerationStart({ provider: 'llmHelper' });
    c.recordFirstToken();
    c.recordAnswer('The current worker batch size is 64 jobs.', true, null);
    c.complete();
    await flushContextDebugWriter();

    const records = readJsonl(dir).filter((x) => x.event === 'context_turn_complete'
      && x.identity.requestId === requestId);
    assert.equal(records.length, 1);
    const rec = records[0];
    assert.equal(rec.question.original, 'What is the current worker batch size?');
    assert.equal(rec.mode.canonicalId, 'technical-interview');
    assert.equal(rec.answer.final, 'The current worker batch size is 64 jobs.');
    assert.ok(rec.sourcePlan.plannedRoles.length > 0);
    assert.equal(rec.retrieval.selectedEvidence[0].sourceId, 'f-config');
    assert.equal(rec.evidenceCoverage.propertyMatched, true);
    assert.ok(typeof rec.generation.tfftMs === 'number');
    assert.ok(rec.precedence?.ignoredSources?.some((s) => s.sourceId === 'f-old'));
    assert.equal(rec.generation.streamCommitted, true);
  });

  test('follow-up resolution state: she → active person, with reason', async () => {
    const session = `it-fu-${Math.random().toString(36).slice(2)}`;
    await buildV3Prompt({
      surface: 'manual-chat', question: "What is Leena's strongest signal?",
      modeTemplateType: 'recruiting', requestId: `fu1_${session}`, requestSequence: 1,
      scope: { userId: 'local', sessionId: session }, retrieval: port(),
    });
    const requestId = `fu2_${session}`;
    await buildV3Prompt({
      surface: 'manual-chat', question: 'Has she used GCP?',
      modeTemplateType: 'recruiting', requestId, requestSequence: 2,
      scope: { userId: 'local', sessionId: session }, retrieval: port(),
    });
    await flushContextDebugWriter();
    const rec = readJsonl(dir).find((x) => x.identity?.requestId === requestId);
    assert.ok(rec, 'record missing');
    assert.ok(rec.conversationState, 'conversationState missing');
    assert.equal(rec.conversationState.referentApplied, true);
    assert.equal(rec.conversationState.activePerson, 'Leena');
    assert.equal(rec.conversationState.referentReason, 'PRONOUN_RESOLVED_TO_ACTIVE_PERSON');
    assert.match(rec.question.resolved, /Leena/);
  });

  test('explicit entity: referent NOT applied, with the explicit-entity reason', async () => {
    const session = `it-ee-${Math.random().toString(36).slice(2)}`;
    await buildV3Prompt({
      surface: 'manual-chat', question: 'What is the interview process?',
      modeTemplateType: 'recruiting', requestId: `ee1_${session}`, requestSequence: 1,
      scope: { userId: 'local', sessionId: session }, retrieval: port(),
    });
    const requestId = `ee2_${session}`;
    await buildV3Prompt({
      surface: 'manual-chat', question: 'How many students used CampusMesh?',
      modeTemplateType: 'recruiting', requestId, requestSequence: 2,
      scope: { userId: 'local', sessionId: session }, retrieval: port(),
    });
    await flushContextDebugWriter();
    const rec = readJsonl(dir).find((x) => x.identity?.requestId === requestId);
    assert.ok(rec?.conversationState, 'conversationState missing');
    assert.equal(rec.conversationState.referentApplied, false);
    assert.equal(rec.conversationState.referentReason, 'CURRENT_QUESTION_CONTAINS_EXPLICIT_ENTITY');
    assert.equal(rec.question.resolved, 'How many students used CampusMesh?');
  });

  test('OFF mode: no collector, no record', async () => {
    process.env.NATIVELY_CONTEXT_DEBUG = 'off';
    try {
      const requestId = `off_${Math.random().toString(36).slice(2)}`;
      const r = await buildV3Prompt({
        surface: 'manual-chat', question: 'What is a mutex?',
        modeTemplateType: 'general', requestId, requestSequence: 1,
        scope: { userId: 'local', sessionId: 'off-s' }, retrieval: port(),
      });
      assert.ok(r);
      assert.equal(r.debugRequestId, undefined);
      assert.equal(getTurnCollector(requestId), undefined);
      await flushContextDebugWriter();
      assert.ok(!readJsonl(dir).some((x) => x.identity?.requestId === requestId));
    } finally {
      process.env.NATIVELY_CONTEXT_DEBUG = 'verbose';
    }
  });

  test('writer failure does not fail the turn', async () => {
    const clash = path.join(tmpRoot, 'occupied-file');
    fs.writeFileSync(clash, 'x');
    bindContextDebugLogDirectory(path.join(clash, 'nope'));
    try {
      const r = await buildV3Prompt({
        surface: 'manual-chat', question: 'What is the current cache TTL?',
        modeTemplateType: 'technical-interview', requestId: `wf_${Math.random().toString(36).slice(2)}`,
        requestSequence: 1, scope: { userId: 'local', sessionId: 'wf-s' }, retrieval: port([evidenceStub()]),
      });
      assert.ok(r, 'turn failed because logging failed');
      await flushContextDebugWriter();
    } finally {
      bindContextDebugLogDirectory(dir);
    }
  });
});

// ── Ingestion events ────────────────────────────────────────────────────────

describe('ingest events', () => {
  const dir = path.join(tmpRoot, 'ingest');
  before(() => {
    process.env.NATIVELY_CONTEXT_DEBUG = 'standard';
    bindContextDebugConfig({ readStoredLevel: () => 'off', isProductionBuild: true });
    bindContextDebugLogDirectory(dir);
  });
  after(() => { delete process.env.NATIVELY_CONTEXT_DEBUG; });

  test('complete ingest → READY with page and chunk accounting', async () => {
    emitModeFileIngestDebug({
      fileId: 'ref_1', fileName: 'system_design.pdf', modeId: 'mode_x',
      characters: 5250, expectedPages: 14, parsedPages: 14,
      chunkCount: 13, embeddedChunkCount: 13, embeddingSpace: 'gemini:embedding-2:768',
      indexState: 'ready', totalMs: 840,
    });
    await flushContextDebugWriter();
    const rec = readJsonl(dir).find((x) => x.event === 'context_ingest_complete' && x.document.id === 'ref_1');
    assert.ok(rec);
    assert.equal(rec.status, 'READY');
    assert.equal(rec.parsing.expectedPages, 14);
    assert.equal(rec.parsing.parsedPages, 14);
    assert.equal(rec.parsing.chunkCount, 13);
    assert.equal(rec.indexes.vectorReady, true);
    assert.equal(rec.schemaVersion, CONTEXT_DEBUG_SCHEMA_VERSION);
  });

  test('missing tail pages → PARTIAL, embeddings incomplete → vector not ready', async () => {
    emitModeFileIngestDebug({
      fileId: 'ref_2', fileName: 'broken.pdf',
      characters: 3000, expectedPages: 14, parsedPages: 11,
      chunkCount: 10, embeddedChunkCount: 4, embeddingSpace: 'gemini:embedding-2:768',
      indexState: 'ready',
    });
    await flushContextDebugWriter();
    const rec = readJsonl(dir).find((x) => x.event === 'context_ingest_complete' && x.document.id === 'ref_2');
    assert.equal(rec.status, 'PARTIAL');
    assert.equal(rec.indexes.vectorReady, false);
    assert.equal(rec.indexes.embeddedChunkCount, 4);
  });

  test('failed ingest → FAILED with the error', async () => {
    emitModeFileIngestDebug({
      fileId: 'ref_3', fileName: 'bad.md', characters: 10, chunkCount: 1,
      embeddedChunkCount: 0, indexState: 'failed', errorMessage: 'embedding provider 429',
    });
    await flushContextDebugWriter();
    const rec = readJsonl(dir).find((x) => x.event === 'context_ingest_complete' && x.document.id === 'ref_3');
    assert.equal(rec.status, 'FAILED');
    assert.match(rec.errors[0].message, /429/);
  });

  test('off level emits nothing', async () => {
    process.env.NATIVELY_CONTEXT_DEBUG = 'off';
    emitModeFileIngestDebug({
      fileId: 'ref_off', fileName: 'x.md', chunkCount: 1, embeddedChunkCount: 1, indexState: 'ready',
    });
    process.env.NATIVELY_CONTEXT_DEBUG = 'standard';
    await flushContextDebugWriter();
    assert.ok(!readJsonl(dir).some((x) => x.document?.id === 'ref_off'));
  });
});
