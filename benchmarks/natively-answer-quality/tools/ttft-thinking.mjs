#!/usr/bin/env node
// Time to the first ANSWER token with the generator's reasoning off and on, streaming, on recorded prompts.
//   node tools/ttft-thinking.mjs --run aq2-dev-fix11 --mode technical-interview,lecture [--limit 20] [--effort low]
// The app sends thinking: disabled on every turn; reasoning tokens arrive before the first answer token, so this is
// the delay a user would see. Direct DeepSeek API, same system + user messages as recorded. Never prints the key.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const run = opt('run'); const modes = new Set(String(opt('mode', '')).split(',').filter(Boolean)); const limit = Number(opt('limit', 20)); const effort = opt('effort', 'low');
const env = fs.readFileSync(process.env.NATIVELY_ENV_FILE || '/Users/evin/natively-cluely-ai-assistant/.env', 'utf8');
const KEY = (env.match(/^DEEPSEEK_API_KEY=(.*)$/m)?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
const dir = path.join(ROOT, 'results', run);
const ds = JSON.parse(fs.readFileSync(path.resolve(ROOT, JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8')).dataset_file), 'utf8'));
const items = Object.fromEntries(ds.items.map((i) => [i.id, i]));
const systems = JSON.parse(fs.readFileSync(path.join(dir, 'systems.json'), 'utf8'));
const wires = fs.readFileSync(path.join(dir, 'natively_benchmark_wire.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  .filter((w) => w.wire?.system_sha && systems[w.wire.system_sha] && w.messages?.length && (!modes.size || modes.has(items[w.benchmark_id]?.mode)));
const byMode = {}; for (const w of wires) (byMode[items[w.benchmark_id].mode] ??= []).push(w);
const pick = Object.values(byMode).flatMap((v) => v.slice(0, Math.ceil(limit / Object.keys(byMode).length)));
async function one(w, thinking) {
  const user = w.messages.filter((m) => m.role === 'user').map((m) => m.text ?? m.content).join('\n');
  const t0 = Date.now(); let first = null, reasoningFirst = null;
  const res = await fetch('https://api.deepseek.com/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-flash', messages: [{ role: 'system', content: systems[w.wire.system_sha] }, { role: 'user', content: user }], temperature: 0.2, max_tokens: 6000, stream: true, thinking: { type: thinking }, ...(thinking === 'enabled' ? { reasoning_effort: effort } : {}) }) });
  if (!res.ok || !res.body) return { err: res.status };
  const dec = new TextDecoder(); let buf = '';
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i; while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:') || line === 'data: [DONE]') continue;
      try { const d = JSON.parse(line.slice(5)).choices?.[0]?.delta ?? {}; if (d.reasoning_content && reasoningFirst == null) reasoningFirst = Date.now() - t0; if (d.content && first == null) first = Date.now() - t0; } catch {}
    }
  }
  return { ttft: first, reasoningFirst, total: Date.now() - t0 };
}
const pct = (x, p) => { const s = x.filter((v) => v != null).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const out = { disabled: [], enabled: [] };
for (const w of pick) for (const t of ['disabled', 'enabled']) out[t].push({ mode: items[w.benchmark_id].mode, ...(await one(w, t)) });
for (const t of ['disabled', 'enabled']) {
  const v = out[t]; console.log(`thinking ${t}${t === 'enabled' ? ` (effort ${effort})` : ''}: n ${v.length}, errors ${v.filter((x) => x.err).length} | first answer token p50 ${pct(v.map((x) => x.ttft), 0.5)} ms, p95 ${pct(v.map((x) => x.ttft), 0.95)} ms | total p50 ${pct(v.map((x) => x.total), 0.5)} ms, p95 ${pct(v.map((x) => x.total), 0.95)} ms`);
  for (const m of Object.keys(byMode)) { const x = v.filter((r) => r.mode === m); console.log(`   ${m}: first answer token p50 ${pct(x.map((r) => r.ttft), 0.5)} ms, p95 ${pct(x.map((r) => r.ttft), 0.95)} ms`); }
}
