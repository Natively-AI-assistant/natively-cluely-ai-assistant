#!/usr/bin/env node
// scripts/embedding-retrieval-bench.mjs
//
// R&D ONLY. Phase B of the bake-off: score one candidate's retrieval through
// Natively's real local embedding provider and a real sqlite-vec index.
//
// Run per model, in its own process, because NATIVELY_EMBEDDING_EXPERIMENT is
// read when LocalEmbeddingProvider is CONSTRUCTED:
//
//   NATIVELY_EMBEDDING_EXPERIMENT=arctic-s \
//   ELECTRON_RUN_AS_NODE=1 npx electron scripts/embedding-retrieval-bench.mjs
//
// ── WHAT IS REAL HERE, PRECISELY ────────────────────────────────────────────
//
// REAL: Natively's `LocalEmbeddingProvider` (the shipped class, not a copy),
// its worker-isolated ONNX inference, its embedBatch/embedQuery split, the
// model recipes from `embeddingExperiments.ts`, the chunk set produced by the
// real `semanticChunks()` at CHUNKER_VERSION 4, a real sqlite-vec `vec0` index
// created with the EXACT DDL `DatabaseManager.ensureVecTableForDim` uses
// (including `distance_metric=cosine`), the same `Float32Array` LE blob
// encoding `VectorStore.embeddingToBlob` uses, the same KNN SQL
// `VectorStore.searchSimilarNative` issues, and the real `LocalReranker`
// cross-encoder.
//
// NOT the `VectorStore` wrapper class itself. `VectorStore.storeEmbedding`
// calls `DatabaseManager.getInstance()` and its search joins `chunks` to
// `meetings` — a meeting-transcript schema that a reference-file corpus does
// not populate. Standing that singleton up outside Electron's main process
// would test the harness, not the model. The INDEX and the DISTANCE METRIC are
// production's; the wrapper is bypassed. The live-session track exercises the
// untouched wrapper end to end.
//
// The `distance_metric=cosine` detail is not cosmetic: the v30 migration
// comment in DatabaseManager records that a vec0 table created without it
// defaults to L2, and under a shared `similarity = 1 - distance` that silently
// turns a 0.25 floor into cos >= 0.719 on unit vectors.

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import Module from 'module';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = process.env.NATIVELY_EMBEDDING_EXPERIMENT || 'minilm-baseline';
const CACHE = process.env.NATIVELY_EMBEDDING_EXPERIMENT_CACHE
  || path.join(os.homedir(), 'Library', 'Application Support', 'natively', 'embedding-experiments');
const TOPK = 10;
const CANDIDATE_POOL = 50; // what the reranker is allowed to rescue from (§14)

// ── stub `electron` ─────────────────────────────────────────────────────────
// Under ELECTRON_RUN_AS_NODE, require('electron') returns a PATH STRING, so
// `app.isPackaged` inside resolveModelPath() would throw. The provider only
// ever reads isPackaged/getAppPath, both already guarded for "not ready".
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { app: { isPackaged: false, getAppPath: () => REPO } };
  return realLoad.apply(this, arguments);
};

// Every model, the MiniLM baseline included, loads from the experiment cache
// (MiniLM stopped shipping 2026-09-22; download-embedding-experiments.mjs
// fetches a byte-identical pinned copy).
process.env.NATIVELY_LOCAL_MODELS_PATH = path.join(CACHE, KEY);

const { LocalEmbeddingProvider } = await import(path.join(REPO, 'dist-electron/electron/rag/providers/LocalEmbeddingProvider.js'));
const { EMBEDDING_EXPERIMENTS } = await import(path.join(REPO, 'dist-electron/electron/rag/embeddingExperiments.js'));

// createRequire gives resolution a base path; realLoad(x, null, false) has none.
const req = Module.createRequire(path.join(REPO, 'package.json'));
const Database = req('better-sqlite3');
const sqliteVec = req('sqlite-vec');

