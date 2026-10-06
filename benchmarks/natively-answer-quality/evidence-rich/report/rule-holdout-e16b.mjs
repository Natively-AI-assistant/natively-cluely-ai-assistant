// Blind-holdout safety rule for E16b on today's main (aggregates only; never prints an item).
//   ER_JUDGE=astra node evidence-rich/report/rule-holdout-e16b.mjs [control run] [candidate run]
import { loadRun, funnel, readJsonl } from '../objective.mjs';
const JUDGE = process.env.ER_JUDGE || 'astra'; const [ca = 'er-holdout-m3', cb = 'er-holdout-e16b3'] = process.argv.slice(2);
const A = loadRun(`evidence-rich/results/${ca}`), B = loadRun(`evidence-rich/results/${cb}`);
const J = (n) => { const m = new Map(); for (const j of readJsonl(`evidence-rich/judge/out/base/${n}.${JUDGE}.jsonl`)) if (j.ok) m.set(j.benchmark_id, j); return m; };
const JA = J(ca), JB = J(cb); const PI = new Set(['looking-for-work', 'technical-interview']); const FL = new Set(['unsupported_personal_claim', 'wrong_profile_used']);
const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; }; const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length); const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');
const hasR = (r) => (r.v3_trace?.retrievedSources ?? []).some((s) => s.role === 'RESUME');
const side = (run) => { const o = { pi: 0, no: 0, req: 0, del: 0, ft: [] }; for (const r of run.rows) { const it = run.ds.byId[r.benchmark_id]; const fn = funnel(it, r, run); if (fn.evidence_required) { o.req++; if (fn.evidence_delivered === true) o.del++; } if (PI.has(it.mode)) { o.ft.push(r.ttft_ms); const st = String(r.pi_state || 'none'); if (st !== 'none' && !/-JD$/.test(st)) { o.pi++; if (!hasR(r)) o.no++; } } } return o; };
const a = side(A), b = side(B); const P = [];
for (const ra of A.rows) { const ja = JA.get(ra.benchmark_id), jb = JB.get(ra.benchmark_id); if (!ja || !jb) continue; P.push({ mode: A.ds.byId[ra.benchmark_id].mode, a: ja.official, b: jb.official, fa: ja.judgment.hard_flags ?? [], fb: jb.judgment.hard_flags ?? [] }); }
const pm = P.filter((p) => PI.has(p.mode)); const fl = (rows, k) => rows.filter((p) => p[k].some((x) => FL.has(x))).length;
console.log(`judge ${JUDGE}; control ${ca} (${A.rows.length} rows, ${JA.size} judged), candidate ${cb} (${B.rows.length} rows, ${JB.size} judged); pairs ${P.length} of 180`);
const L = (n, ok, t) => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  (${t})`);
L('1 résumé loaded, none in the prompt: at most a quarter of the control', b.no <= Math.floor(a.no / 4), `${a.no} → ${b.no} of ${a.pi}`);
L('2 rows with every needed fact ≥ control', b.del >= a.del, `${a.del} → ${b.del} of ${a.req}`);
L('3 all rows: mean ≥ control − 0.15; hard fails ≤ control + 3', mean(P.map((p) => p.b.overall)) >= mean(P.map((p) => p.a.overall)) - 0.15 && P.filter((p) => p.b.hard_fail).length <= P.filter((p) => p.a.hard_fail).length + 3, `${f(mean(P.map((p) => p.a.overall)), 3)} → ${f(mean(P.map((p) => p.b.overall)), 3)}; hard ${P.filter((p) => p.a.hard_fail).length} → ${P.filter((p) => p.b.hard_fail).length}`);
L('4 profile modes: mean ≥ control − 0.30; flagged rows ≤ control + 2', mean(pm.map((p) => p.b.overall)) >= mean(pm.map((p) => p.a.overall)) - 0.30 && fl(pm, 'fb') <= fl(pm, 'fa') + 2, `n ${pm.length}: ${f(mean(pm.map((p) => p.a.overall)))} → ${f(mean(pm.map((p) => p.b.overall)))}; flagged ${fl(pm, 'fa')} → ${fl(pm, 'fb')}`);
L('5 first word, profile modes, median ≤ control + 150 ms', med(b.ft) <= med(a.ft) + 150, `${f(med(a.ft), 0)} → ${f(med(b.ft), 0)} ms`);
const by = {}; for (const p of P) (by[p.mode] ??= []).push(p); console.log('  by mode:', Object.entries(by).sort().map(([k, v]) => `${k} ${f(mean(v.map((p) => p.a.overall)))}→${f(mean(v.map((p) => p.b.overall)))}`).join(' | '));
