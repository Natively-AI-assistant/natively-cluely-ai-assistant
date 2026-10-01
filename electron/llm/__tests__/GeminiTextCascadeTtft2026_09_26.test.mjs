// The Gemini TEXT cascade gives each rung its own first-token budget.
//
// Live 2026-09-26 (Gemini key, Auto Answer, technical interview): the default
// model gemini-3.8-flash thinks at 'low' before its first token (1.9-2.4 s on a
// live-sized prompt) and the cascade allowed a flat 2.5 s, so turns went
// Flash timeout ×2 → Pro timeout ×2 (Pro's first token is 5-6 s) → the Natively
// key, 13 s after the question. These run the REAL cascade with stubbed model
// streams and real timers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { LLMHelper, GEMINI_TEXT_TTFT_MS } = require(path.resolve(__dirname, '../../../dist-electron/electron/LLMHelper.js'));

function cascadeHelper(firstTokenMsByModel, currentModelId) {
  const h = Object.create(LLMHelper.prototype);
  const calls = [];
  Object.assign(h, {
    client: {}, currentModelId, textHealth: new Map(),
    async *streamWithGeminiModel(_msg, model, _imgs, _sys, signal) {
      calls.push(model);
      const wait = firstTokenMsByModel[model] ?? 50;
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, wait);
        signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
      });
      yield `answer from ${model}`;
    },
  });
  return { h, calls };
}

async function collect(gen) { let out = ''; for await (const c of gen) out += c; return out; }

test('budgets are ordered by model speed and Pro gets room for its 5-6 s first token', () => {
  assert.ok(GEMINI_TEXT_TTFT_MS.flashLite < GEMINI_TEXT_TTFT_MS.flash);
  assert.ok(GEMINI_TEXT_TTFT_MS.flash < GEMINI_TEXT_TTFT_MS.pro);
  assert.ok(GEMINI_TEXT_TTFT_MS.pro >= 8000);
});

test('gemini-3.8-flash answering at 3 s is USED — not timed out into Pro and the Natively key', async () => {
  const { h, calls } = cascadeHelper({ 'gemini-3.8-flash': 3000 }, 'gemini-3.8-flash');
  const out = await collect(h.streamGeminiTextCascade('q', undefined, 'sys', undefined));
  assert.match(out, /answer from gemini-3.8-flash/);
  assert.deepEqual(calls, ['gemini-3.8-flash'], 'one call, no retry, no Pro');
});

test('flash-lite keeps its tight budget: a 3 s first token still fails over', async () => {
  const { h, calls } = cascadeHelper({ 'gemini-3.1-flash-lite': 3000, 'gemini-3.8-flash': 50 }, 'gemini-3.1-flash-lite');
  const out = await collect(h.streamGeminiTextCascade('q', undefined, 'sys', undefined));
  assert.match(out, /answer from gemini-3.8-flash/);
  assert.ok(calls.includes('gemini-3.1-flash-lite') && calls.includes('gemini-3.8-flash'));
});
