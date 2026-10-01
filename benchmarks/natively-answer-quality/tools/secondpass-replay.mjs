#!/usr/bin/env node
// A generic second pass over a run's recorded answers (same model, the recorded V3 user message as material), for
// trying a post-stream check before it is built into the app. The variant module exports
//   gate(row) → boolean, systemPrompt(row) → string, pick(original, output) → { answer, note }
//   node tools/secondpass-replay.mjs --run aq2-dev-fix6 --module tools/variants/<x>.mjs --name <out> [--mode m1,m2] [--concurrency 8]
// Output: results/replay/<name>.jsonl — {id, mode, surface, variant, k:0, answer, original, outcome, note, ms, out_tokens}
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const run = opt('run'); const name = opt('name'); const modes = opt('mode') ? new Set(opt('mode').split(',')) : null;
const v = await import(pathToFileURL(path.resolve(opt('module'))).href);
const env = fs.readFileSync(process.env.NATIVELY_ENV_FILE || '/Users/evin/natively-cluely-ai-assistant/.env', 'utf8');
const KEY = (env.match(/^DEEPSEEK_API_KEY=(.*)$/m)?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
const rows = fs.readFileSync(path.join(ROOT, 'results', run, 'natively_benchmark_full.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).filter((r) => !modes || modes.has(r.mode));
const wires = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'results', run, 'natively_benchmark_wire.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { const w = JSON.parse(l); return [w.benchmark_id, w]; }));
const lim = (n) => { let a = 0; const q = []; const nx = () => { if (a >= n || !q.length) return; a++; const { f, r, j } = q.shift(); f().then(r, j).finally(() => { a--; nx(); }); }; return (f) => new Promise((r, j) => { q.push({ f, r, j }); nx(); }); };
const L = lim(Number(opt('concurrency', 8)));
const outFile = path.join(ROOT, 'results', 'replay', `${name}.jsonl`); fs.writeFileSync(outFile, '');
await Promise.all(rows.map((r) => L(async () => {
  const original = r.rendered_answer ?? r.raw_answer ?? '';
  const material = (wires[r.benchmark_id]?.messages ?? []).filter((m) => m.role === 'user').map((m) => m.text ?? m.content).join('\n\n');
  const rec = { id: r.benchmark_id, mode: r.mode, surface: r.surface_path, variant: path.basename(opt('module')), k: 0, answer: original, original, outcome: 'not_gated', note: '', ms: 0 };
  if (original.trim() && v.gate(r, original)) {
    const t0 = Date.now();
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'deepseek-flash', temperature: 0.2, max_tokens: 2500, thinking: { type: 'disabled' }, stream: false,
          messages: [{ role: 'system', content: v.systemPrompt(r) }, { role: 'user', content: `MATERIAL:\n${material.slice(0, 24000)}\n\n---\nDRAFT REPLY:\n${original.trim()}` }] }) });
      const j = await res.json();
      const p = v.pick(original, j.choices?.[0]?.message?.content ?? '');
      Object.assign(rec, { answer: p.answer, outcome: p.answer === original ? 'unchanged' : 'edited', note: p.note ?? '', ms: Date.now() - t0, out_tokens: j.usage?.completion_tokens ?? null });
    } catch (e) { rec.outcome = 'error'; }
  }
  fs.appendFileSync(outFile, JSON.stringify(rec) + '\n');
})));
const R = fs.readFileSync(outFile, 'utf8').trim().split('\n').map(JSON.parse);
const t = {}; for (const r of R) t[r.outcome] = (t[r.outcome] ?? 0) + 1;
const ms = R.filter((r) => r.ms).map((r) => r.ms).sort((a, b) => a - b);
console.log(`${name}: ${R.length} rows`, t, `ms p50 ${ms[Math.floor(ms.length / 2)] ?? '-'} p90 ${ms[Math.floor(ms.length * 0.9)] ?? '-'}`);
