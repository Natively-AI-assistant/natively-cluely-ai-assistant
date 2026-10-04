#!/usr/bin/env node
// Judge and compare generator replays (replay-generator.mjs). The replayed text is the DRAFT (no post-answer pass) in
// every arm, so arms are compared like with like.
//   prep   --arms a,b[,c] [--k 0,1]       derived runs results/rg-<arm>-k<k>--<run>/ + the judge command
//   effect --a base --b variant [--ids X,Y] [--k 0,1]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRun, readJsonl } from './objective.mjs';
import { mean, ci95 } from './judge/score-er.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const JUDGE = process.env.ER_JUDGE || 'cc';
const [cmd, ...args] = process.argv.slice(2); const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const rd = (arm) => readJsonl(path.join(HERE, 'results', 'replay', `gen-${arm}.jsonl`)).filter((r) => !r.err && r.text);
const ks = (arm) => (opt('k') ? String(opt('k')).split(',').map(Number) : [...new Set(rd(arm).map((r) => r.k))].sort());
const tag = (arm, k, run) => `rg-${arm}-k${k}--${run}`;
if (cmd === 'prep') {
  const dirs = [];
  for (const arm of String(opt('arms')).split(',')) { const R = rd(arm);
    for (const run of [...new Set(R.map((r) => r.run))]) { const src = path.join(HERE, 'results', run); const base = loadRun(src);
      for (const k of ks(arm)) { const mine = Object.fromEntries(R.filter((r) => r.run === run && r.k === k).map((r) => [r.id, r])); const out = path.join(HERE, 'results', tag(arm, k, run)); fs.mkdirSync(out, { recursive: true });
        for (const f of ['run.json', 'wire.jsonl', 'systems.json', 'ingest.jsonl', 'pi.jsonl']) { const dst = path.join(out, f); if (fs.existsSync(path.join(src, f)) && !fs.existsSync(dst)) fs.symlinkSync(path.join(src, f), dst); }
        const rows = base.rows.filter((row) => mine[row.benchmark_id]).map((row) => ({ ...row, raw_answer: mine[row.benchmark_id].text, rendered_answer: mine[row.benchmark_id].text, answer_differs_raw_vs_rendered: false }));
        fs.writeFileSync(path.join(out, 'rows.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n'); dirs.push(`evidence-rich/results/${tag(arm, k, run)}`); } } }
  console.log(`AQ_JUDGE=opus ER_JUDGE_ROLE=cc node evidence-rich/judge/judge-er.mjs --set base --runs ${dirs.join(',')} --concurrency 3`);
} else if (cmd === 'effect') {
  const A = opt('a'), B = opt('b'); const ids = opt('ids') ? new Set(String(opt('ids')).split(',')) : null; const P = [];
  const J = (arm) => { const m = {}; for (const run of [...new Set(rd(arm).map((r) => r.run))]) for (const k of ks(arm)) for (const j of readJsonl(path.join(HERE, 'judge', 'out', 'base', `${tag(arm, k, run)}.${JUDGE}.jsonl`))) if (j.ok) (m[`${run}|${j.benchmark_id}`] = m[`${run}|${j.benchmark_id}`] || []).push(j.official); return m; };
  const JA = J(A), JB = J(B);
  for (const key of Object.keys(JA)) { if (!JB[key]) continue; const a = JA[key], b = JB[key]; P.push({ key, id: key.split('|')[1], a: mean(a.map((o) => o.overall)), b: mean(b.map((o) => o.overall)), ha: mean(a.map((o) => (o.hard_fail ? 1 : 0))), hb: mean(b.map((o) => (o.hard_fail ? 1 : 0))) }); }
  const line = (l, xs) => { if (!xs.length) return console.log(`${l}: no rows`); const d = xs.map((p) => p.b - p.a); console.log(`${l.padEnd(34)} n ${String(xs.length).padStart(3)}  ${A} ${mean(xs.map((p) => p.a)).toFixed(3)} → ${B} ${mean(xs.map((p) => p.b)).toFixed(3)}  Δ ${mean(d) >= 0 ? '+' : ''}${mean(d).toFixed(3)} ±${ci95(d).toFixed(3)}  hard (mean of k) ${xs.reduce((s, p) => s + p.ha, 0).toFixed(1)} → ${xs.reduce((s, p) => s + p.hb, 0).toFixed(1)}  better>0.5: ${d.filter((x) => x > 0.5).length} worse>0.5: ${d.filter((x) => x < -0.5).length}`); };
  console.log(`judge ${JUDGE}`); line('all rows', P); if (ids) { line('the listed rows', P.filter((p) => ids.has(p.id))); line('the other rows', P.filter((p) => !ids.has(p.id))); }
} else { console.error('prep | effect'); process.exit(2); }
