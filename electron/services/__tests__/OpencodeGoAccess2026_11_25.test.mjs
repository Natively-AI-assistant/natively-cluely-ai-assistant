/**
 * Pay-as-you-go vs Go: which route a request takes, and how the app knows
 * whether a key has Go.
 *
 * Measured live on 2026-11-25:
 *   - `GET /inference/go/v1/models` answers 200 with NO key, so every key
 *     receives the Go list. Being in it says nothing about the key.
 *   - A Go subscriber's key with no credits answers 402 on the pay-as-you-go
 *     base: "Insufficient balance. … OpenCode Go covers only requests to the
 *     OpenCode Go provider." The same model answers 200 on the Go base.
 *   - `GET /inference/go/v1/usage` answers 200 for a Go key and 401 for a bad
 *     one; OpenCode documents 403 `EntitlementError` for keys Go does not cover.
 *
 * The first revision let the Go list overwrite the pay-as-you-go base on every
 * shared id (15 shared models, 3 of them presets), so they went to the Go
 * base for EVERY key. These tests pin the replacement: both routes kept, the
 * key's Go access read from the usage endpoint (never guessed from one chat
 * refusal), re-read when a refusal says it went stale, and never a silent move
 * onto pay-as-you-go credits for a key that has Go.
 *
 * Real HTTP through the real OpenAI and Anthropic SDKs, against a local server.
 *
 * Run: node --test electron/services/__tests__/OpencodeGoAccess2026_11_25.test.mjs
 */
import { test, describe, before, after, beforeEach } from 'node:test';
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
const { opencodeRoutes, opencodeOfferedIds, opencodeMetaForRoute, opencodePresetMeta, carryForwardGoRoutes } = require(dist('llm/opencode/catalog.js'));
const { probeOpencodeGoAccess } = require(dist('llm/opencode/probe.js'));
const { opencodeGoRefused, opencodePaygWantsGo } = require(dist('llm/opencode/errors.js'));
const OpenAI = require('openai');
const AnthropicMod = require('@anthropic-ai/sdk');
const Anthropic = AnthropicMod?.default || AnthropicMod;

const GO_402 = 'Insufficient balance. This request is pay-as-you-go, billed to OpenCode Models credits. '
  + 'Top up at https://opencode.ai/console/org_x/billing?credits=1. OpenCode Go covers only requests to the OpenCode Go provider.';

let server;
let port;
let seen = [];
/** path prefix ('/go' | '/paid') → { status, message } to refuse with; absent = answer. */
let refuse = {};

const chatSse = (text) => [
  `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', model: 'm', choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}`,
  'data: [DONE]',
  '',
].join('\n\n');

const messagesSse = (text) => [
  ['message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'm', content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }],
  ['message_stop', { type: 'message_stop' }],
].map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');

before(async () => {
  server = http.createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      seen.push(req.url);
      const prefix = req.url.startsWith('/go/') ? '/go' : '/paid';
      const r = refuse[prefix];
      if (r) {
        res.writeHead(r.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: r.message } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(req.url.endsWith('/v1/messages') ? messagesSse(`${prefix}-messages`) : chatSse(`${prefix}-chat`));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); }));
});

after(() => server.close());

beforeEach(() => { seen = []; refuse = {}; });

const PAID_OPENAI = () => `http://127.0.0.1:${port}/paid/openai/v1`;
const GO_OPENAI = () => `http://127.0.0.1:${port}/go/openai/v1`;
const GO_ANTHROPIC = () => `http://127.0.0.1:${port}/go/anthropic`;

