#!/usr/bin/env node
// scripts/embedding-crossfile-bench.mjs
//
// R&D ONLY. The cross-file / multi-hop track (§13), scored separately because
// it needs a different ground truth from the rest of the benchmark.
//
// WHY SEPARATE. The corpus's 75 `crossfile` queries carry `target_facts: []`.
// They are not scored against fact spans at all — the original harness scores
// them on REQUIRED-FILE RECALL: the answer spans two to four files and the
// question is whether retrieval surfaces all of them. Feeding them through the
// fact-based scorer silently dropped all 75, which is why `cross_project_R@10`
// came back null on the first pass.
//
// This reuses the per-model sqlite-vec indexes already built by
// embedding-retrieval-bench.mjs, so only the 75 queries are embedded — nothing
// is re-indexed, and the vectors being searched are byte-identical to the ones
// that produced the main table.
//
// Metrics:
//   anyFile@K  — at least one required file retrieved (a weak floor)
//   allFiles@K — EVERY required file retrieved (the real multi-hop test)
//   fileRecall@K — mean fraction of required files retrieved

import fs from 'fs';
import path from 'path';
import os from 'os';
import Module from 'module';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = process.env.NATIVELY_EMBEDDING_EXPERIMENT || 'minilm-baseline';
const CACHE = process.env.NATIVELY_EMBEDDING_EXPERIMENT_CACHE
  || path.join(os.homedir(), 'Library', 'Application Support', 'natively', 'embedding-experiments');

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
const chunkFileByIdx = snap.chunks.map((c) => c.file);

const queries = fs.readFileSync(path.join(REPO, 'embedding-benchmark/queries/queries.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l))
  .filter((q) => q.track === 'crossfile' && (q.required_files || []).length > 0)
  // Only files that actually made it into the chunk set can ever be retrieved.
  .map((q) => ({ ...q, required_files: q.required_files.filter((f) => chunkFileByIdx.includes(f)) }))
  .filter((q) => q.required_files.length > 0);

const provider = new LocalEmbeddingProvider();
const DIM = provider.dimensions;
const dbFile = path.join(REPO, 'results', 'indexes', `natively_refs__${KEY}__${DIM}d__v1.sqlite`);
if (!fs.existsSync(dbFile)) throw new Error(`no index for ${KEY} — run embedding-retrieval-bench.mjs first`);
const db = new Database(dbFile, { readonly: true });
db.loadExtension(sqliteVec.getLoadablePath().replace('app.asar', 'app.asar.unpacked').replace(/\.(dylib|so|dll)$/, ''));

const rows = db.prepare(`SELECT count(*) AS c FROM vec_chunks_${DIM}`).get();
if (rows.c !== snap.chunks.length) throw new Error(`index holds ${rows.c} of ${snap.chunks.length} chunks`);

const toBlob = (v) => { const b = Buffer.alloc(v.length * 4); for (let i = 0; i < v.length; i++) b.writeFloatLE(v[i], i * 4); return b; };
const knn = db.prepare(`SELECT chunk_id FROM vec_chunks_${DIM} WHERE embedding MATCH ? ORDER BY distance LIMIT ?`);

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const out = { model_id: KEY, dimensions: DIM, index: path.basename(dbFile), n: queries.length, perK: {} };

for (const K of [10, 20, 50]) {
  const any = [], all = [], frac = [];
  for (const q of queries) {
    const qv = await provider.embedQuery(q.text);
    const files = new Set(knn.all(toBlob(qv), K).map((r) => chunkFileByIdx[Number(r.chunk_id)]));
    const hit = q.required_files.filter((f) => files.has(f)).length;
    any.push(hit > 0 ? 1 : 0);
    all.push(hit === q.required_files.length ? 1 : 0);
    frac.push(hit / q.required_files.length);
  }
  out.perK[K] = {
    anyFile: +mean(any).toFixed(4),
    allFiles: +mean(all).toFixed(4),
    fileRecall: +mean(frac).toFixed(4),
  };
}

const dir = path.join(REPO, 'results', 'crossfile');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${KEY}.json`), JSON.stringify(out, null, 2));
console.log(`${KEY.padEnd(23)} n=${out.n}  ` +
  [10, 20, 50].map((K) => `@${K}: any=${out.perK[K].anyFile} all=${out.perK[K].allFiles} rec=${out.perK[K].fileRecall}`).join('  '));

await provider.dispose?.('crossfile bench complete');
db.close();
process.exit(0);
