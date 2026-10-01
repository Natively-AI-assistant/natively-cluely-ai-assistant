#!/usr/bin/env node
// The rules written in docs/ITERATIONS-ASTRA.md BEFORE the judge read these rows, applied mechanically. No judge calls.
//   Prepared change (replay pair, 40 dev rows of one mode): BUILD if the paired gain is at least +0.3, its 95% interval
//   excludes 0 and hard fails are not up. A pair with fewer than all its rows judged on both sides is INCOMPLETE:
//   no verdict.
//   fix13 (kept on an objective rule): its re-run rows must not be below fix12's by more than the interval.
//   node astra/decide.mjs            → markdown on stdout
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAIN = 0.3;

function load(f) {
  const p = path.join(ROOT, f);
  const by = {};
  if (!fs.existsSync(p)) return by;
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!l) continue;
    const j = JSON.parse(l);
    if (!j.ok || !j.official || (j.repeat ?? 0) !== 0 || (j.k ?? 0) !== 0) continue;
    by[j.benchmark_id] = { s: j.official.overall, hf: !!j.official.hard_fail };
  }
  return by;
}
const rowsOf = (f) => (fs.existsSync(path.join(ROOT, f)) ? fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const mean = (x) => x.reduce((p, q) => p + q, 0) / x.length;
const sd = (x) => { const m = mean(x); return Math.sqrt(x.reduce((p, q) => p + (q - m) ** 2, 0) / Math.max(1, x.length - 1)); };

function pair(A, B, ids) {
  const both = ids.filter((id) => A[id] && B[id]);
  if (!both.length) return { n: 0, expected: ids.length };
  const d = both.map((id) => B[id].s - A[id].s);
  return {
    n: both.length, expected: ids.length,
    a: mean(both.map((id) => A[id].s)), b: mean(both.map((id) => B[id].s)),
    diff: mean(d), half: both.length > 1 ? 1.96 * sd(d) / Math.sqrt(both.length) : NaN,
    hfA: both.filter((id) => A[id].hf).length, hfB: both.filter((id) => B[id].hf).length,
    changed: d.filter((x) => x !== 0).length,
  };
}
const f2 = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);

console.log(`# Pre-registered decisions — ${new Date().toISOString()}\n`);
console.log('## Prepared changes (dev replay pairs; rule: gain ≥ +0.3, interval excludes 0, hard fails not up)\n');
console.log('| change | rows judged | base | variant | gain (95%) | hard fails | rows that moved | verdict |');
console.log('|---|---:|---:|---:|---:|---:|---:|---|');
// The candidate build applies the two notices on HEARD turns only ("h"); those are the deciding pairs.
const PAIRS = [
  ['Looking for work — fallback rule reworded (v2)', 'lfw-base', 'lfw-bridge-v2'],
  ['Call Center — "no policy on file" notice, heard turns', 'ccfin-base', 'ccfin-nopolicy-v1h'],
  ['Sales — "how to say it when nothing can be stated", heard turns', 'salesfin-base', 'salesfin-shape-v1h'],
];
// Reported, not built: the same notices on typed turns too.
const SECONDARY = [
  ['Call Center notice on typed turns too', 'ccfin-base', 'ccfin-nopolicy-v1c'],
  ['Sales notice on typed turns too', 'salesfin-base', 'salesfin-shape-v1c'],
  ['Looking for work, first wording (copies its example)', 'lfw-base', 'lfw-bridge-v1'],
];
const table = (pairs, verdicts) => { for (const [label, base, variant] of pairs) {
  const ids = [...new Set(rowsOf(`results/replay/${base}.jsonl`).filter((r) => (r.k ?? 0) === 0).map((r) => r.id))];
  const p = pair(load(`results/replay/${base}.judged.jsonl`), load(`results/replay/${variant}.judged.jsonl`), ids);
  if (p.n < p.expected) { console.log(`| ${label} | ${p.n} of ${p.expected} | | | | | | ${verdicts ? 'INCOMPLETE — no verdict' : 'incomplete'} |`); continue; }
  const pass = p.diff >= GAIN && p.diff - p.half > 0 && p.hfB <= p.hfA;
  const why = pass ? '' : ` (${[p.diff < GAIN ? 'gain under +0.3' : null, !(p.diff - p.half > 0) ? 'interval includes 0' : null, p.hfB > p.hfA ? 'hard fails up' : null].filter(Boolean).join('; ')})`;
  console.log(`| ${label} | ${p.n} of ${p.expected} | ${p.a.toFixed(2)} | ${p.b.toFixed(2)} | ${f2(p.diff)} (±${p.half.toFixed(2)}) | ${p.hfA} → ${p.hfB} | ${p.changed} | ${verdicts ? `${pass ? 'BUILD' : 'DO NOT BUILD'}${why}` : 'reported only'} |`);
} };
table(PAIRS, true);
console.log('\n## Reported only (same rule shown, nothing is built from these)\n');
console.log('| variant | rows judged | base | variant | gain (95%) | hard fails | rows that moved | |');
console.log('|---|---:|---:|---:|---:|---:|---:|---|');
table(SECONDARY, false);

console.log('\n## fix13 (refinement notice) against fix12 on the rows it re-ran\n');
console.log('| split | rows judged | fix12 | fix13 | difference (95%) | hard fails | verdict |');
console.log('|---|---:|---:|---:|---:|---:|---|');
for (const [split, set, a, b] of [['dev', 'abs-dev-c2', 'aq2-dev-fix12c', 'aq2-dev-fix13'], ['holdout', 'abs-holdout-c2', 'aq2-holdout-fix12c', 'aq2-holdout-fix13']]) {
  const B = load(`astra/out/${set}/${b}.jsonl`);
  const ids = rowsOf(`results/${b}/natively_benchmark_full.jsonl`).map((r) => r.benchmark_id ?? r.id).filter(Boolean);
  const p = pair(load(`astra/out/${set}/${a}.jsonl`), B, [...new Set(ids)]);
  if (!p.n) { console.log(`| ${split} | 0 of ${p.expected} | | | | | not judged |`); continue; }
  const ok = p.diff + p.half >= 0 && p.hfB <= p.hfA;
  console.log(`| ${split} | ${p.n} of ${p.expected} | ${p.a.toFixed(2)} | ${p.b.toFixed(2)} | ${f2(p.diff)} (±${p.half.toFixed(2)}) | ${p.hfA} → ${p.hfB} | ${p.n < p.expected ? 'INCOMPLETE' : ok ? 'KEEP (not below fix12)' : 'BELOW fix12 — review'} |`);
}
