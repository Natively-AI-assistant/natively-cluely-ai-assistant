/**
 * AgentRouter on the wire, deterministically: the REAL SDK clients (built by
 * createAgentRouterClients, identity header and all) and the REAL LLMHelper
 * adapters, pointed at a local server that replays the bytes AgentRouter
 * actually sent on 2026-09-30.
 *
 * Two of those byte patterns break code written for a well-behaved OpenAI
 * server, and neither shows up against a mock that returns tidy JSON:
 *   - the Chat Completions stream carries literal `data: null` events, which
 *     the openai SDK yields as `null` chunks — `chunk.choices` then throws a
 *     TypeError halfway through an answer;
 *   - a NON-streaming /v1/messages reply is `Content-Type: text/plain`, so the
 *     Anthropic SDK returns a string and `.content` is undefined — an empty
 *     answer with no error. The adapters must therefore always stream; the
 *     server below answers non-streaming requests exactly that way, so any
 *     path that stops streaming produces an empty answer and fails here.
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
const { createAgentRouterClients } = require(dist('llm/agentRouterClients.js'));

const KEY = 'sk-agentrouter-wire-test';

// ── Replayed bodies (trimmed from the live captures, shapes unchanged) ──────
const oaiChunk = (delta, finish = null, extra = {}) => JSON.stringify({
  id: '4b20cbbc-a612-4865-8260-9449b02381d4', object: 'chat.completion.chunk', created: 1790751287,
  model: 'deepseek-v4-flash', system_fingerprint: null,
  choices: [{ delta, logprobs: null, finish_reason: finish, index: 0 }], usage: null, ...extra,
});
const DEEPSEEK_SSE = [
  `data: ${oaiChunk({ content: '', role: 'assistant' })}`,
  `data: ${oaiChunk({})}`,
  `data: ${oaiChunk({ reasoning_content: 'We need to answer.' })}`,
  `data: ${oaiChunk({ reasoning_content: ' One sentence.' })}`,
  'data: null',
  `data: ${oaiChunk({})}`,
  `data: ${oaiChunk({ content: 'A token bucket' })}`,
  `data: ${oaiChunk({ content: ' per API key.' })}`,
  'data: null',
  `data: ${oaiChunk({}, 'stop')}`,
  'data: [DONE]',
].map((l) => `${l}\n\n`).join('');

const antEvent = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const CLAUDE_SSE = [
  antEvent('message_start', { type: 'message_start', content_block: null, delta: null, error: null, index: 0,
    message: { content: [], id: 'eaea703d-93b4-4470-a315-f3610bd36c11', model: 'claude-opus-5', role: 'assistant', stop_reason: null, stop_sequence: null, type: 'message',
      usage: { cache_creation_input_tokens: 0, cache_read_input_tokens: 0, input_tokens: 40, output_tokens: 0, service_tier: 'standard' } },
    usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }),
  antEvent('content_block_start', { content_block: { signature: '', thinking: '', type: 'thinking' }, delta: null, error: null, index: 0, message: null, type: 'content_block_start' }),
  antEvent('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hidden' } }),
  antEvent('content_block_stop', { type: 'content_block_stop', index: 0 }),
  antEvent('content_block_start', { content_block: { text: '', type: 'text' }, delta: null, error: null, index: 1, message: null, type: 'content_block_start' }),
  antEvent('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Use a sliding' } }),
  antEvent('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: ' window log.' } }),
  antEvent('content_block_stop', { type: 'content_block_stop', index: 1 }),
  antEvent('message_delta', { type: 'message_delta', content_block: null, delta: { stop_reason: 'end_turn', stop_sequence: null }, error: null, index: 0, message: null,
    usage: { input_tokens: 40, output_tokens: 11, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, service_tier: 'standard' } }),
  antEvent('message_stop', { content_block: null, delta: null, error: null, index: 0, message: null, type: 'message_stop' }),
].join('');

const BUDGET_OAI = { error: { message: 'Budget pool quota has been exhausted. Please ask an administrator to increase the limit or select another budget pool.', type: 'bad_response_status_code', param: '', code: 'bad_response_status_code' } };
const BUDGET_ANT = { error: { message: 'Budget pool quota has been exhausted. Please ask an administrator to increase the limit or select another budget pool. (request id: 202609301454324292002395k8kcKa4SFXXZ)', type: 'bad_response_status_code' }, type: 'error' };
const UNAUTHORIZED_CLIENT = { error: { message: 'unauthorized client detected, contact support for assistance at https://discord.gg/HgekCyHJqB' }, message: 'UNAUTHENTICATED', success: false, type: 'unauthorized_client_error' };

// ── The replay server ──────────────────────────────────────────────────────
let server;
let origin;
const requests = [];

function reply(res, status, contentType, body) {
  res.writeHead(status, { 'content-type': contentType, 'x-oneapi-request-id': 'test' });
  res.end(body);
}

before(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = null;
      try { body = JSON.parse(raw); } catch { /* not JSON */ }
      requests.push({ method: req.method, path: req.url, headers: req.headers, body });
      const model = body?.model;
      if (req.url === '/v1/chat/completions') {
        if (model === 'gpt-6-astra') return reply(res, 402, 'text/event-stream', JSON.stringify(BUDGET_OAI));
        if (model === 'unauthorized-probe') return reply(res, 401, 'application/json; charset=utf-8', JSON.stringify(UNAUTHORIZED_CLIENT));
        if (body?.stream !== true) return reply(res, 200, 'application/json', JSON.stringify({ choices: [{ message: { content: 'NON-STREAMING PATH TAKEN' } }] }));
        return reply(res, 200, 'text/event-stream', DEEPSEEK_SSE);
      }
      if (req.url === '/v1/messages') {
        if (model === 'claude-opus-4-8') return reply(res, 402, 'application/json; charset=utf-8', JSON.stringify(BUDGET_ANT));
        // The measured non-streaming shape: valid JSON sent as text/plain.
        if (body?.stream !== true) return reply(res, 200, 'text/plain; charset=utf-8', JSON.stringify({ content: [{ type: 'text', text: 'NON-STREAMING PATH TAKEN' }] }));
        return reply(res, 200, 'text/event-stream', CLAUDE_SSE);
      }
      reply(res, 404, 'text/html', '<html>404</html>');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

