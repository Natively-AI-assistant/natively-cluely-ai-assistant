#!/usr/bin/env node
// Objective checks for the reasoning build (I28): which turns sent `thinking: enabled`, whether anything failed or
// needed more requests, objective validators, and the latency of the typed rows against a reference run.
// Aggregates only (safe for holdout).   node tools/reasoning-check.mjs results/<run> [--ref results/<kept run>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const jl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const load = (dir) => { const d = path.resolve(ROOT, dir); return { rows: jl(path.join(d, 'natively_benchmark_full.jsonl')), wires: Object.fromEntries(jl(path.join(d, 'natively_benchmark_wire.jsonl')).map((w) => [w.benchmark_id, w])) }; };
const q = (x, p) => { const s = x.filter((v) => Number.isFinite(v)).sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))]) : NaN; };
const run = load(args[0]);
const thinking = (id) => run.wires[id]?.wire?.params?.thinking?.type ?? 'not recorded';
const groups = {};
for (const r of run.rows) { const k = `${r.mode} / ${r.surface_path}`; const g = (groups[k] ??= { n: 0, enabled: 0, disabled: 0, other: 0 }); g.n++; const t = thinking(r.benchmark_id); if (t === 'enabled') g.enabled++; else if (t === 'disabled') g.disabled++; else g.other++; }
console.log(`${path.basename(args[0])}: ${run.rows.length} rows, failed ${run.rows.filter((r) => !r.success).length}, empty ${run.rows.filter((r) => r.success && !String(r.raw_answer ?? '').trim()).length}`);
console.log('| mode / surface | rows | thinking enabled | disabled | not recorded |'); console.log('|---|---:|---:|---:|---:|');
for (const [k, g] of Object.entries(groups).sort()) console.log(`| ${k} | ${g.n} | ${g.enabled} | ${g.disabled} | ${g.other} |`);
const eff = [...new Set(run.rows.map((r) => run.wires[r.benchmark_id]?.wire?.params?.reasoning_effort).filter(Boolean))];
console.log(`reasoning_effort values on the wire: ${eff.join(', ') || 'none'}`);
const typed = (rows) => rows.filter((r) => r.surface_path === 'typed' && r.success);
const stat = (rows, label) => console.log(`${label}: n ${rows.length} | first token p50 ${q(rows.map((r) => r.ttft_ms), 0.5)} ms, p95 ${q(rows.map((r) => r.ttft_ms), 0.95)} ms, max ${q(rows.map((r) => r.ttft_ms), 1)} ms | total p50 ${q(rows.map((r) => r.total_latency_ms), 0.5)} ms, p95 ${q(rows.map((r) => r.total_latency_ms), 0.95)} ms | requests per turn: ${JSON.stringify(rows.reduce((o, r) => (o[r.llm_request_count] = (o[r.llm_request_count] ?? 0) + 1, o), {}))} | multiple generations ${rows.filter((r) => r.multiple_generations).length}`);
stat(typed(run.rows), 'typed rows, this run');
stat(run.rows.filter((r) => r.surface_path !== 'typed' && r.success), 'heard rows, this run');
if (opt('ref')) {
  const ref = load(opt('ref')); const ids = new Set(run.rows.map((r) => r.benchmark_id)); const refRows = ref.rows.filter((r) => ids.has(r.benchmark_id));
  stat(typed(refRows), 'typed rows, reference'); stat(refRows.filter((r) => r.surface_path !== 'typed' && r.success), 'heard rows, reference');
}
