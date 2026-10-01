#!/usr/bin/env node
// Paired latency A/B: the SAME questions asked of two running dev:agent instances, interleaved (ABBA order per
// item) so provider load and time of day hit both equally. No documents, no PI, first turns only.
//   node latency.mjs --a <rootA> --b <rootB> --label-a base --label-b fix [--per-mode 10] [--out results/latency-ab.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as app from './lib/app.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const rootA = opt('a'), rootB = opt('b');
const labelA = opt('label-a', 'A'), labelB = opt('label-b', 'B');
const PER = Number(opt('per-mode', 10));
const out = path.resolve(HERE, opt('out', 'results/latency-ab.json'));

async function connect(root) {
  const port = Number(JSON.parse(fs.readFileSync(path.join(root, 'agent-browser.json'), 'utf8')).cdp);
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const attach = async (match) => {
    const t = list.find(match);
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pending = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    const evaluate = async (expression, timeout = 240000) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout });
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
      return r.result?.result?.value;
    };
    return { evaluate, close: () => ws.close() };
  };
  const launcher = await attach(t => t.url.includes('window=launcher'));
  const overlay = await attach(t => /[?&]window=overlay$/.test(t.url));
  const invoke = (channel, ...a) => launcher.evaluate(`window.electronAPI.e2eInvoke(${JSON.stringify(channel)}, ...${JSON.stringify(a)})`);
  return { launcher, overlay, invoke, close() { launcher.close(); overlay.close(); } };
}

const envText = fs.readFileSync(path.join(HERE, '..', '..', '.env'), 'utf8');
const dsKey = (envText.match(/^DEEPSEEK_API_KEY=(.*)$/m)?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
const ds = JSON.parse(fs.readFileSync(path.join(HERE, 'dataset', 'dev.json'), 'utf8'));
const items = [];
for (const m of ds.modes.map(x => x.key)) items.push(...ds.items.filter(i => i.mode === m && !i.context_ref && !i.pi_ref && !i.prior_transcript && i.turn_index === 1).slice(0, PER));

const A = await connect(rootA), B = await connect(rootB);
for (const c of [A, B]) { await app.setupProfile(c, { deepseekKey: dsKey }); await c.invoke('__e2e__:clear-profile'); }
const modeIds = {};
async function ask(c, label, it) {
  const key = `${label}|${it.mode}`;
  modeIds[key] ??= await app.builtinModeId(c, it.mode);
  const files = (await c.launcher.evaluate(`window.electronAPI.modesGetReferenceFiles(${JSON.stringify(modeIds[key])})`)) ?? [];
  for (const f of files) await c.launcher.evaluate(`window.electronAPI.modesDeleteReferenceFile(${JSON.stringify(f.id)})`);
  await app.activateMode(c, modeIds[key]);
  await app.resetSession(c); await app.clearRecorder(c);
  const m = await app.timedAsk(c, { surface: it.surface, question: it.question, timeoutMs: 90000 });
  const w = await app.collectWire(c);
  const usage = app.summariseWire(w, m.t0Epoch)?.response?.usage ?? null;
  return { ttft: m.firstTokenMs, total: m.totalMs, inTok: usage?.prompt_tokens ?? null, err: m.err || (m.timedOut ? 'timeout' : null) };
}
// warm-up
for (const c of [A, B]) for (const it of items.slice(0, 3)) await ask(c, c === A ? labelA : labelB, it);
const rows = [];
let n = 0;
for (const it of items) {
  const order = n++ % 2 === 0 ? [[A, labelA], [B, labelB]] : [[B, labelB], [A, labelA]];
  const r = { id: it.id, mode: it.mode, surface: it.surface };
  for (const [c, label] of order) r[label] = await ask(c, label, it);
  rows.push(r);
  console.log(`${it.id.padEnd(14)} ${it.surface.padEnd(6)} ${labelA} ${String(r[labelA].ttft?.toFixed(0)).padStart(5)} | ${labelB} ${String(r[labelB].ttft?.toFixed(0)).padStart(5)}  in ${r[labelA].inTok}/${r[labelB].inTok}`);
}
fs.writeFileSync(out, JSON.stringify({ labelA, labelB, rootA, rootB, rows }, null, 1));
const q = (a, p) => { a = a.filter(x => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!a.length) return null; const r = (p / 100) * (a.length - 1); const lo = Math.floor(r), hi = Math.ceil(r); return a[lo] + (a[hi] - a[lo]) * (r - lo); };
for (const k of ['ttft', 'total', 'inTok']) {
  const a = rows.map(r => r[labelA][k]), b = rows.map(r => r[labelB][k]), d = rows.map(r => (r[labelB][k] ?? NaN) - (r[labelA][k] ?? NaN));
  console.log(`${k}: ${labelA} p50 ${q(a, 50)?.toFixed(0)} p90 ${q(a, 90)?.toFixed(0)} p95 ${q(a, 95)?.toFixed(0)} | ${labelB} p50 ${q(b, 50)?.toFixed(0)} p90 ${q(b, 90)?.toFixed(0)} p95 ${q(b, 95)?.toFixed(0)} | paired Δ p50 ${q(d, 50)?.toFixed(0)}`);
}
A.close(); B.close();
process.exit(0);