function makeHelper({ access, meta, probe = 'unknown' } = {}) {
  const h = Object.create(LLMHelper.prototype);
  h.isProviderDisabled = () => false;
  h.isLocalOnlyMode = false;
  h.assertOutboundScopes = () => {};
  h.rateLimiters = { opencode: { acquire: async () => {} } };
  h.opencodeApiKey = 'oc_sk_test';
  h._opencodeOpenAIClient = new OpenAI({ apiKey: 'oc_sk_test', baseURL: PAID_OPENAI(), maxRetries: 0 });
  h._opencodeAnthropicClient = new Anthropic({ apiKey: 'oc_sk_test', baseURL: `http://127.0.0.1:${port}/paid/anthropic`, maxRetries: 0 });
  h.opencodeModelMeta = meta || {
    'deepseek-v4.1-flash': {
      api: 'chat-completions', baseUrl: PAID_OPENAI(), vision: true, go: true,
      goRoute: { api: 'chat-completions', baseUrl: GO_OPENAI() },
    },
    // Same id, different protocol per route — as minimax-m3 is live.
    'minimax-m3': {
      api: 'chat-completions', baseUrl: PAID_OPENAI(), vision: false, go: true,
      goRoute: { api: 'messages', baseUrl: GO_ANTHROPIC() },
    },
    'hy4': {
      api: 'chat-completions', baseUrl: GO_OPENAI(), vision: false, go: true, goOnly: true,
      goRoute: { api: 'chat-completions', baseUrl: GO_OPENAI() },
    },
    'paid-only': { api: 'chat-completions', baseUrl: PAID_OPENAI(), vision: false },
  };
  if (access) h.opencodeGoAccess = access;
  const learned = [];
  const probes = [];
  h.opencodeGoAccessListener = (a, key) => learned.push([a, key]);
  // The usage endpoint, faked: what it would answer for this key right now.
  h.opencodeProbeGo = async (key) => { probes.push(key); return typeof probe === 'function' ? probe() : probe; };
  return { h, learned, probes };
}

async function ask(h, model) {
  let text = '';
  let error = null;
  try {
    for await (const chunk of h.streamWithOpencode('hi', 'SYS', undefined, undefined, `opencode/${model}`)) text += chunk;
  } catch (e) { error = e; }
  return { text, error };
}

const paidCalls = () => seen.filter((u) => u.startsWith('/paid'));
const goCalls = () => seen.filter((u) => u.startsWith('/go'));

describe('route order (pure)', () => {
  const both = { api: 'chat-completions', baseUrl: 'P', vision: false, goRoute: { api: 'messages', baseUrl: 'G' } };
  test('shared model: Go first while unknown or yes, pay-as-you-go first once no', () => {
    assert.deepEqual(opencodeRoutes('x', both, 'unknown').map((r) => r.kind), ['go', 'payg']);
    assert.deepEqual(opencodeRoutes('x', both, 'yes').map((r) => r.kind), ['go', 'payg']);
    assert.deepEqual(opencodeRoutes('x', both, 'no').map((r) => r.kind), ['payg', 'go']);
  });
  test('each route keeps its own protocol', () => {
    const [go, payg] = opencodeRoutes('x', both, 'unknown');
    assert.equal(go.api, 'messages');
    assert.equal(payg.api, 'chat-completions');
  });
  test('pay-as-you-go-only and Go-only models have one route', () => {
    assert.deepEqual(opencodeRoutes('x', { api: 'responses', baseUrl: 'P', vision: false }).map((r) => r.kind), ['payg']);
    assert.deepEqual(opencodeRoutes('x', { ...both, goOnly: true }).map((r) => r.kind), ['go']);
  });
  test('no metadata falls back to the name heuristic on pay-as-you-go', () => {
    const [r] = opencodeRoutes('claude-sonnet-5', undefined);
    assert.equal(r.kind, 'payg');
    assert.equal(r.api, 'messages');
  });
  test('metadata the first revision persisted (Go base, no goRoute) still has both routes', () => {
    const legacy = { api: 'chat-completions', baseUrl: 'https://opencode.ai/inference/go/openai/v1', vision: true, go: true };
    const routes = opencodeRoutes('deepseek-v4.1-flash', legacy, 'no');
    assert.deepEqual(routes.map((r) => [r.kind, r.baseUrl]), [
      ['payg', 'https://opencode.ai/inference/openai/v1'],
      ['go', 'https://opencode.ai/inference/go/openai/v1'],
    ]);
  });
  test('a route sends its OWN reasoning levels (kimi-k3: low/high/max paid, max only on Go)', () => {
    const kimi = {
      api: 'chat-completions', baseUrl: 'P', vision: true, reasoning: true, reasoningEffort: ['low', 'high', 'max'],
      goRoute: { api: 'chat-completions', baseUrl: 'G', reasoning: true, reasoningEffort: ['max'] },
    };
    const [go, payg] = opencodeRoutes('kimi-k3', kimi, 'unknown');
    assert.deepEqual(opencodeMetaForRoute(kimi, go).reasoningEffort, ['max']);
    assert.deepEqual(opencodeMetaForRoute(kimi, payg).reasoningEffort, ['low', 'high', 'max']);
    assert.equal(opencodeMetaForRoute(kimi, go).baseUrl, 'G');
  });
  test('Go-only models leave the picker only once the key is known to lack Go', () => {
    const meta = { a: { api: 'chat-completions', baseUrl: 'P', vision: false }, g: { ...both, goOnly: true } };
    assert.deepEqual(opencodeOfferedIds(meta, 'unknown').sort(), ['a', 'g']);
    assert.deepEqual(opencodeOfferedIds(meta, 'yes').sort(), ['a', 'g']);
    assert.deepEqual(opencodeOfferedIds(meta, 'no'), ['a']);
  });
  test('presets carry a Go route, so a Go key with no credit works before any catalogue', () => {
    const presets = opencodePresetMeta();
    for (const id of ['deepseek-v4.1-flash', 'kimi-k3', 'glm-5.3']) {
      assert.equal(presets[id].goRoute?.baseUrl, 'https://opencode.ai/inference/go/openai/v1', id);
    }
  });
});

