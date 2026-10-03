// What the edits of one replay arm cost or gain, row by row, and what a rail on them would change.
//   node evidence-rich/report/replay-edits.mjs <arm> evidence-rich/results/er-dev-e1,evidence-rich/results/er-cf-e1 [--list N]
// Run from benchmarks/natively-answer-quality. ER_JUDGE=opus (default, provisional) or astra.
import path from 'node:path';
import { loadRun, funnel, readJsonl, splitGist } from '../objective.mjs';
import { mean, ci95 } from '../judge/score-er.mjs';
const JUDGE = process.env.ER_JUDGE || 'opus';
const [name, runsArg, ...rest] = process.argv.slice(2); const list = rest.includes('--list') ? Number(rest[rest.indexOf('--list') + 1]) : 0;
const nums = (s) => new Set((String(s).match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, '')));
const body = (t) => splitGist(t).body.replace(/\s+/g, ' ').trim();
const A = {}; for (const r of readJsonl(`evidence-rich/results/replay/${name}.jsonl`)) if (r.k === 0) A[`${r.run}|${r.id}`] = r;
const J = (f) => Object.fromEntries(readJsonl(f).filter((j) => j.ok).map((j) => [j.benchmark_id, j]));
const R = [];
for (const dir of runsArg.split(',')) { const run = loadRun(dir); const rn = path.basename(dir); const S = J(`evidence-rich/judge/out/base/${rn}.${JUDGE}.jsonl`), D = J(`evidence-rich/judge/out/base/${rn}.draft.${JUDGE}.jsonl`), N = J(`evidence-rich/judge/out/base/rp-${name}--${rn}.${JUDGE}.jsonl`);
  for (const row of run.rows) { const rec = A[`${rn}|${row.benchmark_id}`]; if (!rec || !rec.changed || body(rec.text) === body(row.raw_answer)) continue;
    const draft = (row.answer_differs_raw_vs_rendered ? D[row.benchmark_id] : S[row.benchmark_id])?.official; const shown = (row.answer_differs_raw_vs_rendered && body(rec.text) === body(row.rendered_answer ?? '') ? S[row.benchmark_id] : N[row.benchmark_id])?.official; if (!draft || !shown) continue;
    const item = run.ds.byId[row.benchmark_id]; const full = (run.wire[row.benchmark_id]?.messages ?? []).filter((m) => m.role !== 'system').map((m) => m.text ?? '').join('\n');
    const dn = nums(splitGist(row.raw_answer).body), en = nums(rec.text), mn = nums(full); const dropped = [...dn].filter((n) => !en.has(n) && mn.has(n)); const added = [...en].filter((n) => !dn.has(n));
    R.push({ id: row.benchmark_id, item, row, rec, g: shown.overall - draft.overall, draft, shown, dropped, added, fn: funnel(item, row, run) }); } }
const p = (l, xs) => console.log(`  ${l.padEnd(60)} n ${String(xs.length).padStart(3)}  shown − draft ${xs.length ? (mean(xs.map((r) => r.g)) >= 0 ? '+' : '') + mean(xs.map((r) => r.g)).toFixed(2) : '–'}${xs.length >= 5 ? ' ±' + ci95(xs.map((r) => r.g)).toFixed(2) : ''}  hard fails ${xs.filter((r) => r.draft.hard_fail).length} → ${xs.filter((r) => r.shown.hard_fail).length}  better>0.5: ${xs.filter((r) => r.g > 0.5).length} worse>0.5: ${xs.filter((r) => r.g < -0.5).length}`);
console.log(`arm ${name}: ${R.length} edited rows (judge ${JUDGE})`);
p('all edits', R); p('edit drops a number the prompt states', R.filter((r) => r.dropped.length)); p('… and adds no number (the E3 rail would reject)', R.filter((r) => r.dropped.length && !r.added.length)); p('edit drops no stated number', R.filter((r) => !r.dropped.length));
p('evidence required and in the prompt', R.filter((r) => r.fn.evidence_required && r.fn.evidence_delivered === true)); p('need no document', R.filter((r) => ['missing_evidence', 'irrelevant_source'].includes(r.item.condition))); p('conflict / stale', R.filter((r) => r.item.condition === 'conflict_stale'));
const conflictNamed = (r) => /CONFLICT:(?!\s*none)\s*\S/i.test(r.rec.scratch);
p("the pass named a CONFLICT", R.filter(conflictNamed)); p("the pass named no conflict", R.filter((r) => !conflictNamed(r)));
for (const r of [...R].sort((a, b) => a.g - b.g).slice(0, list)) console.log(`\n${r.id} [${r.item.mode} / ${r.item.condition}] ${r.draft.overall.toFixed(1)} → ${r.shown.overall.toFixed(1)} dropped ${r.dropped.join(',') || '-'}\n  Q: ${String(r.row.question).slice(0, 150)}\n  DRAFT: ${body(r.row.raw_answer).slice(0, 330)}\n  SHOWN: ${body(r.rec.text).slice(0, 330)}\n  ${r.rec.scratch.slice(0, 330).replace(/\n/g, ' ⏎ ')}`);
