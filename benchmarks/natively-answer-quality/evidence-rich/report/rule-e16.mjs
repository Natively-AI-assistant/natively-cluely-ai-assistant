// E16 rule, pooled over partitions: node evidence-rich/report/rule-e16.mjs <control runs, comma> <candidate runs, comma>
//   e.g. er-dev-e13c,er-dev2-e13c er-dev-e16,er-dev2-e16   (paired by position). cc judge unless ER_JUDGE is set.
import { loadRun, funnel, readJsonl } from '../objective.mjs';
const JUDGE = process.env.ER_JUDGE || 'cc';
const [ca, cb] = process.argv.slice(2).map((x) => x.split(','));
const PI = new Set(['looking-for-work', 'technical-interview']); const FLAGS = new Set(['unsupported_personal_claim', 'wrong_profile_used', 'evidence_overload']);
const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const hasResume = (row) => (row.v3_trace?.retrievedSources ?? []).some((s) => s.role === 'RESUME');
const P = [];
ca.forEach((a, i) => { const A = loadRun(`evidence-rich/results/${a}`), B = loadRun(`evidence-rich/results/${cb[i]}`);
  const JA = Object.fromEntries(readJsonl(`evidence-rich/judge/out/base/${a}.${JUDGE}.jsonl`).filter((j) => j.ok).map((j) => [j.benchmark_id, j])); const JB = Object.fromEntries(readJsonl(`evidence-rich/judge/out/base/${cb[i]}.${JUDGE}.jsonl`).filter((j) => j.ok).map((j) => [j.benchmark_id, j]));
  for (const ra of A.rows) { const rb = B.rowsById[ra.benchmark_id]; const a2 = JA[ra.benchmark_id], b2 = JB[ra.benchmark_id]; if (!rb || !a2 || !b2) continue; const item = A.ds.byId[ra.benchmark_id];
    P.push({ item, ra, rb, a: a2.official, b: b2.official, fla: a2.judgment.hard_flags ?? [], flb: b2.judgment.hard_flags ?? [], fa: funnel(item, ra, A), fb: funnel(item, rb, B), piLoaded: PI.has(item.mode) && ra.pi_state && ra.pi_state !== 'none' && /RESUME|^A$|^B$/.test(String(ra.pi_state)) && !/-JD$/.test(String(ra.pi_state)) }); } });
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');
console.log(`judge ${JUDGE}; pairs ${P.length}`);
const pi = P.filter((p) => p.piLoaded); const noA = pi.filter((p) => !hasResume(p.ra)), noB = pi.filter((p) => !hasResume(p.rb));
const req = P.filter((p) => p.fa.evidence_required); const dA = req.filter((p) => p.fa.evidence_delivered === true).length, dB = req.filter((p) => p.fb.evidence_delivered === true).length;
const gained = pi.filter((p) => !hasResume(p.ra) && hasResume(p.rb)); const gd = gained.map((p) => p.b.overall - p.a.overall);
const pm = P.filter((p) => PI.has(p.item.mode)); const flag = (fl) => fl.some((x) => FLAGS.has(x));
const all = P.map((p) => p.b.overall - p.a.overall); const hA = P.filter((p) => p.a.hard_fail).length, hB = P.filter((p) => p.b.hard_fail).length;
const fwA = med(pm.map((p) => p.ra.ttft_ms)), fwB = med(pm.map((p) => p.rb.ttft_ms));
const L = (n, ok, d) => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  (${d})`);
L('1 résumé loaded but not in the prompt: ≤ 15 % of control', noB.length <= Math.floor(0.15 * noA.length), `${noA.length} → ${noB.length} of ${pi.length} turns with a résumé loaded`);
L('2 rows with every needed fact ≥ control + 1', dB >= dA + 1, `${dA} → ${dB} of ${req.length}`);
L('3 rows that gain the résumé: mean gain ≥ +0.5', mean(gd) >= 0.5, `n ${gained.length}: ${f(mean(gained.map((p) => p.a.overall)))} → ${f(mean(gained.map((p) => p.b.overall)))}, ${f(mean(gd))}`);
L('4 profile modes: mean ≥ −0.10; flagged rows ≤ control + 2', mean(pm.map((p) => p.b.overall)) >= mean(pm.map((p) => p.a.overall)) - 0.10 && pm.filter((p) => flag(p.flb)).length <= pm.filter((p) => flag(p.fla)).length + 2, `n ${pm.length}: ${f(mean(pm.map((p) => p.a.overall)))} → ${f(mean(pm.map((p) => p.b.overall)))}; flagged ${pm.filter((p) => flag(p.fla)).length} → ${pm.filter((p) => flag(p.flb)).length}`);
L('5 all rows: mean ≥ −0.10; hard ≤ control + 3', mean(all) >= -0.10 && hB <= hA + 3, `${f(mean(P.map((p) => p.a.overall)), 3)} → ${f(mean(P.map((p) => p.b.overall)), 3)}; hard ${hA} → ${hB}`);
L('6 first word, profile modes, median ≤ control + 150 ms', fwB <= fwA + 150, `${f(fwA, 0)} → ${f(fwB, 0)} ms`);
