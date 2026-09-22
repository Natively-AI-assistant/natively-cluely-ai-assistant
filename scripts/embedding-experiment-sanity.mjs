#!/usr/bin/env node
// scripts/embedding-experiment-sanity.mjs
//
// R&D ONLY. Section 8 of the bake-off: prove each candidate loads and behaves
// in THE EXACT RUNTIME NATIVELY USES before any retrieval number is believed.
//
// It drives `dist-electron/electron/rag/providers/localEmbeddingWorker.js` —
// the real compiled worker, over the real worker_threads message protocol, with
// the same dtype/pooling/session-options path production takes. It is
// deliberately NOT a reimplementation: a hand-rolled transformers.js script
// proves nothing about whether Natively can load the model.
//
// Must run under Electron's node (ELECTRON_RUN_AS_NODE=1 electron ...) so the
// ONNX Runtime ABI matches the one the app links against.
//
// Checks per model: correct dimension, no NaN/Inf, unit-norm, determinism
// across repeated calls, batch-vs-single equivalence (the slicing bug this
// benchmark exists to avoid), query/document prefixes producing DIFFERENT
// vectors for asymmetric models, long-input truncation, unload/reload.
// Measures: cold load, cold first inference, warm p50/p95, throughput, peak RSS.

import { Worker } from 'worker_threads';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = path.join(REPO, 'dist-electron/electron/rag/providers/localEmbeddingWorker.js');
const CACHE = process.env.NATIVELY_EMBEDDING_EXPERIMENT_CACHE
  || path.join(os.homedir(), 'Library', 'Application Support', 'natively', 'embedding-experiments');

// Recipes come from the COMPILED REGISTRY, never a copy.
//
// This script used to carry its own hardcoded map, which is a drift hazard with
// teeth: adding a model to embeddingExperiments.ts without also editing here
// made the sanity run crash on an undefined recipe — or, worse, could have
// tested a model under a stale pooling/prefix and reported a PASS. Reading the
// single source of truth removes the class of bug entirely.
const { EMBEDDING_EXPERIMENTS } = await import(path.join(REPO, 'dist-electron/electron/rag/embeddingExperiments.js'));
const RECIPES = Object.fromEntries(Object.entries(EMBEDDING_EXPERIMENTS).map(([k, e]) => [
  k,
  { modelId: e.modelId, dim: e.dimensions, pooling: e.pooling, q: e.queryPrefix, d: e.documentPrefix },
]));

function modelRoot(key) {
  // The baseline loads from the SHIPPED bundle, never from the experiment
  // cache — the incumbent must be measured as the app actually ships it.
  return path.join(CACHE, key);
}

