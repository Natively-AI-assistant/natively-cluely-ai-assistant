#!/usr/bin/env node
// Re-applies the CURRENT deterministic checks (objective.mjs, OBJECTIVE_VERSION) to stored judgments, without a judge
// call: the judge's dimension scores and flags are kept as stored, only the check-added flags and the cap change.
//   node evidence-rich/report/rescore-objective.mjs <run>[,<run>…] [--draft] [--blind]
// Prints, per run and pooled: rows, mean and hard fails as stored and as rescored, and (unless --blind) the ids whose
// official score changes. Writes nothing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRun, objective, OBJECTIVE_VERSION } from '../objective.mjs';
import { officialScore } from '../judge/score-er.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ER = path.join(HERE, '..');
const args = process.argv.slice(2); const draft = args.includes('--draft'); const blind = args.includes('--blind');
const runs = String(args.find((a) => !a.startsWith('--')) ?? '').split(',').filter(Boolean);
const lines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
export function rescoreRun(name, { draft = false } = {}) {
  const run = loadRun(path.join(ER, 'results', name)); const out = [];
  const last = new Map(); for (const j of lines(path.join(ER, 'judge/out/base', `${name}${draft ? '.draft' : ''}.astra.jsonl`))) if (j.ok) last.set(j.benchmark_id, j);
  for (const [id, j] of last) {
    const item = run.ds.byId[id]; let row = run.rowsById[id]; if (!item || !row) continue;
    if (draft) row = { ...row, rendered_answer: null };
    const obj = objective(item, row); const off = officialScore(j.judgment, item.mode, obj);
    out.push({ id, mode: item.mode, condition: item.condition, stored: j.official, rescored: off, objective: obj });
  }
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const all = [];
  for (const r of runs) { const rows = rescoreRun(r, { draft }); all.push(...rows.map((x) => ({ ...x, run: r }))); }
  const stat = (rows, k) => ({ n: rows.length, mean: rows.length ? +(rows.reduce((a, x) => a + x[k].overall, 0) / rows.length).toFixed(3) : null, hard: rows.filter((x) => x[k].hard_fail).length });
  console.log(`checks ${OBJECTIVE_VERSION}${draft ? ' (drafts)' : ''}`);
  for (const r of [...runs, 'POOLED']) { const rows = r === 'POOLED' ? all : all.filter((x) => x.run === r); console.log(r, 'stored', JSON.stringify(stat(rows, 'stored')), 'rescored', JSON.stringify(stat(rows, 'rescored'))); }
  const changed = all.filter((x) => Math.abs(x.stored.overall - x.rescored.overall) > 1e-9 || x.stored.hard_fail !== x.rescored.hard_fail);
  console.log('rows whose official score changes:', changed.length);
  if (!blind) for (const x of changed) console.log(`  ${x.id} ${x.stored.overall} -> ${x.rescored.overall} flags ${JSON.stringify(x.stored.flags)} -> ${JSON.stringify(x.rescored.flags)}`);
}
