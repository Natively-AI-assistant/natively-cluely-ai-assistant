// E19 rule, read on the rows where the two replay arms show different text.  ER_JUDGE=astra node evidence-rich/report/rule-e19.mjs
import fs from 'node:fs';
import { loadRun, readJsonl } from '../objective.mjs';
const JUDGE = process.env.ER_JUDGE || 'astra';
const plan = JSON.parse(fs.readFileSync('evidence-rich/results/replay/astra-plan-e19.json', 'utf8'));
const cache = {}; const get = (name) => (cache[name] ??= (() => { const m = new Map(); try { for (const j of readJsonl(`evidence-rich/judge/out/base/${name}.${JUDGE}.jsonl`)) if (j.ok) m.set(j.benchmark_id, j); } catch { /* not judged yet */ } return m; })());
const side = (run, id, src, arm) => get(src === 'new' ? `rp-${arm}--${run}` : src === 'draft' ? `${run}.draft` : run).get(id);
const P = []; let missing = 0;
for (const p of plan.e19pairs) { const c = side(p.run, p.id, p.sc, 'e19-ctl'), v = side(p.run, p.id, p.sv, 'e19'); if (!c || !v) { missing++; continue; } P.push({ ...p, c: c.official, v: v.official, fc: c.judgment.hard_flags ?? [], fv: v.judgment.hard_flags ?? [] }); }
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a'); const sum = (a) => a.reduce((x, y) => x + y, 0); const md = (rows) => sum(rows.map((r) => r.v.overall - r.c.overall)) / Math.max(1, rows.length);
const hard = (rows, k) => rows.filter((r) => r[k].hard_fail).length; const has = (rows, k, re) => rows.filter((r) => r[k].some((x) => re.test(x))).length;
const INV = /^unsupported_|^fabricated_/; const MISS = /^(important_question_unanswered|missed_available_evidence)$/;
console.log(`judge ${JUDGE}; rows where the arms differ ${plan.e19pairs.length}, both sides judged ${P.length}${missing ? ` (NOT YET: ${missing})` : ''}`);
const L = (n, ok, t) => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  (${t})`); const me = P.filter((r) => r.cond === 'missing_evidence');
const show = (rows) => `${f(sum(rows.map((r) => r.c.overall)) / Math.max(1, rows.length))} → ${f(sum(rows.map((r) => r.v.overall)) / Math.max(1, rows.length))}`;
L('1 missing_evidence rows that differ: mean change ≥ +0.30; hard fails ≤ control arm', md(me) >= 0.30 && hard(me, 'v') <= hard(me, 'c'), `n ${me.length}: ${show(me)}, ${f(md(me))}; hard ${hard(me, 'c')} → ${hard(me, 'v')}`);
L('2 all rows that differ: mean change ≥ 0; hard fails ≤ control arm', md(P) >= 0 && hard(P, 'v') <= hard(P, 'c'), `n ${P.length}: ${show(P)}, ${f(md(P))}; hard ${hard(P, 'c')} → ${hard(P, 'v')}`);
L('3 rows flagged unsupported_* or fabricated_* ≤ control arm + 1', has(P, 'fv', INV) <= has(P, 'fc', INV) + 1, `${has(P, 'fc', INV)} → ${has(P, 'fv', INV)}`);
L('4 rows flagged important_question_unanswered / missed_available_evidence ≤ control arm', has(P, 'fv', MISS) <= has(P, 'fc', MISS), `${has(P, 'fc', MISS)} → ${has(P, 'fv', MISS)}`);
const by = {}; for (const r of P) (by[r.cond] ??= []).push(r); console.log('  by condition:', Object.entries(by).map(([k, v]) => `${k} n ${v.length} ${f(md(v))}`).join('; '));
const up = P.filter((r) => r.v.overall - r.c.overall > 1.5), dn = P.filter((r) => r.v.overall - r.c.overall < -1.5); console.log(`  rise >1.5: ${up.length} (${up.map((r) => r.id.replace('ER-', '')).join(' ')})`); console.log(`  fall >1.5: ${dn.length} (${dn.map((r) => r.id.replace('ER-', '')).join(' ')})`);
