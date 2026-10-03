// The two profile modes, a candidate against a control: delivery of profile facts (judge-free) and paired scores.
//   node evidence-rich/report/profile-rows.mjs s3 s4 dev cf [--blind]
// Run from benchmarks/natively-answer-quality. ER_JUDGE=opus (default, provisional) or astra; never pooled.
import { loadRun, funnel, readJsonl } from '../objective.mjs';
import { mean, ci95 } from '../judge/score-er.mjs';
const JUDGE = process.env.ER_JUDGE || 'opus';
const argv = process.argv.slice(2).filter((a) => a !== '--blind'); const [tagA, tagB, ...sets] = argv;
const PI = new Set(['looking-for-work', 'technical-interview']);
const load = (tag) => { const m = {}; let passes = 0, cut = 0; for (const s of sets) { const name = `er-${s}-${tag}`; let run; try { run = loadRun(`evidence-rich/results/${name}`); } catch { continue; }
  const S = Object.fromEntries(readJsonl(`evidence-rich/judge/out/base/${name}.${JUDGE}.jsonl`).filter((j) => j.ok).map((j) => [j.benchmark_id, j]));
  for (const row of run.rows) { const item = run.ds.byId[row.benchmark_id]; if (!item || (s !== 'iso' && !PI.has(item.mode))) continue; const w = run.wire[row.benchmark_id];
    const user = (w?.messages ?? []).map((x) => x.text ?? '').join('\n'); for (const o of w?.other_requests ?? []) { const t = (o.messages ?? []).map((x) => x.text ?? '').join('\n'); if (/DRAFT REPLY:/.test(t)) { passes++; if (/truncated for the repair pass/.test(t) || user.length > 96000) cut++; } }
    m[`${s}|${row.benchmark_id}`] = { item, row, o: S[row.benchmark_id]?.official ?? null, fn: funnel(item, row, run), chars: user.length, whole: (user.match(/section="Document \(whole\)"/g) ?? []).length }; } }
  return { m, passes, cut }; };
const A = load(tagA), B = load(tagB); const keys = Object.keys(A.m).filter((k) => B.m[k]);
const needs = (r) => r.fn.pi_fact_reached_prompt === true || r.fn.pi_fact_reached_prompt === false;
for (const [tag, X] of [[tagA, A], [tagB, B]]) { const rows = keys.map((k) => X.m[k]); const n = rows.filter(needs); const med = (v) => { const s = v.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? Math.round(s[Math.floor(s.length / 2)]) : NaN; };
  const heard = rows.filter((r) => r.row.surface !== 'typed');
  console.log(`${tag}: rows ${rows.length}; need a profile fact ${n.length}, every one in the prompt ${n.filter((r) => r.fn.pi_fact_reached_prompt === true).length}; prompts with a whole profile document ${rows.filter((r) => r.whole > 0).length}; claim passes ${X.passes}, cut ${X.cut}; prompt chars median ${med(rows.map((r) => r.chars))} max ${Math.max(...rows.map((r) => r.chars))}; heard first word median ${med(heard.map((r) => r.row.ttft_ms))} ms (n ${heard.length}); request sent median ${med(heard.map((r) => r.row.request_dispatch_ms))} ms; input tokens median ${med(rows.map((r) => r.row.input_tokens))}`); }
const P = keys.map((k) => ({ a: A.m[k], b: B.m[k] })).filter((p) => p.a.o && p.b.o); const f2 = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}`;
console.log(`paired and judged: ${P.length} (judge ${JUDGE})`);
const line = (l, xs) => { if (!xs.length) return console.log(`  ${l.padEnd(58)} n   0`); const d = xs.map((p) => p.b.o.overall - p.a.o.overall); console.log(`  ${l.padEnd(58)} n ${String(xs.length).padStart(3)}  ${mean(xs.map((p) => p.a.o.overall)).toFixed(2)} → ${mean(xs.map((p) => p.b.o.overall)).toFixed(2)}  ${f2(mean(d))}${xs.length >= 5 ? ' ±' + ci95(d).toFixed(2) : ''}  hard fails ${xs.filter((p) => p.a.o.hard_fail).length} → ${xs.filter((p) => p.b.o.hard_fail).length}  critical ${xs.filter((p) => p.a.o.critical).length} → ${xs.filter((p) => p.b.o.critical).length}`); };
line('all rows', P); line('need a profile fact', P.filter((p) => needs(p.a))); line('need no profile fact', P.filter((p) => !needs(p.a))); line('missing evidence', P.filter((p) => p.a.item.condition === 'missing_evidence'));
line('looking for work', P.filter((p) => p.a.item.mode === 'looking-for-work')); line('technical interview', P.filter((p) => p.a.item.mode === 'technical-interview')); line('profile loaded', P.filter((p) => p.a.row.pi_state && p.a.row.pi_state !== 'none')); line('no profile loaded', P.filter((p) => p.a.row.pi_state === 'none'));
