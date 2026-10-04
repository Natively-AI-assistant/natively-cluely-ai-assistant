#!/usr/bin/env node
// The claim pass's own effect, with no sampling in the way: for every row whose shown answer differs from the streamed
// draft, write the DRAFT and the SHOWN answer as two replay files, to be judged against the same recorded
// conversation (astra/judge-replay.mjs --run results/<run>). Same question, same draft, with and without the edit.
//   node tools/edit-pairs.mjs results/<run> <name>   → results/replay/<name>-draft.jsonl, results/replay/<name>-shown.jsonl
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [run, name] = process.argv.slice(2);
const strip = (s) => String(s ?? '').replace(/\n*\s*\[\[GIST\]\][\s\S]*$/, '').replace(/\*\*/g, '').trim();
const rows = fs.readFileSync(path.resolve(ROOT, run, 'natively_benchmark_full.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const edited = rows.filter((r) => r.rendered_answer != null && strip(r.rendered_answer) !== strip(r.raw_answer));
const out = (suffix, pick) => fs.writeFileSync(path.join(ROOT, 'results', 'replay', `${name}-${suffix}.jsonl`), edited.map((r) => JSON.stringify({ id: r.benchmark_id, mode: r.mode, surface: r.surface_path, variant: suffix, k: 0, answer: pick(r) })).join('\n') + '\n');
out('draft', (r) => r.raw_answer); out('shown', (r) => r.rendered_answer);
console.log(`${name}: ${edited.length} edited rows of ${rows.length}`);
