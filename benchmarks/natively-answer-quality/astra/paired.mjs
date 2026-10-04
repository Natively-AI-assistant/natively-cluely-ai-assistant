#!/usr/bin/env node
// Paired per-mode comparison of two judged answer sets on the items BOTH have (official score, astra/score.mjs).
// A set is an absolute-judge file (astra/out/<set>/<run_id>.jsonl) or a replay's judged file
// (results/replay/<name>.judged.jsonl). Items missing from either side are left out, so a sample or a
// partially judged set compares only like with like.
//   node astra/paired.mjs <A> <B> [--mode m1,m2] [--label-a x --label-b y]
// Prints per mode: n, mean A, mean B, paired diff (with a 95% interval), hard fails A → B, items below 9.5.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const [fa, fb] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const modes = opt('mode') ? new Set(opt('mode').split(',')) : null;

function load(f) {
  const p = path.resolve(ROOT, f);
  const by = {};
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!l) continue;
    const j = JSON.parse(l);
    if (!j.ok || !j.official) continue;
    // One score per item: the first repeat (k / repeat 0) is the comparable one.
    if ((j.repeat ?? 0) !== 0 || (j.k ?? 0) !== 0) continue;
    by[j.benchmark_id] = { mode: j.mode, s: j.official.overall, hf: !!j.official.hard_fail, flags: j.official.flags ?? [] };
  }
  return by;
}
const A = load(fa); const B = load(fb);
const la = opt('label-a', path.basename(fa).replace(/\.jsonl$/, '')); const lb = opt('label-b', path.basename(fb).replace(/\.jsonl$/, ''));
const rows = {};
for (const id of Object.keys(A)) {
  if (!B[id]) continue;
  const mode = A[id].mode ?? B[id].mode;
  if (modes && !modes.has(mode)) continue;
  for (const k of [mode, 'ALL']) (rows[k] ??= []).push({ id, a: A[id], b: B[id] });
}
const mean = (x) => x.reduce((p, q) => p + q, 0) / x.length;
const sd = (x) => { const m = mean(x); return Math.sqrt(x.reduce((p, q) => p + (q - m) ** 2, 0) / Math.max(1, x.length - 1)); };
console.log(`A = ${la}   B = ${lb}`);
console.log('| mode | n | mean A | mean B | B − A (95%) | hard fails A → B | < 9.5 A → B |');
console.log('|---|---:|---:|---:|---:|---:|---:|');
for (const [mode, r] of Object.entries(rows).sort((x, y) => (x[0] === 'ALL') - (y[0] === 'ALL') || x[0].localeCompare(y[0]))) {
  const d = r.map((x) => x.b.s - x.a.s);
  const half = r.length > 1 ? 1.96 * sd(d) / Math.sqrt(r.length) : NaN;
  console.log(`| ${mode} | ${r.length} | ${mean(r.map((x) => x.a.s)).toFixed(2)} | ${mean(r.map((x) => x.b.s)).toFixed(2)} | ${mean(d) >= 0 ? '+' : ''}${mean(d).toFixed(2)} (±${half.toFixed(2)}) | ${r.filter((x) => x.a.hf).length} → ${r.filter((x) => x.b.hf).length} | ${r.filter((x) => x.a.s < 9.5).length} → ${r.filter((x) => x.b.s < 9.5).length} |`);
}
if (args.includes('--items')) {
  for (const x of (rows.ALL ?? []).sort((p, q) => (p.b.s - p.a.s) - (q.b.s - q.a.s))) {
    if (x.a.s === x.b.s) continue;
    console.log(`${x.id.padEnd(12)} ${x.a.s.toFixed(1)} → ${x.b.s.toFixed(1)}  ${x.a.flags.join(',') || '-'} → ${x.b.flags.join(',') || '-'}`);
  }
}
