#!/usr/bin/env node
// I29: the rule for a replay pair judged with several samples per touched row, on one half of a split test set
// (docs/ITERATIONS-ASTRA.md, written 2026-10-02 before any answer was generated). No judge calls. Aggregates only.
//   node astra/decide-enlarged.mjs --prefix ccE --half D|C --samples 3 [--root <harness dir>]
// Files, per sample s = 1..N: results/replay/<prefix><s>-base.<half>.jsonl and <prefix><s>-var.<half>.jsonl with
// their .judged.jsonl. Sample 1 holds every row of the half (a row the change does not touch is `carried`: base's
// answer, a difference of exactly 0); samples 2..N hold the touched rows only.
// An item's difference is the mean over its samples of (variant − base). Rules:
//   D (decision):     mean ≥ +0.3, 95 % interval over items excludes 0, hard fails (summed over judged answers) not up
//   C (confirmation): mean > 0,    95 % interval over items excludes 0, hard fails not up
// Exit: 0 pass, 1 fail, 2 incomplete (some answer is not judged yet).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonl } from './store.mjs';

const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const ROOT = opt('root') ? path.resolve(opt('root')) : path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const prefix = opt('prefix'); const half = opt('half'); const N = Number(opt('samples', 3));
if (!prefix || !['D', 'C'].includes(half)) { console.error('--prefix and --half D|C required'); process.exit(2); }
const file = (s, arm) => path.join(ROOT, 'results', 'replay', `${prefix}${s}-${arm}.${half}`);
const answers = (s, arm) => Object.fromEntries(readJsonl(`${file(s, arm)}.jsonl`).filter((r) => (r.k ?? 0) === 0).map((r) => [r.id, r]));
const judged = (s, arm) => Object.fromEntries(readJsonl(`${file(s, arm)}.judged.jsonl`).filter((j) => j.ok && j.official && (j.k ?? 0) === 0).map((j) => [j.benchmark_id, { s: j.official.overall, hf: !!j.official.hard_fail }]));

const A = []; const B = []; const JA = []; const JB = [];
for (let s = 1; s <= N; s++) { A.push(answers(s, 'base')); B.push(answers(s, 'var')); JA.push(judged(s, 'base')); JB.push(judged(s, 'var')); }
const ids = Object.keys(A[0]);
const diffs = []; const meanA = []; const meanB = [];
let missing = 0; let touched = 0; let hfA = 0; let hfB = 0; let judgedAnswers = 0;
for (const id of ids) {
  if (!B[0][id]) { missing++; continue; }
  if (B[0][id].carried) {
    // Untouched: base's answer in both arms, judged once.
    const j = JA[0][id]; if (!j) { missing++; continue; }
    diffs.push(0); meanA.push(j.s); meanB.push(j.s); if (j.hf) { hfA++; hfB++; } judgedAnswers++;
    continue;
  }
  touched++;
  const d = []; const a = []; const b = [];
  for (let s = 0; s < N; s++) {
    const ja = JA[s][id]; const jb = JB[s][id];
    if (!A[s][id] || !B[s][id] || !ja || !jb) { missing++; continue; }
    d.push(jb.s - ja.s); a.push(ja.s); b.push(jb.s); if (ja.hf) hfA++; if (jb.hf) hfB++; judgedAnswers += 2;
  }
  if (d.length !== N) continue;
  const m = (x) => x.reduce((p, q) => p + q, 0) / x.length;
  diffs.push(m(d)); meanA.push(m(a)); meanB.push(m(b));
}
const mean = (x) => x.reduce((p, q) => p + q, 0) / x.length;
const sd = (x) => { const m = mean(x); return Math.sqrt(x.reduce((p, q) => p + (q - m) ** 2, 0) / Math.max(1, x.length - 1)); };
const f2 = (x) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2);
const name = half === 'D' ? 'decision' : 'confirmation';
console.log(`# ${prefix}, ${name} half — judge gpt-6-astra — ${new Date().toISOString()}\n`);
if (!ids.length || missing) {
  console.log(`INCOMPLETE — ${ids.length} rows, ${missing} answers or judgments missing. No verdict.`);
  process.exit(2);
}
const diff = mean(diffs); const hw = 1.96 * sd(diffs) / Math.sqrt(diffs.length);
console.log('| rows | rows the change touches | samples per touched row | base | variant | gain (95 %) | hard fails (all judged answers) |');
console.log('|---:|---:|---:|---:|---:|---:|---:|');
console.log(`| ${diffs.length} | ${touched} | ${N} | ${mean(meanA).toFixed(2)} | ${mean(meanB).toFixed(2)} | ${f2(diff)} (±${hw.toFixed(2)}) | ${hfA} → ${hfB} |`);
const need = half === 'D' ? 0.3 : 0;
const fails = [
  half === 'D' ? (diff >= need ? null : 'gain under +0.3') : (diff > 0 ? null : 'gain not above 0'),
  diff - hw > 0 ? null : 'interval includes 0',
  hfB <= hfA ? null : 'hard fails up',
].filter(Boolean);
console.log(`\nVerdict (${name} rule): ${fails.length ? `FAIL — ${fails.join('; ')}` : 'PASS'}. Judged answers: ${judgedAnswers}.`);
process.exit(fails.length ? 1 : 0);
