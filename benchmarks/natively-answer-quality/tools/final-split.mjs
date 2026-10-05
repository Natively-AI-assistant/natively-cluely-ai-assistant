#!/usr/bin/env node
// Split one mode's rows of the FINAL set into a decision half and a confirmation half, for a test that needs more
// items than dev has (40 a mode). The final set was never judged; only this mode's rows change role, the other
// modes stay the regression read. Whole conversations go to one half (a chain's turns are not independent), and the
// assignment is by a hash of the conversation id — nothing about the answers or their scores enters it.
// Prints counts only (the final set is read in aggregate), and writes the ids to dataset/final-split-<mode>.json.
//   node tools/final-split.mjs --run aq2-final-fix13 --mode call-center --variant tools/variants/cc-nopolicy-v1h.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const run = opt('run'); const mode = opt('mode');
if (!run || !mode || !opt('variant')) { console.error('--run, --mode and --variant required'); process.exit(2); }
const { transform } = await import(pathToFileURL(path.resolve(opt('variant'))).href);
const dir = path.join(ROOT, 'results', run);
const jl = (f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const header = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
const items = Object.fromEntries(JSON.parse(fs.readFileSync(path.resolve(ROOT, header.dataset_file), 'utf8')).items.map((i) => [i.id, i]));
const systems = JSON.parse(fs.readFileSync(path.join(dir, 'systems.json'), 'utf8'));
const wires = Object.fromEntries(jl('natively_benchmark_wire.jsonl').map((w) => [w.benchmark_id, w]));
const rows = jl('natively_benchmark_full.jsonl').filter((r) => r.mode === mode);

// The same message pick as tools/replay.mjs and tools/replay-carry.mjs.
const touches = (id) => {
  const w = wires[id]; const system = systems[w?.wire?.system_sha];
  const user = (w?.messages ?? []).filter((m) => m.role === 'user').at(-1)?.text;
  if (!system || typeof user !== 'string') return null;
  const out = transform({ system, user, item: items[id] }) ?? { system, user };
  return !(out.system === system && out.user === user);
};
// A row with no conversation is its own unit.
const unit = (r) => r.conversation_id ?? `single:${r.benchmark_id}`;
const half = (u) => (crypto.createHash('sha256').update(`final-split|${mode}|${u}`).digest()[0] & 1 ? 'confirmation' : 'decision');
const out = { run, mode, variant: path.basename(opt('variant')), decision: [], confirmation: [], touched: { decision: [], confirmation: [] } };
const stat = { decision: { rows: 0, touched: 0, heard: 0, typed: 0, units: new Set(), unreadable: 0 }, confirmation: { rows: 0, touched: 0, heard: 0, typed: 0, units: new Set(), unreadable: 0 } };
for (const r of rows) {
  const h = half(unit(r)); const t = touches(r.benchmark_id); const s = stat[h];
  out[h].push(r.benchmark_id); s.rows++; s.units.add(unit(r)); s[r.surface_path === 'typed' ? 'typed' : 'heard']++;
  if (t == null) s.unreadable++; else if (t) { s.touched++; out.touched[h].push(r.benchmark_id); }
}
const file = path.join(ROOT, 'dataset', `final-split-${mode}.json`);
fs.writeFileSync(file, `${JSON.stringify(out, null, 1)}\n`);
console.log(`| half | rows | conversations or single rows | heard | typed | rows the change touches | prompt not recorded |`); console.log('|---|---:|---:|---:|---:|---:|---:|');
for (const h of ['decision', 'confirmation']) { const s = stat[h]; console.log(`| ${h} | ${s.rows} | ${s.units.size} | ${s.heard} | ${s.typed} | ${s.touched} | ${s.unreadable} |`); }
console.log(`written ${path.relative(ROOT, file)}`);