function makeHelper(model) {
  const h = Object.create(LLMHelper.prototype);
  Object.assign(h, {
    useOllama: false, isLocalOnlyMode: false, customProvider: null, activeCurlProvider: null,
    currentModelId: model, textHealth: new Map(), visionHealth: new Map(), answerLatency: new Map(),
    rateLimiters: { agentrouter: { acquire: async () => {} } },
    assertOutboundScopes: () => {},
  });
  const clients = createAgentRouterClients(KEY, origin);
  h._agentrouterOpenAIClient = clients.openai;
  h._agentrouterAnthropicClient = clients.anthropic;
  return h;
}

async function collect(gen) {
  let text = '';
  for await (const piece of gen) text += piece;
  return text;
}

const lastRequest = () => requests[requests.length - 1];

describe('Chat Completions (DeepSeek)', () => {
  test('`data: null` events are skipped, reasoning is not shown, the answer arrives whole', async () => {
    const h = makeHelper('agentrouter/deepseek-v4-flash');
    const text = await collect(h.streamWithAgentRouter('How would you rate-limit an API?', 'SYS'));
    assert.equal(text, 'A token bucket per API key.');
  });

  test('what goes on the wire: path, key, identity header, stripped id, thinking off, streamed', async () => {
    const h = makeHelper('agentrouter/deepseek-v4-flash');
    await collect(h.streamWithAgentRouter('q', 'SYS'));
    const r = lastRequest();
    assert.equal(r.method, 'POST');
    assert.equal(r.path, '/v1/chat/completions');
    assert.equal(r.headers.authorization, `Bearer ${KEY}`);
    assert.equal(r.headers.originator, 'codex_cli_rs', 'the client-identity header must be on every request');
    assert.match(r.headers['user-agent'], /^OpenAI\/JS /, 'the User-Agent stays the SDK\'s own');
    assert.equal(r.body.model, 'deepseek-v4-flash', 'the agentrouter/ prefix must never reach the wire');
    assert.deepEqual(r.body.thinking, { type: 'disabled' });
    assert.equal(r.body.stream, true);
    assert.equal(r.body.messages[0].role, 'system');
  });

  test('the blocking adapter drains the stream too', async () => {
    const h = makeHelper('agentrouter/deepseek-v4-flash');
    assert.equal(await h.generateWithAgentRouter('q', 'SYS'), 'A token bucket per API key.');
    assert.equal(lastRequest().body.stream, true);
  });

  test('the fast-model seam caps the output with the parameter DeepSeek takes', async () => {
    const h = makeHelper('agentrouter/claude-opus-5');
    const out = await h.callFastModel('judge', { modelId: 'agentrouter/deepseek-v4-flash', timeoutMs: 5000 });
    assert.equal(out, 'A token bucket per API key.');
    const r = lastRequest();
    assert.equal(r.body.max_tokens, 256);
    assert.equal(r.body.max_completion_tokens, undefined);
    assert.deepEqual(r.body.thinking, { type: 'disabled' });
  });

  test('a 402 from the rationed pool is explained, with the status kept', async () => {
    const h = makeHelper('agentrouter/gpt-6-astra');
    await assert.rejects(collect(h.streamWithAgentRouter('q', 'SYS')), (e) => {
      assert.equal(e.status, 402);
      assert.match(e.message, /gpt-6-astra/);
      assert.match(e.message, /02:00 and 11:00 UTC/);
      return true;
    });
  });

  test('an unrecognised-client 401 is named as that, not as a bad key', async () => {
    const h = makeHelper('agentrouter/unauthorized-probe');
    await assert.rejects(collect(h.streamWithAgentRouter('q', 'SYS')), (e) => {
      assert.equal(e.status, 401);
      assert.match(e.message, /unrecognised app/);
      return true;
    });
  });
});

