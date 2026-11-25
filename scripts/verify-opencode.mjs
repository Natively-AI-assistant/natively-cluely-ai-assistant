#!/usr/bin/env node
/**
 * OpenCode smoke verification.
 *
 * Two phases, both REAL:
 *
 *   A. LIVE CATALOGUE — fetch the public `GET /inference/v1/models`, run it
 *      through the shipped parser, and assert the shape the adapters dispatch
 *      on (four protocols, vision flags, output ceilings, free filtering).
 *      Needs no API key; exercises the network and the parser.
 *
 *   B. FOUR-PROTOCOL HTTP DRIVE — start a local server that speaks all four
 *      wire formats, point the real OpenAI and Anthropic SDK clients at it, and
 *      drive `streamWithOpencode` through every family. This is not a stub:
 *      the SDKs serialise the requests, the server receives them, and the
 *      adapters parse real SSE over a real socket.
 *
 * A paid-key drive against opencode.ai is intentionally NOT included: it needs
 * a key and spends balance. The plan's §6.4 records that as the Phase 0 gate.
 *
 * Run: node scripts/verify-opencode.mjs
 */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

// CredentialsManager (loaded transitively) wants Electron's app paths.
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: {
    app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-smoke' },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};

const { parseOpencodeCatalogue, mergeOpencodeCatalogues, OPENCODE_PRESET_MODELS } =
  require(path.join(root, 'dist-electron/electron/llm/opencode/catalog.js'));
const { LLMHelper } = require(path.join(root, 'dist-electron/electron/LLMHelper.js'));

let failures = 0;
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

// ── Phase A: live catalogue ────────────────────────────────────────────────
async function phaseA() {
  console.log('\nA. Live catalogue (https://opencode.ai/inference/v1/models)');
  const resp = await fetch('https://opencode.ai/inference/v1/models', {
    signal: AbortSignal.timeout(30000),
  });
  ok('the catalogue answers 200', resp.ok, `status ${resp.status}`);
  if (!resp.ok) return;

  const payload = await resp.json();
  const parsed = parseOpencodeCatalogue(payload);
  const ids = Object.keys(parsed);
  const byFamily = ids.reduce((acc, id) => {
    acc[parsed[id].api] = (acc[parsed[id].api] || 0) + 1;
    return acc;
  }, {});
  const vision = ids.filter((id) => parsed[id].vision);
  const rawCount = Array.isArray(payload?.data) ? payload.data.length : 0;

  console.log(`  models: ${rawCount} raw, ${ids.length} usable`);
  console.log(`  families: ${Object.entries(byFamily).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`  vision-capable: ${vision.length}`);

  ok('more than 50 usable models', ids.length > 50, `got ${ids.length}`);
  for (const family of ['chat-completions', 'responses', 'messages', 'generate-content']) {
    ok(`the ${family} family is present`, (byFamily[family] || 0) > 0);
  }
  ok('at least 30 models read images', vision.length >= 30, `got ${vision.length}`);
  ok('no free-tier id survived the filter', ids.every((id) => !/-free$/.test(id)));
  ok('every model has a base URL', ids.every((id) => typeof parsed[id].baseUrl === 'string' && parsed[id].baseUrl.length > 0));
  ok('every model has an output ceiling or leaves it unknown', ids.every((id) => parsed[id].outputTokens === undefined || parsed[id].outputTokens > 0));

  const claude = Object.keys(parsed).find((id) => id.startsWith('claude-'));
  const gpt = Object.keys(parsed).find((id) => id.startsWith('gpt-'));
  const gem = Object.keys(parsed).find((id) => id.startsWith('gemini-'));
  ok('a Claude id is on the Messages protocol', !!claude && parsed[claude].api === 'messages', claude);
  ok('a GPT id is on the Responses protocol', !!gpt && parsed[gpt].api === 'responses', gpt);
  ok('a Gemini id is on generate-content', !!gem && parsed[gem].api === 'generate-content', gem);

  // A Go merge must be idempotent on a single catalogue.
  const merged = mergeOpencodeCatalogues(parsed, {});
  ok('merge with an empty Go catalogue changes nothing', Object.keys(merged).length === ids.length);
}

// ── Phase B: four-protocol HTTP drive ──────────────────────────────────────
const SSE = (res) => {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
};
const sse = (res, obj, event) => {
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
};

function startServer() {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let json = null;
      try { json = JSON.parse(body); } catch { /* GET */ }
      seen.push({
        method: req.method, url: req.url, body: json,
        auth: req.headers.authorization || '',
        apiKeyHeader: req.headers['x-api-key'] || '',
      });

      if (req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [] }));
        return;
      }

      if (req.url === '/openai/v1/chat/completions') {
        SSE(res);
        sse(res, { choices: [{ delta: { reasoning_content: 'hidden thinking' } }] });
        sse(res, { choices: [{ delta: { content: 'Hello' } }] });
        sse(res, { choices: [{ delta: { content: ' from chat' } }] });
        sse(res, { choices: [{ delta: {} }], usage: { cost: 0.001, opencode: { billing_source: 'balance' } } });
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      if (req.url === '/openai/v1/responses') {
        SSE(res);
        sse(res, { type: 'response.created' }, 'response.created');
        sse(res, { type: 'response.output_text.delta', delta: 'Hello' }, 'response.output_text.delta');
        sse(res, { type: 'response.output_text.delta', delta: ' from responses' }, 'response.output_text.delta');
        sse(res, { type: 'response.completed', response: { usage: { cost: 0.002 } } }, 'response.completed');
        res.end();
        return;
      }

      if (req.url === '/anthropic/v1/messages') {
        SSE(res);
        sse(res, { type: 'message_start', message: { usage: { input_tokens: 5 } } }, 'message_start');
        sse(res, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } }, 'content_block_delta');
        sse(res, { type: 'content_block_delta', delta: { type: 'text_delta', text: ' from messages' } }, 'content_block_delta');
        sse(res, { type: 'message_delta', usage: { output_tokens: 4 } }, 'message_delta');
        res.end();
        return;
      }

      if (req.url.startsWith('/google/v1beta/models/') && req.url.includes(':streamGenerateContent')) {
        SSE(res);
        sse(res, { candidates: [{ content: { parts: [{ text: 'Hello' }] } }] });
        sse(res, { candidates: [{ content: { parts: [{ text: ' from gemini' }] } }] });
        res.end();
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not found' } }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port }));
  });
}

function bareHelper(port) {
  const OpenAI = require('openai');
  const AnthropicMod = require('@anthropic-ai/sdk');
  const Anthropic = AnthropicMod?.default || AnthropicMod;

  const h = Object.create(LLMHelper.prototype);
  h.isLocalOnlyMode = false;
  h.currentModelId = 'opencode/deepseek-v4.1-flash';
  h.opencodeApiKey = 'oc_sk_smoke';
  h._opencodeOpenAIClient = new OpenAI({ apiKey: 'oc_sk_smoke', baseURL: `http://127.0.0.1:${port}/openai/v1` });
  h._opencodeAnthropicClient = new Anthropic({ apiKey: 'oc_sk_smoke', baseURL: `http://127.0.0.1:${port}/anthropic` });
  h.opencodeModelMeta = {};
  h.assertOutboundScopes = () => {};
  h.rateLimiters = { opencode: { acquire: async () => {} } };
  h.textHealth = new Map();
  h.visionHealth = new Map();
  h.isProviderDisabled = () => false;
  return h;
}

async function drain(gen) {
  let text = '';
  for await (const chunk of gen) text += chunk;
  return text;
}

async function phaseB() {
  console.log('\nB. Four-protocol drive through the real SDKs (local HTTP server)');
  const { server, seen, port } = await startServer();
  try {
    const h = bareHelper(port);
    h.opencodeModelMeta = {
      'deepseek-v4.1-flash': { api: 'chat-completions', baseUrl: `http://127.0.0.1:${port}/openai/v1`, vision: false },
      'gpt-6.1-sol': { api: 'responses', baseUrl: `http://127.0.0.1:${port}/openai/v1`, vision: true },
      'claude-sonnet-5': { api: 'messages', baseUrl: `http://127.0.0.1:${port}/anthropic`, vision: true },
      'gemini-3.8-flash': { api: 'generate-content', baseUrl: `http://127.0.0.1:${port}/google`, vision: true },
    };

    const chat = await drain(h.streamWithOpencode('hi', 'SYS', undefined, undefined, 'opencode/deepseek-v4.1-flash'));
    ok('chat-completions answers through the OpenAI SDK', chat === 'Hello from chat', JSON.stringify(chat));

    const resp = await drain(h.streamWithOpencode('hi', 'SYS', undefined, undefined, 'opencode/gpt-6.1-sol'));
    ok('responses answers through the OpenAI SDK', resp === 'Hello from responses', JSON.stringify(resp));

    const msg = await drain(h.streamWithOpencode('hi', 'SYS', undefined, undefined, 'opencode/claude-sonnet-5'));
    ok('messages answers through the Anthropic SDK', msg === 'Hello from messages', JSON.stringify(msg));

    const gem = await drain(h.streamWithOpencode('hi', 'SYS', undefined, undefined, 'opencode/gemini-3.8-flash'));
    ok('generate-content answers through raw fetch + SSE', gem === 'Hello from gemini', JSON.stringify(gem));

    // Request-shape assertions: the server saw what the protocols require.
    const chatReq = seen.find((r) => r.url === '/openai/v1/chat/completions')?.body;
    ok('chat request names the model', chatReq?.model === 'deepseek-v4.1-flash', chatReq?.model);
    ok('chat request streams and asks for usage', chatReq?.stream === true && chatReq?.stream_options?.include_usage === true);
    ok('chat request carries the system message', chatReq?.messages?.[0]?.role === 'system');

    const respReq = seen.find((r) => r.url === '/openai/v1/responses')?.body;
    ok('responses request uses input + instructions', Array.isArray(respReq?.input) && respReq?.instructions === 'SYS');
    ok('responses request disables storage', respReq?.store === false);

    const msgReq = seen.find((r) => r.url === '/anthropic/v1/messages')?.body;
    ok('messages request sends a required max_tokens', typeof msgReq?.max_tokens === 'number' && msgReq.max_tokens > 0);
    ok('messages request sends system top-level', msgReq?.system === 'SYS');

    const gemReq = seen.find((r) => r.url.startsWith('/google/v1beta/models/'))?.body;
    ok('gemini request carries contents parts', Array.isArray(gemReq?.contents?.[0]?.parts));
    ok('gemini request carries the system instruction', !!gemReq?.systemInstruction);
    ok('the gemini URL has exactly one version segment', !/\/v1beta\/v1beta\//.test(seen.find((r) => r.url.startsWith('/google/'))?.url || ''));

    // The Anthropic SDK authenticates with `x-api-key`, not `Authorization`;
    // Console accepts either. Every other family must carry the Bearer token.
    ok('every request carried the key in the header its SDK uses',
      seen.every((r) => /^Bearer oc_sk_smoke$/.test(r.auth) || /^oc_sk_smoke$/.test(r.apiKeyHeader)),
      JSON.stringify(seen.map((r) => r.auth || r.apiKeyHeader)));
    const msgAuth = seen.find((r) => r.url === '/anthropic/v1/messages');
    ok('the messages request authenticated with x-api-key (Anthropic SDK)',
      /^oc_sk_smoke$/.test(msgAuth?.apiKeyHeader || ''), JSON.stringify(msgAuth?.apiKeyHeader));

    ok('exactly four outbound calls reached the server', seen.length === 4, JSON.stringify(seen.map((r) => r.url)));
  } finally {
    server.close();
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
(async () => {
  console.log('OpenCode smoke verification');
  console.log(`presets: ${OPENCODE_PRESET_MODELS.map((p) => `${p.id}(${p.api})`).join(', ')}`);

  try { await phaseA(); } catch (e) {
    failures++;
    console.error(`  FAIL  phase A threw — ${e?.message || e}`);
  }
  try { await phaseB(); } catch (e) {
    failures++;
    console.error(`  FAIL  phase B threw — ${e?.stack || e?.message || e}`);
  }

  console.log(failures === 0 ? '\nSMOKE: PASS' : `\nSMOKE: FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
})();