class WorkerClient {
  constructor() { this.w = new Worker(WORKER); this.id = 0; this.pending = new Map(); this.status = [];
    this.w.on('message', (m) => {
      if (m.type === 'status') { this.status.push(m.status); return; }
      const p = this.pending.get(m.requestId); if (!p) return;
      this.pending.delete(m.requestId);
      m.type === 'error' ? p.reject(new Error(m.error)) : p.resolve(m);
    });
    this.w.on('error', (e) => { for (const p of this.pending.values()) p.reject(e); this.pending.clear(); });
  }
  post(msg, timeoutMs = 180000) {
    const id = ++this.id; msg.requestId = id;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout after ${timeoutMs}ms`)); }, timeoutMs);
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
      this.w.postMessage(msg);
    });
  }
  close() { return this.w.terminate(); }
}

const norm = (v) => Math.sqrt(v.reduce((a, x) => a + x * x, 0));
const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0) / (norm(a) * norm(b));
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

const SHORT = 'How does the billing service revoke a premium entitlement?';
const PARA = 'The subscription reconciler runs every fifteen minutes. It walks every account whose plan is flagged cancel_at_period_end, compares the stored period end against the current time, and when the period has elapsed it writes a revocation record and clears the cached entitlement set. Downstream permission checks read that cache, so an account loses premium access on the next request rather than immediately.';
const LONG = PARA.repeat(12);

async function run(key) {
  const r = RECIPES[key];
  const root = modelRoot(key);
  const out = { key, modelId: r.modelId, expectedDim: r.dim, pooling: r.pooling, modelRoot: root, checks: {}, failures: [] };
  const fail = (n, m) => { out.failures.push(`${n}: ${m}`); out.checks[n] = 'FAIL'; };
  const pass = (n) => { out.checks[n] = 'PASS'; };

  if (!fs.existsSync(path.join(root, ...r.modelId.split('/'), 'tokenizer.json'))) {
    out.status = 'BLOCKED'; out.blocked = `no tokenizer.json under ${root}`; return out;
  }

  const rssBefore = process.memoryUsage().rss;
  let c = new WorkerClient();
  const init = { type: 'init', modelPath: root, modelId: r.modelId, dtype: 'q8', pooling: r.pooling };

  try {
    const t0 = Date.now();
    await c.post(init);
    out.loadTimeMs = Date.now() - t0;
  } catch (e) {
    out.status = 'BLOCKED'; out.blocked = `RUNTIME FAILURE on load: ${e.message}`;
    await c.close(); return out;
  }

  const embed = async (texts) => (await c.post({ ...init, type: 'embed', texts }));

  // cold first inference
  const t1 = Date.now();
  let first;
  try { first = await embed([r.d + PARA]); } catch (e) {
    out.status = 'BLOCKED'; out.blocked = `RUNTIME FAILURE on first inference: ${e.message}`;
    await c.close(); return out;
  }
  out.coldFirstInferenceMs = Date.now() - t1;

  // --- dimension, reported and actual ---
  const v = first.vectors[0];
  out.actualDim = v.length;
  out.reportedDim = first.dimensions;
  if (v.length !== r.dim) fail('dimension', `expected ${r.dim}, got ${v.length}`); else pass('dimension');
  if (first.dimensions !== v.length) fail('dimensionReport', `worker reported ${first.dimensions}, vector is ${v.length}`); else pass('dimensionReport');

  // --- finite values ---
  if (v.some((x) => !Number.isFinite(x))) fail('finite', 'NaN or Inf present'); else pass('finite');

  // --- normalization ---
  out.l2Norm = Number(norm(v).toFixed(6));
  Math.abs(out.l2Norm - 1) < 1e-3 ? pass('normalized') : fail('normalized', `L2=${out.l2Norm}`);

  // --- determinism ---
  const again = await embed([r.d + PARA]);
  const dmax = Math.max(...v.map((x, i) => Math.abs(x - again.vectors[0][i])));
  out.determinismMaxAbsDelta = dmax;
  dmax === 0 ? pass('deterministic') : fail('deterministic', `max |Δ| = ${dmax}`);

  // --- BATCH vs SINGLE: the slicing bug this whole benchmark depends on ---
  // A 768d model through the old hardcoded-384 slice returns, for item 1, the
  // SECOND HALF of item 0's vector. Comparing a 16-item batch against the same
  // texts embedded one at a time is what catches that.
  //
  // THRESHOLD = 0.95, set from a measured negative control, not from tuning
  // until the suite went green. scripts/embedding-slicing-negative-control.mjs
  // reconstructs what the old 384-stride loop would have returned from the same
  // real arctic-m tensor and measures both sides:
  //
  //   old slicing vs correct   : -0.046, -0.015, 0.584, 1.000  (worst -0.046)
  //   batch vs single (real)   : worst 0.9947
  //
  // i.e. the defect and the noise are separated by ~1.04 of cosine, and 0.95
  // sits in the empty gap. The earlier 0.999 was below real q8 + batch-padding
  // noise and failed the BASELINE MiniLM at 0.989, which is a broken test, not
  // a broken model.
  //
  // Note from that control: item 0 scored 1.000 even when broken, because the
  // first 384 floats of item 0 ARE its own. Any check that looks only at the
  // first vector of a batch cannot see this defect — hence the full sweep.
  const BATCH_EQUIV_MIN_COSINE = 0.95;
  const batchTexts = Array.from({ length: 16 }, (_, i) => `${r.d}chunk ${i}: ${PARA.slice(i * 7, i * 7 + 220)}`);
  const batched = await embed(batchTexts);
  let worstBatchCos = 1;
  for (let i = 0; i < batchTexts.length; i++) {
    const single = (await embed([batchTexts[i]])).vectors[0];
    worstBatchCos = Math.min(worstBatchCos, cos(batched.vectors[i], single));
  }
  out.batchVsSingleWorstCosine = Number(worstBatchCos.toFixed(6));
  worstBatchCos > BATCH_EQUIV_MIN_COSINE ? pass('batchEqualsSingle')
    : fail('batchEqualsSingle', `worst cosine ${worstBatchCos.toFixed(4)} < ${BATCH_EQUIV_MIN_COSINE}`);

  // --- batch shape ---
  batched.vectors.length === 16 && batched.vectors.every((x) => x.length === r.dim)
    ? pass('batchShape') : fail('batchShape', 'wrong count or width');

  // --- asymmetry: prefixes must actually change the vector ---
  if (r.q || r.d) {
    const asQuery = (await embed([r.q + SHORT])).vectors[0];
    const asDoc = (await embed([r.d + SHORT])).vectors[0];
    out.queryVsDocCosine = Number(cos(asQuery, asDoc).toFixed(6));
    out.queryVsDocCosine < 0.9999 ? pass('prefixChangesVector')
      : fail('prefixChangesVector', `cosine ${out.queryVsDocCosine} — prefix had no effect`);
  } else {
    out.checks.prefixChangesVector = 'N/A (symmetric model)';
  }

  // --- long input (model truncates rather than throwing) ---
  try {
    const lv = (await embed([r.d + LONG])).vectors[0];
    lv.length === r.dim && lv.every(Number.isFinite) ? pass('longInput') : fail('longInput', 'bad vector');
    out.longInputChars = LONG.length;
  } catch (e) { fail('longInput', e.message); }

  // --- latency: warm single-text (query latency the user feels) ---
  const warm = [];
  for (let i = 0; i < 25; i++) { const s = Date.now(); await embed([r.q + SHORT + ' ' + i]); warm.push(Date.now() - s); }
  out.querySingleP50Ms = pct(warm, 0.5);
  out.querySingleP95Ms = pct(warm, 0.95);

  // --- throughput: batched indexing (NOT the same as query latency) ---
  const chunks = Array.from({ length: 128 }, (_, i) => `${r.d}${PARA} variant ${i}`);
  const tB = Date.now();
  for (let i = 0; i < chunks.length; i += 16) await embed(chunks.slice(i, i + 16));
  const elapsed = (Date.now() - tB) / 1000;
  out.indexChunksPerSec = Number((chunks.length / elapsed).toFixed(1));
  out.index128ChunksMs = Math.round(elapsed * 1000);

  out.peakRssDeltaMB = Number(((process.memoryUsage().rss - rssBefore) / 1024 / 1024).toFixed(1));

  // --- unload / reload ---
  await c.close();
  try {
    c = new WorkerClient();
    const t2 = Date.now();
    await c.post(init);
    out.reloadTimeMs = Date.now() - t2;
    const rv = (await c.post({ ...init, type: 'embed', texts: [r.d + PARA] })).vectors[0];
    cos(rv, v) > 0.999 ? pass('reload') : fail('reload', 'vector changed after reload');
    await c.close();
  } catch (e) { fail('reload', e.message); }

  out.status = out.failures.length ? 'FAIL' : 'PASS';
  return out;
}

const keys = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(RECIPES);
const all = [];
for (const k of keys) {
  process.stdout.write(`\n--- ${k} ---\n`);
  let res;
  try { res = await run(k); } catch (e) { res = { key: k, status: 'BLOCKED', blocked: e.message, failures: [e.message] }; }
  all.push(res);
  console.log(JSON.stringify(res, null, 1));
}

const outDir = path.join(REPO, 'results');
fs.mkdirSync(outDir, { recursive: true });
// MERGE by model key: a partial run must not erase other models' results
// (a full-file overwrite once lost the multilingual-e5-small memory figure).
const sanityFile = path.join(outDir, 'local-embedding-sanity.json');
let prior = [];
try { prior = JSON.parse(fs.readFileSync(sanityFile, 'utf8')); } catch { /* first run */ }
const merged = new Map(prior.map((r) => [r.key, r]));
for (const r of all) merged.set(r.key, r);
fs.writeFileSync(sanityFile, JSON.stringify([...merged.values()], null, 2));

console.log('\n================ SANITY SUMMARY ================');
console.log('model'.padEnd(23), 'st'.padEnd(8), 'dim'.padEnd(5), 'load'.padEnd(7), 'p50'.padEnd(6), 'p95'.padEnd(6), 'chunk/s'.padEnd(8), 'batch≡single');
for (const r of all) {
  console.log(
    r.key.padEnd(23),
    String(r.status).padEnd(8),
    String(r.actualDim ?? '-').padEnd(5),
    String(r.loadTimeMs ?? '-').padEnd(7),
    String(r.querySingleP50Ms ?? '-').padEnd(6),
    String(r.querySingleP95Ms ?? '-').padEnd(6),
    String(r.indexChunksPerSec ?? '-').padEnd(8),
    String(r.batchVsSingleWorstCosine ?? '-'),
  );
  for (const f of r.failures || []) console.log('   !!', f);
  if (r.blocked) console.log('   !!', r.blocked);
}
