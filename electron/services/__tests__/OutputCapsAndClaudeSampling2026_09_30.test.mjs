/**
 * Output caps and Claude sampling parameters (2026-09-30).
 *
 * Two findings from checking AgentRouter against the vendors' real limits, both
 * in the NATIVE provider tables that AgentRouter mirrors on purpose:
 *
 *  1. Output caps were far below the models' real ceilings: DeepSeek 8,192
 *     (real 393,216 — measured: api.deepseek.com answers more with 400 "the
 *     valid range of max_tokens is [1, 393216]"), every Claude 5 model 8,192
 *     (real 128K; the table had no Claude 5 entry), gpt-6 16,384 (an unknown
 *     id to the table). A long coding answer was cut off at exactly 8,192.
 *     Evin's choice: a shared 65,536 ceiling (MAX_OUTPUT_TOKENS), lower only
 *     where a model's own limit is lower.
 *
 *  2. Claude Opus 4.7+ and the Claude 5 families reject `temperature` with a
 *     400 (Claude API model reference), and Natively sent 0.2 to every Claude
 *     model — natively and, by mirroring, through AgentRouter.
 *
 * The bodies are asserted on the wire (a local server, the real Anthropic SDK,
 * the real streamWithClaude), not by reading source.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);

const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: {
    app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};

const { LLMHelper } = require(dist('LLMHelper.js'));
const { claudeAcceptsSamplingParams, getOpenAiMaxOutput } = require(dist('llm/modelCapabilities.js'));
const Anthropic = require('@anthropic-ai/sdk').default ?? require('@anthropic-ai/sdk');

describe('which Claude models take temperature', () => {
  test('models up to 4.6 do', () => {
    for (const id of ['claude-haiku-4-5', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-6',
      'claude-sonnet-4-20250514', 'claude-opus-4-1-20250805', 'claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307']) {
      assert.equal(claudeAcceptsSamplingParams(id), true, id);
    }
  });

  test('Opus 4.7+ and every Claude 5 family do not (a 400 if sent)', () => {
    for (const id of ['claude-opus-4-7', 'claude-opus-4-8', 'claude-opus-5', 'claude-opus-5-5', 'claude-sonnet-5',
      'claude-sonnet-5-5', 'claude-fable-5', 'claude-fable-5-1', 'claude-mythos-5-1']) {
      assert.equal(claudeAcceptsSamplingParams(id), false, id);
    }
  });

  test('an unknown or future id omits it — omitting never 400s, sending can', () => {
    assert.equal(claudeAcceptsSamplingParams('claude-opus-6'), false);
    assert.equal(claudeAcceptsSamplingParams(''), false);
  });
});

describe('output caps', () => {
  const h = Object.create(LLMHelper.prototype);

  test('DeepSeek: its real 393,216 held to the shared 65,536 ceiling', () => {
    assert.equal(h.getDeepseekMaxOutput('deepseek-flash'), 65536);
  });

  test('Claude 5 families were at 8192 for want of a table entry; now the ceiling', () => {
    for (const id of ['claude-opus-5', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1']) {
      assert.equal(h.getClaudeMaxOutput(id), 65536, id);
    }
    assert.equal(h.getClaudeMaxOutput('claude-opus-4-8'), 65536, 'real 128K, held to the ceiling');
  });

  test('models whose own limit is below the ceiling keep it', () => {
    assert.equal(h.getClaudeMaxOutput('claude-haiku-4-5'), 64000);
    assert.equal(h.getClaudeMaxOutput('claude-opus-4-1'), 32000);
    assert.equal(h.getClaudeMaxOutput('claude-3-5-sonnet-20241022'), 8192);
    assert.equal(h.getClaudeMaxOutput('some-unknown-claude-proxy'), 8192, 'unknown stays conservative');
  });

  test('gpt-6 is grouped with gpt-5 instead of falling to the unknown-id 16,384', () => {
    assert.equal(getOpenAiMaxOutput('gpt-6-astra', 65536), 65536);
    assert.equal(getOpenAiMaxOutput('gpt-6-astra', 10_000_000), 128000);
    assert.equal(getOpenAiMaxOutput('gpt-5.5', 65536), 65536);
    assert.equal(getOpenAiMaxOutput('some-custom-openai-proxy', 65536), 16384, 'unknown ids unchanged');
  });
});

describe('native streamWithClaude on the wire', () => {
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

  async function send(model) {
    const h = Object.create(LLMHelper.prototype);
    Object.assign(h, { isLocalOnlyMode: false, currentModelId: model, assertOutboundScopes: () => {}, rateLimiters: { claude: { acquire: async () => {} } } });
    h._claudeClient = new Anthropic({ apiKey: 'sk-ant-test', baseURL: origin, maxRetries: 0 });
    let text = '';
    for await (const piece of h.streamWithClaude('q', undefined, model)) text += piece;
    assert.equal(text, 'ok');
    return bodies[bodies.length - 1];
  }

  test('Opus 5: no temperature, the 65,536 cap, thinking off', async () => {
    const b = await send('claude-opus-5');
    assert.equal(b.temperature, undefined);
    assert.equal(b.max_tokens, 65536);
    assert.deepEqual(b.thinking, { type: 'disabled' });
  });

  test('Opus 4.8: no temperature either', async () => {
    assert.equal((await send('claude-opus-4-8')).temperature, undefined);
  });

  test('Sonnet 4.6 still gets the low interactive temperature', async () => {
    const b = await send('claude-sonnet-4-6');
    assert.equal(b.temperature, 0.2);
    assert.equal(b.max_tokens, 64000);
  });
});