// ── corpus snapshot, hash-asserted (§19) ────────────────────────────────────
// SNAPSHOT: an alternative chunking of the same corpus (the chunk-size sweep).
// QUERY_FILE: an alternative query set over the SAME chunks and ground truth
// (the cross-language track: translated questions, unchanged relevantChunkIds).
// OUT_TAG names the result file so neither overwrites the main run.
const snapPath = process.env.SNAPSHOT ? path.resolve(process.env.SNAPSHOT) : path.join(REPO, 'results', 'corpus-snapshot.json');
const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
const OUT_TAG = process.env.OUT_TAG || '';
const recomputed = crypto.createHash('sha256')
  .update(snap.chunks.map((c) => c.id + '\u0000' + c.text).join('\u0001')).digest('hex');
if (recomputed !== snap.chunkSetSha256) {
  throw new Error(`corpus snapshot hash mismatch: ${recomputed} != ${snap.chunkSetSha256}`);
}
if (process.env.QUERY_FILE) {
  const alt = JSON.parse(fs.readFileSync(path.resolve(process.env.QUERY_FILE), 'utf8'));
  const known = new Set(snap.chunks.map((c) => c.id));
  for (const q of alt) {
    if (!q.relevantChunkIds?.length || !q.relevantChunkIds.every((id) => known.has(id))) throw new Error(`QUERY_FILE ${q.query_id}: ground truth does not reference this snapshot's chunks`);
  }
  snap.queries = alt;
}
console.log(`[${KEY}] corpus ${snap.chunks.length} chunks, ${snap.queries.length} queries, sha256 ${snap.chunkSetSha256.slice(0, 16)} VERIFIED${OUT_TAG ? ` [${OUT_TAG}]` : ''}`);

// ── provider ────────────────────────────────────────────────────────────────
const provider = new LocalEmbeddingProvider();
const exp = EMBEDDING_EXPERIMENTS[KEY];
console.log(`[${KEY}] provider model=${provider.model} dim=${provider.dimensions} space=${provider.space}`);
if (exp && provider.dimensions !== exp.dimensions) throw new Error('provider/registry dimension disagreement');

// ── real sqlite-vec index, one DB FILE PER MODEL ────────────────────────────
// Structural isolation (§10): different models cannot share a collection even
// by accident, rather than relying on a space filter behaving correctly.
const dbDir = path.join(REPO, 'results', 'indexes');
fs.mkdirSync(dbDir, { recursive: true });
const dbFile = path.join(dbDir, `natively_refs__${KEY}__${provider.dimensions}d__v1${OUT_TAG ? `__${OUT_TAG}` : ''}.sqlite`);
fs.rmSync(dbFile, { force: true });
const db = new Database(dbFile);
let extPath = sqliteVec.getLoadablePath().replace('app.asar', 'app.asar.unpacked').replace(/\.(dylib|so|dll)$/, '');
db.loadExtension(extPath);

