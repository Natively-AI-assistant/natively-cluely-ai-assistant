// run-loadtest.mjs — concurrency / pressure test.
//
// The pipeline benchmark found DeepSeek stalling to ~45s at concurrency 4
// through natively-api while the SAME prompt direct-to-API took 2.4s. That
// leaves one decisive question before any rollout: is the ceiling in
// DeepSeek's API, or in Natively's server path? Those have very different
// fixes, so this measures BOTH transports at the same concurrency levels.
//
//   --mode=direct    → straight to api.deepseek.com (isolates the provider)
//   --mode=pipeline  → through natively-api /v1/chat (the real path)
//   --mode=gemini    → through natively-api unpinned (control: does the
//                      SERVER hold up at this concurrency for any provider?)
//
// Reports per level: success rate, TTFT/total percentiles, and error taxonomy.
// A provider that "works" at concurrency 10 must show ~100% success AND a
// latency curve that degrades gracefully — a 45s timeout is a failure even
// when the request eventually returns.
//
// Usage:
//   node benchmarks/deepseek-vs-gemini/run-loadtest.mjs --mode=direct --levels=1,4,8,10 --n=20
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeepseekClient, callDeepseek } from './lib/clients.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const SERVER_URL = process.env.NATIVELY_BENCH_URL || 'http://localhost:3000';
const LOCAL_TOKEN = process.env.NATIVELY_LOCAL_TEST_TOKEN || 'local-bench-token';
const PROMPT_FILE = process.env.NATIVELY_BENCH_PROMPT || '/tmp/natively-system-prompt.txt';

const arg = (k, d) => {
  const a = process.argv.slice(2).find((x) => x.startsWith(`--${k}=`));
  return a ? a.split('=').slice(1).join('=') : d;
};

const pct = (arr, q) => {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
};

function loadPrompts(n) {
  let all = [];
  for (const f of ['meeting.json', 'technical-interview.json', 'sales.json', 'recruiting.json', 'general.json']) {
    all = all.concat(JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, f), 'utf8')));
  }
  // Deterministic spread across categories rather than the first N of one file.
  const step = Math.max(1, Math.floor(all.length / n));
  return Array.from({ length: n }, (_, i) => all[(i * step) % all.length]);
}

/** Fire `tasks` such that exactly `limit` are in flight at all times. */
async function runAtConcurrency(tasks, limit) {
  const out = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      out[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return out;
}

async function pipelineCall({ systemPrompt, userPrompt, requestId }) {
  const start = Date.now();
  let ttftMs = null, text = '';
  try {
    const res = await fetch(`${SERVER_URL}/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-natively-local-test': LOCAL_TOKEN, 'X-Request-Id': requestId },
      body: JSON.stringify({ messages: [{ role: 'user', content: userPrompt }], system: systemPrompt, stream: true }),
    });
    if (!res.ok) return { ok: false, ttftMs: null, latencyMs: Date.now() - start, error: `HTTP ${res.status}` };
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const p = t.slice(5).trim();
        if (p === '[DONE]') continue;
        let o; try { o = JSON.parse(p); } catch { continue; }
        const piece = o.delta ?? o.content ?? '';
        if (piece) { if (ttftMs === null) ttftMs = Date.now() - start; text += piece; }
      }
    }
    return { ok: text.trim().length > 0, ttftMs, latencyMs: Date.now() - start, error: text.trim() ? null : 'empty response' };
  } catch (e) {
    return { ok: false, ttftMs: null, latencyMs: Date.now() - start, error: String(e?.message || e) };
  }
}

async function main() {
  const mode = arg('mode', 'direct');
  const levels = String(arg('levels', '1,4,8,10')).split(',').map(Number).filter(Boolean);
  const n = Number(arg('n', 20));
  if (!['direct', 'pipeline', 'gemini'].includes(mode)) { console.log('--mode=direct|pipeline|gemini'); process.exit(1); }

  const systemPrompt = fs.readFileSync(PROMPT_FILE, 'utf8');
  const prompts = loadPrompts(n);
  const client = mode === 'direct' ? createDeepseekClient(process.env.DEEPSEEK_API_KEY) : null;

  console.log(`LOAD TEST | mode=${mode} | ${n} requests per level | levels: ${levels.join(', ')}`);
  console.log(`system prompt: ${systemPrompt.length} chars (the real production prompt)\n`);
  console.log('LEVEL  OK      FAIL  TTFT p50  TTFT p95  TOTAL p50  TOTAL p95  WALL     ERRORS');

  const summary = [];
  for (const level of levels) {
    const tasks = prompts.map((fx, i) => async () => {
      const userPrompt = `Context:\n${fx.context}\n\nQuestion: ${fx.question}`;
      if (mode === 'direct') {
        const r = await callDeepseek(client, { model: 'deepseek-v4-flash', systemPrompt, userPrompt });
        return { ok: !r.error && r.text.trim().length > 0, ttftMs: r.ttftMs, latencyMs: r.latencyMs, error: r.error || (r.text.trim() ? null : 'empty response') };
      }
      return pipelineCall({ systemPrompt, userPrompt, requestId: `load-${mode}-${level}-${i}` });
    });

    const wall0 = Date.now();
    const res = await runAtConcurrency(tasks, level);
    const wallMs = Date.now() - wall0;

    const ok = res.filter((r) => r.ok);
    const bad = res.filter((r) => !r.ok);
    const errs = {};
    for (const b of bad) {
      const k = /timeout|aborted/i.test(b.error || '') ? 'timeout'
        : /empty/i.test(b.error || '') ? 'empty'
        : /HTTP/i.test(b.error || '') ? b.error
        : 'other';
      errs[k] = (errs[k] || 0) + 1;
    }
    const t = ok.filter((r) => r.ttftMs != null).map((r) => r.ttftMs);
    const tot = ok.map((r) => r.latencyMs);
    const row = {
      level, ok: ok.length, fail: bad.length,
      ttftP50: pct(t, 0.5), ttftP95: pct(t, 0.95),
      totalP50: pct(tot, 0.5), totalP95: pct(tot, 0.95),
      wallMs, errors: errs,
    };
    summary.push(row);
    console.log(
      String(level).padEnd(6) +
      `${ok.length}/${res.length}`.padEnd(8) +
      String(bad.length).padEnd(6) +
      String(row.ttftP50 ?? '-').padEnd(10) +
      String(row.ttftP95 ?? '-').padEnd(10) +
      String(row.totalP50 ?? '-').padEnd(11) +
      String(row.totalP95 ?? '-').padEnd(11) +
      `${(wallMs / 1000).toFixed(1)}s`.padEnd(9) +
      (Object.keys(errs).length ? JSON.stringify(errs) : '-')
    );
  }

  const outPath = path.join(__dirname, 'results', `loadtest-${mode}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${outPath}`);
  if (mode !== 'direct') {
    console.log('For pipeline modes, cross-check the server log: GEN-PIN successes vs "FAILED" fallthroughs.');
  }
}

main();
