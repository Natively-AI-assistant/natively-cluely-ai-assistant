#!/usr/bin/env node
// scripts/embedding-rerank-bench.mjs
//
// R&D ONLY. §14: how much Natively's real local cross-encoder recovers on top
// of each embedding candidate, and — the question §14 actually cares about —
// whether a model with mediocre top-1 but strong pool recall is still a good
// choice for Natively.
//
// Reuses the per-model sqlite-vec index already on disk, so nothing is
// re-embedded at the document side. Only the queries are embedded.
//
// The reranker is the REAL bundled one: `getLocalReranker()` →
// Xenova/ms-marco-MiniLM-L-6-v2 q8. (NOT `models/Xenova/bge-reranker-base` at
// the repo root — download-models.js records that bge was removed entirely on
// 2026-09-04 and ms-marco replaced it; that directory is stale leftover.)
//
// QUERY SUBSET. A full 503-query × 50-passage rerank costs ~35 minutes PER
// MODEL on this machine. RERANK_QUERIES takes a deterministic evenly-spaced
// sample so every model reranks THE SAME queries, which is what makes the
// per-model gains comparable. The dense-only numbers in the main table remain
// full-corpus; only this track is sampled, and it is labelled as such.

import fs from 'fs';
import path from 'path';
import os from 'os';
import Module from 'module';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = process.env.NATIVELY_EMBEDDING_EXPERIMENT || 'minilm-baseline';
const CACHE = process.env.NATIVELY_EMBEDDING_EXPERIMENT_CACHE
  || path.join(os.homedir(), 'Library', 'Application Support', 'natively', 'embedding-experiments');
const N_QUERIES = Number(process.env.RERANK_QUERIES || 120);
const POOL = Number(process.env.RERANK_POOL || 50);
const TOPK = 10;

const realLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return { app: { isPackaged: false, getAppPath: () => REPO, getPath: () => os.tmpdir() } };
  return realLoad.apply(this, arguments);
};
process.env.NATIVELY_LOCAL_MODELS_PATH =
  path.join(CACHE, KEY);

const { LocalEmbeddingProvider } = await import(path.join(REPO, 'dist-electron/electron/rag/providers/LocalEmbeddingProvider.js'));
const req = Module.createRequire(path.join(REPO, 'package.json'));
const Database = req('better-sqlite3');
const sqliteVec = req('sqlite-vec');

const snap = JSON.parse(fs.readFileSync(path.join(REPO, 'results', 'corpus-snapshot.json'), 'utf8'));
const textByIdx = snap.chunks.map((c) => c.text);
const idByIdx = snap.chunks.map((c) => c.id);

// Deterministic evenly-spaced sample — identical for every model.
const step = Math.max(1, Math.floor(snap.queries.length / N_QUERIES));
const queries = snap.queries.filter((_, i) => i % step === 0).slice(0, N_QUERIES);

const provider = new LocalEmbeddingProvider();
const DIM = provider.dimensions;
const dbFile = path.join(REPO, 'results', 'indexes', `natively_refs__${KEY}__${DIM}d__v1.sqlite`);
if (!fs.existsSync(dbFile)) throw new Error(`no index for ${KEY}`);
const db = new Database(dbFile, { readonly: true });
db.loadExtension(sqliteVec.getLoadablePath().replace('app.asar', 'app.asar.unpacked').replace(/\.(dylib|so|dll)$/, ''));

const { getLocalReranker } = await import(path.join(REPO, 'dist-electron/electron/rag/LocalReranker.js'));
const reranker = getLocalReranker();

const toBlob = (v) => { const b = Buffer.alloc(v.length * 4); for (let i = 0; i < v.length; i++) b.writeFloatLE(v[i], i * 4); return b; };
const knn = db.prepare(`SELECT chunk_id FROM vec_chunks_${DIM} WHERE embedding MATCH ? ORDER BY distance LIMIT ?`);

