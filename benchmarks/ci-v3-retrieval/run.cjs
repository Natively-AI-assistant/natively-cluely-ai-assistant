/**
 * Phase 2 bake-off — runner.
 *
 * Usage:
 *   NATIVELY_TEST_USERDATA=<dir> NATIVELY_INTERNAL=1 ELECTRON_RUN_AS_NODE=1 \
 *     ./node_modules/.bin/electron benchmarks/ci-v3-retrieval/run.cjs
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { boot, assertVectorRunValid } = require('./bootstrap.cjs');
const { ingestCorpus } = require('./ingest.cjs');
const { makeRetriever, buildPool, RANKERS, assertTokenizerParity } = require('./configs.cjs');
const { scoreQuestion, aggregate } = require('./score.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BANK = path.join(REPO_ROOT, 'test-fixtures/ci-v3-corpus/questions.json');

// Corpus → SourceType label. Contamination scoring depends on this mapping.
const CORPUS = [
  { path: 'tests/fixtures/modes/looking-for-work/lfw_resume.txt', label: 'RESUME' },
  { path: 'tests/fixtures/modes/looking-for-work/lfw_jd.md', label: 'JOB_DESCRIPTION' },
  { path: 'test-fixtures/ci-v3-corpus/additions/resume_v1_2023.md', label: 'RESUME' },
  { path: 'test-fixtures/ci-v3-corpus/additions/resume_v2_2026.md', label: 'RESUME' },
  { path: 'test-fixtures/ci-v3-corpus/additions/meeting_transcript_current.txt', label: 'MEETING_TRANSCRIPT' },
  { path: 'test-fixtures/ci-v3-corpus/additions/meeting_transcript_previous.txt', label: 'MEETING_TRANSCRIPT' },
  { path: 'test-fixtures/ci-v3-corpus/additions/empty_reference.md', label: 'REFERENCE_FILE' },
  { path: 'tests/fixtures/modes/sales/sales_pricing_policy.json', label: 'REFERENCE_FILE' },
  { path: 'tests/fixtures/modes/sales/sales_competitor_battlecard.md', label: 'REFERENCE_FILE' },
  { path: 'tests/fixtures/modes/recruiting/recruiting_compensation_policy.txt', label: 'REFERENCE_FILE' },
  { path: 'tests/fixtures/modes/technical-interview/tech_error_log.txt', label: 'REFERENCE_FILE' },
  { path: 'tests/fixtures/modes/lecture/lecture_pde_syllabus.md', label: 'REFERENCE_FILE' },
  { path: 'tests/fixtures/modes/team-meet/team_meet_risk_register.json', label: 'REFERENCE_FILE' },
  // NOTE — institutional_thesis.pdf (66 pp, 128 184 chars) is EXCLUDED.
  // It reproducibly crashes the local ONNX embedding worker with SIGTRAP during
  // indexReferenceFile. Isolated: extraction succeeds (128 184 chars returned),
  // and bert_1810.04805.pdf (64 701 chars) indexes fine — so the failure is in
  // embedding a document of this size, not in parsing.
  // Tracked as finding F22; see 02_RETRIEVAL_BENCHMARK.md §6.1.
  // { path: 'test-fixtures/modes-corpus/thesis/institutional_thesis.pdf', label: 'REFERENCE_FILE' },
  { path: 'test-fixtures/modes-corpus/papers/attention_is_all_you_need_1706.03762.pdf', label: 'REFERENCE_FILE' },
  { path: 'test-fixtures/modes-corpus/papers/bert_1810.04805.pdf', label: 'REFERENCE_FILE' },
];

(async () => {
  const t0 = Date.now();
  const b = await boot({ verbose: true });
  const bank = JSON.parse(fs.readFileSync(BANK, 'utf8'));

  const { mode, ingested } = await ingestCorpus(b, CORPUS);
  const indexedFiles = ingested.filter((i) => i.file);
  const fileIds = indexedFiles.map((i) => i.file.id);

  // VOID guard — a degraded run must not masquerade as a result.
  const validity = assertVectorRunValid({ db: b.db, spaceKey: b.spaceKey, fileIds });
  console.log('[run] validity', JSON.stringify(validity));

  const fileLabel = new Map(indexedFiles.map((i) => [path.basename(i.path), i.label]));
  const ctx = makeRetriever(b);
  const parity = assertTokenizerParity(ctx);
  console.log('[run] tokenizer parity score', parity.toFixed(4));

  const { ModesManager } = require(path.join(REPO_ROOT, 'dist-electron/electron/services/ModesManager.js'));
  const mm = ModesManager.getInstance();
  const files = mm.getReferenceFiles(mode.id);
  console.log('[run] files visible to retriever:', files.length);

  const results = {};
  const latencies = {};
  for (const name of Object.keys(RANKERS)) { results[name] = []; latencies[name] = []; }

  for (const q of bank.questions) {
    let pool;
    // Unbuffered progress marker: a SIGTRAP in the native ONNX/sqlite-vec layer
    // kills the process outright, so the last line printed is the only evidence
    // of where it died.
    fs.writeSync(1, `[run] Q ${q.id}\n`);
    try {
      const tq = Date.now();
      pool = await buildPool(ctx, files, q.question);
      var poolMs = Date.now() - tq;
    } catch (e) {
      console.log(`[run] ${q.id} POOL FAILED: ${e.message}`);
      continue;
    }
    for (const [name, rank] of Object.entries(RANKERS)) {
      const t1 = Date.now();
      const ranked = rank(ctx, pool, q.question);
      latencies[name].push(poolMs + (Date.now() - t1));
      results[name].push(scoreQuestion(ranked, q, fileLabel));
    }
  }

  const p = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * q)] ?? null; };
  const out = { runAt: new Date().toISOString(), validity, corpusFiles: indexedFiles.length, configs: {} };
  for (const name of Object.keys(RANKERS)) {
    out.configs[name] = {
      ...aggregate(results[name]),
      latencyMs: { p50: p(latencies[name], 0.5), p95: p(latencies[name], 0.95), p99: p(latencies[name], 0.99) },
      rows: results[name],
    };
  }

  const outDir = path.join(REPO_ROOT, 'benchmarks/ci-v3-retrieval/results');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'bakeoff-latest.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  console.log('\n=== RESULTS ===');
  const f = (v) => (v === null || v === undefined ? '  n/a' : (v * 100).toFixed(1).padStart(5));
  console.log('config                R@1    R@3    R@5   P@3   contam  stale  falseRet  p50ms');
  for (const [name, r] of Object.entries(out.configs)) {
    console.log(
      `${name.padEnd(20)} ${f(r.recall1)} ${f(r.recall3)} ${f(r.recall5)} ${f(r.precision3)} ${f(r.contaminationRate)} ${f(r.staleVersionRate)} ${f(r.falseRetrievalRate)}   ${String(r.latencyMs.p50).padStart(5)}`,
    );
  }
  console.log(`\nwrote ${outPath}  ·  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(0);
})().catch((e) => { console.error('RUN FAILED:', e.stack || e.message); process.exit(1); });
