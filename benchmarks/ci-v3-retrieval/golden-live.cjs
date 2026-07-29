/**
 * Phase 8 — golden suite against the REAL retrieval stack.
 *
 * WHY THIS EXISTS SEPARATELY FROM golden-run.cjs
 * `golden-run.cjs` measures the DECISION layer with a stub retrieval port. That
 * proves the policy is right; it does not prove the pipeline is right. A gate
 * passed against a stub cannot authorise deleting legacy code, because the stub
 * is exactly the part that was replaced.
 *
 * This runner uses the real thing end to end: real SQLite, real sqlite-vec, real
 * local MiniLM embeddings, real ModeHybridRetriever over a real ingested corpus,
 * driven through the same orchestrator + legacy adapter the wired manual-chat
 * surface uses.
 *
 * Usage:
 *   NATIVELY_TEST_USERDATA=<dir> NATIVELY_INTERNAL=1 ELECTRON_RUN_AS_NODE=1 \
 *     ./node_modules/.bin/electron benchmarks/ci-v3-retrieval/golden-live.cjs
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { boot, assertVectorRunValid, REPO_ROOT, DIST } = require('./bootstrap.cjs');
const { ingestCorpus } = require('./ingest.cjs');

process.env.NATIVELY_CONTEXT_INTELLIGENCE_V3 = '1';
// F23 — MUST be set, or this measurement is void.
//
// With the bundled LOCAL embedder and no live transcript, the legacy retriever's
// `shouldUseLexicalForLocalManualQuery` gate skips the vector path, and
// `keylessManualRetrievalUsesLexical` DEFAULTS TRUE. The lexical floor then
// rejects real matches: measured on a resume question whose answer is in the
// corpus, production returned 0 chunks with topScore 0 while the unfiltered pool
// held a chunk scoring 0.330. Setting this to 0 restores the vector path
// (0 chunks -> 1, topScore 0 -> 0.330).
//
// This is a LEGACY defect, not a V3 one, but it would silently zero out every
// grounded answer in this evaluation and make V3 look like the cause.
process.env.NATIVELY_KEYLESS_LEXICAL_MANUAL_RETRIEVAL =
  process.env.NATIVELY_KEYLESS_LEXICAL_MANUAL_RETRIEVAL ?? '0';

const d = (rel) => require(path.join(DIST, rel));

// Same corpus the bake-off used, minus the thesis (F22: 128k-char PDF aborts the
// embedding worker with SIGTRAP — a real P1, excluded here so it does not mask
// the gate result).
const CORPUS = [
  { path: 'tests/fixtures/modes/looking-for-work/lfw_resume.txt', label: 'RESUME' },
  { path: 'tests/fixtures/modes/looking-for-work/lfw_jd.md', label: 'JOB_DESCRIPTION' },
  { path: 'test-fixtures/ci-v3-corpus/additions/resume_v2_2026.md', label: 'RESUME' },
  { path: 'test-fixtures/ci-v3-corpus/additions/meeting_transcript_current.txt', label: 'MEETING_TRANSCRIPT' },
  { path: 'tests/fixtures/modes/sales/sales_pricing_policy.json', label: 'REFERENCE_FILE' },
  { path: 'tests/fixtures/modes/sales/sales_competitor_battlecard.md', label: 'REFERENCE_FILE' },
  { path: 'tests/fixtures/modes/recruiting/recruiting_compensation_policy.txt', label: 'REFERENCE_FILE' },
  { path: 'tests/fixtures/modes/technical-interview/tech_error_log.txt', label: 'REFERENCE_FILE' },
  { path: 'tests/fixtures/modes/lecture/lecture_pde_syllabus.md', label: 'REFERENCE_FILE' },
  { path: 'tests/fixtures/modes/team-meet/team_meet_risk_register.json', label: 'REFERENCE_FILE' },
  { path: 'test-fixtures/modes-corpus/papers/attention_is_all_you_need_1706.03762.pdf', label: 'REFERENCE_FILE' },
  { path: 'test-fixtures/modes-corpus/papers/bert_1810.04805.pdf', label: 'REFERENCE_FILE' },
];

const MODE_FOR_SOURCE = {
  RESUME: 'looking-for-work', JOB_DESCRIPTION: 'looking-for-work',
  REFERENCE_FILE: 'seminar', MEETING_TRANSCRIPT: 'team-meet', PROFILE_FACT: 'looking-for-work',
};

(async () => {
  const b = await boot({ verbose: true });
  const { orchestrate } = d('electron/context-intelligence/orchestration/orchestrator.js');
  const { composePrompt } = d('electron/context-intelligence/generation/prompt-composer.js');
  const { resolveModePolicy, isModeId } = d('electron/context-intelligence/policies/mode-policy-registry.js');
  const { createLegacyRetrievalPort } = d('electron/context-intelligence/retrieval/legacy-retrieval-port.js');
  const { ModesManager } = d('electron/services/ModesManager.js');

  const { mode, ingested } = await ingestCorpus(b, CORPUS);
  const indexed = ingested.filter((i) => i.file);
  const validity = assertVectorRunValid({
    db: b.db, spaceKey: b.spaceKey, fileIds: indexed.map((i) => i.file.id),
  });
  console.log('[live] validity', JSON.stringify(validity));

  // Real source registry from the real ingest. Legacy mode files carry no
  // version, so a single synthetic active version is stamped — stated, not
  // pretended otherwise.
  const sourceTypes = new Map();
  const activeVersions = new Map();
  for (const i of indexed) { sourceTypes.set(i.file.id, i.label); activeVersions.set(i.file.id, 'legacy'); }

  const mm = ModesManager.getInstance();
  const files = mm.getReferenceFiles(mode.id);

  const port = createLegacyRetrievalPort({
    registry: { sourceTypes, activeVersions },
    retrieve: async (query, opts) => {
      const res = await mm.retrieveHybridRaw(mode, files, {
        query, topK: opts.topK, tokenBudget: 3600, allowRerank: false,
      });
      return (res?.chunks ?? []).map((c) => ({
        sourceId: c.sourceId, fileName: c.fileName, text: c.text,
        chunkIndex: c.chunkIndex, score: c.score, ftsScore: c.ftsScore, vectorScore: c.vectorScore,
      }));
    },
  });

  const bank = JSON.parse(fs.readFileSync(
    path.join(REPO_ROOT, 'test-fixtures/ci-v3-corpus/questions.json'), 'utf8')).questions;

  const CHECKS = ['noProhibitedSourceInEvidence', 'evidenceCarriesProvenance',
    'promptLabelsEvidenceUntrusted', 'noStaleVersionAccepted', 'retrievalPath'];
  const rows = [];
  const t0 = Date.now();
  const latencies = [];

  for (const q of bank) {
    const raw = MODE_FOR_SOURCE[(q.requiredSources || [])[0]] || 'general';
    const modeId = isModeId(raw) ? raw : 'general';
    const policy = resolveModePolicy(modeId);

    const tq = Date.now();
    const result = await orchestrate({
      requestId: `live-${q.id}`, requestSequence: 1, surface: 'manual-chat',
      modeId, scope: { userId: 'local' }, sessionId: 's', manualQuestion: q.question,
    }, port);
    latencies.push(Date.now() - tq);

    const composed = composePrompt({ decision: result.decision, policy, evidence: result.evidence });
    const prohibited = new Set(q.prohibitedSources || []);

    const checks = {
      noProhibitedSourceInEvidence: !result.evidence.some((e) => prohibited.has(e.sourceType)),
      evidenceCarriesProvenance: result.evidence.every(
        (e) => e.sourceId && e.versionId && e.scopeId && typeof e.isDirectFact === 'boolean'),
      promptLabelsEvidenceUntrusted: result.evidence.length === 0 || /untrusted data/i.test(composed.user),
      // The measured top risk: a superseded version must never be accepted.
      noStaleVersionAccepted: !result.evidence.some((e) => /resume_v1/.test(e.documentTitle || '')),
      retrievalPath: !q.expectedPath || result.decision.retrievalPlan.path === q.expectedPath,
    };

    rows.push({
      id: q.id, category: q.category, modeId,
      path: result.decision.retrievalPlan.path,
      answerability: result.answerability,
      evidence: result.evidence.length,
      retrievedRaw: result.trace.retrievalAttempts[0]?.candidateCount ?? 0,
      rejectedByScope: result.trace.retrievalAttempts[0]?.rejectedByScopeFilter ?? 0,
      checks, failed: CHECKS.filter((c) => !checks[c]),
    });
  }

  const total = rows.length;
  const per = Object.fromEntries(CHECKS.map((c) => [c, rows.filter((r) => r.checks[c]).length]));
  const clean = rows.filter((r) => !r.failed.length).length;
  const p = (a, x) => { const s2 = [...a].sort((m, n) => m - n); return s2[Math.floor(s2.length * x)] ?? 0; };

  const out = {
    runAt: new Date().toISOString(), mode: 'LIVE retrieval stack',
    validity, corpusFiles: indexed.length, questions: total, fullyPassing: clean, perCheck: per,
    latencyMs: { p50: p(latencies, 0.5), p95: p(latencies, 0.95), p99: p(latencies, 0.99) },
    totalMs: Date.now() - t0, rows,
  };
  const outDir = path.join(REPO_ROOT, 'benchmarks/ci-v3-retrieval/results');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'golden-live-latest.json'), JSON.stringify(out, null, 2));

  const pc = (n) => `${((n / total) * 100).toFixed(1)}%`;
  console.log('\n=== GOLDEN SUITE — LIVE RETRIEVAL STACK ===');
  console.log(`corpus files indexed               ${indexed.length}`);
  console.log(`chunks                             ${validity.chunkCount}`);
  console.log(`questions                          ${total}`);
  console.log(`fully passing                      ${clean}  ${pc(clean)}\n`);
  for (const c of CHECKS) console.log(`  ${c.padEnd(32)} ${String(per[c]).padStart(3)}/${total}  ${pc(per[c])}`);
  console.log(`\nretrieval latency  p50 ${out.latencyMs.p50}ms · p95 ${out.latencyMs.p95}ms · p99 ${out.latencyMs.p99}ms`);
  const failing = rows.filter((r) => r.failed.length);
  if (failing.length) {
    console.log('\n--- FAILURES ---');
    for (const r of failing.slice(0, 15)) console.log(`  ${r.id} [${r.modeId}] ${r.failed.join(', ')}`);
  }
  console.log(`\nwrote ${path.join(outDir, 'golden-live-latest.json')}`);
  process.exit(0);
})().catch((e) => { console.error('LIVE GOLDEN FAILED:', e.stack || e.message); process.exit(1); });
