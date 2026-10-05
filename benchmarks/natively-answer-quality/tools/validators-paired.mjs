#!/usr/bin/env node
// Deterministic validators on the rows two runs share: pass / fail counts per surface, and (dev only, with --items)
// the items whose verdict changed. Aggregates are safe for holdout.
//   node tools/validators-paired.mjs results/<run A> results/<run B> [--items]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../validators/index.mjs';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const load = (dir) => { const d = path.resolve(ROOT, dir); const header = JSON.parse(fs.readFileSync(path.join(d, 'run.json'), 'utf8')); const ds = JSON.parse(fs.readFileSync(path.resolve(ROOT, header.dataset_file), 'utf8'));
  return { ds, items: Object.fromEntries(ds.items.map((i) => [i.id, i])), rows: Object.fromEntries(fs.readFileSync(path.join(d, 'natively_benchmark_full.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.benchmark_id, r])) }; };
const A = load(args[0]); const B = load(args[1]);
const shown = (r) => r.rendered_answer ?? r.raw_answer ?? '';
const ids = Object.keys(B.rows).filter((id) => A.rows[id] && B.items[id]);
const t = {}; const changed = [];
for (const id of ids) {
  const it = B.items[id]; const va = validate(it, shown(A.rows[id]), A.ds).verdict; const vb = validate(it, shown(B.rows[id]), B.ds).verdict;
  if (va === 'n/a' && vb === 'n/a') continue;
  const k = B.rows[id].surface_path === 'typed' ? 'typed' : 'heard';
  for (const g of [k, 'all']) { const m = (t[g] ??= { n: 0, a: 0, b: 0 }); m.n++; if (va === 'pass') m.a++; if (vb === 'pass') m.b++; }
  if (va !== vb) changed.push(`${id} ${k} ${va} → ${vb}`);
}
console.log(`${path.basename(args[0])} → ${path.basename(args[1])}: ${ids.length} shared rows`);
for (const [k, m] of Object.entries(t).sort()) console.log(`  ${k}: validators pass ${m.a} → ${m.b} of ${m.n}`);
console.log(`  verdicts that changed: ${changed.length}`);
if (args.includes('--items')) for (const c of changed) console.log(`    ${c}`);
