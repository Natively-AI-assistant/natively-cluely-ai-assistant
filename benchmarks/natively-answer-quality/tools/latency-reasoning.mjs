#!/usr/bin/env node
// What reasoning costs in time and tokens: the recorded prompts of the benchmark runs sent to DeepSeek THROUGH
// AGENTROUTER (deepseek-v4-flash on /v1/messages, streaming — the route the app's AgentRouter provider uses), once
// per arm, on the same prompt back to back in random order. Measures time to the first reasoning token, time to the
// first ANSWER token (what the user waits for), total time, and tokens. No answer text is stored or printed, and
// nothing is printed per row, so holdout and final prompts can be in the sample. A key value is never printed.
//   node tools/latency-reasoning.mjs --name <out> [--runs aq2-dev-fix11,aq2-holdout-fix11,aq2-final-fix13]
//        [--per-cell 12] [--boost technical-interview,lecture=30] [--mode m1,m2] [--limit N]
//        [--arms off,low,default] [--concurrency 4] [--key-var AGENTROUTER_API_KEY_1] [--screens <screens.json>]
//   node tools/latency-reasoning.mjs --name <out> --report        (tables from results/latency/<out>.jsonl)
// Sample: up to --per-cell prompts per (mode, difficulty), picked by a hash of the item id.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const name = opt('name'); if (!name) { console.error('--name required'); process.exit(2); }
const outDir = path.join(ROOT, 'results', 'latency'); fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${name}.jsonl`);

// What each arm adds to the request. `off` is what the app sends today.
export const ARMS = {
  off: { thinking: { type: 'disabled' } },
  low: { thinking: { type: 'enabled' }, output_config: { effort: 'low' } },
  medium: { thinking: { type: 'enabled' }, output_config: { effort: 'medium' } },
  high: { thinking: { type: 'enabled' }, output_config: { effort: 'high' } },
  default: { thinking: { type: 'enabled' } },
  relow: { thinking: { type: 'enabled' }, reasoning_effort: 'low' },
  b1024: { thinking: { type: 'enabled', budget_tokens: 1024 } },
};
const MODES = ['general', 'sales', 'recruiting', 'team-meet', 'looking-for-work', 'lecture', 'technical-interview', 'seminar', 'call-center'];

// ---------- the recorded prompts ----------
const RUNS = String(opt('runs', 'aq2-dev-fix11,aq2-holdout-fix11,aq2-final-fix13')).split(',').filter(Boolean);
function loadPrompts(only) {
  const out = [];
  for (const run of RUNS) {
    const dir = path.join(ROOT, 'results', run);
    const header = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
    const items = Object.fromEntries(JSON.parse(fs.readFileSync(path.resolve(ROOT, header.dataset_file), 'utf8')).items.map((i) => [i.id, i]));
    const systems = JSON.parse(fs.readFileSync(path.join(dir, 'systems.json'), 'utf8'));
    for (const line of fs.readFileSync(path.join(dir, 'natively_benchmark_wire.jsonl'), 'utf8').split('\n')) {
      if (!line) continue; const w = JSON.parse(line); const it = items[w.benchmark_id];
      const system = systems[w.wire?.system_sha]; const user = (w.messages ?? []).filter((m) => m.role === 'user').at(-1)?.text;
      if (!it || !system || typeof user !== 'string' || (only && !only.has(it.mode))) continue;
      out.push({ id: w.benchmark_id, set: header.partition, mode: it.mode, difficulty: it.difficulty ?? null, surface: it.surface === 'typed' ? 'typed' : 'heard', system, content: user });
    }
  }
  return out;
}
const loadScreens = () => (opt('screens') ? JSON.parse(fs.readFileSync(path.resolve(opt('screens')), 'utf8')) : []);
/** Prompt size in characters, by id — from the prompt text, because the route's input_tokens leaves cached tokens out. */
function promptChars() {
  const c = {};
  try { for (const p of loadPrompts(null)) c[p.id] = p.system.length + p.content.length; for (const s of loadScreens()) c[s.id] = s.system.length + s.user.length; } catch { /* sizes are optional */ }
  return c;
}

// ---------- report ----------
const q = (x, p) => { if (!x.length) return NaN; const s = [...x].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const sec = (ms) => (Number.isFinite(ms) ? (ms / 1000).toFixed(2) : '—');
function report() {
  const R = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
  const ok = R.filter((r) => r.ok);
  const arms = [...new Set(R.map((r) => r.arm))];
  const prompts = new Set(ok.map((r) => r.id));
  // Only prompts every arm answered, so the arms are compared on the same prompts.
  const full = new Set([...prompts].filter((id) => arms.every((a) => ok.some((r) => r.id === id && r.arm === a))));
  const P = ok.filter((r) => full.has(r.id));
  console.log(`# ${name}: ${full.size} prompts answered by every arm (${R.length} calls, ${R.length - ok.length} failed), arms ${arms.join(', ')}\n`);
  const table = (title, groups) => {
    console.log(`\n### ${title}\n`);
    console.log('| group | prompts | arm | first answer token p50 / p90 / p95 s | total p50 / p90 / p95 s | first word after 2 s / 3 s / 5 s | reasoning shown first p50 s | output tokens mean |');
    console.log('|---|---:|---|---:|---:|---:|---:|---:|');
    for (const [g, rows] of groups) for (const a of arms) {
      const x = rows.filter((r) => r.arm === a); if (!x.length) continue;
      const t = x.map((r) => r.t_text); const tot = x.map((r) => r.t_total);
      const over = (ms) => `${Math.round(100 * t.filter((v) => v > ms).length / t.length)}%`;
      const think = x.map((r) => r.t_think).filter((v) => v != null);
      console.log(`| ${g} | ${x.length} | ${a} | ${sec(q(t, 0.5))} / ${sec(q(t, 0.9))} / ${sec(q(t, 0.95))} | ${sec(q(tot, 0.5))} / ${sec(q(tot, 0.9))} / ${sec(q(tot, 0.95))} | ${over(2000)} / ${over(3000)} / ${over(5000)} | ${think.length ? sec(q(think, 0.5)) : '—'} | ${Math.round(x.reduce((p, r) => p + (r.output_tokens ?? 0), 0) / x.length)} |`);
    }
  };
  const by = (f, order) => { const g = {}; for (const r of P) (g[f(r)] ??= []).push(r); return (order ?? Object.keys(g).sort()).filter((k) => g[k]).map((k) => [k, g[k]]); };
  table('All prompts', [['all', P]]);
  table('By difficulty', by((r) => r.difficulty ?? 'n/a', ['easy', 'normal', 'hard', 'n/a']));
  table('By mode', by((r) => r.mode, [...MODES, 'screenshot']));
  table('By how the question arrives', by((r) => r.surface ?? 'n/a'));
  const chars = promptChars();
  const size = (r) => { const c = chars[r.id]; return c == null ? 'n/a' : c < 12000 ? 'prompt under 12k chars' : c < 30000 ? 'prompt 12k–30k chars' : 'prompt 30k chars and over'; };
  table('By prompt size', by(size, ['prompt under 12k chars', 'prompt 12k–30k chars', 'prompt 30k chars and over', 'n/a']));
  // Paired: the same prompt, arm minus `off`.
  if (arms.includes('off')) {
    console.log('\n### The same prompt, with reasoning minus without (paired)\n');
    console.log('| arm | prompts | first answer token later by p50 / p90 / p95 s | total later by p50 / p90 s | output tokens × |');
    console.log('|---|---:|---:|---:|---:|');
    const base = Object.fromEntries(P.filter((r) => r.arm === 'off').map((r) => [r.id, r]));
    for (const a of arms.filter((x) => x !== 'off')) {
      const x = P.filter((r) => r.arm === a && base[r.id]);
      const d = x.map((r) => r.t_text - base[r.id].t_text); const dt = x.map((r) => r.t_total - base[r.id].t_total);
      const tok = x.reduce((p, r) => p + (r.output_tokens ?? 0), 0) / Math.max(1, x.reduce((p, r) => p + (base[r.id].output_tokens ?? 0), 0));
      console.log(`| ${a} | ${x.length} | ${sec(q(d, 0.5))} / ${sec(q(d, 0.9))} / ${sec(q(d, 0.95))} | ${sec(q(dt, 0.5))} / ${sec(q(dt, 0.9))} | ${tok.toFixed(1)} |`);
    }
  }
  const fails = {}; for (const r of R.filter((x) => !x.ok)) fails[`${r.arm}: ${r.status} ${String(r.error ?? '').slice(0, 60)}`] = (fails[`${r.arm}: ${r.status} ${String(r.error ?? '').slice(0, 60)}`] ?? 0) + 1;
  if (Object.keys(fails).length) console.log(`\nFailed calls: ${JSON.stringify(fails)}`);
  const retried = ok.filter((r) => r.attempts > 1).length; if (retried) console.log(`Calls answered after a retry: ${retried} (timed from the attempt that answered).`);
}
if (args.includes('--report')) { report(); process.exit(0); }

