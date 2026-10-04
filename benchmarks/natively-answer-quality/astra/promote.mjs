#!/usr/bin/env node
// The promotion rules for the candidates' APP rows, applied mechanically (no judge calls). astra/decide.mjs says
// which prepared changes get BUILD from their replay pairs; this says whether a built candidate replaces the kept
// build, from its judged app rows paired by item with the kept build's (the fix13c composites). The rules are the
// ones written in docs/ITERATIONS-ASTRA.md before any of these rows had a score:
//   Reasoning on typed turns (fix15), condition (4), 2026-10-02 01:32Z: the judged typed app rows are positive on
//     holdout with hard fails not up, and positive on dev. (Conditions 1-3: both replay pairs pass, clean app run.)
//   The three "material cannot answer" parts (fix14 promotion rule, 2026-10-01 22:24Z), over the modes whose pair
//     says BUILD: (1) holdout pooled gain positive, interval excluding 0; (2) holdout hard fails not up in total;
//     (3) no built mode down by more than 0.4 with its interval excluding 0 on holdout — a mode failing that alone
//     is removed and the pooled test recomputed once; (4) dev pooled agrees in sign; (6) important_question_unanswered
//     not up. Rules (5) validators and (7) typed refinement are objective and come from tools/validators-paired.mjs
//     and tools/refine-check.mjs.
// Aggregates only: nothing here prints a row or an id, so it is safe for holdout.
//   node astra/promote.mjs [--root <harness dir>]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonl } from './store.mjs';

// --root <dir>: read another harness tree (the test uses a made-up one).
const rootArg = process.argv.indexOf('--root');
const ROOT = rootArg >= 0 ? path.resolve(process.argv[rootArg + 1]) : path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const jl = (f) => readJsonl(path.join(ROOT, f));
function judged(f) {
  const by = {};
  for (const j of jl(f)) {
    if (!j.ok || !j.official || (j.repeat ?? 0) !== 0 || (j.k ?? 0) !== 0) continue;
    by[j.benchmark_id] = { s: j.official.overall, hf: !!j.official.hard_fail, flags: j.official.flags ?? [] };
  }
  return by;
}
const mean = (x) => x.reduce((p, q) => p + q, 0) / x.length;
const sd = (x) => { const m = mean(x); return Math.sqrt(x.reduce((p, q) => p + (q - m) ** 2, 0) / Math.max(1, x.length - 1)); };
const f2 = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
function pair(A, B, ids, flag = null) {
  const both = ids.filter((id) => A[id] && B[id]);
  if (!both.length) return { n: 0, expected: ids.length };
  const d = both.map((id) => B[id].s - A[id].s);
  return {
    n: both.length, expected: ids.length, a: mean(both.map((id) => A[id].s)), b: mean(both.map((id) => B[id].s)),
    diff: mean(d), half: both.length > 1 ? 1.96 * sd(d) / Math.sqrt(both.length) : NaN,
    hfA: both.filter((id) => A[id].hf).length, hfB: both.filter((id) => B[id].hf).length,
    flagA: flag ? both.filter((id) => A[id].flags.includes(flag)).length : 0, flagB: flag ? both.filter((id) => B[id].flags.includes(flag)).length : 0,
  };
}
const complete = (p) => p.n > 0 && p.n === p.expected;
const cell = (p) => (complete(p) ? `${p.n} | ${p.a.toFixed(2)} | ${p.b.toFixed(2)} | ${f2(p.diff)} (±${p.half.toFixed(2)}) | ${p.hfA} → ${p.hfB}` : `${p.n} of ${p.expected} | | | | `);
const SETS = { dev: 'abs-dev-c2', holdout: 'abs-holdout-c2' };
const KEPT = { dev: 'aq2-dev-fix13c', holdout: 'aq2-holdout-fix13c' };
const appRows = (run) => jl(`results/${run}/natively_benchmark_full.jsonl`);

console.log(`# Promotion rules on the candidates' app rows — judge gpt-6-astra — ${new Date().toISOString()}\n`);
console.log(`Paired by item with the kept build (${KEPT.dev}, ${KEPT.holdout}). Holdout is aggregate only.\n`);

// ---- Reasoning on typed turns (fix15) ----
console.log('## Reasoning on typed turns (fix15) — condition (4): judged typed app rows against the kept build\n');
console.log('| split | rows | typed rows judged | kept | fix15 | difference (95%) | hard fails |');
console.log('|---|---|---:|---:|---:|---:|---:|');
const r15 = {};
for (const split of ['dev', 'holdout']) {
  const run = `aq2-${split}-fix15`;
  const rows = appRows(run);
  const A = judged(`astra/out/${SETS[split]}/${KEPT[split]}.jsonl`); const B = judged(`astra/out/${SETS[split]}/${run}.jsonl`);
  const typed = rows.filter((r) => r.surface_path === 'typed').map((r) => r.benchmark_id);
  const heard = rows.filter((r) => r.surface_path !== 'typed').map((r) => r.benchmark_id);
  r15[split] = pair(A, B, typed);
  console.log(`| ${split} | typed (reason) | ${cell(r15[split])} |`);
  console.log(`| ${split} | heard (unchanged code, a new sample) | ${cell(pair(A, B, heard))} |`);
}
{
  const d = r15.dev; const h = r15.holdout;
  const verdict = !complete(d) || !complete(h) ? 'INCOMPLETE — no verdict'
    : h.diff > 0 && h.hfB <= h.hfA && d.diff > 0 ? 'condition (4) MET'
      : `condition (4) NOT MET (${[!(h.diff > 0) ? 'holdout typed rows not positive' : null, h.hfB > h.hfA ? 'holdout hard fails up' : null, !(d.diff > 0) ? 'dev typed rows not positive' : null].filter(Boolean).join('; ')}) — fix15 stays a candidate`;
  console.log(`\nVerdict: ${verdict}. Promotion also needs both replay pairs to pass (astra/decide.mjs) and the clean app run (shown 2026-10-02 01:28Z).`);
}

