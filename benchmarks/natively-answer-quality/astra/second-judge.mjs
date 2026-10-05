#!/usr/bin/env node
// Two judges on the SAME stored replay answers: gpt-6-astra (the judge of record) and the second judge Evin asked
// for on 2026-10-03 (claude-opus-5-5, AQ_JUDGE=opus). For each deciding pair it applies the rule written before
// either judge read the rows (gain >= +0.3, 95% interval excludes 0, hard fails not up) once per judge, then says how
// far the two judges agree on the answers both scored. No judge calls. The two series are never pooled.
//   node astra/second-judge.mjs [--rows]      --rows lists the dev rows whose change the judges read differently
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonl } from './store.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAIN = 0.3;
const JUDGES = [['gpt-6-astra', '.judged.jsonl'], ['claude-opus-5-5', '.judged-opus.jsonl']];
const PAIRS = [
  ['Reasoning on typed Technical interview + Lecture turns', 'i7', 'think-off-til', 'think-low-til-typed'],
  ['Looking for work, fallback rule v2', 'i6', 'lfw-base', 'lfw-bridge-v2'],
  ['Call Center, "no policy on file" notice, heard turns', 'i6', 'ccfin-base', 'ccfin-nopolicy-v1h'],
  ['Sales, reply-shape notice, heard turns', 'i6', 'salesfin-base', 'salesfin-shape-v1h'],
];
const rows = (name) => fs.readFileSync(path.join(ROOT, `results/replay/${name}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => (r.k ?? 0) === 0);
const judged = (name, suffix) => {
  const by = {};
  for (const j of readJsonl(path.join(ROOT, `results/replay/${name}${suffix}`))) {
    if (!j.ok || !j.official || (j.repeat ?? 0) !== 0 || (j.k ?? 0) !== 0) continue;
    by[j.benchmark_id] = { s: j.official.overall, hf: !!j.official.hard_fail };
  }
  return by;
};
const mean = (x) => x.reduce((p, q) => p + q, 0) / x.length;
const sd = (x) => { const m = mean(x); return Math.sqrt(x.reduce((p, q) => p + (q - m) ** 2, 0) / Math.max(1, x.length - 1)); };
const f2 = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);

function pair(A, B, ids) {
  const both = ids.filter((id) => A[id] && B[id]);
  if (both.length < ids.length) return { n: both.length, expected: ids.length };
  const d = both.map((id) => B[id].s - A[id].s);
  const p = { n: both.length, expected: ids.length, a: mean(both.map((id) => A[id].s)), b: mean(both.map((id) => B[id].s)), diff: mean(d), half: 1.96 * sd(d) / Math.sqrt(both.length), hfA: both.filter((id) => A[id].hf).length, hfB: both.filter((id) => B[id].hf).length, d: Object.fromEntries(both.map((id, i) => [id, d[i]])) };
  p.pass = p.diff >= GAIN && p.diff - p.half > 0 && p.hfB <= p.hfA;
  p.why = p.pass ? '' : [p.diff < GAIN ? 'gain under +0.3' : null, !(p.diff - p.half > 0) ? 'interval includes 0' : null, p.hfB > p.hfA ? 'hard fails up' : null].filter(Boolean).join('; ');
  return p;
}

console.log(`# Two judges on the same answers — ${new Date().toISOString()}\n`);
console.log('Rule for each judge: gain at least +0.3, 95 % interval excludes 0, hard fails not up.\n');
console.log('| change | branch | judge | rows | base | variant | gain (95 %) | hard fails | verdict |');
console.log('|---|---|---|---:|---:|---:|---:|---:|---|');
const perPair = [];
for (const [label, branch, base, variant] of PAIRS) {
  const ids = rows(base).map((r) => r.id);
  const res = {};
  for (const [judge, suffix] of JUDGES) {
    const p = pair(judged(base, suffix), judged(variant, suffix), ids);
    res[judge] = p;
    console.log(p.n < p.expected
      ? `| ${label} | ${branch} | ${judge} | ${p.n} of ${p.expected} | | | | | INCOMPLETE — no verdict |`
      : `| ${label} | ${branch} | ${judge} | ${p.n} | ${p.a.toFixed(2)} | ${p.b.toFixed(2)} | ${f2(p.diff)} (±${p.half.toFixed(2)}) | ${p.hfA} → ${p.hfB} | ${p.pass ? 'PASS' : `FAIL (${p.why})`} |`);
  }
  perPair.push({ label, base, variant, ids, res });
}

// Agreement: every answer both judges scored, each distinct answer once.
console.log('\n## How far the two judges agree (each distinct answer once)\n');
console.log('| answers of | answers | astra mean | opus mean | opus − astra | within 1.0 | correlation | hard fail: both / astra only / opus only / neither |');
console.log('|---|---:|---:|---:|---:|---:|---:|---|');
const corr = (x, y) => { const mx = mean(x), my = mean(y); const c = x.reduce((p, v, i) => p + (v - mx) * (y[i] - my), 0); const q = Math.sqrt(x.reduce((p, v) => p + (v - mx) ** 2, 0) * y.reduce((p, v) => p + (v - my) ** 2, 0)); return q ? c / q : NaN; };
const all = { x: [], y: [], hf: [0, 0, 0, 0] };
for (const { label, base, variant } of perPair) {
  const seen = new Set(); const x = []; const y = []; const hf = [0, 0, 0, 0];
  for (const name of [base, variant]) {
    const A = judged(name, JUDGES[0][1]); const O = judged(name, JUDGES[1][1]);
    for (const r of rows(name)) {
      const k = `${r.id}\u0000${r.answer}`;
      if (seen.has(k) || !A[r.id] || !O[r.id]) continue;
      seen.add(k); x.push(A[r.id].s); y.push(O[r.id].s);
      hf[A[r.id].hf ? (O[r.id].hf ? 0 : 1) : (O[r.id].hf ? 2 : 3)]++;
    }
  }
  if (!x.length) { console.log(`| ${label} | 0 | | | | | | |`); continue; }
  console.log(`| ${label} | ${x.length} | ${mean(x).toFixed(2)} | ${mean(y).toFixed(2)} | ${f2(mean(y) - mean(x))} | ${Math.round(100 * x.filter((v, i) => Math.abs(v - y[i]) <= 1).length / x.length)} % | ${corr(x, y).toFixed(2)} | ${hf.join(' / ')} |`);
  all.x.push(...x); all.y.push(...y); hf.forEach((v, i) => { all.hf[i] += v; });
}
if (all.x.length) console.log(`| all four | ${all.x.length} | ${mean(all.x).toFixed(2)} | ${mean(all.y).toFixed(2)} | ${f2(mean(all.y) - mean(all.x))} | ${Math.round(100 * all.x.filter((v, i) => Math.abs(v - all.y[i]) <= 1).length / all.x.length)} % | ${corr(all.x, all.y).toFixed(2)} | ${all.hf.join(' / ')} |`);

// Do the judges agree on WHICH rows the change helped or hurt? Only rows whose answer differs between the arms.
console.log('\n## Rows the change touched: the direction each judge saw\n');
console.log('| change | rows touched | both better | both worse | both no change | judges disagree on direction | correlation of the row differences |');
console.log('|---|---:|---:|---:|---:|---:|---:|');
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
for (const { label, base, variant, res } of perPair) {
  const a = res[JUDGES[0][0]]; const o = res[JUDGES[1][0]];
  if (!a.d || !o.d) { console.log(`| ${label} | incomplete | | | | | |`); continue; }
  const A = Object.fromEntries(rows(base).map((r) => [r.id, r.answer]));
  const touched = rows(variant).filter((r) => A[r.id] !== r.answer).map((r) => r.id);
  const da = touched.map((id) => a.d[id]); const dob = touched.map((id) => o.d[id]);
  const both = (s) => touched.filter((id) => sign(a.d[id]) === s && sign(o.d[id]) === s).length;
  const disagree = touched.filter((id) => sign(a.d[id]) !== sign(o.d[id]));
  console.log(`| ${label} | ${touched.length} | ${both(1)} | ${both(-1)} | ${both(0)} | ${disagree.length} | ${corr(da, dob).toFixed(2)} |`);
  if (process.argv.includes('--rows')) for (const id of disagree) console.log(`|   ${id} | astra ${f2(a.d[id])} | opus ${f2(o.d[id])} | | | | |`);
}