// ---------- the key (never printed) ----------
const KEY_VAR = opt('key-var', 'AGENTROUTER_API_KEY_1');
const env = fs.readFileSync(process.env.NATIVELY_ENV_FILE || '/Users/evin/natively-cluely-ai-assistant/.env', 'utf8');
const KEY = (() => { for (const line of env.split(/\r?\n/)) { const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (m && m[1] === KEY_VAR) { const v = m[2].trim().replace(/^['"]|['"]$/g, ''); if (v) return v; } } return null; })();
if (!KEY) { console.error(`${KEY_VAR} not found in the env file`); process.exit(2); }
const scrub = (s) => String(s ?? '').split(KEY).join('[REDACTED]');

// ---------- the sample ----------
const modes = opt('mode') ? new Set(opt('mode').split(',')) : null;
const perCell = Number(opt('per-cell', 12));
const boost = (() => { const b = opt('boost'); if (!b) return {}; const [list, n] = b.split('='); return Object.fromEntries(list.split(',').map((m) => [m, Number(n)])); })();
const armNames = String(opt('arms', 'off,low,default')).split(',');
for (const a of armNames) if (!ARMS[a]) { console.error(`unknown arm ${a}`); process.exit(2); }
const h = (s) => crypto.createHash('sha256').update(s).digest('hex');
let prompts = loadPrompts(modes);
const cells = {};
for (const p of prompts.sort((a, b) => (h(a.id) < h(b.id) ? -1 : 1))) { const c = (cells[`${p.mode}|${p.difficulty}`] ??= []); if (c.length < (boost[p.mode] ?? perCell)) c.push(p); }
prompts = Object.values(cells).flat();
if (opt('screens')) {
  for (const s of loadScreens()) {
    prompts.push({ id: s.id, set: 'screens', mode: 'screenshot', difficulty: s.difficulty ?? null, surface: 'screenshot', system: s.system,
      content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: s.image_b64 } }, { type: 'text', text: s.user }] });
  }
}
if (opt('limit')) prompts = prompts.sort((a, b) => (h(`l${a.id}`) < h(`l${b.id}`) ? -1 : 1)).slice(0, Number(opt('limit')));

// ---------- one streamed call ----------
async function call(p, arm) {
  let last = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const t0 = Date.now(); const rec = { id: p.id, set: p.set, mode: p.mode, difficulty: p.difficulty, surface: p.surface, arm, ok: false, attempts: attempt, at: new Date().toISOString(), t_think: null, t_text: null, t_total: null, think_chars: 0, answer_chars: 0 };
    try {
      const res = await fetch('https://agentrouter.org/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', originator: 'codex_cli_rs' },
        // Reasoning counts against max_tokens, so the reasoning arms get room for it (as tools/replay.mjs does).
        body: JSON.stringify({ model: 'deepseek-v4-flash', max_tokens: arm === 'off' ? 1500 : 6000, stream: true, temperature: 0.2, system: p.system, messages: [{ role: 'user', content: p.content }], ...ARMS[arm] }),
        signal: AbortSignal.timeout(120000),
      });
      rec.status = res.status;
      if (!res.ok || !res.body) {
        rec.error = scrub(await res.text()).replace(/\s+/g, ' ').slice(0, 200); last = rec;
        if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt)); continue; }
        return rec;
      }
      const dec = new TextDecoder(); let buf = '';
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          const d = line.slice(5).trim(); if (!d || d === '[DONE]' || d === 'null') continue;
          let j; try { j = JSON.parse(d); } catch { continue; }
          if (j.type === 'content_block_delta' && j.delta?.type === 'thinking_delta') { rec.t_think ??= Date.now() - t0; rec.think_chars += (j.delta.thinking ?? '').length; }
          if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta' && (j.delta.text ?? '').length) { rec.t_text ??= Date.now() - t0; rec.answer_chars += j.delta.text.length; }
          if (j.type === 'message_start' && j.message?.usage) rec.input_tokens = j.message.usage.input_tokens ?? null;
          if (j.type === 'message_delta') { if (j.usage?.output_tokens != null) rec.output_tokens = j.usage.output_tokens; if (j.usage?.input_tokens != null) rec.input_tokens = j.usage.input_tokens; rec.stop = j.delta?.stop_reason ?? rec.stop; }
          if (j.type === 'error') rec.error = scrub(JSON.stringify(j.error ?? j)).slice(0, 200);
        }
      }
      rec.t_total = Date.now() - t0;
      rec.ok = rec.t_text != null && !rec.error;
      if (!rec.ok && !rec.error) rec.error = 'no answer text in the stream';
      return rec;
    } catch (e) { rec.status = rec.status ?? 0; rec.error = scrub(e?.message ?? e).slice(0, 160); last = rec; await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt)); }
  }
  return last;
}

