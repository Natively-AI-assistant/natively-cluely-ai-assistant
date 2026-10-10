// Read a generator replay (replay-generator.mjs): node evidence-rich/report/gen-replay.mjs <arm> [<arm2>]
import fs from 'node:fs';
const rd = (n) => fs.readFileSync(`evidence-rich/results/replay/gen-${n}.jsonl`, 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter((r) => !r.err);
const arms = process.argv.slice(2).filter((a) => !a.startsWith('--')); const show = process.argv.includes('--rows');
const stat = (R) => { const by = {}; for (const r of R) (by[r.id] = by[r.id] || []).push(r); const rows = Object.entries(by).filter(([, v]) => v[0].required > 0);
  const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  return { by, rows, calls: R.length, graded: rows.reduce((n, [, v]) => n + v.length, 0), allHit: rows.reduce((n, [, v]) => n + v.filter((x) => x.all_required).length, 0),
    always: rows.filter(([, v]) => v.every((x) => x.all_required)).length, never: rows.filter(([, v]) => v.every((x) => !x.all_required)).length, forbidden: R.filter((r) => r.forbidden.length).length,
    calc: R.filter((r) => r.calc_block).length, first: med(R.map((r) => r.ms_first)), total: med(R.map((r) => r.ms_total)), shown: med(R.map((r) => r.shown_chars)) }; };
const S = arms.map((a) => [a, stat(rd(a))]);
for (const [a, s] of S) console.log(`${a}: calls ${s.calls}; rows with fixed strings ${s.rows.length}; samples with every required string ${s.allHit}/${s.graded} (${(100 * s.allHit / s.graded).toFixed(1)} %); rows right every time ${s.always}, never ${s.never}, sometimes ${s.rows.length - s.always - s.never}; samples with a forbidden string ${s.forbidden}; CALC block used ${s.calc}/${s.calls}; first token median ${s.first} ms, total ${s.total} ms, shown chars ${s.shown}`);
if (show) { const [, s0] = S[0]; for (const [id, v] of s0.rows) { const line = S.map(([, s]) => `${(s.by[id] || []).filter((x) => x.all_required).length}/${(s.by[id] || []).length}`).join('  '); if (S.some(([, s]) => { const x = s.by[id] || []; const h = x.filter((y) => y.all_required).length; return h !== x.length; })) console.log(`  ${id.padEnd(16)} ${v[0].condition.padEnd(16)} ${line}`); } }
