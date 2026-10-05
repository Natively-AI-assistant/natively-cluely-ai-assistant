#!/usr/bin/env node
// A generator-side variant only changes the turns its transform touches, but tools/replay.mjs regenerates EVERY row
// for both arms, so an untouched row still differs between base and variant by sampling alone (temperature 0.2) — and
// the judge then scores two different samples of the same prompt. That is noise in a paired comparison, and it is
// paid for in judge calls. This carries base's answer into the variant on every row the transform leaves unchanged,
// so those pairs are identical (the judge cache is keyed by answer text: no second call, a difference of exactly 0).
//   node tools/replay-carry.mjs --run <source run> --variant <transform.mjs> --base <replay name> --from <replay name> --name <out name>
// Output: results/replay/<out name>.jsonl — the --from rows, with `carried: true` and base's answer where untouched.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const MAIN_RESULTS = process.env.NATIVELY_MAIN_RESULTS || '/Users/evin/natively-cluely-ai-assistant/benchmarks/natively-answer-quality/results';
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const run = opt('run'); const name = opt('name');
if (!run || !name || !opt('variant') || !opt('base') || !opt('from')) { console.error('--run, --variant, --base, --from and --name required'); process.exit(2); }
const { transform } = await import(pathToFileURL(path.resolve(opt('variant'))).href);

const resultsDir = fs.existsSync(path.join(MAIN_RESULTS, run, 'natively_benchmark_wire.jsonl')) ? path.join(MAIN_RESULTS, run) : path.join(ROOT, 'results', run);
const header = JSON.parse(fs.readFileSync(path.join(resultsDir, 'run.json'), 'utf8'));
const ds = JSON.parse(fs.readFileSync(path.resolve(ROOT, header.dataset_file), 'utf8'));
const items = Object.fromEntries(ds.items.map((i) => [i.id, i]));
const systems = JSON.parse(fs.readFileSync(path.join(resultsDir, 'systems.json'), 'utf8'));
const wires = fs.readFileSync(path.join(resultsDir, 'natively_benchmark_wire.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// The same message pick as tools/replay.mjs: the recorded system prompt and the last user message of the turn.
const untouched = new Set();
const touched = new Set();
for (const w of wires) {
  const system = systems[w.wire?.system_sha];
  const user = (w.messages ?? []).filter((m) => m.role === 'user').at(-1)?.text;
  if (!system || typeof user !== 'string') continue;
  const out = transform({ system, user, item: items[w.benchmark_id] }) ?? { system, user };
  (out.system === system && out.user === user ? untouched : touched).add(w.benchmark_id);
}
for (const id of touched) untouched.delete(id);

const load = (n) => fs.readFileSync(path.join(ROOT, 'results', 'replay', `${n}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const base = Object.fromEntries(load(opt('base')).map((r) => [`${r.id}#${r.k}`, r]));
let carried = 0; let kept = 0; let missing = 0;
const out = load(opt('from')).map((r) => {
  if (!untouched.has(r.id)) { kept++; return r; }
  const b = base[`${r.id}#${r.k}`];
  if (!b) { missing++; return r; }
  carried++;
  return { ...b, variant: r.variant, carried: true };
});
fs.writeFileSync(path.join(ROOT, 'results', 'replay', `${name}.jsonl`), out.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`${name}: ${out.length} rows — ${kept} touched by the variant, ${carried} carried from ${opt('base')}${missing ? `, ${missing} untouched without a base row` : ''}`);
