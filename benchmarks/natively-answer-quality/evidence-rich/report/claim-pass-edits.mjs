// Cost of claim-pass edits by whether they drop a number the prompt states: … claim-pass-edits.mjs
// Run from benchmarks/natively-answer-quality. Judge files: ER_JUDGE=opus (default, provisional) or ER_JUDGE=astra; never pooled.
import { loadRun, funnel, readJsonl, answerOf, splitGist } from '../objective.mjs';
import { mean, ci95 } from '../judge/score-er.mjs';
const JUDGE = process.env.ER_JUDGE || 'opus';
const nums = (s) => new Set((String(s).match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, '')));
for (const tag of ['base', 'e1']) { const R = [];
  for (const s of ['dev', 'cf', 'holdout']) { const name = `er-${s}-${tag}`; const run = loadRun(`evidence-rich/results/${name}`); const S = Object.fromEntries(readJsonl(`evidence-rich/judge/out/base/${name}.${JUDGE}.jsonl`).filter((j) => j.ok).map((j) => [j.benchmark_id, j])); const D = Object.fromEntries(readJsonl(`evidence-rich/judge/out/base/${name}.draft.${JUDGE}.jsonl`).filter((j) => j.ok).map((j) => [j.benchmark_id, j]));
    for (const row of run.rows) { const d = D[row.benchmark_id], s2 = S[row.benchmark_id]; if (!d || !s2) continue; const material = (run.wire[row.benchmark_id]?.messages ?? []).filter((m) => m.role !== 'system').map((m) => m.text ?? '').join('\n'); const dn = nums(splitGist(row.raw_answer).body), en = nums(splitGist(answerOf(row)).body), mn = nums(material); const item = run.ds.byId[row.benchmark_id];
      R.push({ g: s2.official.overall - d.official.overall, dropSupp: [...dn].some((n) => !en.has(n) && mn.has(n)), dropAny: [...dn].some((n) => !en.has(n)), del: funnel(item, row, run).evidence_delivered === true }); } }
  const p = (l, xs) => console.log(`${tag} ${l}: n ${xs.length}, shown − draft ${xs.length ? mean(xs.map((r) => r.g)).toFixed(2) : '-'} ±${xs.length >= 5 ? ci95(xs.map((r) => r.g)).toFixed(2) : '-'}`);
  p('all replaced rows', R); p('edit drops a number the prompt states', R.filter((r) => r.dropSupp)); p('edit drops no number', R.filter((r) => !r.dropAny)); p('edit drops only numbers the prompt does not state', R.filter((r) => r.dropAny && !r.dropSupp)); p('evidence in the prompt', R.filter((r) => r.del)); p('evidence in the prompt, drops a stated number', R.filter((r) => r.del && r.dropSupp)); }
