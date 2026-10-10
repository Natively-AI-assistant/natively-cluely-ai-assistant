// The rows that missed their reference evidence in a control build, paired with a candidate; plus one mode's rows
// and its flags:  node evidence-rich/report/missed-rows.mjs m1 m2 recruiting -- dev cf [--blind]
// Run from benchmarks/natively-answer-quality. ER_JUDGE=opus (default, provisional) or astra.
import { loadRun, funnel, readJsonl } from '../objective.mjs';
import { mean, ci95 } from '../judge/score-er.mjs';
const JUDGE = process.env.ER_JUDGE || 'opus'; const argv = process.argv.slice(2).filter((a) => a !== '--blind'); const cut = argv.indexOf('--'); const [tagA, tagB, mode] = argv.slice(0, cut); const sets = argv.slice(cut + 1);
const load = (tag) => { const m = {}; for (const s of sets) { const name = `er-${s}-${tag}`; const run = loadRun(`evidence-rich/results/${name}`); const S = Object.fromEntries(readJsonl(`evidence-rich/judge/out/base/${name}.${JUDGE}.jsonl`).filter((j) => j.ok).map((j) => [j.benchmark_id, j]));
  for (const row of run.rows) { const item = run.ds.byId[row.benchmark_id]; const j = S[row.benchmark_id]; if (!item || !j) continue; m[`${s}|${row.benchmark_id}`] = { item, row, o: j.official, fn: funnel(item, row, run) }; } } return m; };
const A = load(tagA), B = load(tagB); const P = Object.keys(A).filter((k) => B[k]).map((k) => ({ a: A[k], b: B[k] })); const f2 = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}`;
const refMissed = (r) => r.fn.doc_fact_reached_prompt === false;
const line = (l, xs) => { if (!xs.length) return console.log(`  ${l.padEnd(62)} n   0`); const d = xs.map((p) => p.b.o.overall - p.a.o.overall); console.log(`  ${l.padEnd(62)} n ${String(xs.length).padStart(3)}  ${mean(xs.map((p) => p.a.o.overall)).toFixed(2)} → ${mean(xs.map((p) => p.b.o.overall)).toFixed(2)}  ${f2(mean(d))}${xs.length >= 5 ? ' ±' + ci95(d).toFixed(2) : ''}  hard fails ${xs.filter((p) => p.a.o.hard_fail).length} → ${xs.filter((p) => p.b.o.hard_fail).length}  critical ${xs.filter((p) => p.a.o.critical).length} → ${xs.filter((p) => p.b.o.critical).length}`); };
console.log(`${tagA} → ${tagB}, ${sets.join('+')}: ${P.length} paired rows (judge ${JUDGE})`);
const missed = P.filter((p) => refMissed(p.a));
line(`rows that missed their reference evidence in ${tagA}`, missed); console.log(`     of which have it in ${tagB}: ${missed.filter((p) => p.b.fn.doc_fact_reached_prompt === true).length}`);
line('… on the fast path', missed.filter((p) => p.a.row.v3_trace?.path === 'FAST')); line('… not on the fast path', missed.filter((p) => p.a.row.v3_trace?.path !== 'FAST'));
line(`all fast-path turns of ${tagA} with a pack loaded`, P.filter((p) => p.a.row.v3_trace?.path === 'FAST' && (p.a.row.corpus_tokens ?? 0) > 0));
line('… that need no document', P.filter((p) => p.a.row.v3_trace?.path === 'FAST' && (p.a.row.corpus_tokens ?? 0) > 0 && !p.a.fn.evidence_required));
if (mode) { const M = P.filter((p) => p.a.item.mode === mode); line(`${mode}, all rows`, M); line(`${mode}, heard`, M.filter((p) => p.a.row.surface !== 'typed'));
  const flag = (side, re) => M.filter((p) => (p[side].o.flags ?? []).some((f) => re.test(f))).length;
  console.log(`  ${mode}: rows flagged unsupported_personal_claim ${flag('a', /unsupported_personal_claim/)} → ${flag('b', /unsupported_personal_claim/)}; role_confusion ${flag('a', /role_confusion/)} → ${flag('b', /role_confusion/)}; missed_available_evidence ${flag('a', /missed_available_evidence/)} → ${flag('b', /missed_available_evidence/)}`); }
