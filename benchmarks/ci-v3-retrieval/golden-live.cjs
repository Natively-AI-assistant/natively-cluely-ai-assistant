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
const {
  MODE_FOR_SOURCE, docsForGroup, groupForQuestion,
  buildRegistry, supersededFileIds, assertCorpusWellFormed,
} = require('./corpus.cjs');

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

(async () => {
  const b = await boot({ verbose: true });
  const { orchestrate } = d('electron/context-intelligence/orchestration/orchestrator.js');
  const { composePrompt } = d('electron/context-intelligence/generation/prompt-composer.js');
  const { resolveModePolicy, isModeId } = d('electron/context-intelligence/policies/mode-policy-registry.js');
  const { createLegacyRetrievalPort } = d('electron/context-intelligence/retrieval/legacy-retrieval-port.js');
  const { ModesManager } = d('electron/services/ModesManager.js');

  console.log('[live] corpus', JSON.stringify(assertCorpusWellFormed()));

  // Each retrieval GROUP is ingested into its own mode, so a question only ever
  // sees the documents its family is written against. Merged, Priya's résumé
  // (Kubernetes, PostgreSQL) answered probes asserting those terms are absent
  // from Evin's — C-02, the canonical JD-as-experience case, passed corrupted.
  const groups = {};
  for (const group of ['base', 'versioned']) {
    const { mode, ingested } = await ingestCorpus(b, docsForGroup(group), {
      modeName: `CIv3 Bench ${group}`,
    });
    const indexed = ingested.filter((i) => i.file);
    const validity = assertVectorRunValid({
      db: b.db, spaceKey: b.spaceKey, fileIds: indexed.map((i) => i.file.id),
    });
    const registry = buildRegistry(indexed);
    const stale = supersededFileIds(registry);
    const mm = ModesManager.getInstance();
    const files = mm.getReferenceFiles(mode.id);

    groups[group] = {
      mode, indexed, validity, registry, stale, files,
      port: createLegacyRetrievalPort({
        // NO assumeCurrentWhenVersionUnknown: this harness declares every
        // chunk's version, so the adapter's fail-closed default must hold.
        registry,
        retrieve: async (query, opts) => {
          const res = await mm.retrieveHybridRaw(mode, files, {
            query, topK: opts.topK, tokenBudget: 3600, allowRerank: false,
          });
          return (res?.chunks ?? []).map((c) => ({
            sourceId: c.sourceId, fileName: c.fileName, text: c.text,
            chunkIndex: c.chunkIndex, score: c.score, ftsScore: c.ftsScore, vectorScore: c.vectorScore,
          }));
        },
      }),
    };
    console.log(`[live] group ${group}: ${indexed.length} files · ${validity.chunkCount} chunks`
      + ` · ${stale.size} superseded revision(s)`);
  }

  if (!groups.versioned.stale.size) {
    throw new Error('no superseded revision indexed — the stale-version gate would be vacuous');
  }

  const bank = JSON.parse(fs.readFileSync(
    path.join(REPO_ROOT, 'test-fixtures/ci-v3-corpus/questions.json'), 'utf8')).questions;

  const CHECKS = ['noProhibitedSourceInEvidence', 'evidenceCarriesProvenance',
    'promptLabelsEvidenceUntrusted', 'noStaleVersionAccepted', 'retrievalPath',
    'answerabilityMatchesExpected'];

  // Questions whose gold answer lives in the CURRENT revision of a source that
  // also has a superseded revision indexed. For these the run must show the
  // stale revision being actively rejected, not merely absent.
  const VERSIONED = new Set(['G-01', 'G-02', 'G-03', 'H-01', 'H-02', 'H-03', 'H-04']);
  let staleRejectionsObserved = 0;
  const rows = [];
  const t0 = Date.now();
  const latencies = [];

  for (const q of bank) {
    const raw = MODE_FOR_SOURCE[(q.requiredSources || [])[0]] || 'general';
    const modeId = isModeId(raw) ? raw : 'general';
    const policy = resolveModePolicy(modeId);
    // Retrieval group and V3 policy mode are DIFFERENT axes: the group decides
    // which documents exist for this question, the mode decides which source
    // types it may read. Conflating them is what merged the two corpora.
    const group = groupForQuestion(q.id);
    const { port, stale } = groups[group];

    const tq = Date.now();
    const result = await orchestrate({
      requestId: `live-${q.id}`, requestSequence: 1, surface: 'manual-chat',
      modeId, scope: { userId: 'local' }, sessionId: 's', manualQuestion: q.question,
    }, port);
    latencies.push(Date.now() - tq);

    const composed = composePrompt({ decision: result.decision, policy, evidence: result.evidence });
    const prohibited = new Set(q.prohibitedSources || []);

    const rejections = result.trace.retrievalAttempts[0]?.rejections ?? [];
    const supersededRejections = rejections.filter((r) => r.reason === 'SUPERSEDED_VERSION');
    if (supersededRejections.length) staleRejectionsObserved++;

    const checks = {
      noProhibitedSourceInEvidence: !result.evidence.some((e) => prohibited.has(e.sourceType)),
      evidenceCarriesProvenance: result.evidence.every(
        (e) => e.sourceId && e.versionId && e.scopeId && typeof e.isDirectFact === 'boolean'),
      promptLabelsEvidenceUntrusted: result.evidence.length === 0 || /untrusted data/i.test(composed.user),

      // The measured top risk: a superseded version must never be accepted.
      //
      // This was `!/resume_v1/.test(documentTitle)` against a corpus that did
      // NOT contain resume_v1 — it could not fail, and reported 42/42 with
      // nothing to reject. Now it asserts on file IDENTITY from the registry,
      // so a stale document reaching evidence is caught by what it IS rather
      // than by a filename substring that happened to match nothing.
      noStaleVersionAccepted: !result.evidence.some((e) => stale.has(e.sourceId)),

      retrievalPath: !q.expectedPath || result.decision.retrievalPlan.path === q.expectedPath,

      // expectedAnswerability was recorded by all three harnesses and asserted
      // by none, which is how 4 questions came to expect CONFLICTING — a state
      // the orchestrator could not produce.
      answerabilityMatchesExpected:
        !q.expectedAnswerability || result.answerability === q.expectedAnswerability,
    };

    rows.push({
      id: q.id, category: q.category, modeId, group,
      path: result.decision.retrievalPlan.path,
      answerability: result.answerability,
      evidence: result.evidence.length,
      retrievedRaw: result.trace.retrievalAttempts[0]?.candidateCount ?? 0,
      rejectedByScope: result.trace.retrievalAttempts[0]?.rejectedByScopeFilter ?? 0,
      rejections, staleRejected: supersededRejections.length,
      expectedAnswerability: q.expectedAnswerability ?? null,
      checks, failed: CHECKS.filter((c) => !checks[c]),
    });
  }

  const total = rows.length;
  const per = Object.fromEntries(CHECKS.map((c) => [c, rows.filter((r) => r.checks[c]).length]));
  const clean = rows.filter((r) => !r.failed.length).length;
  const p = (a, x) => { const s2 = [...a].sort((m, n) => m - n); return s2[Math.floor(s2.length * x)] ?? 0; };

  const out = {
    runAt: new Date().toISOString(), mode: 'LIVE retrieval stack',
    groups: Object.fromEntries(Object.entries(groups).map(([g, v]) => [g, {
      files: v.indexed.length, chunks: v.validity.chunkCount, superseded: v.stale.size,
    }])),
    questions: total, fullyPassing: clean, perCheck: per,
    supersededRevisionsIndexed: groups.versioned.stale.size, staleRejectionsObserved,
    latencyMs: { p50: p(latencies, 0.5), p95: p(latencies, 0.95), p99: p(latencies, 0.99) },
    totalMs: Date.now() - t0, rows,
  };
  const outDir = path.join(REPO_ROOT, 'benchmarks/ci-v3-retrieval/results');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'golden-live-latest.json'), JSON.stringify(out, null, 2));

  const pc = (n) => `${((n / total) * 100).toFixed(1)}%`;
  console.log('\n=== GOLDEN SUITE — LIVE RETRIEVAL STACK ===');
  for (const [g, v] of Object.entries(groups)) {
    console.log(`group ${g.padEnd(10)}                  ${String(v.indexed.length).padStart(2)} files · `
      + `${String(v.validity.chunkCount).padStart(3)} chunks · ${v.stale.size} superseded`);
  }
  console.log(`questions                          ${total}`);
  console.log(`fully passing                      ${clean}  ${pc(clean)}\n`);
  for (const c of CHECKS) console.log(`  ${c.padEnd(32)} ${String(per[c]).padStart(3)}/${total}  ${pc(per[c])}`);

  // A pass on noStaleVersionAccepted means nothing unless the filter was
  // actually exercised. Report the count and say so plainly when it is zero.
  console.log(`\nsuperseded revisions indexed       ${groups.versioned.stale.size}`);
  console.log(`turns where one was REJECTED       ${staleRejectionsObserved}`);
  if (!staleRejectionsObserved) {
    console.log('  *** noStaleVersionAccepted is VACUOUS this run: no superseded chunk was ever');
    console.log('      a retrieval candidate, so the filter was never exercised. ***');
  }
  console.log(`\nretrieval latency  p50 ${out.latencyMs.p50}ms · p95 ${out.latencyMs.p95}ms · p99 ${out.latencyMs.p99}ms`);
  const failing = rows.filter((r) => r.failed.length);
  if (failing.length) {
    console.log('\n--- FAILURES ---');
    for (const r of failing.slice(0, 15)) console.log(`  ${r.id} [${r.modeId}] ${r.failed.join(', ')}`);
  }
  console.log(`\nwrote ${path.join(outDir, 'golden-live-latest.json')}`);
  process.exit(0);
})().catch((e) => { console.error('LIVE GOLDEN FAILED:', e.stack || e.message); process.exit(1); });