// ---------- run: arms back to back on one prompt, in an order drawn per prompt; resumable ----------
const done = new Set(fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map((l) => { try { const r = JSON.parse(l); return r.ok ? `${r.id}|${r.arm}` : null; } catch { return null; } }).filter(Boolean) : []);
const CONC = Number(opt('concurrency', 4));
console.error(`${name}: ${prompts.length} prompts × ${armNames.length} arms (${armNames.join(', ')}) on ${KEY_VAR}, ${done.size} calls already recorded`);
let stop = null; let n = 0; let next = 0;
async function worker() {
  for (;;) {
    if (stop || next >= prompts.length) return;
    const p = prompts[next++];
    const order = [...armNames].sort((a, b) => (h(`${p.id}|${a}`) < h(`${p.id}|${b}`) ? -1 : 1));
    for (const arm of order) {
      if (done.has(`${p.id}|${arm}`) || stop) continue;
      const rec = await call(p, arm);
      fs.appendFileSync(outFile, `${JSON.stringify(rec)}\n`);
      if (!rec.ok && (rec.status === 401 || rec.status === 402 || rec.status === 403)) stop = `HTTP ${rec.status}: ${rec.error}`;
    }
    if (++n % 25 === 0) console.error(`  ${n}/${prompts.length} prompts`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
if (stop) console.error(`stopped: ${stop}`);
report();
