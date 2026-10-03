// Isolation rows by kind: … isolation-kinds.mjs evidence-rich/results/er-iso-e1 [judge file]
// Run from benchmarks/natively-answer-quality. Judge files: ER_JUDGE=opus (default, provisional) or ER_JUDGE=astra; never pooled.
import { loadRun, funnel, objective, answerOf, readJsonl } from '../objective.mjs';
const JUDGE = process.env.ER_JUDGE || 'opus';
const run = loadRun(process.argv[2]); const J = Object.fromEntries(readJsonl(process.argv[3]).filter((j) => j.ok).map((j) => [j.benchmark_id, j]));
const by = {};
for (const row of run.rows) { const item = run.ds.byId[row.benchmark_id]; const j = J[row.benchmark_id]; const fn = funnel(item, row, run); const o = objective(item, row);
  const k = item.iso_kind; (by[k] ??= []).push(j?.official.overall ?? null);
  const leak = (j?.official.flags ?? []).filter((f) => ['wrong_profile_used', 'pi_leak', 'cross_mode_reference_leak'].includes(f));
  console.log(`${row.benchmark_id} ${String(item.iso_kind).padEnd(38)} ${item.mode.padEnd(19)} pi:${String(row.pi_state).padEnd(4)} ${j ? j.official.overall.toFixed(1) : ' - '} ${leak.length ? 'LEAK:' + leak.join(',') : ''} ${fn.cross_mode_source_in_prompt.length ? 'XMODE-IN-PROMPT' : ''} ${fn.pi_in_forbidden_mode_prompt ? 'PI-IN-PROMPT' : ''} ${fn.wrong_profile_reached_prompt ? 'OTHER-PROFILE-IN-PROMPT:' + fn.wrong_profile_needles_in_prompt.join('/') : ''} ${(row.pi_other_profile_residue ?? []).length ? 'RESIDUE' : ''} | ${answerOf(row).replace(/\s+/g, ' ').slice(0, 130)}`); }
for (const [k, v] of Object.entries(by)) console.log(k, v.length, (v.filter((x) => x != null).reduce((a, b) => a + b, 0) / v.length).toFixed(2));
