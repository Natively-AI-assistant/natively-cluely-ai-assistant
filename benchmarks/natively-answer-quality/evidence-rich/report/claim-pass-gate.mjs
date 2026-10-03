// What the claim pass contributes as built, off, and gated on reference evidence in the prompt: … claim-pass-gate.mjs e1 holdout
// Run from benchmarks/natively-answer-quality. Judge files: ER_JUDGE=opus (default, provisional) or ER_JUDGE=astra; never pooled.
import { loadRun, funnel, readJsonl } from '../objective.mjs';
import { mean, ci95 } from '../judge/score-er.mjs';
const JUDGE = process.env.ER_JUDGE || 'opus';
const tag = process.argv[2]; const sets = process.argv.slice(3); const rows = [];
for (const s of sets) { const name = `er-${s}-${tag}`; const run = loadRun(`evidence-rich/results/${name}`);
  const S = Object.fromEntries(readJsonl(`evidence-rich/judge/out/base/${name}.${JUDGE}.jsonl`).filter((j) => j.ok).map((j) => [j.benchmark_id, j])); const D = Object.fromEntries(readJsonl(`evidence-rich/judge/out/base/${name}.draft.${JUDGE}.jsonl`).filter((j) => j.ok).map((j) => [j.benchmark_id, j]));
  for (const row of run.rows) { const s2 = S[row.benchmark_id]; if (!s2) continue; const d = D[row.benchmark_id]; const hasDoc = (row.prompt_evidence ?? []).some((e) => e.provenance === 'MODE_REFERENCE_FILE'); const hasPi = (row.prompt_evidence ?? []).some((e) => /PROFILE/.test(String(e.provenance))); rows.push({ on: s2.official, off: (d ?? s2).official, hasDoc, hasPi, replaced: !!d }); } }
const show = (label, pick) => { const v = rows.map(pick); const base = rows.map((r) => r.on.overall); const g = v.map((x, i) => x.overall - base[i]); console.log(`${label.padEnd(64)} mean ${mean(v.map((x) => x.overall)).toFixed(2)} (vs pass always on ${mean(g) >= 0 ? '+' : ''}${mean(g).toFixed(2)} ±${(ci95(g) ?? 0).toFixed(2)})  hard fails ${v.filter((x) => x.hard_fail).length}  critical ${v.filter((x) => x.critical).length}`); };
console.log(`build ${tag}, sets ${sets.join('+')}, ${rows.length} rows; rows with reference-file evidence in the prompt: ${rows.filter((r) => r.hasDoc).length}; of the ${rows.filter((r) => r.replaced).length} replaced rows, ${rows.filter((r) => r.replaced && r.hasDoc).length} had reference evidence`);
show('claim pass on every turn (as built)', (r) => r.on); show('claim pass off', (r) => r.off);
show('claim pass only where no reference file is in the prompt', (r) => (r.hasDoc ? r.off : r.on));
show('claim pass only where no file and no profile evidence is in the prompt', (r) => (r.hasDoc || r.hasPi ? r.off : r.on));