const DIM = provider.dimensions;
// EXACT production DDL, distance_metric=cosine included.
db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks_${DIM} USING vec0(
  chunk_id INTEGER PRIMARY KEY,
  embedding float[${DIM}] distance_metric=cosine
);`);

// Assert the native index is genuinely live. Without this, a silent drop to a
// JS fallback would make every "real vector index" claim in the report false.
let nativeVecLive = false;
try { db.prepare(`SELECT count(*) AS c FROM vec_chunks_${DIM} LIMIT 1`).get(); nativeVecLive = true; } catch (e) { nativeVecLive = false; }
if (!nativeVecLive) throw new Error(`sqlite-vec vec_chunks_${DIM} not queryable — refusing to report a fallback as a real index`);
console.log(`[${KEY}] sqlite-vec native index LIVE (vec_chunks_${DIM}, distance_metric=cosine)`);

const toBlob = (v) => { const b = Buffer.alloc(v.length * 4); for (let i = 0; i < v.length; i++) b.writeFloatLE(v[i], i * 4); return b; };

// ── index the chunks (documents → embedBatch, real prefixes applied inside) ──
const insert = db.prepare(`INSERT OR REPLACE INTO vec_chunks_${DIM}(chunk_id, embedding) VALUES (?, ?)`);
// nomic-v1.5 (768d, 2048-token context) SIGTRAPs inside ONNX Runtime partway
// through bulk indexing at batch 16 — the same native-abort signature as the
// known ephemeral batch-embed OOM. Overridable so the failure can be
// characterised as "needs a smaller batch" rather than reported as "unusable".
const BATCH = Number(process.env.EMBED_BATCH || 16);
const t0 = Date.now();
let indexed = 0;
const embedLatencies = [];
for (let i = 0; i < snap.chunks.length; i += BATCH) {
  const slice = snap.chunks.slice(i, i + BATCH);
  const tb = Date.now();
  const vecs = await provider.embedBatch(slice.map((c) => c.text));
  embedLatencies.push(Date.now() - tb);
  const tx = db.transaction(() => { slice.forEach((c, j) => { insert.run(BigInt(i + j), toBlob(vecs[j])); }); });
  tx();
  indexed += slice.length;
  if (indexed % 320 === 0) process.stdout.write(`\r[${KEY}] indexed ${indexed}/${snap.chunks.length}`);
}
const indexMs = Date.now() - t0;
process.stdout.write(`\r[${KEY}] indexed ${indexed}/${snap.chunks.length} in ${(indexMs / 1000).toFixed(1)}s (${(indexed / (indexMs / 1000)).toFixed(1)} chunks/s)\n`);

const rowCount = db.prepare(`SELECT count(*) AS c FROM vec_chunks_${DIM}`).get().c;
if (rowCount !== snap.chunks.length) throw new Error(`index holds ${rowCount} of ${snap.chunks.length} chunks — partial index, quarantining`);

// ── reranker (§14) ──────────────────────────────────────────────────────────
let reranker = null;
if (process.env.SKIP_RERANK !== '1') {
  try {
    const mod = await import(path.join(REPO, 'dist-electron/electron/rag/LocalReranker.js'));
    reranker = mod.getLocalReranker ? mod.getLocalReranker() : null;
    if (reranker) console.log(`[${KEY}] local reranker loaded: ${reranker.modelId || reranker.model || '(cross-encoder)'}`);
  } catch (e) { console.warn(`[${KEY}] reranker unavailable: ${e.message}`); }
}

// ── query ───────────────────────────────────────────────────────────────────
const knn = db.prepare(`SELECT chunk_id, distance FROM vec_chunks_${DIM} WHERE embedding MATCH ? ORDER BY distance LIMIT ?`);
const idOf = new Map(snap.chunks.map((c, i) => [i, c.id]));

const dcg = (rels) => rels.reduce((a, r, i) => a + r / Math.log2(i + 2), 0);
function metrics(rankedIds, relevant) {
  const rel = new Set(relevant);
  const hits = rankedIds.map((id) => (rel.has(id) ? 1 : 0));
  const firstHit = hits.indexOf(1);
  const ideal = Array(Math.min(rel.size, TOPK)).fill(1);
  return {
    r1: hits.slice(0, 1).includes(1) ? 1 : 0,
    r5: hits.slice(0, 5).includes(1) ? 1 : 0,
    r10: hits.slice(0, 10).includes(1) ? 1 : 0,
    mrr: firstHit === -1 ? 0 : 1 / (firstHit + 1),
    ndcg: ideal.length ? dcg(hits.slice(0, TOPK)) / dcg(ideal) : 0,
  };
}

const perQuery = [];
const qLatencies = [];
let rerankAttempted = 0, rerankSucceeded = 0;

for (const q of snap.queries) {
  const tq = Date.now();
  const qv = await provider.embedQuery(q.text);   // real query prefix applied here
  const embedMs = Date.now() - tq;
  const rows = knn.all(toBlob(qv), CANDIDATE_POOL);
  qLatencies.push(Date.now() - tq);

  const poolIds = rows.map((r) => idOf.get(Number(r.chunk_id)));
  const base = metrics(poolIds.slice(0, TOPK), q.relevantChunkIds);
  // Candidate recall over the whole pool: how much the reranker COULD rescue.
  const poolHit = poolIds.some((id) => q.relevantChunkIds.includes(id)) ? 1 : 0;

  let reranked = null;
  if (reranker && poolIds.length) {
    rerankAttempted++;
    try {
      const byId = new Map(snap.chunks.map((c) => [c.id, c.text]));
      const passages = poolIds.map((id) => byId.get(id) || '');
      const scores = await reranker.rerank(q.text, passages);
      if (scores && scores.length) {
        rerankSucceeded++;
        const order = [...scores].sort((a, b) => b.score - a.score).map((s) => poolIds[s.index]);
        reranked = metrics(order.slice(0, TOPK), q.relevantChunkIds);
      }
    } catch { /* recorded via rerankSucceeded */ }
  }

  perQuery.push({ query_id: q.query_id, track: q.track, categories: q.categories, lang: q.lang, embedMs, base, poolHit, reranked });
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const agg = (rows, pick) => ({
  n: rows.length,
  r1: +mean(rows.map((r) => pick(r)?.r1 ?? 0)).toFixed(4),
  r5: +mean(rows.map((r) => pick(r)?.r5 ?? 0)).toFixed(4),
  r10: +mean(rows.map((r) => pick(r)?.r10 ?? 0)).toFixed(4),
  mrr: +mean(rows.map((r) => pick(r)?.mrr ?? 0)).toFixed(4),
  ndcg: +mean(rows.map((r) => pick(r)?.ndcg ?? 0)).toFixed(4),
});

const byTrack = {};
for (const t of new Set(perQuery.map((r) => r.track))) {
  byTrack[t] = agg(perQuery.filter((r) => r.track === t), (r) => r.base);
}
const codeRows = perQuery.filter((r) => (r.categories || []).includes('code'));
const crossRows = perQuery.filter((r) => r.track === 'crossfile' || (r.hops || 0) > 1);

const result = {
  model_id: KEY,
  repo: exp?.repo ?? 'bundled',
  revision: exp?.revision ?? 'bundled',
  license: exp?.license ?? 'apache-2.0',
  dimensions: DIM,
  pooling: exp?.pooling ?? 'mean',
  query_prefix: exp?.queryPrefix ?? '',
  document_prefix: exp?.documentPrefix ?? '',
  space: provider.space,
  runtime: 'transformers.js 3.8.1 / onnxruntime-node (worker_threads)',
  quantization: exp?.dtype ?? 'q8',
  index: { file: path.basename(dbFile), backend: 'sqlite-vec vec0', distance_metric: 'cosine', rows: rowCount, native: nativeVecLive },
  corpus: { chunks: snap.chunks.length, queries: snap.queries.length, sha256: snap.chunkSetSha256, chunkerVersion: snap.chunkerVersion },
  indexing: { totalMs: indexMs, chunksPerSec: +(indexed / (indexMs / 1000)).toFixed(2), batchP50Ms: pct(embedLatencies, 0.5), batchP95Ms: pct(embedLatencies, 0.95) },
  query_latency: { p50Ms: pct(qLatencies, 0.5), p95Ms: pct(qLatencies, 0.95) },
  memory_peak_rss_mb: +(process.memoryUsage().rss / 1024 / 1024).toFixed(1),
  overall: agg(perQuery, (r) => r.base),
  candidate_recall_at_pool: +mean(perQuery.map((r) => r.poolHit)).toFixed(4),
  reranked: rerankSucceeded ? agg(perQuery.filter((r) => r.reranked), (r) => r.reranked) : null,
  rerank: { attempted: rerankAttempted, succeeded: rerankSucceeded, poolSize: CANDIDATE_POOL },
  by_track: byTrack,
  code_r10: codeRows.length ? agg(codeRows, (r) => r.base).r10 : null,
  cross_project_r10: crossRows.length ? agg(crossRows, (r) => r.base).r10 : null,
  perQuery,
};

const outDir = path.join(REPO, 'results', 'raw-retrieval');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${KEY}${OUT_TAG ? `__${OUT_TAG}` : ''}.json`), JSON.stringify(result, null, 1));

console.log(`\n[${KEY}] R@1=${result.overall.r1} R@5=${result.overall.r5} R@10=${result.overall.r10} MRR=${result.overall.mrr} nDCG@10=${result.overall.ndcg}`);
console.log(`[${KEY}] pool(${CANDIDATE_POOL}) candidate recall=${result.candidate_recall_at_pool}`);
if (result.reranked) console.log(`[${KEY}] reranked  R@1=${result.reranked.r1} R@5=${result.reranked.r5} R@10=${result.reranked.r10}`);
console.log(`[${KEY}] query p50=${result.query_latency.p50Ms}ms p95=${result.query_latency.p95Ms}ms | index ${result.indexing.chunksPerSec} chunks/s`);

await provider.dispose?.('benchmark complete');
db.close();
process.exit(0);
