#!/usr/bin/env node
// Derive an arm from an arm already replayed, by applying a variant's accept() to its recorded verdicts.
// For a rail that reads only the pass's own output (its scratch and the draft): no model is called, so the derived arm
// differs from its source on exactly the rows the rail changes.
//   node evidence-rich/derive-arm.mjs --from e19-ctl --name e20 --variant evidence-rich/replay-variants/<file>.mjs \
//        --runs evidence-rich/results/er4-dev-main,evidence-rich/results/er4-dev2-main
// Output: results/replay/<name>.jsonl (same shape as replay-claim-pass.mjs) and the count of rows changed, by outcome.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadRun } from './objective.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2); const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
if (!opt('from') || !opt('name') || !opt('variant') || !opt('runs')) { console.error('need --from, --name, --variant and --runs'); process.exit(2); }
const variant = await import(pathToFileURL(path.resolve(opt('variant'))).href);
const rows = {};
for (const r of String(opt('runs')).split(',')) { const dir = path.resolve(HERE, '..', r); const run = loadRun(dir); for (const row of run.rows) rows[`${path.basename(dir)}|${row.benchmark_id}`] = row; }
const src = fs.readFileSync(path.join(HERE, 'results', 'replay', `${opt('from')}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const out = []; const moved = {};
for (const rec of src) {
  const row = rows[`${rec.run}|${rec.id}`]; if (!row) continue;
  const v = variant.accept({ text: rec.text, changed: rec.changed, outcome: rec.outcome }, { row, scratch: rec.scratch }) ?? rec;
  if (v.outcome !== rec.outcome) moved[v.outcome] = (moved[v.outcome] ?? 0) + 1;
  out.push({ ...rec, text: v.text, changed: v.changed, outcome: v.outcome, derived_from: opt('from') });
}
fs.writeFileSync(path.join(HERE, 'results', 'replay', `${opt('name')}.jsonl`), out.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`${opt('name')}: ${out.length} records from ${opt('from')}; verdicts changed by the rail: ${JSON.stringify(moved)}`);
