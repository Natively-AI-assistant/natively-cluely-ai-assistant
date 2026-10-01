#!/usr/bin/env node
// A composite run for REPORTING: every mode from <base>, except the modes of <override>, which come from <override>.
// Used when a build changes one mode's code path only and only that mode was re-run (fix12 = fix11 + a Seminar-only
// verifier clause; every other mode's verifier prompt is byte-identical to fix11).
//   node tools/compose-run.mjs --base aq2-dev-fix11 --override aq2-dev-fix12 --out aq2-dev-fix12c --sets abs-dev-c2
// Writes results/<out>/ (rows, wire, run.json with a `composite` note) and astra/out/<set>/<out>.jsonl.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const [base, over, out] = [opt('base'), opt('override'), opt('out')];
const jl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const dir = (r) => path.join(ROOT, 'results', r);
const oRows = jl(path.join(dir(over), 'natively_benchmark_full.jsonl'));
const modes = new Set(oRows.map((r) => r.mode));
fs.mkdirSync(dir(out), { recursive: true });
const rows = [...jl(path.join(dir(base), 'natively_benchmark_full.jsonl')).filter((r) => !modes.has(r.mode)), ...oRows];
fs.writeFileSync(path.join(dir(out), 'natively_benchmark_full.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const oIds = new Set(oRows.map((r) => r.benchmark_id));
const wire = [...jl(path.join(dir(base), 'natively_benchmark_wire.jsonl')).filter((w) => !oIds.has(w.benchmark_id) && rows.some((r) => r.benchmark_id === w.benchmark_id)), ...jl(path.join(dir(over), 'natively_benchmark_wire.jsonl'))];
fs.writeFileSync(path.join(dir(out), 'natively_benchmark_wire.jsonl'), wire.map((r) => JSON.stringify(r)).join('\n') + '\n');
const header = JSON.parse(fs.readFileSync(path.join(dir(base), 'run.json'), 'utf8'));
fs.writeFileSync(path.join(dir(out), 'run.json'), JSON.stringify({ ...header, composite: { base, override: over, modes: [...modes] } }, null, 2));
for (const set of String(opt('sets', '')).split(',').filter(Boolean)) {
  const d = path.join(ROOT, 'astra', 'out', set);
  const J = [...jl(path.join(d, `${base}.jsonl`)).filter((j) => !modes.has(j.mode)), ...jl(path.join(d, `${over}.jsonl`))];
  fs.writeFileSync(path.join(d, `${out}.jsonl`), J.map((j) => JSON.stringify(j)).join('\n') + '\n');
  console.log(`${set}/${out}.jsonl: ${J.filter((j) => j.ok).length} judgments`);
}
console.log(`results/${out}: ${rows.length} rows (${[...modes].join(', ')} from ${over}, the rest from ${base})`);
