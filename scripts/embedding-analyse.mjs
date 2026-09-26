#!/usr/bin/env node
// scripts/embedding-analyse.mjs
//
// R&D ONLY. Aggregates results/raw-retrieval/*.json into the reportable
// artifacts: a paired comparison against the freshly-measured MiniLM baseline
// (§21), a paired bootstrap confidence interval (§22), per-category breakdowns
// (§13), and the machine-readable JSON + CSV (§26).
//
// PAIRED, because every model answered THE SAME 503 queries from THE SAME
// chunk set (sha256-asserted). The comparison resamples QUERIES, not models,
// so each bootstrap replicate keeps both models' answers to the same question
// together — which is what makes the interval a statement about the model
// difference rather than about query difficulty.
//
// An interval spanning zero is reported as "within noise", never as a win.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(REPO, 'results', 'raw-retrieval');
const BASE = 'minilm-baseline';
const BATCH4 = new Set(['nomic-v1.5', 'arctic-l', 'bge-large-en', 'e5-large-v2']);
const B = 2000; // bootstrap replicates

const models = {};
for (const f of fs.readdirSync(RAW)) {
  const r = JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
  models[r.model_id] = r;
}
if (!models[BASE]) throw new Error('no baseline result — cannot report a delta against MiniLM');

const sizes = JSON.parse(fs.readFileSync(path.join(REPO, 'results', 'model-sizes.json'), 'utf8'));
const sanity = JSON.parse(fs.readFileSync(path.join(REPO, 'results', 'local-embedding-sanity.json'), 'utf8'));
const sanityBy = Object.fromEntries(sanity.map((s) => [s.key, s]));

// Optional side tracks, keyed by model id. Absent files simply leave nulls.
const loadDir = (d) => {
  const out = {};
  const p = path.join(REPO, 'results', d);
  if (!fs.existsSync(p)) return out;
  for (const f of fs.readdirSync(p)) {
    const j = JSON.parse(fs.readFileSync(path.join(p, f), 'utf8'));
    out[j.model_id] = j;
  }
  return out;
};
const rr = loadDir('rerank');
const cf = loadDir('crossfile');

// Deterministic RNG so the published interval is reproducible.
let seed = 0x9e3779b9;
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 4294967296); };

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Paired bootstrap over shared query ids for one metric. */
function pairedDelta(cand, base, metric) {
  const b = new Map(base.perQuery.map((r) => [r.query_id, r.base[metric]]));
  const pairs = [];
  for (const r of cand.perQuery) {
    if (b.has(r.query_id)) pairs.push([r.base[metric], b.get(r.query_id)]);
  }
  if (!pairs.length) return null;
  const observed = mean(pairs.map(([c, x]) => c - x));
  const deltas = [];
  for (let i = 0; i < B; i++) {
    let s = 0;
    for (let j = 0; j < pairs.length; j++) {
      const p = pairs[(rnd() * pairs.length) | 0];
      s += p[0] - p[1];
    }
    deltas.push(s / pairs.length);
  }
  deltas.sort((a, b2) => a - b2);
  const lo = deltas[Math.floor(0.025 * B)];
  const hi = deltas[Math.floor(0.975 * B)];
  return {
    delta: +observed.toFixed(4),
    ci95: [+lo.toFixed(4), +hi.toFixed(4)],
    n: pairs.length,
    significant: (lo > 0 && hi > 0) || (lo < 0 && hi < 0),
  };
}

