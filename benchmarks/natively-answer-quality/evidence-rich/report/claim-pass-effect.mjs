// The claim pass's whole effect per slice and per mode (needs the .draft judgments): … claim-pass-effect.mjs base e1
// Run from benchmarks/natively-answer-quality. Judge files: ER_JUDGE=opus (default, provisional) or ER_JUDGE=astra; never pooled.
import { loadRun, funnel, readJsonl } from '../objective.mjs';
import { mean, ci95 } from '../judge/score-er.mjs';
const JUDGE = process.env.ER_JUDGE || 'opus';
for (const tag of process.argv.slice(2)) { const rows = [];
  for (const s of ['dev', 'cf']) { const name = `er-${s}-${tag}`; const run = loadRun(`evidence-rich/results/${name}`);
    const S = Object.fromEntries(readJsonl(`evidence-rich/judge/out/base/${name}.${JUDGE}.jsonl`).filter((j) => j.ok).map((j) => [j.benchmark_id, j])); const D = Object.fromEntries(readJsonl(`evidence-rich/judge/out/base/${name}.draft.${JUDGE}.jsonl`).filter((j) => j.ok).map((j) => [j.benchmark_id, j]));
    for (const row of run.rows) { const s2 = S[row.benchmark_id]; if (!s2) continue; const item = run.ds.byId[row.benchmark_id]; const fn = funnel(item, row, run); const d = D[row.benchmark_id]; rows.push({ item, fn, on: s2.official, off: (d ?? s2).official }); } }
  const line = (l, xs) => { const g = xs.map((r) => r.on.overall - r.off.overall); console.log(`  ${l.padEnd(44)} n=${String(xs.length).padStart(3)}  pass off ${mean(xs.map((r) => r.off.overall)).toFixed(2)}  pass on ${mean(xs.map((r) => r.on.overall)).toFixed(2)}  on − off ${mean(g) >= 0 ? '+' : ''}${mean(g).toFixed(2)} ±${(ci95(g) ?? 0).toFixed(2)}  hard fails off ${xs.filter((r) => r.off.hard_fail).length} / on ${xs.filter((r) => r.on.hard_fail).length}  critical off ${xs.filter((r) => r.off.critical).length} / on ${xs.filter((r) => r.on.critical).length}`); };
  console.log(`build ${tag}: dev + counterfactual, the claim pass's whole effect (rows it did not change count as 0)`);
  line('all rows', rows); line('evidence required, in the prompt', rows.filter((r) => r.fn.evidence_required && r.fn.evidence_delivered)); line('evidence required, not in the prompt', rows.filter((r) => r.fn.evidence_required && r.fn.evidence_delivered === false)); line('missing evidence', rows.filter((r) => r.item.condition === 'missing_evidence')); line('irrelevant source', rows.filter((r) => r.item.condition === 'irrelevant_source')); line('conflict / stale', rows.filter((r) => r.item.condition === 'conflict_stale'));
  for (const m of ['general', 'sales', 'recruiting', 'team-meet', 'looking-for-work', 'lecture', 'technical-interview', 'seminar', 'call-center']) line(`mode ${m}`, rows.filter((r) => r.item.mode === m)); }
