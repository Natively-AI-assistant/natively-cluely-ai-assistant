// run-pipeline-comparison.mjs — PIPELINE-LEVEL comparison.
//
// Unlike run-raw-comparison.mjs (which calls the model APIs directly), this
// drives the REAL Natively backend: natively-api/server.js, with the REAL
// production system prompt (OPENAI_SYSTEM_PROMPT, ~23k chars, extracted from
// electron/llm/prompts.ts), through the REAL /v1/chat route — so routing,
// prompt composition, thinking config, budgets and cascade all apply.
//
// Two arms, one server each:
//   gemini   — server started with NO pin  → normal cascade (flash-lite default)
//   deepseek — server started with NATIVELY_FORCE_PRIMARY_GEN=deepseek
//
// MODEL ATTRIBUTION: the streaming route emits only `data: {"delta":…}` and
// carries no model id, so the arm cannot be verified per-response from the
// response body. Instead the runner records the per-request X-Request-Id and
// the caller MUST cross-check the server log for one
// `[GEN-PIN] routeChatStream → DeepSeek` line per request. The GEN-PIN block
// falls through to Gemini on hard failure BY DESIGN, so a silent fallthrough
// would otherwise be invisible and would corrupt the comparison.
//
// Usage:
//   node benchmarks/deepseek-vs-gemini/run-pipeline-comparison.mjs --arm=deepseek --confirm
//   node benchmarks/deepseek-vs-gemini/run-pipeline-comparison.mjs --arm=gemini --confirm [--sample=N] [--concurrency=4]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/cli-args.mjs';
import { runWithConcurrency } from './lib/concurrency.mjs';
import { pendingWork } from './lib/resumability.mjs';
import { upsertResult } from './lib/results.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const RESULTS_DIR = path.join(__dirname, 'results');
const CATEGORY_FILES = ['meeting.json', 'technical-interview.json', 'sales.json', 'recruiting.json', 'general.json'];

const SERVER_URL = process.env.NATIVELY_BENCH_URL || 'http://localhost:3000';
const LOCAL_TOKEN = process.env.NATIVELY_LOCAL_TEST_TOKEN || 'local-bench-token';
// The real production system prompt the gateway receives on the default chat
// path (LLMHelper: `systemPromptOverride || OPENAI_SYSTEM_PROMPT`). Extracted
// by bundling electron/llm/prompts.ts — see the --extract-prompt step below.
const SYSTEM_PROMPT_FILE = process.env.NATIVELY_BENCH_PROMPT || '/tmp/natively-system-prompt.txt';

function loadFixtures(sampleCap) {
  let all = [];
  for (const file of CATEGORY_FILES) {
    const entries = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf8'));
    all = all.concat(sampleCap ? entries.slice(0, sampleCap) : entries);
  }
  return all;
}

/**
 * One streamed /v1/chat call against the real server.
 * Returns { text, ttftMs, latencyMs, requestId, error }.
 */
