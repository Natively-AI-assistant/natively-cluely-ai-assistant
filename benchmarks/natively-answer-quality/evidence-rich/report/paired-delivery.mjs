// Delivered / not-delivered means with intervals, and the paired change of each group between two builds: … paired-delivery.mjs
// Run from benchmarks/natively-answer-quality. Judge files: ER_JUDGE=opus (default, provisional) or ER_JUDGE=astra; never pooled.
import { loadRun, funnel, objective, readJsonl } from '../objective.mjs';
import { mean, ci95 } from '../judge/score-er.mjs';
const JUDGE = process.env.ER_JUDGE || 'opus';
const load = (tag, sets) => { const R = []; for (const s of sets) { const name = `er-${s}-${tag}`; const run = loadRun(`evidence-rich/results/${name}`); const J = Object.fromEntries(readJsonl(`evidence-rich/judge/out/base/${name}.${JUDGE}.jsonl`).filter((j) => j.ok).map((j) => [j.benchmark_id, j])); for (const row of run.rows) { const j = J[row.benchmark_id]; if (!j) continue; const item = run.ds.byId[row.benchmark_id]; const cfg = run.ds.configsById.get(row.evidence_config); R.push({ id: row.benchmark_id, set: s, item, row, o: j.official, fn: funnel(item, row, run), nfiles: (cfg?.files ?? []).length, run }); } } return R; };
const st = (l, xs) => { const v = xs.map((r) => r.o.overall); console.log(`${l}: n ${xs.length} mean ${v.length ? mean(v).toFixed(2) : '-'} ±${v.length >= 5 ? ci95(v).toFixed(2) : '-'} hard ${xs.filter((r) => r.o.hard_fail).length}`); };
const B1 = load('base', ['dev', 'cf']), BH = load('base', ['holdout']), E1 = load('e1', ['dev', 'cf']), EH = load('e1', ['holdout']);
const del = (r) => r.fn.evidence_required && r.fn.evidence_delivered === true, nd = (r) => r.fn.evidence_required && r.fn.evidence_delivered === false;
st('base dev+cf D', B1.filter(del)); st('base dev+cf N', B1.filter(nd)); st('base holdout D', BH.filter(del)); st('base holdout N', BH.filter(nd));
// paired: rows not delivered in base
for (const [l, A, B] of [['dev+cf', B1, E1], ['holdout', BH, EH], ['all', [...B1, ...BH], [...E1, ...EH]]]) { const bm = Object.fromEntries(B.map((r) => [r.set + r.id, r])); for (const [name, f] of [['not delivered in base', nd], ['delivered in base', del]]) { const pairs = A.filter(f).map((a) => [a, bm[a.set + a.id]]).filter(([, b]) => b); const g = pairs.map(([a, b]) => b.o.overall - a.o.overall); console.log(`${l} ${name}: n ${pairs.length} ${mean(pairs.map(([a]) => a.o.overall)).toFixed(2)} → ${mean(pairs.map(([, b]) => b.o.overall)).toFixed(2)} Δ ${mean(g).toFixed(2)} ±${ci95(g).toFixed(2)}; delivered in fix ${pairs.filter(([, b]) => b.fn.evidence_delivered === true).length}`); } }
const all = (xs) => xs; const EA = [...E1, ...EH], BA = [...B1, ...BH];
st('e1 nothing loaded', EA.filter((r) => r.nfiles === 0 && r.row.pi_state === 'none')); st('e1 calc', EA.filter((r) => r.item.oracle.requires_calculation)); st('base calc', BA.filter((r) => r.item.oracle.requires_calculation));
// reference delivery
for (const [l, X] of [['base', BA], ['e1', EA]]) { const ref = X.filter((r) => r.fn.reference_fact_reached_prompt !== null && r.fn.reference_fact_reached_prompt !== undefined); console.log(l, 'ref fact in prompt', ref.filter((r) => r.fn.reference_fact_reached_prompt === true).length, '/', ref.length, '| fn keys', Object.keys(X[0].fn).join(',')); }
// code tests
for (const [l, X] of [['base', BA], ['e1', EA]]) { const c = X.filter((r) => r.item.oracle.requires_code_validation); const res = c.map((r) => objective(r.item, r.row)); console.log(l, 'code rows', c.length, JSON.stringify(res.map((o) => o.code ?? o.code_tests ?? Object.keys(o)).slice(0, 2))); }
// LFW relocation family
for (const [l, X] of [['base', B1], ['e1', E1]]) console.log(l, 'CF-LFW-1', X.filter((r) => r.id.startsWith('ER-CF-LFW-1')).map((r) => `${r.id}:${r.o.overall.toFixed(1)}${r.o.hard_fail ? '!' : ''}`).join(' '));
