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
import { readJsonl } from './store.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAIN = 0.3;
// AQ_JUDGE=fable reads the Fable series (its own replay files and abs-*-f1 sets), AQ_JUDGE=opus the Opus series
// (replay files only; no absolute sets were judged by it); the judges are never pooled.
const FABLE = process.env.AQ_JUDGE === 'fable';
const OPUS = process.env.AQ_JUDGE === 'opus';
const JUDGED = FABLE ? '.judged-fable.jsonl' : OPUS ? '.judged-opus.jsonl' : '.judged.jsonl';

function load(f) {
  const p = path.join(ROOT, f);
  const by = {};
  for (const j of readJsonl(p)) {
    if (!j.ok || !j.official || (j.repeat ?? 0) !== 0 || (j.k ?? 0) !== 0) continue;
    by[j.benchmark_id] = { s: j.official.overall, hf: !!j.official.hard_fail };
  }
  return by;
}
const rowsOf = (f) => (fs.existsSync(path.join(ROOT, f)) ? fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const mean = (x) => x.reduce((p, q) => p + q, 0) / x.length;
const sd = (x) => { const m = mean(x); return Math.sqrt(x.reduce((p, q) => p + (q - m) ** 2, 0) / Math.max(1, x.length - 1)); };

// Answers shared by both arms of a pair (carried rows, byte-identical verifier outputs) must have ONE score: the
// judge's cache is keyed by answer text. A different score means the same answer was judged twice (a race).
function sharedAnswerMismatches(base, variant) {
  const a = Object.fromEntries(rowsOf(`results/replay/${base}.jsonl`).map((r) => [`${r.id}#${r.k ?? 0}`, r.answer]));
  const A = load(`results/replay/${base}${JUDGED}`); const B = load(`results/replay/${variant}${JUDGED}`);
  let shared = 0; let mismatched = 0;
  for (const r of rowsOf(`results/replay/${variant}.jsonl`)) {
    if ((r.k ?? 0) !== 0 || a[`${r.id}#0`] !== r.answer || !A[r.id] || !B[r.id]) continue;
    shared++; if (A[r.id].s !== B[r.id].s) mismatched++;
  }
  return { shared, mismatched };
}

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

console.log(`# Pre-registered decisions — judge ${FABLE ? 'claude-fable-5-1' : OPUS ? 'claude-opus-5-5 (effort medium)' : 'gpt-6-astra'} — ${new Date().toISOString()}\n`);
console.log('## Prepared changes (dev replay pairs; rule: gain ≥ +0.3, interval excludes 0, hard fails not up)\n');
console.log('| change | rows judged | base | variant | gain (95%) | hard fails | rows that moved | verdict |');
console.log('|---|---:|---:|---:|---:|---:|---:|---|');
// The candidate build applies the two notices on HEARD turns only ("h"); those are the deciding pairs.
const PAIRS = [
  ['Reasoning on typed turns (what fix15 builds) — Technical interview + Lecture, dev', 'think-off-til', 'think-low-til-typed'],
  ['Looking for work — fallback rule reworded (v2)', 'lfw-base', 'lfw-bridge-v2'],
  ['Call Center — "no policy on file" notice, heard turns', 'ccfin-base', 'ccfin-nopolicy-v1h'],
  ['Sales — "how to say it when nothing can be stated", heard turns', 'salesfin-base', 'salesfin-shape-v1h'],
];
// Reported, not built: the same notices on typed turns too.
const SECONDARY = [
  ['Reasoning on ALL turns, dev (the heard-turn question)', 'think-off-til', 'think-low-til'],
  ['Reasoning on ALL turns, holdout (the heard-turn question)', 'think-off-til-hold', 'think-low-til-hold'],
  ['Call Center notice on typed turns too', 'ccfin-base', 'ccfin-nopolicy-v1c'],
  ['Sales notice on typed turns too', 'salesfin-base', 'salesfin-shape-v1c'],
  ['Looking for work, first wording (copies its example)', 'lfw-base', 'lfw-bridge-v1'],
];
const BUILT = {}; // dev variant → did its pair pass (holdout is a confirmation of a pass, not a second chance)
const table = (pairs, verdicts) => { for (const [label, base, variant] of pairs) {
  const ids = [...new Set(rowsOf(`results/replay/${base}.jsonl`).filter((r) => (r.k ?? 0) === 0).map((r) => r.id))];
  const p = pair(load(`results/replay/${base}${JUDGED}`), load(`results/replay/${variant}${JUDGED}`), ids);
  if (p.n < p.expected) { console.log(`| ${label} | ${p.n} of ${p.expected} | | | | | | ${verdicts ? 'INCOMPLETE — no verdict' : 'incomplete'} |`); continue; }
  const pass = p.diff >= GAIN && p.diff - p.half > 0 && p.hfB <= p.hfA;
  if (verdicts) BUILT[variant] = pass;
  const why = pass ? '' : ` (${[p.diff < GAIN ? 'gain under +0.3' : null, !(p.diff - p.half > 0) ? 'interval includes 0' : null, p.hfB > p.hfA ? 'hard fails up' : null].filter(Boolean).join('; ')})`;
  console.log(`| ${label} | ${p.n} of ${p.expected} | ${p.a.toFixed(2)} | ${p.b.toFixed(2)} | ${f2(p.diff)} (±${p.half.toFixed(2)}) | ${p.hfA} → ${p.hfB} | ${p.changed} | ${verdicts ? `${pass ? 'BUILD' : 'DO NOT BUILD'}${why}` : 'reported only'} |`);
} };
table(PAIRS, true);
for (const [label, base, variant] of [...PAIRS, ...SECONDARY]) {
  const m = sharedAnswerMismatches(base, variant);
  if (m.mismatched) console.log(`\nWARNING ${label}: ${m.mismatched} of ${m.shared} rows with the SAME answer in both arms have different scores — judged twice; that pair's interval is inflated.`);
}
for (const [label, base, variant] of [['dev', 'think-off-til', 'think-low-til-typed'], ['holdout', 'think-off-til-hold', 'think-low-til-hold-typed']]) {
  const touched = rowsOf(`results/replay/${variant}.jsonl`).filter((r) => !r.carried && (r.k ?? 0) === 0).map((r) => r.id);
  const p = pair(load(`results/replay/${base}${JUDGED}`), load(`results/replay/${variant}${JUDGED}`), touched);
  console.log(p.n < p.expected ? `\nReasoning, the typed rows alone (${label}): ${p.n} of ${p.expected} judged` : `\nReasoning, the typed rows alone (${label}, reported next to the rule): ${p.a.toFixed(2)} → ${p.b.toFixed(2)}, ${f2(p.diff)} (±${p.half.toFixed(2)}), hard fails ${p.hfA} → ${p.hfB}, n ${p.n}`);
}
console.log(`\nSame-answer rows scored differently in the deciding pairs: ${PAIRS.reduce((n, [, b, v]) => n + sharedAnswerMismatches(b, v).mismatched, 0)} (must be 0).`);
// Holdout confirmation of a lever that passed on dev: positive, interval excludes 0, hard fails not up. Aggregate only.
console.log('\n## Holdout confirmation (rule: gain > 0, interval excludes 0, hard fails not up)\n');
console.log('| lever | rows judged | base | variant | gain (95%) | hard fails | verdict |');
console.log('|---|---:|---:|---:|---:|---:|---|');
for (const [label, base, variant, devVariant] of [['Reasoning on typed turns — Technical interview + Lecture, holdout', 'think-off-til-hold', 'think-low-til-hold-typed', 'think-low-til-typed']]) {
  const ids = [...new Set(rowsOf(`results/replay/${base}.jsonl`).filter((r) => (r.k ?? 0) === 0).map((r) => r.id))];
  const p = pair(load(`results/replay/${base}${JUDGED}`), load(`results/replay/${variant}${JUDGED}`), ids);
  if (p.n < p.expected) { console.log(`| ${label} | ${p.n} of ${p.expected} | | | | | INCOMPLETE — no verdict |`); continue; }
  const ok = p.diff > 0 && p.diff - p.half > 0 && p.hfB <= p.hfA;
  console.log(`| ${label} | ${p.n} of ${p.expected} | ${p.a.toFixed(2)} | ${p.b.toFixed(2)} | ${f2(p.diff)} (±${p.half.toFixed(2)}) | ${p.hfA} → ${p.hfB} | ${BUILT[devVariant] === false ? `NOT APPLIED — the dev pair did not pass; shown for the record (${ok ? 'would confirm' : 'would not confirm'})` : BUILT[devVariant] ? (ok ? 'CONFIRMED' : 'NOT CONFIRMED') : 'waits for the dev pair'} |`);
}
console.log('\n## Reported only (same rule shown, nothing is built from these)\n');
console.log('| variant | rows judged | base | variant | gain (95%) | hard fails | rows that moved | |');
console.log('|---|---:|---:|---:|---:|---:|---:|---|');
table(SECONDARY, false);

console.log('\n## fix13 (refinement notice) against fix12 on the rows it re-ran\n');
console.log('| split | rows judged | fix12 | fix13 | difference (95%) | hard fails | verdict |');
console.log('|---|---:|---:|---:|---:|---:|---|');
for (const [split, set, a, b] of [['dev', FABLE ? 'abs-dev-f1' : OPUS ? 'abs-dev-o1' : 'abs-dev-c2', 'aq2-dev-fix12c', 'aq2-dev-fix13'], ['holdout', FABLE ? 'abs-holdout-f1' : OPUS ? 'abs-holdout-o1' : 'abs-holdout-c2', 'aq2-holdout-fix12c', 'aq2-holdout-fix13']]) {
  const B = load(`astra/out/${set}/${b}.jsonl`);
  const ids = rowsOf(`results/${b}/natively_benchmark_full.jsonl`).map((r) => r.benchmark_id ?? r.id).filter(Boolean);
  const p = pair(load(`astra/out/${set}/${a}.jsonl`), B, [...new Set(ids)]);
  if (!p.n) { console.log(`| ${split} | 0 of ${p.expected} | | | | | not judged |`); continue; }
  const ok = p.diff + p.half >= 0 && p.hfB <= p.hfA;
  console.log(`| ${split} | ${p.n} of ${p.expected} | ${p.a.toFixed(2)} | ${p.b.toFixed(2)} | ${f2(p.diff)} (±${p.half.toFixed(2)}) | ${p.hfA} → ${p.hfB} | ${p.n < p.expected ? 'INCOMPLETE' : ok ? 'KEEP (not below fix12)' : 'BELOW fix12 — review'} |`);
}
