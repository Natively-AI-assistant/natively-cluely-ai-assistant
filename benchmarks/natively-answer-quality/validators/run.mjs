#!/usr/bin/env node
// node validators/run.mjs results/<run>[,results/<run2>] [--verbose]  — deterministic validator results per run.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { validate, oracles } from './index.mjs';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const runs = (args[0] ?? '').split(',').filter(Boolean);
const verbose = args.includes('--verbose');
const ids = Object.keys(oracles());
export function validateRun(dir) {
  const header = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
  const ds = JSON.parse(fs.readFileSync(path.resolve(ROOT, header.dataset_file), 'utf8'));
  const items = Object.fromEntries(ds.items.map((i) => [i.id, i]));
  const rows = fs.readFileSync(path.join(dir, 'natively_benchmark_full.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return rows.filter((r) => ids.includes(r.benchmark_id)).map((r) => ({ id: r.benchmark_id, mode: r.mode, answer: r.rendered_answer ?? r.raw_answer ?? '', v: validate(items[r.benchmark_id], r.rendered_answer ?? r.raw_answer ?? '', ds) }));
}
if (import.meta.url === `file://${process.argv[1]}`) {
  for (const r of runs) {
    const res = validateRun(path.resolve(ROOT, r));
    const pass = res.filter((x) => x.v.verdict === 'pass').length;
    console.log(`\n=== ${path.basename(r)}: ${pass}/${res.length} pass`);
    for (const x of res) {
      const failed = x.v.checks.filter((c) => !c.ok);
      console.log(`  ${x.v.verdict === 'pass' ? 'PASS' : 'FAIL'} ${x.id.padEnd(12)} ${failed.map((c) => `[${c.flag}] ${c.label}: ${c.detail}`).join(' ; ')}`);
      if (verbose && failed.length) console.log(`       A: ${x.answer.replace(/\n+/g, ' ⏎ ').slice(0, 400)}`);
    }
  }
}
