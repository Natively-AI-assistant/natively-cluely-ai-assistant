#!/usr/bin/env node
// scripts/intent-benchmark/restore.mjs
//
// Candidate P: fill `input_punctuated` on every corpus row, so each provider can
// be scored with AND without restoration, as the campaign brief requires.
//
// The model runs in its own worker. The decoder is the production module
// (electron/llm/punctuationRestoration.ts, compiled), not a copy, so the
// benchmark measures the code that would ship.
//
// A restoration that changes the WORDS is rejected and the row keeps its raw
// text. That is not defensive padding: a token-classification decoder that
// mishandles WordPiece subwords silently drops or mangles words, and nothing
// downstream would notice, because the output still reads like English.
//
// Usage:
//   node scripts/intent-benchmark/restore.mjs --in dataset/v1.jsonl

import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseJsonl } from './lib/schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i > -1 && args[i + 1] ? args[i + 1] : d; };
const IN = path.resolve(__dirname, val('--in', 'dataset/v1.jsonl'));
const OUT = path.resolve(__dirname, val('--out', val('--in', 'dataset/v1.jsonl')));
const LIMIT = Number(val('--limit', '0'));

const { restoreFromLabels, isFaithfulRestoration } = await import(
  pathToFileURL(path.join(repoRoot, 'dist-electron/electron/llm/punctuationRestoration.js')).href
);

const worker = new Worker(path.join(__dirname, 'lib/restoreWorker.mjs'), {
  workerData: {
    modelPath: path.join(repoRoot, 'resources/models'),
    modelId: 'natively/punctuation-restore',
  },
});

let nextId = 1;
const pending = new Map();
worker.on('message', (m) => {
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  if (m.type === 'error') p.reject(new Error(m.error)); else p.resolve(m);
});
worker.on('error', (e) => { for (const p of pending.values()) p.reject(e); pending.clear(); });

const ask = (msg) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  worker.postMessage({ ...msg, id });
});

const t0 = Date.now();
await ask({ type: 'init' });
console.log(`model loaded in ${Date.now() - t0}ms`);

const { rows } = parseJsonl(fs.readFileSync(IN, 'utf8'));
const target = LIMIT > 0 ? rows.slice(0, LIMIT) : rows;

const stats = { restored: 0, unfaithful: 0, unchanged: 0, failed: 0 };
const latencies = [];
let done = 0;

for (const row of target) {
  try {
    const res = await ask({ type: 'restore', text: row.input });
    latencies.push(res.ms);
    const { text } = restoreFromLabels(res.tokens);
    if (!text) { stats.failed++; continue; }
    if (!isFaithfulRestoration(row.input, text)) {
      // The model changed the words, not just the marks. Keep the raw text.
      stats.unfaithful++;
      continue;
    }
    if (text === row.input) stats.unchanged++;
    else stats.restored++;
    row.input_punctuated = text;
  } catch {
    stats.failed++;
  }
  if (++done % 200 === 0) process.stdout.write(`  ${done}/${target.length}\r`);
}

fs.writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
await worker.terminate();

const sorted = latencies.sort((a, b) => a - b);
const pct = (p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)].toFixed(1) : 'n/a';
console.log(`\nrestored      ${stats.restored}`);
console.log(`unchanged     ${stats.unchanged}   (model proposed nothing)`);
console.log(`REJECTED      ${stats.unfaithful}   (restoration changed the words, raw text kept)`);
console.log(`failed        ${stats.failed}`);
console.log(`latency       p50 ${pct(50)}ms  p95 ${pct(95)}ms  (inside the worker)`);
