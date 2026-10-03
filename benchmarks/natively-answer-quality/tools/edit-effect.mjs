#!/usr/bin/env node
// What the claim pass did to the rows it edited: draft vs shown, judged on the same conversation (tools/edit-pairs.mjs).
// Aggregates only — safe for the holdout set.
//   node tools/edit-effect.mjs <name> results/<run> [--suffix .judged-fable.jsonl] [--shown <other name>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const [name, run] = args;
const suffix = opt('suffix', process.env.AQ_JUDGE === 'fable' ? '.judged-fable.jsonl' : '.judged.jsonl');
const header = JSON.parse(fs.readFileSync(path.resolve(ROOT, run, 'run.json'), 'utf8'));
const items = Object.fromEntries(JSON.parse(fs.readFileSync(path.resolve(ROOT, header.dataset_file), 'utf8')).items.map((i) => [i.id, i]));
const load = (n) => Object.fromEntries(fs.readFileSync(path.join(ROOT, 'results', 'replay', `${n}${suffix}`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((j) => j.ok && j.official).map((j) => [j.benchmark_id, j]));
const A = load(opt('base', `${name}-draft`)); const B = load(opt('shown', `${name}-shown`));
const la = opt('label-a', 'draft'); const lb = opt('label-b', 'shown');
const ids = Object.keys(A).filter((id) => B[id]);
const mean = (x) => x.reduce((p, q) => p + q, 0) / x.length;
const sd = (x) => { const m = mean(x); return Math.sqrt(x.reduce((p, q) => p + (q - m) ** 2, 0) / Math.max(1, x.length - 1)); };
const groups = {};
for (const id of ids) {
  const s = items[id]?.surface === 'typed' ? 'typed' : 'heard';
  for (const k of ['ALL', `ALL / ${s}`, `${A[id].mode} / ${s}`, A[id].official.hard_fail ? `ALL / ${la} had a hard fail` : `ALL / ${la} had none`]) (groups[k] ??= []).push(id);
}
console.log(`| group | rows | ${la} | ${lb} | change (95%) | hard fails ${la} → ${lb} | worse by 1+ | better by 1+ |`); console.log('|---|---:|---:|---:|---:|---:|---:|---:|');
for (const [k, g] of Object.entries(groups).sort()) {
  const d = g.map((id) => B[id].official.overall - A[id].official.overall);
  console.log(`| ${k} | ${g.length} | ${mean(g.map((id) => A[id].official.overall)).toFixed(2)} | ${mean(g.map((id) => B[id].official.overall)).toFixed(2)} | ${(mean(d) >= 0 ? '+' : '') + mean(d).toFixed(2)} (±${g.length > 1 ? (1.96 * sd(d) / Math.sqrt(g.length)).toFixed(2) : 'n/a'}) | ${g.filter((id) => A[id].official.hard_fail).length} → ${g.filter((id) => B[id].official.hard_fail).length} | ${d.filter((x) => x <= -1).length} | ${d.filter((x) => x >= 1).length} |`);
}