// ---- The three "material cannot answer" parts ----
const PARTS = [
  { mode: 'looking-for-work', label: 'Looking for work — fallback rule', base: 'lfw-base', variant: 'lfw-bridge-v2', app: 'fix14' },
  { mode: 'call-center', label: 'Call Center — no-policy notice (heard)', base: 'ccfin-base', variant: 'ccfin-nopolicy-v1h', app: 'fix16' },
  { mode: 'sales', label: 'Sales — reply shape notice (heard)', base: 'salesfin-base', variant: 'salesfin-shape-v1h', app: 'fix16' },
];
// The same rule astra/decide.mjs applies to the dev replay pairs.
function replayVerdict(part) {
  const ids = [...new Set(jl(`results/replay/${part.base}.jsonl`).filter((r) => (r.k ?? 0) === 0).map((r) => r.id))];
  const p = pair(judged(`results/replay/${part.base}.judged.jsonl`), judged(`results/replay/${part.variant}.judged.jsonl`), ids);
  if (!complete(p)) return 'incomplete';
  return p.diff >= 0.3 && p.diff - p.half > 0 && p.hfB <= p.hfA ? 'BUILD' : 'DO NOT BUILD';
}
const FLAG = 'important_question_unanswered';
function partPair(part, split) {
  const run = `aq2-${split}-${part.app}`;
  const ids = appRows(run).filter((r) => r.mode === part.mode).map((r) => r.benchmark_id);
  return { ids, run, p: pair(judged(`astra/out/${SETS[split]}/${KEPT[split]}.jsonl`), judged(`astra/out/${SETS[split]}/${run}.jsonl`), ids, FLAG) };
}
function pooled(parts, split) {
  const A = judged(`astra/out/${SETS[split]}/${KEPT[split]}.jsonl`);
  const B = {}; const ids = [];
  for (const part of parts) { const x = partPair(part, split); const J = judged(`astra/out/${SETS[split]}/${x.run}.jsonl`); for (const id of x.ids) { ids.push(id); if (J[id]) B[id] = J[id]; } }
  return pair(A, B, ids, FLAG);
}

console.log('\n## The three "material cannot answer" parts — fix14 promotion rule on the built modes\n');
console.log('| part | replay pair | split | rows | kept | candidate | difference (95%) | hard fails | question left unanswered |');
console.log('|---|---|---|---:|---:|---:|---:|---:|---:|');
for (const part of PARTS) {
  part.verdict = replayVerdict(part);
  for (const split of ['dev', 'holdout']) {
    const { p } = partPair(part, split);
    console.log(`| ${part.label} | ${part.verdict} | ${split} | ${cell(p)} | ${complete(p) ? `${p.flagA} → ${p.flagB}` : ''} |`);
  }
}
let built = PARTS.filter((p) => p.verdict === 'BUILD');
const pending = PARTS.filter((p) => p.verdict === 'incomplete');
if (pending.length) console.log(`\nReplay pair not fully judged yet: ${pending.map((p) => p.label).join('; ')}.`);
if (!built.length) {
  console.log(pending.length ? '\nVerdict: INCOMPLETE — no part has a verdict from its replay pair yet.' : '\nNo part has a BUILD verdict from its replay pair: nothing to promote; the app rows above are reported only.');
} else {
  const notes = [];
  const down = (part) => { const { p } = partPair(part, 'holdout'); return complete(p) && p.diff < -0.4 && p.diff + p.half < 0; };
  const failing = built.filter(down);
  if (failing.length === 1 && built.length > 1) { notes.push(`rule 3: ${failing[0].label} is down by more than 0.4 on holdout with its interval excluding 0 — removed, pooled test recomputed once on the rest`); built = built.filter((p) => p !== failing[0]); }
  const h = pooled(built, 'holdout'); const d = pooled(built, 'dev');
  console.log(`\nBuilt modes: ${built.map((p) => p.mode).join(', ')}.`);
  console.log('\n| pooled over the built modes | rows | kept | candidate | difference (95%) | hard fails | question left unanswered |');
  console.log('|---|---:|---:|---:|---:|---:|---:|');
  console.log(`| holdout | ${cell(h)} | ${complete(h) ? `${h.flagA} → ${h.flagB}` : ''} |`);
  console.log(`| dev | ${cell(d)} | ${complete(d) ? `${d.flagA} → ${d.flagB}` : ''} |`);
  if (!complete(h) || !complete(d)) console.log('\nVerdict: INCOMPLETE — no verdict (app rows not fully judged).');
  else {
    const fails = [
      !(h.diff > 0 && h.diff - h.half > 0) ? '1: holdout pooled gain is not positive with its interval excluding 0' : null,
      h.hfB > h.hfA ? '2: holdout hard fails up' : null,
      built.some(down) ? '3: a built mode is down by more than 0.4 on holdout' : null,
      Math.sign(d.diff) !== Math.sign(h.diff) ? '4: dev does not agree in sign' : null,
      h.flagB > h.flagA || d.flagB > d.flagA ? '6: "question left unanswered" is up' : null,
    ].filter(Boolean);
    for (const n of notes) console.log(`\nNote — ${n}.`);
    console.log(`\nVerdict: ${fails.length ? `NOT PROMOTED (rule ${fails.join('; rule ')}) — the kept build stays; reported as a candidate` : 'rules 1–4 and 6 MET — promotion still needs rule 5 (tools/validators-paired.mjs) and rule 7 (tools/refine-check.mjs)'}.`);
  }
}