const rows = [];
for (const [id, m] of Object.entries(models)) {
  const sz = sizes[id] || {};
  const sn = sanityBy[id] || {};
  const row = {
    model_id: id,
    repo: m.repo,
    revision: m.revision,
    license: m.license,
    artifact: 'onnx/model_quantized.onnx',
    quantization: m.quantization,
    artifact_size_bytes: sz.artifactBytes ?? null,
    installed_size_bytes: sz.installedBytes ?? null,
    dimensions: m.dimensions,
    context_length: sz.contextLength ?? null,
    runtime: m.runtime,
    loader: 'transformers.js pipeline("feature-extraction")',
    pooling: m.pooling,
    normalization: 'l2 (normalize:true), measured 1.000',
    query_prefix: m.query_prefix,
    document_prefix: m.document_prefix,
    load_time_ms: sn.loadTimeMs ?? null,
    indexing_chunks_per_sec: m.indexing.chunksPerSec,
    // Models that could not complete at Natively's batch 16 and were indexed
    // at 4 instead. nomic-v1.5 SIGTRAPs; the three 335M/1024d models exceed
    // LocalEmbeddingProvider's 30s WORKER_EMBED_TIMEOUT_MS on real chunks.
    // Measured effect of batch size on R@10: 0.0000 (see the batch-size control).
    index_batch_size: BATCH4.has(id) ? 4 : 16,
    query_latency_p50_ms: m.query_latency.p50Ms,
    query_latency_p95_ms: m.query_latency.p95Ms,
    memory_peak_rss_mb: m.memory_peak_rss_mb,
    R_at_1: m.overall.r1,
    R_at_5: m.overall.r5,
    R_at_10: m.overall.r10,
    MRR: m.overall.mrr,
    nDCG_at_10: m.overall.ndcg,
    candidate_recall_at_50: m.candidate_recall_at_pool,
    code_R_at_10: m.code_r10,
    cross_project_R_at_10: m.cross_project_r10,
    reranked_R_at_10: rr[id]?.reranked?.r10 ?? null,
    reranker_gain_R_at_10: rr[id]?.gain?.r10 ?? null,
    rerank_unrecoverable_rate: rr[id]?.unrecoverable_rate ?? null,
    rerank_queries_sampled: rr[id]?.n_queries ?? null,
    rerank_pool: rr[id]?.pool ?? null,
    rerank_failures: rr[id]?.rerank_failures ?? null,
    crossfile_any_at_10: cf[id]?.perK?.['10']?.anyFile ?? null,
    crossfile_all_at_10: cf[id]?.perK?.['10']?.allFiles ?? null,
    crossfile_file_recall_at_10: cf[id]?.perK?.['10']?.fileRecall ?? null,
    index_backend: `${m.index.backend} distance_metric=${m.index.distance_metric}`,
    index_rows: m.index.rows,
    sanity_status: sn.status ?? null,
    failures: (sn.failures || []).join('; ') || null,
  };
  if (id !== BASE) {
    for (const met of ['r1', 'r5', 'r10', 'mrr', 'ndcg']) {
      row[`delta_${met}_vs_minilm`] = pairedDelta(m, models[BASE], met);
    }
  }
  rows.push(row);
}
rows.sort((a, b) => b.R_at_10 - a.R_at_10);

const out = {
  generatedAt: new Date().toISOString(),
  baseline: BASE,
  bootstrapReplicates: B,
  corpus: models[BASE].corpus,
  machine: 'Apple M4, 16 GB, darwin 27.0.0',
  note: 'Absolute values are NOT comparable to the historical Python-harness numbers: different chunker (Natively semanticChunker v4, no overlap), different relevance rule, different runtime. Only the deltas within this table are head-to-head.',
  models: rows,
};
fs.writeFileSync(path.join(REPO, 'results', 'local-embedding-benchmark.json'), JSON.stringify(out, null, 2));

// ── CSV ─────────────────────────────────────────────────────────────────────
const cols = Object.keys(rows[0]).filter((c) => !c.startsWith('delta_'));
const csvCols = [...cols, 'delta_r10_vs_minilm', 'delta_r10_ci95_low', 'delta_r10_ci95_high', 'delta_r10_significant'];
const esc = (v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const lines = [csvCols.join(',')];
for (const r of rows) {
  const d = r.delta_r10_vs_minilm;
  lines.push([...cols.map((c) => esc(r[c])), esc(d?.delta), esc(d?.ci95?.[0]), esc(d?.ci95?.[1]), esc(d?.significant)].join(','));
}
fs.writeFileSync(path.join(REPO, 'results', 'local-embedding-benchmark.csv'), lines.join('\n') + '\n');

// ── console ─────────────────────────────────────────────────────────────────
console.log('\n=== HEAD-TO-HEAD, matched configuration (503 queries, 872 chunks, chunker v4) ===\n');
console.log('model'.padEnd(23), 'MiB'.padStart(6), 'dim'.padStart(4), 'R@1'.padStart(7), 'R@5'.padStart(7), 'R@10'.padStart(7), 'MRR'.padStart(7), 'nDCG'.padStart(7), 'pool@50'.padStart(8), 'p95'.padStart(5));
for (const r of rows) {
  console.log(
    r.model_id.padEnd(23),
    (r.installed_size_bytes ? (r.installed_size_bytes / 1048576).toFixed(1) : '-').padStart(6),
    String(r.dimensions).padStart(4),
    r.R_at_1.toFixed(4).padStart(7),
    r.R_at_5.toFixed(4).padStart(7),
    r.R_at_10.toFixed(4).padStart(7),
    r.MRR.toFixed(4).padStart(7),
    r.nDCG_at_10.toFixed(4).padStart(7),
    r.candidate_recall_at_50.toFixed(4).padStart(8),
    String(r.query_latency_p95_ms).padStart(5),
  );
}

console.log('\n=== PAIRED DELTA vs freshly-measured MiniLM (R@10, 95% bootstrap CI, 2000 replicates) ===\n');
for (const r of rows) {
  if (r.model_id === BASE) { console.log(r.model_id.padEnd(23), '  (baseline)'); continue; }
  const d = r.delta_r10_vs_minilm;
  const verdict = d.significant ? (d.delta > 0 ? 'BETTER' : 'WORSE ') : 'within noise';
  console.log(r.model_id.padEnd(23), (d.delta >= 0 ? '+' : '') + d.delta.toFixed(4), ` [${d.ci95[0].toFixed(4)}, ${d.ci95[1].toFixed(4)}]  ${verdict}`);
}
console.log('\nwritten: results/local-embedding-benchmark.json, results/local-embedding-benchmark.csv');