describe('Anthropic Messages (Claude)', () => {
  test('Claude streams over /v1/messages; only text deltas reach the user', async () => {
    const h = makeHelper('agentrouter/claude-opus-5');
    const text = await collect(h.streamWithAgentRouter('q', 'SYS'));
    assert.equal(text, 'Use a sliding window log.', 'thinking deltas must not leak into the answer');
  });

  test('what goes on the wire: /v1/messages (no doubled /v1), x-api-key, identity, string system', async () => {
    const h = makeHelper('agentrouter/claude-opus-5');
    await collect(h.streamWithAgentRouter('q', 'SYS'));
    const r = lastRequest();
    assert.equal(r.path, '/v1/messages');
    assert.equal(r.headers['x-api-key'], KEY);
    assert.equal(r.headers.originator, 'codex_cli_rs');
    assert.ok(r.headers['anthropic-version'], 'the SDK sets anthropic-version');
    assert.match(r.headers['user-agent'], /^Anthropic\/JS /);
    assert.equal(r.body.model, 'claude-opus-5');
    assert.equal(r.body.stream, true);
    assert.equal(r.body.system, 'SYS', 'a plain string, no cache_control blocks');
    assert.equal(typeof r.body.max_tokens, 'number');
    assert.equal(r.body.thinking, undefined);
  });

  test('the blocking adapter streams, so the text/plain non-streaming reply is never parsed', async () => {
    const h = makeHelper('agentrouter/claude-opus-5');
    assert.equal(await h.generateWithAgentRouter('q', 'SYS'), 'Use a sliding window log.');
  });

  test('the fast-model seam streams Claude too, with max_tokens', async () => {
    const h = makeHelper('agentrouter/claude-opus-5');
    const out = await h.callFastModel('judge', { modelId: 'agentrouter/claude-opus-5', timeoutMs: 5000 });
    assert.equal(out, 'Use a sliding window log.');
    const r = lastRequest();
    assert.equal(r.path, '/v1/messages');
    assert.equal(r.body.stream, true);
    assert.equal(r.body.max_tokens, 256);
  });

  test('a 402 on the Anthropic route is explained the same way', async () => {
    const h = makeHelper('agentrouter/claude-opus-4-8');
    await assert.rejects(collect(h.streamWithAgentRouter('q', 'SYS')), (e) => {
      assert.equal(e.status, 402);
      assert.match(e.message, /claude-opus-4-8/);
      return true;
    });
  });
});