describe('a failed Go-list read keeps the last Go routes', () => {
  const prev = {
    shared: { api: 'chat-completions', baseUrl: 'P', vision: true, go: true, goRoute: { api: 'chat-completions', baseUrl: 'G' } },
    gonly: { api: 'chat-completions', baseUrl: 'G', vision: false, go: true, goOnly: true, goRoute: { api: 'chat-completions', baseUrl: 'G' } },
  };
  test('shared models get their Go route back, Go-only models stay listed', () => {
    const fresh = { shared: { api: 'chat-completions', baseUrl: 'P2', vision: true }, paid: { api: 'responses', baseUrl: 'P', vision: false } };
    const out = carryForwardGoRoutes(fresh, prev);
    assert.equal(out.shared.baseUrl, 'P2', 'fresh pay-as-you-go data wins');
    assert.deepEqual(out.shared.goRoute, prev.shared.goRoute);
    assert.equal(out.gonly, prev.gonly);
    assert.equal(out.paid, fresh.paid);
  });
  test('nothing to carry from an empty store', () => {
    const fresh = { a: { api: 'chat-completions', baseUrl: 'P', vision: false } };
    assert.deepEqual(carryForwardGoRoutes(fresh, undefined), fresh);
  });
});

describe('catalogue fetch reads Go access beside the lists', () => {
  const { fetchOpencodeCatalogue, __resetOpencodeCatalogueCache, setOpencodeGoAccessReader } = require(dist('utils/modelFetcher.js'));
  const paid = { data: [
    { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', recommended_api: 'chat-completions', modalities: { input: ['text', 'image/png'] } },
    { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', recommended_api: 'messages', modalities: { input: ['text'] } },
  ] };
  const go = { data: [
    { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', recommended_api: 'chat-completions', modalities: { input: ['text', 'image/png'] } },
    { id: 'hy4', name: 'HY4', recommended_api: 'chat-completions', modalities: { input: ['text'] } },
  ] };
  const getImpl = ({ goFails = false } = {}) => async (url) => {
    if (url.includes('/go/')) { if (goFails) throw new Error('ETIMEDOUT'); return { data: go }; }
    return { data: paid };
  };
  beforeEach(() => { __resetOpencodeCatalogueCache(); setOpencodeGoAccessReader(() => 'unknown'); });

  test('a key Go covers keeps Go-only models and reports yes', async () => {
    const r = await fetchOpencodeCatalogue('oc_sk_a', { getImpl: getImpl(), fetchImpl: async () => ({ status: 200 }) });
    assert.equal(r.goAccess, 'yes');
    assert.equal(r.goListRead, true);
    assert.ok(r.models.some((m) => m.id === 'opencode/hy4'));
    assert.ok(r.meta['deepseek-v4.1-flash'].goRoute, 'shared model keeps its Go route');
  });

  test('a key Go does not cover gets no Go-only models in its list (its own answer, not the saved one)', async () => {
    setOpencodeGoAccessReader(() => 'yes');
    const r = await fetchOpencodeCatalogue('oc_sk_typed', { getImpl: getImpl(), fetchImpl: async () => ({ status: 403 }) });
    assert.equal(r.goAccess, 'no');
    assert.ok(!r.models.some((m) => m.id === 'opencode/hy4'));
    assert.ok(r.meta.hy4, 'routing metadata still keeps it');
  });

  test('an unreadable usage endpoint falls back to the saved answer for the list', async () => {
    setOpencodeGoAccessReader(() => 'no');
    const r = await fetchOpencodeCatalogue('oc_sk_b', { getImpl: getImpl(), fetchImpl: async () => { throw new Error('offline'); } });
    assert.equal(r.goAccess, 'unknown');
    assert.ok(!r.models.some((m) => m.id === 'opencode/hy4'));
  });

  test('a failed Go list is reported, so the caller can keep the last Go routes', async () => {
    const r = await fetchOpencodeCatalogue('oc_sk_c', { getImpl: getImpl({ goFails: true }), fetchImpl: async () => ({ status: 200 }) });
    assert.equal(r.goListRead, false);
    assert.equal(r.meta['deepseek-v4.1-flash'].goRoute, undefined);
  });
});

describe('Go usage probe (pure, fake fetch)', () => {
  const answering = (status) => async () => ({ status });
  test('200 → yes, 403 → no; 401, 5xx, network → unknown', async () => {
    assert.equal(await probeOpencodeGoAccess('k', { fetchImpl: answering(200) }), 'yes');
    assert.equal(await probeOpencodeGoAccess('k', { fetchImpl: answering(403) }), 'no');
    assert.equal(await probeOpencodeGoAccess('k', { fetchImpl: answering(401) }), 'unknown');
    assert.equal(await probeOpencodeGoAccess('k', { fetchImpl: answering(503) }), 'unknown');
    assert.equal(await probeOpencodeGoAccess('k', { fetchImpl: async () => { throw new Error('ENOTFOUND'); } }), 'unknown');
    assert.equal(await probeOpencodeGoAccess('', { fetchImpl: answering(200) }), 'unknown');
  });
  test('asks the usage endpoint with the key as a bearer token', async () => {
    let url; let auth;
    await probeOpencodeGoAccess(' oc_sk_x ', { fetchImpl: async (u, init) => { url = u; auth = init.headers.Authorization; return { status: 200 }; } });
    assert.equal(url, 'https://opencode.ai/inference/go/v1/usage');
    assert.equal(auth, 'Bearer oc_sk_x');
  });
});

describe('refusal triggers (pure)', () => {
  const err = (status, message, type) => Object.assign(new Error(`${status} ${message}`), { status, error: { message, ...(type ? { type } : {}) } });
  test('the live pay-as-you-go 402 for a Go key asks for the Go route', () => {
    assert.equal(opencodePaygWantsGo(err(402, GO_402), 'deepseek-v4.1-flash'), true);
    assert.equal(opencodePaygWantsGo(err(402, 'Insufficient balance.'), 'deepseek-v4.1-flash'), false);
    assert.equal(opencodePaygWantsGo(err(400, GO_402), 'deepseek-v4.1-flash'), false);
  });
  test('Go refusals worth a re-read: 402/403, EntitlementError, a 400 naming Go; never 401 or 429', () => {
    for (const s of [402, 403]) assert.equal(opencodeGoRefused(err(s, 'nope'), 'm'), true, String(s));
    assert.equal(opencodeGoRefused(err(400, "Model m isn't included in OpenCode Go."), 'm'), true);
    assert.equal(opencodeGoRefused(err(418, 'x', 'EntitlementError'), 'm'), true);
    assert.equal(opencodeGoRefused(err(401, 'Unauthorized', 'AuthError'), 'm'), false);
    assert.equal(opencodeGoRefused(err(400, 'max_tokens too large'), 'm'), false);
    assert.equal(opencodeGoRefused(err(429, 'Go usage limit reached'), 'm'), false);
    assert.equal(opencodeGoRefused(err(500, 'upstream'), 'm'), false);
  });
});

describe('a key WITHOUT Go', () => {
  test('first turn, access unknown: the usage endpoint is asked first, and Go is never tried', async () => {
    refuse['/go'] = { status: 403, message: 'no Go' };
    const { h, learned, probes } = makeHelper({ probe: 'no' });
    const { text, error } = await ask(h, 'deepseek-v4.1-flash');
    assert.equal(error, null, error?.message);
    assert.equal(text, '/paid-chat');
    assert.deepEqual(seen, ['/paid/openai/v1/chat/completions']);
    assert.deepEqual(probes, ['oc_sk_test']);
    assert.deepEqual(learned, [['no', 'oc_sk_test']]);
  });

  test('whatever Go answers this key with, an unreadable usage endpoint still reaches pay-as-you-go on a 403', async () => {
    refuse['/go'] = { status: 403, message: 'This key has no OpenCode Go subscription.' };
    const { h, learned } = makeHelper({ probe: 'unknown' });
    const { text, error } = await ask(h, 'deepseek-v4.1-flash');
    assert.equal(error, null, error?.message);
    assert.equal(text, '/paid-chat');
    assert.deepEqual(learned, [], 'one refusal is not stored as "no Go"');
    assert.equal(h.getOpencodeGoAccess(), 'unknown');
  });

  test('after "no": straight to pay-as-you-go, one request, no probe', async () => {
    const { h, probes } = makeHelper({ access: 'no' });
    const { text, error } = await ask(h, 'deepseek-v4.1-flash');
    assert.equal(error, null, error?.message);
    assert.equal(text, '/paid-chat');
    assert.deepEqual(seen, ['/paid/openai/v1/chat/completions']);
    assert.deepEqual(probes, []);
  });

  test('a Go-only model says it needs Go, rather than a generic billing error', async () => {
    refuse['/go'] = { status: 403, message: 'no Go' };
    const { h } = makeHelper({ probe: 'no' });
    const { error } = await ask(h, 'hy4');
    assert.match(error?.message || '', /only available with OpenCode Go/);
  });

  test('a dead key on a Go-only model is reported as a key problem, not as "needs Go"', async () => {
    refuse['/go'] = { status: 401, message: 'Unauthorized' };
    const { h, learned } = makeHelper({ access: 'yes' });
    const { error } = await ask(h, 'hy4');
    assert.doesNotMatch(error?.message || '', /only available with OpenCode Go/);
    assert.deepEqual(learned, []);
  });

  test('no Go and no credit: the balance error is shown, Go is not asked', async () => {
    refuse['/paid'] = { status: 402, message: GO_402 };
    refuse['/go'] = { status: 403, message: 'no Go' };
    const { h } = makeHelper({ access: 'no', probe: 'no' });
    const { error } = await ask(h, 'deepseek-v4.1-flash');
    assert.equal(error?.status, 402);
    assert.deepEqual(goCalls(), []);
  });
});

describe('a key WITH Go', () => {
  test('first turn, no credit: answered on Go, pay-as-you-go never asked', async () => {
    refuse['/paid'] = { status: 402, message: GO_402 };
    const { h, learned } = makeHelper({ probe: 'yes' });
    const { text, error } = await ask(h, 'deepseek-v4.1-flash');
    assert.equal(error, null, error?.message);
    assert.equal(text, '/go-chat');
    assert.deepEqual(seen, ['/go/openai/v1/chat/completions']);
    assert.deepEqual(learned, [['yes', 'oc_sk_test']]);
  });

  test('a stale "no" recovers: pay-as-you-go 402 naming Go triggers a re-read, then Go', async () => {
    refuse['/paid'] = { status: 402, message: GO_402 };
    const { h, learned } = makeHelper({ access: 'no', probe: 'yes' });
    const { text, error } = await ask(h, 'deepseek-v4.1-flash');
    assert.equal(error, null, error?.message);
    assert.equal(text, '/go-chat');
    assert.deepEqual(seen, ['/paid/openai/v1/chat/completions', '/go/openai/v1/chat/completions']);
    assert.deepEqual(learned, [['yes', 'oc_sk_test']]);
  });

  test('the Go route uses ITS protocol (Messages for minimax-m3), not the pay-as-you-go one', async () => {
    const { h } = makeHelper({ access: 'yes' });
    const { text, error } = await ask(h, 'minimax-m3');
    assert.equal(error, null, error?.message);
    assert.equal(text, '/go-messages');
    assert.deepEqual(seen, ['/go/anthropic/v1/messages']);
  });

  test('a Go 402 while Go is still active (quota, one model) never bills pay-as-you-go credits', async () => {
    refuse['/go'] = { status: 402, message: 'Go usage exhausted for this period.' };
    const { h, learned } = makeHelper({ probe: 'yes' });
    const { error } = await ask(h, 'deepseek-v4.1-flash');
    assert.ok(error, 'the turn must fail rather than bill credits');
    assert.deepEqual(paidCalls(), []);
    assert.deepEqual(learned, [['yes', 'oc_sk_test']]);
  });

  test('"isn\'t included in OpenCode Go" for one model is not saved as "no Go" for the key', async () => {
    refuse['/go'] = { status: 400, message: "Model deepseek-v4.1-flash isn't included in OpenCode Go." };
    const { h } = makeHelper({ access: 'yes', probe: 'yes' });
    const { error } = await ask(h, 'deepseek-v4.1-flash');
    assert.ok(error);
    assert.deepEqual(paidCalls(), []);
    assert.equal(h.getOpencodeGoAccess(), 'yes');
  });

  test('a lapsed subscription recovers: saved "yes", Go 403, re-read says no, answered on pay-as-you-go', async () => {
    refuse['/go'] = { status: 403, message: 'OpenCode Go subscription is not active.' };
    const { h, learned } = makeHelper({ access: 'yes', probe: 'no' });
    const { text, error } = await ask(h, 'deepseek-v4.1-flash');
    assert.equal(error, null, error?.message);
    assert.equal(text, '/paid-chat');
    assert.deepEqual(learned, [['no', 'oc_sk_test']]);
    assert.equal(h.getOpencodeGoAccess(), 'no');
  });

  test('a Go rate limit is not read as "no Go", and does not trigger a re-read', async () => {
    refuse['/go'] = { status: 429, message: 'Go usage limit reached' };
    const { h, learned, probes } = makeHelper({ access: 'yes' });
    const { error } = await ask(h, 'deepseek-v4.1-flash');
    assert.ok(error);
    assert.deepEqual(paidCalls(), []);
    assert.deepEqual(learned, []);
    assert.deepEqual(probes, []);
  });

  test('a burst of refused turns asks the usage endpoint once', async () => {
    refuse['/go'] = { status: 402, message: 'Go usage exhausted.' };
    const { h, probes } = makeHelper({ access: 'yes', probe: 'yes' });
    await Promise.all([ask(h, 'deepseek-v4.1-flash'), ask(h, 'deepseek-v4.1-flash'), ask(h, 'deepseek-v4.1-flash')]);
    await ask(h, 'deepseek-v4.1-flash');
    assert.equal(probes.length, 1);
  });

  test('the system prompt family follows the route tried first (minimax-m3: Messages on Go, Chat paid)', () => {
    const goKey = makeHelper({ access: 'yes' }).h;
    const paidKey = makeHelper({ access: 'no' }).h;
    const onGo = goKey.opencodeDefaultSystemPrompt('opencode/minimax-m3');
    const onPaid = paidKey.opencodeDefaultSystemPrompt('opencode/minimax-m3');
    assert.equal(onGo, goKey.opencodeDefaultSystemPrompt('opencode/claude-haiku-5-5'), 'Go route = the Messages family');
    assert.notEqual(onGo, onPaid);
    assert.equal(onPaid, paidKey.opencodeDefaultSystemPrompt('opencode/paid-only'), 'pay-as-you-go route = the Chat family');
  });
});

describe('Go access belongs to the key it was read with', () => {
  test('an answer read with another key is ignored', () => {
    const { h } = makeHelper();
    h.setOpencodeGoAccess('no', 'oc_sk_old');
    assert.equal(h.getOpencodeGoAccess(), 'unknown');
    h.setOpencodeGoAccess('no', 'oc_sk_test');
    assert.equal(h.getOpencodeGoAccess(), 'no');
    h.setOpencodeGoAccess('unknown', 'oc_sk_test');
    assert.equal(h.getOpencodeGoAccess(), 'no', 'an unreadable endpoint is not news');
  });

  test('a re-read that outlives a key change is not adopted or persisted', async () => {
    refuse['/go'] = { status: 403, message: 'no Go' };
    let release;
    const gate = new Promise((r) => { release = r; });
    const { h, learned } = makeHelper({ probe: async () => { await gate; return 'no'; } });
    const turn = ask(h, 'deepseek-v4.1-flash');
    await new Promise((r) => setTimeout(r, 20));
    h.opencodeApiKey = 'oc_sk_new';
    release();
    await turn;
    assert.deepEqual(learned, []);
    assert.equal(h.getOpencodeGoAccess(), 'unknown');
  });

  test('CredentialsManager drops an answer for a key that is no longer saved', () => {
    const { CredentialsManager } = require(dist('services/CredentialsManager.js'));
    const cm = Object.create(CredentialsManager.prototype);
    cm.credentials = { opencodeApiKey: 'oc_sk_new' };
    cm.refuseWriteWhileDegraded = () => false;
    let saves = 0;
    cm.saveCredentials = () => { saves += 1; return true; };
    assert.equal(cm.setOpencodeGoAccess('yes', 'oc_sk_old'), false);
    assert.equal(cm.getOpencodeGoAccess(), 'unknown');
    assert.equal(saves, 0);
    assert.equal(cm.setOpencodeGoAccess('yes', ' oc_sk_new '), true);
    assert.equal(cm.getOpencodeGoAccess(), 'yes');
  });

  test('setOpencodeConfig restores the persisted answer, and a cleared key resets it', () => {
    const h = Object.create(LLMHelper.prototype);
    h.isProviderDisabled = () => false;
    h.textHealth = new Map();
    h.visionHealth = new Map();
    h.setOpencodeConfig('oc_sk_a', undefined, 'no');
    assert.equal(h.getOpencodeGoAccess(), 'no');
    h.setOpencodeConfig('', undefined, 'no');
    assert.equal(h.getOpencodeGoAccess(), 'unknown');
  });
});

// ── Screenshot analysis ─────────────────────────────────────────────────────
// VisionProviderRegistry seats an `opencode` rung whose invoke() hands off to
// LLMHelper.runVisionRequest('opencode', …). The first revision had no such
// case, so every screen read through OpenCode threw "unknown providerId".
// Checked live 2026-11-25: with the case in place, all four protocols read a
// synthetic screenshot's ticket code (deepseek-v4.1-flash, kimi-k3,
// claude-haiku-5-5, gpt-6-luna, gemini-4-argon).
describe('screen reads through runVisionRequest', () => {
  test("runVisionRequest('opencode') sends the image to the selected model and returns its text", async () => {
    const { h } = makeHelper();
    h.currentModelId = 'opencode/deepseek-v4.1-flash';
    const calls = [];
    h.streamWithOpencode = async function* (prompt, system, images, signal, modelId) {
      calls.push({ prompt, system, images, modelId, hasSignal: !!signal });
      yield 'ZEBRA-';
      yield 'QUOKKA';
    };
    const text = await h.runVisionRequest('opencode', 'read it', 'SYS', '/tmp/shot.png', { signal: new AbortController().signal });
    assert.equal(text, 'ZEBRA-QUOKKA');
    assert.deepEqual(calls.map((c) => c.images), [['/tmp/shot.png']]);
    assert.equal(calls[0].hasSignal, true, 'the chain\'s per-rung deadline must reach the request');
  });

  test('a model the catalogue marks text-only refuses the screen read, so the chain moves on', async () => {
    const { h } = makeHelper();
    h.currentModelId = 'opencode/minimax-m3';
    let called = false;
    h.streamWithOpencode = async function* () { called = true; yield 'I do not see a screenshot.'; };
    await assert.rejects(h.runVisionRequest('opencode', 'read it', 'SYS', '/tmp/shot.png'), /cannot read images/);
    assert.equal(called, false);
  });

  test('a cancelled screen read throws instead of storing an empty screen', async () => {
    const { h } = makeHelper();
    h.currentModelId = 'opencode/deepseek-v4.1-flash';
    const ac = new AbortController();
    h.streamWithOpencode = async function* () { ac.abort(); };
    await assert.rejects(h.runVisionRequest('opencode', 'read it', 'SYS', '/tmp/shot.png', { signal: ac.signal }), /cancelled/);
  });

  test('every rung VisionProviderRegistry hands to LLMHelper has a runVisionRequest case', async () => {
    const fs = await import('node:fs');
    const src = (p) => fs.readFileSync(path.join(__dirname, '../../', p), 'utf8');
    const registry = src('services/screen/VisionProviderRegistry.ts');
    const helper = src('LLMHelper.ts');
    const start = helper.indexOf('public async runVisionRequest(');
    const body = helper.slice(start, helper.indexOf('runVisionRequest: unknown providerId', start));
    const ids = [...registry.matchAll(/callLLMHelperVision\('([a-z_]+)'/g)].map((m) => m[1]);
    assert.ok(ids.includes('opencode'), 'the OpenCode rung must hand off to LLMHelper');
    const missing = [...new Set(ids)].filter((id) => !body.includes(`case '${id}'`));
    assert.deepEqual(missing, [], `rungs with no runVisionRequest case throw "unknown providerId": ${missing.join(', ')}`);
  });
});
