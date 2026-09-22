#!/usr/bin/env node
// scripts/embedding-slicing-negative-control.mjs
//
// Proves the `batchEqualsSingle` guard in embedding-experiment-sanity.mjs is
// not vacuous.
//
// The guard exists to catch ONE specific defect: localEmbeddingWorker.ts used
// to slice its output tensor at a hardcoded `DIMENSIONS = 384` regardless of
// the model's real width. Against a 768d model that hands batch item i the
// bytes belonging to item i/2 — finite, plausibly-shaped, and wrong.
//
// A guard whose threshold was merely tuned until the suite went green proves
// nothing. So this script reconstructs what the OLD code would have returned,
// from the SAME real tensor the fixed code produced, and reports the cosine the
// guard would have seen. The reconstruction is exact: the worker's output data
// is the concatenation of the correct per-item vectors, which is precisely the
// buffer the old 384-stride loop indexed into.
//
// Expected: correct-vs-correct ~1.0, correct-vs-old-slicing far below any
// sane threshold — demonstrating the guard separates the two by a wide margin.

import { Worker } from 'worker_threads';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = path.join(REPO, 'dist-electron/electron/rag/providers/localEmbeddingWorker.js');
const CACHE = process.env.NATIVELY_EMBEDDING_EXPERIMENT_CACHE
  || path.join(os.homedir(), 'Library', 'Application Support', 'natively', 'embedding-experiments');

const KEY = 'arctic-m';
const MODEL_ID = 'Snowflake/snowflake-arctic-embed-m';
const REAL_WIDTH = 768;
const OLD_HARDCODED_WIDTH = 384;

const norm = (v) => Math.sqrt(v.reduce((a, x) => a + x * x, 0));
const cos = (a, b) => {
  const n = Math.min(a.length, b.length);
  let s = 0; for (let i = 0; i < n; i++) s += a[i] * b[i];
  const d = norm(a.slice(0, n)) * norm(b.slice(0, n));
  return d === 0 ? 0 : s / d;
};

const w = new Worker(WORKER);
let id = 0; const pending = new Map();
w.on('message', (m) => {
  if (m.type === 'status') return;
  const p = pending.get(m.requestId); if (!p) return;
  pending.delete(m.requestId);
  m.type === 'error' ? p.reject(new Error(m.error)) : p.resolve(m);
});
const post = (msg) => new Promise((res, rej) => { msg.requestId = ++id; pending.set(id, { resolve: res, reject: rej }); w.postMessage(msg); });

// `hfModelId` is the id the worker loads (protocol since the PR #582 merge).
const init = { type: 'init', modelPath: path.join(CACHE, KEY), modelId: MODEL_ID, hfModelId: MODEL_ID, dtype: 'q8', pooling: 'cls', runtime: 'onnx' };
await post(init);

const texts = [
  'The reconciler revokes premium access when the billing period elapses.',
  'Postgres connection pooling is configured with a maximum of twenty sockets.',
  'Webhook signatures are verified against the endpoint secret before parsing.',
  'The dashboard renders a sparkline of daily active seats per tenant.',
];

const batched = await post({ ...init, type: 'embed', texts });
const correct = batched.vectors;
console.log(`model=${MODEL_ID}  reported width=${batched.dimensions}  vectors=${correct.length}x${correct[0].length}`);
if (batched.dimensions !== REAL_WIDTH) { console.error(`unexpected width ${batched.dimensions}`); process.exit(1); }

// Exactly the buffer the old loop indexed into.
const flat = correct.flat();
const oldSlicing = texts.map((_, i) => flat.slice(i * OLD_HARDCODED_WIDTH, (i + 1) * OLD_HARDCODED_WIDTH));

console.log('\nWhat the OLD hardcoded-384 slice would have returned, vs the correct vector:');
console.log('item  len  cos(old_i, correct_i)   verdict');
let worst = 1;
for (let i = 0; i < texts.length; i++) {
  const c = cos(oldSlicing[i], correct[i]);
  worst = Math.min(worst, c);
  console.log(`  ${i}   ${String(oldSlicing[i].length).padEnd(4)} ${c.toFixed(6).padStart(12)}        ${c > 0.95 ? 'would PASS a 0.95 guard' : 'CAUGHT'}`);
}

// Single-embed each text and compare against the correct batched vector: this
// is the real guard's measurement, and its spread is padding + q8 noise only.
let worstReal = 1;
for (let i = 0; i < texts.length; i++) {
  const single = (await post({ ...init, type: 'embed', texts: [texts[i]] })).vectors[0];
  worstReal = Math.min(worstReal, cos(single, correct[i]));
}

console.log(`\nworst cosine, OLD slicing vs correct : ${worst.toFixed(6)}`);
console.log(`worst cosine, batch vs single (real) : ${worstReal.toFixed(6)}`);
console.log(`separation                           : ${(worstReal - worst).toFixed(6)}`);
console.log(
  worst < 0.95 && worstReal > 0.95
    ? '\nGUARD IS MEANINGFUL: a 0.95 threshold rejects the defect and accepts real quantization/padding noise.'
    : '\nGUARD IS NOT MEANINGFUL at 0.95 — do not rely on it.',
);
await w.terminate();
