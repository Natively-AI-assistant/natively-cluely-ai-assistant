/**
 * The thinking setting each Claude model is sent (2026-10-01).
 *
 * Natively sent `thinking: { type: 'disabled' }` on EVERY native Claude request,
 * for low time-to-first-token. Anthropic's per-model table
 * (platform.claude.com/docs/en/build-with-claude/thinking, read 2026-10-01):
 *
 *   disabled accepted : Opus/Sonnet/Haiku 4.5–4.8, Sonnet 5, Opus 5 (at the
 *                       default effort)
 *   400 on disabled   : Opus 5.5, Sonnet 5.5, Fable 5 / 5.1, Mythos
 *   Sonnet 5.5        : `between_tools` is its lowest setting (up-front
 *                       thinking off), accepted at the default effort
 *
 * So a selected Opus 5.5, Sonnet 5.5 or Fable failed every request, text and
 * screenshot. Since phase 5a a selected Claude model also reads its own
 * screenshots, so the image adapter is pinned here too.
 *
 * The bytes are asserted on the wire (real Anthropic SDK against a local
 * server). NOT EXECUTED against Anthropic: there is no Anthropic key in this
 * environment, so the 400 itself is the documentation's word.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: { app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' }, safeStorage: { isEncryptionAvailable: () => false } },
};
const { claudeThinkingParam } = require(dist('llm/modelCapabilities.js'));
const { LLMHelper } = require(dist('LLMHelper.js'));
const Anthropic = require('@anthropic-ai/sdk').default ?? require('@anthropic-ai/sdk');

const OFF = ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307', 'claude-opus-4-20250514', 'claude-sonnet-4-5', 'claude-opus-4-5-20251101',
  'claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-opus-5', 'claude-sonnet-5'];
const BETWEEN_TOOLS = ['claude-sonnet-5-5', 'claude-sonnet-5-5-20260915'];
const NONE = ['claude-opus-5-5', 'claude-opus-5-5-20260915', 'claude-fable-5', 'claude-fable-5-1', 'claude-mythos-5', 'claude-mythos-5-1',
  'claude-mythos-preview', 'claude-haiku-5', 'claude-opus-6', 'claude-something-new', ''];

describe('claudeThinkingParam', () => {
  for (const id of OFF) test(`${id}: thinking disabled`, () => assert.deepEqual(claudeThinkingParam(id), { thinking: { type: 'disabled' } }));
  for (const id of BETWEEN_TOOLS) test(`${id}: between_tools, its lowest setting`, () => assert.deepEqual(claudeThinkingParam(id), { thinking: { type: 'between_tools' } }));
  for (const id of NONE) test(`${id || '(empty)'}: no thinking field (the only request it accepts, or unknown)`, () => assert.deepEqual(claudeThinkingParam(id), {}));
  test('case does not matter', () => assert.deepEqual(claudeThinkingParam('Claude-Sonnet-5'), { thinking: { type: 'disabled' } }));
});

describe('every native Claude request, on the wire', () => {
  let server; let origin; const bodies = [];
  const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  before(async () => {
    server = http.createServer((req, res) => {
      let raw = ''; req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        bodies.push(JSON.parse(raw));
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end([
          sse('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }),
          sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
          sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }),
          sse('content_block_stop', { type: 'content_block_stop', index: 0 }),
          sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }),
          sse('message_stop', { type: 'message_stop' }),
        ].join(''));
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    origin = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise((r) => server.close(r)));

  function helper(model) {
    const h = Object.create(LLMHelper.prototype);
    Object.assign(h, { isLocalOnlyMode: false, isProviderDisabled: () => false, currentModelId: model, assertOutboundScopes: () => {}, rateLimiters: { claude: { acquire: async () => {} } } });
    h._claudeClient = new Anthropic({ apiKey: 'sk-ant-test', baseURL: origin, maxRetries: 0 });
    return h;
  }
  const drain = async (gen) => { let t = ''; for await (const p of gen) t += p; return t; };
  const ADAPTERS = {
    'text stream': async (h, model) => assert.equal(await drain(h.streamWithClaude('q', 'SYS', model)), 'ok'),
    'image stream': async (h, model) => assert.equal(await drain(h.streamWithClaudeMultimodal('what is this?', [], 'SYS', model)), 'ok'),
    'non-streaming': async (h, model) => assert.equal(await h.generateWithClaude('q', 'SYS', undefined, model), 'ok'),
  };
  const sent = async (adapter, model) => { await ADAPTERS[adapter](helper(model), model); return bodies[bodies.length - 1]; };

  for (const adapter of Object.keys(ADAPTERS)) {
    test(`${adapter}: Sonnet 4.6, Sonnet 5 and Opus 5 still get thinking disabled`, async () => {
      for (const model of ['claude-sonnet-4-6', 'claude-sonnet-5', 'claude-opus-5']) {
        const b = await sent(adapter, model);
        assert.equal(b.model, model);
        assert.deepEqual(b.thinking, { type: 'disabled' }, model);
      }
    });
    test(`${adapter}: Opus 5.5 and Fable get NO thinking field (they 400 on one)`, async () => {
      for (const model of ['claude-opus-5-5', 'claude-fable-5-1']) {
        const b = await sent(adapter, model);
        assert.equal(b.model, model);
        assert.equal('thinking' in b, false, `${model} was sent ${JSON.stringify(b.thinking)}`);
      }
    });
    test(`${adapter}: Sonnet 5.5 gets between_tools (it 400s on disabled)`, async () => {
      assert.deepEqual((await sent(adapter, 'claude-sonnet-5-5')).thinking, { type: 'between_tools' });
    });
  }
});
