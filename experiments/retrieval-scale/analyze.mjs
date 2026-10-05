#!/usr/bin/env node
// Stage breakdown for a run-offline.mjs result file.
//   node experiments/retrieval-scale/analyze.mjs <result.json> [--list] [--size 70k]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2];
const list = process.argv.includes('--list');
const sizeArg = process.argv.includes('--size') ? process.argv[process.argv.indexOf('--size') + 1] : null;
const rows = JSON.parse(fs.readFileSync(file, 'utf8')).filter((r) => r.retr !== null && (!sizeArg || r.size === sizeArg));
const Q = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(HERE, 'out/questions.json'), 'utf8')).map((q) => [q.id, q]));

export const stageOf = (r) => (r.pack ? 'OK' : !r.retrieved ? 'NOT_ROUTED' : !r.retr ? 'RETRIEVER_MISS' : !r.evid ? 'EVIDENCE_DROP' : 'PACK_DROP');
const STAGES = ['OK', 'NOT_ROUTED', 'RETRIEVER_MISS', 'EVIDENCE_DROP', 'PACK_DROP'];

console.log(`${path.basename(file)}  (${rows.length} needle questions)`);
console.log('size   ' + STAGES.map((s) => s.padStart(15)).join(''));
for (const size of [...new Set(rows.map((r) => r.size))]) {
  const xs = rows.filter((r) => r.size === size);
  console.log(size.padEnd(6) + ' ' + STAGES.map((s) => String(xs.filter((r) => stageOf(r) === s).length).padStart(15)).join(''));
}
if (list) {
  for (const r of rows.filter((x) => stageOf(x) !== 'OK')) {
    console.log(`${stageOf(r).padEnd(15)} ${r.id.padEnd(24)} rank=${r.retrRank}/${r.retrCount} ev=${r.evidCount} pk=${r.packCount} ${String(r.fallback).padEnd(24)} | ${Q[r.id]?.question}`);
  }
}
