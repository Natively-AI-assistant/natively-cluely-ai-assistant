#!/usr/bin/env node
// scripts/embedding-chunk-sweep-analyse.mjs
//
// Chunk-size sweep: the same 503 questions against three chunkings of the same
// corpus (target 200 / production 350 / 600 tokens; embedding-corpus-prepare.mjs
// with CHUNK_OPTIONS). Each chunking has its own chunk-level ground truth,
// derived by the same rules, so a question's R@k is comparable across
// chunkings and the deltas are paired per question (2000 bootstrap replicates,
// fixed seed). Production (350) is the reference.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(REPO, 'results', 'raw-retrieval');
const MODELS = (process.env.MODELS || 'multilingual-e5-small,minilm-baseline').split(',');
// The production reference is a dedicated reranked run (`__chunk-t350`). The
// round-1 result file for the same chunking has NO reranked metrics, and using
// it made every reranked delta compare against zero ("+0.44 better").
const VARIANTS = [['t200', '__chunk-t200'], ['t350 (production)', '__chunk-t350'], ['t600', '__chunk-t600']];

let seed = 0x2545f491;
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
function paired(a, b, fn, filter = () => true) {
  const bm = new Map(b.perQuery.map((q) => [q.query_id, q]));
  const d = a.perQuery.filter((q) => bm.has(q.query_id) && filter(q)).map((q) => fn(q) - fn(bm.get(q.query_id)));
  const reps = [];
  for (let i = 0; i < 2000; i++) { let s = 0; for (let j = 0; j < d.length; j++) s += d[(rnd() * d.length) | 0]; reps.push(s / d.length); }
  reps.sort((x, y) => x - y);
  const lo = reps[50], hi = reps[1949];
  return { n: d.length, delta: +mean(d).toFixed(4), ci: [+lo.toFixed(4), +hi.toFixed(4)], verdict: lo > 0 ? 'better' : hi < 0 ? 'worse' : 'noise' };
}
const fmt = (p) => `${p.delta >= 0 ? '+' : ''}${p.delta.toFixed(4)} [${p.ci[0].toFixed(3)}, ${p.ci[1].toFixed(3)}] ${p.verdict}`;
const r10 = (q) => q.base.r10;
const rr10 = (q) => q.reranked?.r10 ?? 0;
const mrr = (q) => q.base.mrr;
const isLong = (q) => q.track === 'long';

const out = { generatedAt: new Date().toISOString(), models: {} };
for (const model of MODELS) {
  const runs = {};
  for (const [label, suffix] of VARIANTS) {
    const f = path.join(RAW, `${model}${suffix}.json`);
    if (fs.existsSync(f)) runs[label] = JSON.parse(fs.readFileSync(f, 'utf8'));
  }
  const ref = runs['t350 (production)'];
  if (!ref) { console.log(`${model}: no reranked production reference (__chunk-t350) yet`); continue; }
  if (!ref.reranked) throw new Error(`${model}__chunk-t350 has no reranked metrics`);
  console.log(`\n== ${model}`);
  const m = {};
  for (const [label, r] of Object.entries(runs)) {
    const longR10 = mean(r.perQuery.filter(isLong).map(r10));
    m[label] = { chunks: r.corpus.chunks, r10: r.overall.r10, mrr: r.overall.mrr, reranked_r10: r.reranked?.r10 ?? null, long_r10: +longR10.toFixed(4) };
    console.log(`   ${label.padEnd(18)} chunks=${r.corpus.chunks}  R@10=${r.overall.r10.toFixed(4)}  MRR=${r.overall.mrr.toFixed(4)}  reranked R@10=${r.reranked?.r10?.toFixed(4) ?? 'n/a'}  long-track R@10=${longR10.toFixed(4)}`);
    if (r !== ref) {
      m[label].vsProduction = { r10: paired(r, ref, r10), mrr: paired(r, ref, mrr), rerankedR10: paired(r, ref, rr10), longR10: paired(r, ref, r10, isLong) };
      for (const [k, v] of Object.entries(m[label].vsProduction)) console.log(`      vs 350 ${k.padEnd(12)} ${fmt(v)}`);
    }
  }
  out.models[model] = m;
}
fs.mkdirSync(path.join(REPO, 'results', 'chunk-sweep'), { recursive: true });
fs.writeFileSync(path.join(REPO, 'results', 'chunk-sweep', 'comparison.json'), JSON.stringify(out, null, 1));
