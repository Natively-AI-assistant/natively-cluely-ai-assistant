#!/usr/bin/env node
// scripts/embedding-live-corpus-analyse.mjs
//
// Paired comparison of the live-session corpus runs (embedding-live-corpus-compare.mjs).
// Every model answered the same questions against the same uploaded files in a
// real app session, so differences are measured per question and resampled per
// question (paired bootstrap, 2000 replicates, fixed seed). An interval that
// spans zero is reported as within noise.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(REPO, 'results', 'live-corpus');
const BASE = 'minilm';
const runs = {};
for (const f of fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && !f.startsWith('comparison'))) {
  const r = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  runs[r.model] = r;
}
if (!runs[BASE]) throw new Error('no MiniLM run');

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const metric = {
  hit1: (q) => (q.firstHitRank === 1 ? 1 : 0),
  hit3: (q) => (q.firstHitRank !== null && q.firstHitRank <= 3 ? 1 : 0),
  hitAny: (q) => (q.firstHitRank !== null ? 1 : 0),
  mrr: (q) => (q.firstHitRank ? 1 / q.firstHitRank : 0),
};

let seed = 0x2545f491;
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
function paired(a, b, fn) {
  const bm = new Map(b.queries.map((q) => [q.query_id, fn(q)]));
  const d = a.queries.filter((q) => bm.has(q.query_id)).map((q) => fn(q) - bm.get(q.query_id));
  const reps = [];
  for (let i = 0; i < 2000; i++) { let s = 0; for (let j = 0; j < d.length; j++) s += d[(rnd() * d.length) | 0]; reps.push(s / d.length); }
  reps.sort((x, y) => x - y);
  const lo = reps[50], hi = reps[1949];
  return { delta: +mean(d).toFixed(4), ci: [+lo.toFixed(4), +hi.toFixed(4)], sig: (lo > 0 && hi > 0) || (lo < 0 && hi < 0), n: d.length };
}

const rows = Object.values(runs).map((r) => {
  const q = r.queries;
  return {
    model: r.model, loaded: r.modelLoadedInApp, dims: r.embeddingStatus?.dimensions ?? null,
    n: q.length, failedCalls: q.filter((x) => !x.ok).length, selfPoison: r.selfPoison,
    indexSec: +(r.index?.ms / 1000).toFixed(1), embedded: `${r.index?.embedded}/${r.index?.chunks}`,
    hit1: +mean(q.map(metric.hit1)).toFixed(4), hit3: +mean(q.map(metric.hit3)).toFixed(4),
    hitAny: +mean(q.map(metric.hitAny)).toFixed(4), mrr: +mean(q.map(metric.mrr)).toFixed(4),
    p50: pct(q.map((x) => x.ms), 0.5), p95: pct(q.map((x) => x.ms), 0.95),
    avgReturned: +mean(q.map((x) => x.returned)).toFixed(1), matched: r.matchedSnippetRate,
  };
});

const tracks = [...new Set(runs[BASE].queries.map((q) => q.track))];
const byTrack = {};
for (const r of Object.values(runs)) {
  byTrack[r.model] = {};
  for (const t of tracks) byTrack[r.model][t] = +mean(r.queries.filter((q) => q.track === t).map(metric.hit3)).toFixed(4);
}
const deltas = {};
for (const r of Object.values(runs)) {
  if (r.model === BASE) continue;
  deltas[r.model] = Object.fromEntries(Object.entries(metric).map(([k, fn]) => [k, paired(r, runs[BASE], fn)]));
}

// Also against multilingual-e5-base, the default bundled for one day (2026-09-21) before multilingual-e5-small.
const deltasVsE5 = {};
if (runs['e5-base']) for (const r of Object.values(runs)) {
  if (r.model === 'e5-base') continue;
  deltasVsE5[r.model] = Object.fromEntries(Object.entries(metric).map(([k, fn]) => [k, paired(r, runs['e5-base'], fn)]));
}
fs.writeFileSync(path.join(DIR, 'comparison.json'), JSON.stringify({ generatedAt: new Date().toISOString(), rows, byTrack, deltasVsMiniLM: deltas, deltasVsE5Base: deltasVsE5 }, null, 2));

console.log('\nmodel        loaded                          dim  idx-s  embedded  hit@1   hit@3   hit@any  MRR     p50  p95  fails');
for (const r of rows) console.log(`${r.model.padEnd(12)} ${String(r.loaded).padEnd(31)} ${String(r.dims).padEnd(4)} ${String(r.indexSec).padEnd(6)} ${r.embedded.padEnd(9)} ${r.hit1.toFixed(4)}  ${r.hit3.toFixed(4)}  ${r.hitAny.toFixed(4)}   ${r.mrr.toFixed(4)}  ${String(r.p50).padEnd(4)} ${String(r.p95).padEnd(4)} ${r.failedCalls}`);
console.log('\nhit@3 by track:');
for (const t of tracks) console.log(`  ${t.padEnd(10)} ` + Object.keys(byTrack).map((m) => `${m}=${byTrack[m][t].toFixed(4)}`).join('  '));
console.log('\npaired delta vs MiniLM (95% CI, 2000 replicates):');
for (const [m, d] of Object.entries(deltas)) {
  for (const [k, v] of Object.entries(d)) console.log(`  ${m.padEnd(12)} ${k.padEnd(7)} ${(v.delta >= 0 ? '+' : '') + v.delta.toFixed(4)}  [${v.ci[0].toFixed(4)}, ${v.ci[1].toFixed(4)}]  ${v.sig ? (v.delta > 0 ? 'BETTER' : 'WORSE') : 'within noise'}`);
}

console.log('\npaired delta vs multilingual-e5-base (the superseded 2026-09-21 default):');
for (const [m, d] of Object.entries(deltasVsE5)) {
  for (const [k, v] of Object.entries(d)) console.log(`  ${m.padEnd(12)} ${k.padEnd(7)} ${(v.delta >= 0 ? '+' : '') + v.delta.toFixed(4)}  [${v.ci[0].toFixed(4)}, ${v.ci[1].toFixed(4)}]  ${v.sig ? (v.delta > 0 ? 'BETTER' : 'WORSE') : 'within noise'}`);
}
