/**
 * Go-tier routing: per-model base URLs and the session header.
 *
 * Found by live testing on 2026-11-19, not by reading the docs:
 *
 *   - A Go key answers 402 "Insufficient balance" on the PAY-AS-YOU-GO base for
 *     a model the Go subscription covers. The catalogue names a different base
 *     per model (`.../inference/go/openai/v1`), so the adapter MUST use it.
 *   - The Go base refuses every request without `x-opencode-session`
 *     ("Request is missing x-opencode-session and cannot be routed
 *     efficiently"), and asks clients to send their own user agent.
 *
 * A fixed base URL or a missing header therefore turns every Go request into a
 * billing error that reads like a dead account. These assertions execute real
 * HTTP through the real SDKs against a local server.
 *
 * Run: node --test electron/services/__tests__/OpencodeGoRouting2026_11_19.test.mjs
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
  exports: {
    app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};

const { LLMHelper } = require(dist('LLMHelper.js'));
const OpenAI = require('openai');
const AnthropicMod = require('@anthropic-ai/sdk');
const Anthropic = AnthropicMod?.default || AnthropicMod;

let server;
let port;
const seen = [];

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({
        url: req.url,
        session: req.headers['x-opencode-session'] || '',
        ua: req.headers['user-agent'] || '',
        body,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url.endsWith('/v1/messages')) {
        res.end(JSON.stringify({
          id: 'msg_1', type: 'message', role: 'assistant', model: 'm',
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }));
      } else {
        res.end(JSON.stringify({
          id: 'c1', object: 'chat.completion', model: 'm',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    port = server.address().port;
    resolve();
  }));
});

after(() => server.close());

function helperWithLocalClients() {
  const h = Object.create(LLMHelper.prototype);
  h.isProviderDisabled = () => false;
  const headers = { 'x-opencode-session': 'natively-test-session', 'User-Agent': 'Natively/3.2.0' };
  h._opencodeOpenAIClient = new OpenAI({
    apiKey: 'oc_sk_test',
    baseURL: `http://127.0.0.1:${port}/paid/openai/v1`,
    defaultHeaders: headers,
  });
  h._opencodeAnthropicClient = new Anthropic({
    apiKey: 'oc_sk_test',
    baseURL: `http://127.0.0.1:${port}/paid/anthropic`,
    defaultHeaders: headers,
  });
  return h;
}

describe('per-model base URLs', () => {
  test('the primary client is used for the paid base', () => {
    const h = helperWithLocalClients();
    assert.equal(h.opencodeOpenAIFor(undefined), h.opencodeOpenAIClient);
    assert.equal(h.opencodeAnthropicFor(undefined), h.opencodeAnthropicClient);
  });

  test('a Go base gets its own client and reaches that URL', async () => {
    const h = helperWithLocalClients();
    const client = h.opencodeOpenAIFor(`http://127.0.0.1:${port}/go/openai/v1`);
    assert.notEqual(client, h.opencodeOpenAIClient);
    await client.chat.completions.create({
      model: 'deepseek-v4.1-flash',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const req = seen.find((r) => r.url === '/go/openai/v1/chat/completions');
    assert.ok(req, `no Go request seen: ${JSON.stringify(seen.map((s) => s.url))}`);
  });

  test('the Anthropic client honours the Go base too', async () => {
    const h = helperWithLocalClients();
    const client = h.opencodeAnthropicFor(`http://127.0.0.1:${port}/go/anthropic`);
    await client.messages.create({
      model: 'claude-haiku-5-5',
      max_tokens: 8,
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.ok(seen.some((r) => r.url === '/go/anthropic/v1/messages'),
      `no Go messages request: ${JSON.stringify(seen.map((s) => s.url))}`);
  });

  test('clients are cached per base', () => {
    const h = helperWithLocalClients();
    const base = `http://127.0.0.1:${port}/go/openai/v1`;
    assert.equal(h.opencodeOpenAIFor(base), h.opencodeOpenAIFor(base));
  });

  test('a disabled provider returns null, so no request is attempted', () => {
    const h = helperWithLocalClients();
    h.isProviderDisabled = () => true;
    assert.equal(h.opencodeOpenAIFor(`http://127.0.0.1:${port}/go/openai/v1`), null);
    assert.equal(h.opencodeAnthropicFor(`http://127.0.0.1:${port}/go/anthropic`), null);
  });
});

describe('the Go session header', () => {
  test('every request carries the stable session id and the product user agent', () => {
    const goRequests = seen.filter((r) => r.url.startsWith('/go/'));
    assert.ok(goRequests.length >= 2, `expected Go requests, saw ${goRequests.length}`);
    for (const req of goRequests) {
      assert.equal(req.session, 'natively-test-session', req.url);
      assert.match(req.ua, /^Natively\//, `${req.url}: generic SDK user agent '${req.ua}'`);
    }
  });

  test('the id is generated once and reused (not per request)', () => {
    const h = Object.create(LLMHelper.prototype);
    const a = h.opencodeSessionHeader();
    const b = h.opencodeSessionHeader();
    assert.match(a, /^natively-[0-9a-f-]{36}$/i);
    assert.equal(a, b);
    assert.notEqual(h.opencodeSessionHeader(), Object.create(LLMHelper.prototype).opencodeSessionHeader());
  });
});
