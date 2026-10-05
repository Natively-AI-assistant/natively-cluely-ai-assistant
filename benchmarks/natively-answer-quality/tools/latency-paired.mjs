#!/usr/bin/env node
// Paired latency: two runs of the SAME items made side by side (two apps at once, so network and provider drift hit
// both). Per mode and overall: TTFT and total p50 / p95 for each run, and the median per-item difference (B − A).
//   node tools/latency-paired.mjs results/<runA> results/<runB>
import fs from 'node:fs';
import path from 'node:path';

const [da, db] = process.argv.slice(2).map((p) => path.resolve(p));
const load = (d) => Object.fromEntries(fs.readFileSync(path.join(d, 'natively_benchmark_full.jsonl'), 'utf8').split('\n').filter(Boolean)
  .map((l) => JSON.parse(l)).filter((r) => r.success !== false && r.ttft_ms != null && r.total_latency_ms != null).map((r) => [r.benchmark_id, r]));
const A = load(da); const B = load(db);
const pct = (x, p) => { if (!x.length) return NaN; const s = [...x].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const by = {};
for (const id of Object.keys(A)) {
  if (!B[id]) continue;
  for (const k of [A[id].mode, 'ALL']) {
    const m = (by[k] ??= { n: 0, ta: [], tb: [], la: [], lb: [], dt: [], dl: [] });
    m.n++; m.ta.push(A[id].ttft_ms); m.tb.push(B[id].ttft_ms); m.la.push(A[id].total_latency_ms); m.lb.push(B[id].total_latency_ms);
    m.dt.push(B[id].ttft_ms - A[id].ttft_ms); m.dl.push(B[id].total_latency_ms - A[id].total_latency_ms);
  }
}
const f = (x) => Math.round(x);
console.log(`A = ${path.basename(da)}   B = ${path.basename(db)}`);
console.log('| mode | n | TTFT p50/p95 A | TTFT p50/p95 B | median Δ TTFT | total p50/p95 A | total p50/p95 B | median Δ total |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|');
for (const [k, m] of Object.entries(by).sort((x, y) => (x[0] === 'ALL') - (y[0] === 'ALL') || x[0].localeCompare(y[0]))) {
  console.log(`| ${k} | ${m.n} | ${f(pct(m.ta, 50))}/${f(pct(m.ta, 95))} | ${f(pct(m.tb, 50))}/${f(pct(m.tb, 95))} | ${f(pct(m.dt, 50))} | ${f(pct(m.la, 50))}/${f(pct(m.la, 95))} | ${f(pct(m.lb, 50))}/${f(pct(m.lb, 95))} | ${f(pct(m.dl, 50))} |`);
}
