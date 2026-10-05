// E17 rule, read on the rows where the two replay arms show different text (identical texts differ by 0).
//   ER_JUDGE=astra node evidence-rich/report/rule-e17.mjs
// Denominators are the rows whose turn ran the pass (the replay's rows), as the rule says.
import fs from 'node:fs';
import { loadRun, readJsonl } from '../objective.mjs';
const JUDGE = process.env.ER_JUDGE || 'astra';
const plan = JSON.parse(fs.readFileSync('evidence-rich/results/replay/astra-plan.json', 'utf8'));
const B = process.argv.includes('--sample-b'); // the second sample: the same wordings on the E16b runs' drafts
const RUNS = B ? ['er-dev-e16b', 'er-dev2-e16b'] : ['er-dev-e13c', 'er-dev2-e13c']; const CTL = B ? 'e17b-ctl' : 'e17-ctl', NEW = B ? 'e17b-conflict' : 'e17-conflict'; const PAIRS = B ? plan.e17bpairs : plan.e17pairs;
const J = (name) => Object.fromEntries(readJsonl(`evidence-rich/judge/out/base/${name}.${JUDGE}.jsonl`).filter((j) => j.ok).map((j) => [j.benchmark_id, j]));
const cache = {}; const get = (name) => (cache[name] ??= J(name));
const side = (run, id, src, arm) => get(src === 'new' ? `rp-${arm}--${run}` : src === 'draft' ? `${run}.draft` : run)[id];
const runs = {}; const passRows = {};
for (const run of RUNS) runs[run] = loadRun(`evidence-rich/results/${run}`);
for (const l of fs.readFileSync(`evidence-rich/results/replay/${CTL}.jsonl`, 'utf8').split('\n').filter(Boolean)) { const j = JSON.parse(l); const c = runs[j.run].ds.byId[j.id].condition; passRows[c] = (passRows[c] ?? 0) + 1; passRows.all = (passRows.all ?? 0) + 1; }
const P = []; let missing = 0;
for (const p of PAIRS) { const c = side(p.run, p.id, p.sc, CTL), v = side(p.run, p.id, p.sv, NEW); if (!c || !v) { missing++; continue; } const item = runs[p.run].ds.byId[p.id];
  P.push({ ...p, c: c.official, v: v.official, fc: c.judgment.hard_flags ?? [], fv: v.judgment.hard_flags ?? [], unresolved: (item.known_conflicts ?? []).some((k) => k.resolution === 'unresolved') }); }
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a'); const sum = (a) => a.reduce((x, y) => x + y, 0);
const d = (rows) => sum(rows.map((r) => r.v.overall - r.c.overall)); const hard = (rows, k) => rows.filter((r) => r[k].hard_fail).length;
const CF = new Set(['source_conflict_ignored', 'stale_source_preferred']); const flagged = (rows, k) => rows.filter((r) => r[k].some((x) => CF.has(x))).length;
console.log(`judge ${JUDGE}; ${B ? 'SECOND sample (E16b drafts); ' : ''}rows where the arms differ ${PAIRS.length}, both sides judged ${P.length}${missing ? ` (NOT YET JUDGED: ${missing})` : ''}; rows whose turn ran the pass ${passRows.all}`);
const L = (n, ok, t) => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  (${t})`);
const conf = P.filter((r) => r.cond === 'conflict_stale'), miss = P.filter((r) => r.cond === 'missing_evidence');
L('2 conflict_stale rows: effect ≥ control arm + 0.30; hard fails ≤ control arm', d(conf) / passRows.conflict_stale >= 0.30 && hard(conf, 'v') <= hard(conf, 'c'), `${f(d(conf) / passRows.conflict_stale)} on ${passRows.conflict_stale} rows (the ${conf.length} that differ: ${f(sum(conf.map((r) => r.c.overall)) / conf.length)} → ${f(sum(conf.map((r) => r.v.overall)) / conf.length)}); hard ${hard(conf, 'c')} → ${hard(conf, 'v')}`);
L('3 all rows: effect ≥ control arm; hard fails ≤ control arm', d(P) >= 0 && hard(P, 'v') <= hard(P, 'c'), `${f(d(P) / passRows.all, 3)} on ${passRows.all} rows (the ${P.length} that differ: ${f(sum(P.map((r) => r.c.overall)) / P.length)} → ${f(sum(P.map((r) => r.v.overall)) / P.length)}); hard ${hard(P, 'c')} → ${hard(P, 'v')}`);
L('4 rows flagged source_conflict_ignored / stale_source_preferred ≤ control arm + 1', flagged(P, 'fv') <= flagged(P, 'fc') + 1, `${flagged(P, 'fc')} → ${flagged(P, 'fv')}`);
L('5 missing_evidence rows: effect ≥ control arm − 0.10', d(miss) / passRows.missing_evidence >= -0.10, `${f(d(miss) / passRows.missing_evidence)} on ${passRows.missing_evidence} rows (the ${miss.length} that differ: ${f(sum(miss.map((r) => r.c.overall)) / Math.max(1, miss.length))} → ${f(sum(miss.map((r) => r.v.overall)) / Math.max(1, miss.length))})`);
const by = {}; for (const r of P) (by[r.cond] ??= []).push(r);
console.log('  beside the rule — by condition (rows that differ):', Object.entries(by).map(([k, v]) => `${k} n ${v.length} ${f(d(v) / v.length)}`).join('; '));
const un = P.filter((r) => r.unresolved); console.log(`  beside the rule — rows whose oracle holds an UNRESOLVED conflict: n ${un.length}${un.length ? `, ${f(sum(un.map((r) => r.c.overall)) / un.length)} → ${f(sum(un.map((r) => r.v.overall)) / un.length)}, hard ${hard(un, 'c')} → ${hard(un, 'v')}` : ''}`);
