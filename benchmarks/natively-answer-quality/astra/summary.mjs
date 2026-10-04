#!/usr/bin/env node
// Per-mode summary of one judged file (aggregates only: safe for holdout): mean, p10, hard fails, share at 9.5+,
// dimension means, flag counts.   node astra/summary.mjs astra/out/<set>/<run>.jsonl [--dims] [--flags]
import fs from 'node:fs';
const args = process.argv.slice(2);
const J = fs.readFileSync(args[0], 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((j) => j.ok && j.official && (j.repeat ?? 0) === 0);
const mean = (x) => x.reduce((p, q) => p + q, 0) / x.length;
const p10 = (x) => { const s = [...x].sort((a, b) => a - b); return s[Math.max(0, Math.ceil(s.length * 0.1) - 1)]; };
const modes = [...new Set(J.map((j) => j.mode))].sort();
console.log('| mode | n | mean | p10 | hard fails | at 9.5+ | under 8 |'); console.log('|---|---:|---:|---:|---:|---:|---:|');
for (const m of [...modes, 'ALL']) { const s = J.filter((j) => m === 'ALL' || j.mode === m); const o = s.map((j) => j.official.overall); console.log(`| ${m} | ${s.length} | ${mean(o).toFixed(2)} | ${p10(o).toFixed(2)} | ${s.filter((j) => j.official.hard_fail).length} | ${o.filter((v) => v >= 9.5).length} | ${o.filter((v) => v < 8).length} |`); }
if (args.includes('--dims')) {
  const dims = Object.keys(J[0].judgment.scores);
  console.log(`\n| mode | ${dims.map((d) => d.replace(/_/g, ' ')).join(' | ')} |`); console.log(`|---|${dims.map(() => '---:').join('|')}|`);
  for (const m of [...modes, 'ALL']) { const s = J.filter((j) => m === 'ALL' || j.mode === m); console.log(`| ${m} | ${dims.map((d) => mean(s.map((j) => Number(j.judgment.scores[d]))).toFixed(1)).join(' | ')} |`); }
}
if (args.includes('--flags')) {
  const f = {}; for (const j of J) for (const k of j.official.flags ?? []) f[k] = (f[k] ?? 0) + 1;
  console.log('\nflags: ' + Object.entries(f).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
}
