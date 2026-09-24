// electron/llm/__tests__/DeepseekThinkingDisabled2026_09_23.test.mjs
//
// DeepSeek's chat API THINKS BY DEFAULT: `thinking.type` defaults to `enabled`
// (reasoning_effort `high`), and when streaming, the reasoning arrives in
// `delta.reasoning_content` BEFORE the first `delta.content` token
// (api-docs.deepseek.com/api/create-chat-completion). The repo's own benchmark
// (benchmark/reports/REPORT.md) measured it: a probe without the field returned
// reasoning_tokens 106 on a tiny prompt; the summary server's body, which has
// always sent `thinking:{type:'disabled'}`, returned 0.
//
// The INTERACTIVE paths never sent it. Every live answer on a DeepSeek model
// therefore waited out a hidden chain of thought before the overlay showed a
// word — the content readers here only look at `delta.content`, so nothing
// was visible, only slow.
//
// These drive the REAL compiled methods over a recording stub client, so the
// request that would reach the wire is observed, not assumed.
//
// Platform: no platform branch in any of this — one run covers darwin and win32.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/DeepseekThinkingDisabled2026_09_23.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const { LLMHelper } = await import(pathToFileURL(path.resolve(repoRoot, 'dist-electron/electron/LLMHelper.js')).href);

/** A bare instance wired to a DeepSeek stub that records every request body. */
const harness = (reply) => {
  const seen = [];
  const self = Object.create(LLMHelper.prototype);
  self._deepseekClient = {
    chat: { completions: { create: async (req) => { seen.push(req); return reply(req); } } },
  };
  self.isProviderDisabled = () => false;
  self.assertOutboundScopes = () => {};
  self.rateLimiters = { deepseek: { acquire: async () => {} } };
  self.currentModelId = 'deepseek-flash';
  return { self, seen };
};

async function* chunks(...parts) {
  for (const p of parts) yield { choices: [{ delta: { content: p } }] };
}

describe('DeepSeek interactive requests switch thinking off', () => {
  test('streaming (the live answer path) sends thinking:{type:disabled}', async () => {
    const { self, seen } = harness(() => chunks('Hel', 'lo'));
    let out = '';
    for await (const c of self.streamWithDeepseek('q', 'sys')) out += c;
    assert.equal(out, 'Hello', 'the stream itself is untouched');
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].thinking, { type: 'disabled' });
    assert.equal(seen[0].stream, true);
    assert.equal(seen[0].model, 'deepseek-flash');
  });

  test('a user-picked deepseek-v4-pro gets it too — the default is per API, not per model', async () => {
    const { self, seen } = harness(() => chunks('x'));
    for await (const _ of self.streamWithDeepseek('q', undefined, 'deepseek-v4-pro')) { /* drain */ }
    assert.equal(seen[0].model, 'deepseek-v4-pro');
    assert.deepEqual(seen[0].thinking, { type: 'disabled' });
  });

  test('non-streaming generation sends it as well', async () => {
    const { self, seen } = harness(() => ({ choices: [{ message: { content: 'Answer.' } }] }));
    const text = await self.generateWithDeepseek('q', 'sys');
    assert.equal(text, 'Answer.');
    assert.deepEqual(seen[0].thinking, { type: 'disabled' });
  });

  test('Settings "Test Connection" does not make the user wait out a reasoning pass', () => {
    const ipc = fs.readFileSync(path.resolve(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');
    const at = ipc.indexOf("'https://api.deepseek.com/chat/completions'");
    assert.ok(at > 0, 'probe located');
    assert.match(ipc.slice(at, at + 600), /thinking: \{ type: 'disabled' \}/);
  });
});