const dcg = (r) => r.reduce((a, x, i) => a + x / Math.log2(i + 2), 0);
function met(ranked, rel) {
  const s = new Set(rel);
  const h = ranked.map((id) => (s.has(id) ? 1 : 0));
  const f = h.indexOf(1);
  const ideal = Array(Math.min(s.size, TOPK)).fill(1);
  return { r1: h[0] || 0, r5: h.slice(0, 5).includes(1) ? 1 : 0, r10: h.slice(0, 10).includes(1) ? 1 : 0,
    mrr: f === -1 ? 0 : 1 / (f + 1), ndcg: ideal.length ? dcg(h.slice(0, TOPK)) / dcg(ideal) : 0 };
}

const base = [], post = [];
let rescued = 0, lost = 0, unrecoverable = 0, rerankFailures = 0;
const rerankMs = [];

for (const q of queries) {
  const qv = await provider.embedQuery(q.text);
  const pool = knn.all(toBlob(qv), POOL).map((r) => idByIdx[Number(r.chunk_id)]);
  const poolIdx = knn.all(toBlob(qv), POOL).map((r) => Number(r.chunk_id));
  const b = met(pool.slice(0, TOPK), q.relevantChunkIds);
  base.push(b);

  // The embedding failed so badly the reranker CANNOT recover: nothing relevant
  // anywhere in the pool. This is the number that separates "mediocre top-1 but
  // useful" from "actually unusable".
  const inPool = pool.some((id) => q.relevantChunkIds.includes(id));
  if (!inPool) unrecoverable++;

  const t0 = Date.now();
  let scores = null;
  try { scores = await reranker.rerank(q.text, poolIdx.map((i) => textByIdx[i])); } catch { /* counted below */ }
  rerankMs.push(Date.now() - t0);
  if (!scores || !scores.length) { rerankFailures++; post.push(b); continue; }

  const order = [...scores].sort((x, y) => y.score - x.score).map((s) => pool[s.index]);
  const p = met(order.slice(0, TOPK), q.relevantChunkIds);
  post.push(p);
  if (!b.r10 && p.r10) rescued++;
  if (b.r10 && !p.r10) lost++;
}

const mean = (xs) => xs.reduce((a, b2) => a + b2, 0) / xs.length;
const agg = (rows) => ({
  r1: +mean(rows.map((r) => r.r1)).toFixed(4), r5: +mean(rows.map((r) => r.r5)).toFixed(4),
  r10: +mean(rows.map((r) => r.r10)).toFixed(4), mrr: +mean(rows.map((r) => r.mrr)).toFixed(4),
  ndcg: +mean(rows.map((r) => r.ndcg)).toFixed(4),
});
const pct = (xs, p) => { const s = [...xs].sort((a, b2) => a - b2); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

const B = agg(base), P = agg(post);
const out = {
  model_id: KEY, reranker: 'Xenova/ms-marco-MiniLM-L-6-v2 (q8, bundled)',
  n_queries: queries.length, pool: POOL, sampled: true,
  embedding_only: B, reranked: P,
  gain: { r1: +(P.r1 - B.r1).toFixed(4), r5: +(P.r5 - B.r5).toFixed(4), r10: +(P.r10 - B.r10).toFixed(4), mrr: +(P.mrr - B.mrr).toFixed(4) },
  rescued_queries: rescued, lost_queries: lost,
  unrecoverable_queries: unrecoverable,
  unrecoverable_rate: +(unrecoverable / queries.length).toFixed(4),
  rerank_failures: rerankFailures,
  rerank_latency_p50_ms: pct(rerankMs, 0.5), rerank_latency_p95_ms: pct(rerankMs, 0.95),
};

const dir = path.join(REPO, 'results', 'rerank');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${KEY}.json`), JSON.stringify(out, null, 2));

console.log(`${KEY.padEnd(23)} n=${out.n_queries} | dense R@10=${B.r10} → reranked ${P.r10} (${out.gain.r10 >= 0 ? '+' : ''}${out.gain.r10}) | rescued ${rescued} lost ${lost} | unrecoverable ${unrecoverable} (${(out.unrecoverable_rate * 100).toFixed(1)}%) | rerank p50 ${out.rerank_latency_p50_ms}ms`);

await provider.dispose?.('rerank bench complete');
db.close();
process.exit(0);