async function callPipeline({ systemPrompt, userPrompt, requestId }) {
  const start = Date.now();
  let ttftMs = null;
  let text = '';
  try {
    const res = await fetch(`${SERVER_URL}/v1/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-natively-local-test': LOCAL_TOKEN,
        'X-Request-Id': requestId,
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: userPrompt }],
        system: systemPrompt,
        stream: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { text: '', ttftMs: null, latencyMs: Date.now() - start, requestId, error: `HTTP ${res.status} ${body.slice(0, 200)}` };
    }

    // SSE: `data: {"delta":"…"}` lines terminated by `data: [DONE]`.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (payload === '[DONE]') continue;
        let obj;
        try { obj = JSON.parse(payload); } catch { continue; }
        const piece = obj.delta ?? obj.content ?? '';
        if (piece) {
          if (ttftMs === null) ttftMs = Date.now() - start;
          text += piece;
        }
      }
    }
    return { text, ttftMs, latencyMs: Date.now() - start, requestId, error: null };
  } catch (err) {
    return { text: '', ttftMs: null, latencyMs: Date.now() - start, requestId, error: String(err?.message || err) };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const armArg = process.argv.slice(2).find((a) => a.startsWith('--arm='));
  const arm = armArg ? armArg.split('=')[1] : null;
  if (!arm || !['gemini', 'deepseek'].includes(arm)) {
    console.log('Pass --arm=gemini or --arm=deepseek (must match how the server was started).');
    process.exit(1);
  }
  if (!fs.existsSync(SYSTEM_PROMPT_FILE)) {
    console.log(`Missing system prompt file ${SYSTEM_PROMPT_FILE}. Extract it first with:`);
    console.log("  npx esbuild electron/llm/prompts.ts --bundle --format=esm --platform=node --outfile=/tmp/prompts-bundle.mjs");
    console.log("  node -e \"import('/tmp/prompts-bundle.mjs').then(p=>require('fs').writeFileSync('/tmp/natively-system-prompt.txt',p.OPENAI_SYSTEM_PROMPT))\"");
    process.exit(1);
  }
  const systemPrompt = fs.readFileSync(SYSTEM_PROMPT_FILE, 'utf8');
  const fixtures = loadFixtures(args.sample);

  console.log(`Arm: ${arm} | server: ${SERVER_URL} | prompt: ${systemPrompt.length} chars`);
  console.log(`Fixtures: ${fixtures.length} prompts (1 call each)`);
  if (args.dryRun) { console.log('--dry-run: exiting without calling the server.'); return; }
  if (!args.confirm) { console.log('Pass --confirm to run (or --dry-run).'); process.exit(1); }

  // Health check before spending: a wrong-arm or dead server should fail loudly now.
  try {
    const probe = await callPipeline({ systemPrompt: 'You are a test.', userPrompt: 'Reply with OK.', requestId: 'bench-probe-0001' });
    if (probe.error) { console.error(`Server probe FAILED: ${probe.error}`); process.exit(1); }
    console.log(`Server probe OK (${probe.latencyMs}ms, ttft ${probe.ttftMs}ms)`);
  } catch (e) {
    console.error(`Server probe threw: ${e.message}`); process.exit(1);
  }

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const resultsPath = path.join(RESULTS_DIR, `pipeline-${arm}.json`);
  const existing = fs.existsSync(resultsPath) ? JSON.parse(fs.readFileSync(resultsPath, 'utf8')) : [];
  const pending = pendingWork(fixtures.map((f) => f.id), [arm], existing);
  console.log(`${pending.length} of ${fixtures.length} pending.`);

  const byId = new Map(fixtures.map((f) => [f.id, f]));
  let results = existing.slice();

  const tasks = pending.map(({ promptId }) => async () => {
    const fx = byId.get(promptId);
    const userPrompt = `Context:\n${fx.context}\n\nQuestion: ${fx.question}`;
    // Request id is the ONLY handle for cross-checking the server log, so it
    // must be unique, stable per prompt, and match the server's accepted shape
    // (/^[a-zA-Z0-9_.:-]{8,128}$/).
    const requestId = `bench-${arm}-${promptId}`;
    const call = await callPipeline({ systemPrompt, userPrompt, requestId });
    const record = { promptId, category: fx.category, modelId: arm, ...call };
    results = upsertResult(results, record);
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    console.log(`[${arm}] ${promptId}: ${call.error ? `ERROR ${call.error}` : `ttft ${call.ttftMs}ms total ${call.latencyMs}ms ${call.text.length}ch`}`);
    return record;
  });

  await runWithConcurrency(tasks, args.concurrency);
  const errs = results.filter((r) => r.error).length;
  console.log(`Done. ${results.length} results (${errs} errors) → ${resultsPath}`);
  console.log(`VERIFY ATTRIBUTION: grep the server log for GEN-PIN lines; for arm=deepseek there must be ${results.length - errs} successes and ZERO "[GEN-PIN] ... FAILED" fallthroughs.`);
}

main();
