// Counterfactual families, variant by variant: … counterfactual-families.mjs evidence-rich/results/er-cf-e1 [judge file]
// Run from benchmarks/natively-answer-quality. Judge files: ER_JUDGE=opus (default, provisional) or ER_JUDGE=astra; never pooled.
import { loadRun, funnel, answerOf, readJsonl } from '../objective.mjs';
const JUDGE = process.env.ER_JUDGE || 'opus';
const run = loadRun(process.argv[2]); const J = Object.fromEntries(readJsonl(process.argv[3]).filter((j) => j.ok).map((j) => [j.benchmark_id, j]));
const fam = {};
for (const row of run.rows) { const item = run.ds.byId[row.benchmark_id]; (fam[item.cf_family] ??= []).push({ row, item, j: J[row.benchmark_id], fn: funnel(item, row, run) }); }
let famOk = 0, n = 0;
for (const [f, xs] of Object.entries(fam)) {
  xs.sort((a, b) => a.item.cf_variant.localeCompare(b.item.cf_variant));
  const all = xs.every((x) => x.j && x.j.official.overall >= 8 && !x.j.official.hard_fail); n++; if (all) famOk++;
  console.log(`\n${f} [${xs[0].item.mode}] ${xs[0].item.question.slice(0, 90)}  ${all ? 'ALL VARIANTS RIGHT' : ''}`);
  for (const x of xs) console.log(`  ${x.item.cf_variant} ${String(x.item.evidence_state).padEnd(42)} ${x.j ? x.j.official.overall.toFixed(1) : '-'} del:${x.fn.evidence_delivered === null ? 'n/a' : x.fn.evidence_delivered ? 'yes' : 'NO '} ${x.j?.official.flags.join(',') ?? ''} | ${answerOf(x.row).replace(/\s+/g, ' ').slice(0, 150)}`);
}
console.log(`\nfamilies with every variant right (>= 8, no hard fail): ${famOk}/${n}`);
