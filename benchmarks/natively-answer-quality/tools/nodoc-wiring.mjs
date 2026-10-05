#!/usr/bin/env node
// The no-document notices (Call Center "No policy on file", Sales "How to say it when nothing can be stated") in an
// APP run: on which turns did the notice reach the prompt? The replay puts it on the heard turns by construction;
// only an app run shows that the build's gate fires on the same turns and on no other. Aggregates only (safe for
// holdout); on dev the rows are also matched with the rows the heard-only replay variants touched.
//   node tools/nodoc-wiring.mjs <run> [<run> …]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const jl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const HEAD = { 'call-center': '# No policy on file', sales: '# How to say it when nothing can be stated' };
const REPLAY = { 'call-center': 'ccfin-nopolicy-v1h', sales: 'salesfin-shape-v1h' };
for (const run of process.argv.slice(2)) {
  const dir = path.join(ROOT, 'results', run);
  const rows = jl(path.join(dir, 'natively_benchmark_full.jsonl'));
  const wires = Object.fromEntries(jl(path.join(dir, 'natively_benchmark_wire.jsonl')).map((w) => [w.benchmark_id, w]));
  const systems = JSON.parse(fs.readFileSync(path.join(dir, 'systems.json'), 'utf8'));
  const header = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
  // The whole prompt of the answer request: the system prompt plus every message (per-turn notices ride in the
  // user message).
  const promptOf = (w) => { const sys = systems[w?.wire?.system_sha]; return typeof sys === 'string' && w.messages?.length ? [sys, ...w.messages.map((m) => m.text ?? '')].join('\n') : null; };
  console.log(`\n${run}: ${rows.length} rows, failed ${rows.filter((r) => !r.success).length}, empty ${rows.filter((r) => r.success && !String(r.raw_answer ?? '').trim()).length}, commit ${String(header.git_commit).slice(0, 8)}${header.git_dirty ? ' (dirty)' : ''}`);
  console.log('| mode / surface | rows | own notice in the prompt | another mode\'s notice | no prompt recorded |'); console.log('|---|---:|---:|---:|---:|');
  const g = {};
  for (const r of rows) {
    const x = (g[`${r.mode} / ${r.surface_path}`] ??= { n: 0, own: 0, other: 0, none: 0 });
    x.n++;
    const p = promptOf(wires[r.benchmark_id]);
    if (p == null) { x.none++; continue; }
    if (HEAD[r.mode] && p.includes(HEAD[r.mode])) x.own++;
    if (Object.entries(HEAD).some(([m, h]) => m !== r.mode && p.includes(h))) x.other++;
  }
  for (const [k, x] of Object.entries(g).sort()) console.log(`| ${k} | ${x.n} | ${x.own} | ${x.other} | ${x.none} |`);
  if (header.partition !== 'dev') continue;
  for (const [mode, rep] of Object.entries(REPLAY)) {
    const touched = new Set(jl(path.join(ROOT, 'results', 'replay', `${rep}.jsonl`)).filter((r) => !r.carried).map((r) => r.id));
    const app = new Set(rows.filter((r) => r.mode === mode && String(promptOf(wires[r.benchmark_id]) ?? '').includes(HEAD[mode])).map((r) => r.benchmark_id));
    if (!rows.some((r) => r.mode === mode)) continue;
    const both = [...app].filter((id) => touched.has(id)).length;
    console.log(`${mode}: notice on ${app.size} app rows; the heard-only replay touched ${touched.size}; in both ${both}, app only ${app.size - both}, replay only ${touched.size - both}`);
  }
}
