#!/usr/bin/env node
// Aggregates of Astra judgments, rescored under the CURRENT deterministic checks (objective.mjs). Prints counts and
// means only: no ids, questions, answers or explanations, so it is safe on the blind sets.
//   node evidence-rich/report/window-read.mjs single <set>:<run>[,<run>…] [--bench pack24] [--mode a,b] [--by mode,condition,kind]
//   node evidence-rich/report/window-read.mjs pair   <set>:<runA>[,…] <set>:<runB>[,…] [--bench pack24] [--mode a,b] [--by mode,condition,kind]
// A pair is read on the questions judged on BOTH sides (run k of side A against run k of side B).
// Run from benchmarks/natively-answer-quality. `--bench pack24` reads the separate pack24 corpus (set ER_BENCH_DIR too).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRun, objective, OBJECTIVE_VERSION } from '../objective.mjs';
import { officialScore, mean, pct, ci95 } from '../judge/score-er.mjs';
const ER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2); const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const [cmd, ...specs] = pos;
const ROOT = opt('bench') ? path.join(ER, opt('bench')) : ER;
const modes = opt('mode') ? new Set(opt('mode').split(',')) : null;
const by = (opt('by') ?? 'mode').split(',').filter(Boolean);
const lines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
const exact = (j) => j.judge_model === 'gpt-6-astra' && (j.calls ?? []).every((c) => !c.model_mismatch && (!c.returned_model || c.returned_model === 'gpt-6-astra'));
const INVENTION = /^(unsupported_|fabricated_)/;
// pack24 ids: ER-P24-<PFX>-N-nnn are the questions written for the larger packs, the others are derived from frozen ones
const kindOf = (id) => (/^ER-P24-/.test(id) ? (/-N-\d+$/.test(id) ? 'new' : 'derived') : 'all');

function read(spec) {
  const [set, runs] = spec.split(':'); const out = [];
  for (const name of runs.split(',')) {
    const run = loadRun(path.join(ROOT, 'results', name)); const last = new Map();
    for (const j of lines(path.join(ROOT, 'judge/out', set, `${name}.astra.jsonl`))) if (j.ok) last.set(j.benchmark_id, j);
    let rows = 0, notExact = 0;
    for (const row of run.rows) {
      const item = run.ds.byId[row.benchmark_id]; if (!item || (modes && !modes.has(item.mode))) continue; rows++;
      const j = last.get(row.benchmark_id); if (!j) continue; if (!exact(j)) { notExact++; continue; }
      const off = officialScore(j.judgment, item.mode, objective(item, row));
      out.push({ run: name, id: row.benchmark_id, mode: item.mode, condition: item.condition, kind: kindOf(row.benchmark_id), overall: off.overall, hard: !!off.hard_fail, invention: (off.flags ?? []).some((f) => INVENTION.test(f)), flags: off.flags ?? [] });
    }
    console.log(`  ${name} [${set}]: ${rows} rows in scope, ${out.filter((x) => x.run === name).length} judged by exact gpt-6-astra${notExact ? `, ${notExact} set aside (returned model not exact)` : ''}`);
  }
  return out;
}
const f2 = (x) => (x == null ? '–' : x.toFixed(3));
const stat = (xs) => { const v = xs.map((x) => x.overall); return `n ${String(xs.length).padStart(3)} | mean ${f2(mean(v))} ±${xs.length > 1 ? ci95(v).toFixed(2) : '–'} | p10 ${xs.length ? pct(v, 10).toFixed(1) : '–'} | median ${xs.length ? pct(v, 50).toFixed(1) : '–'} | hard ${xs.filter((x) => x.hard).length} (${xs.length ? (100 * xs.filter((x) => x.hard).length / xs.length).toFixed(1) : '–'} %) | ≥9.5 ${xs.filter((x) => x.overall >= 9.5).length} | invention-flag rows ${xs.filter((x) => x.invention).length}`; };
const groups = (xs, key) => [...new Set(xs.map((x) => x[key]))].sort();

console.log(`checks ${OBJECTIVE_VERSION}${modes ? `, modes ${[...modes].join(', ')}` : ''}`);
if (cmd === 'single') {
  const xs = read(specs[0]);
  console.log(`ALL          ${stat(xs)}`);
  for (const k of by) for (const g of groups(xs, k)) console.log(`${k}=${String(g).padEnd(22)} ${stat(xs.filter((x) => x[k] === g))}`);
} else if (cmd === 'pair') {
  const [sa, sb] = specs; const ra = sa.split(':')[1].split(','), rb = sb.split(':')[1].split(',');
  const A = read(sa), B = read(sb); const P = [];
  ra.forEach((name, k) => { const bm = new Map(B.filter((x) => x.run === rb[k]).map((x) => [x.id, x])); for (const a of A.filter((x) => x.run === name)) { const b = bm.get(a.id); if (b) P.push({ a, b, mode: a.mode, condition: a.condition, kind: a.kind }); } });
  const line = (label, xs) => { if (!xs.length) return; const d = xs.map((p) => p.b.overall - p.a.overall); const m = mean(d), h = xs.length > 1 ? ci95(d) : NaN;
    console.log(`${label.padEnd(34)} n ${String(xs.length).padStart(3)} | ${f2(mean(xs.map((p) => p.a.overall)))} → ${f2(mean(xs.map((p) => p.b.overall)))} | diff ${m >= 0 ? '+' : ''}${m.toFixed(3)} (95 % ${(m - h).toFixed(2)} to ${(m + h).toFixed(2)}) | hard ${xs.filter((p) => p.a.hard).length} → ${xs.filter((p) => p.b.hard).length} | invention-flag rows ${xs.filter((p) => p.a.invention).length} → ${xs.filter((p) => p.b.invention).length} | better ${d.filter((x) => x > 0.25).length}, worse ${d.filter((x) => x < -0.25).length} | p10 ${pct(xs.map((p) => p.a.overall), 10).toFixed(1)} → ${pct(xs.map((p) => p.b.overall), 10).toFixed(1)}`); };
  line('ALL pairs', P);
  for (const k of by) for (const g of groups(P, k)) line(`${k}=${g}`, P.filter((p) => p[k] === g));
} else { console.error('usage: window-read.mjs single|pair …'); process.exit(2); }
