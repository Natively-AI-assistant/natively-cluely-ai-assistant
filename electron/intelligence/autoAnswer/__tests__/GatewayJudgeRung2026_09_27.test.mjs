// The Auto Answer judge has a rung for gateway-only users.
//
// OpenRouter, Fluxion, 9Router, NVIDIA NIM and LiteLLM were in neither the
// judge's ladder nor the structured ladder below it: the judge threw "No
// reasoning model available" on every candidate and Auto Answer fired only on
// a trailing '?'. These run the REAL generateJudgeVerdict / callFastModel with
// stubbed provider clients.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { LLMHelper, OPENROUTER_JUDGE_MODEL } = require(path.resolve(__dirname, '../../../../dist-electron/electron/LLMHelper.js'));

function fakeOpenAIClient(calls, reply = '{"is_ask":true}') {
  return { chat: { completions: { create: async (body) => { calls.push(body); return { choices: [{ message: { content: reply } }] }; } } } };
}

function helper(over = {}) {
  const h = Object.create(LLMHelper.prototype);
  Object.assign(h, {
    _client: null, _openaiClient: null, _claudeClient: null, _groqClient: null, _deepseekClient: null,
    _openrouterClient: null, _ninerouterClient: null, _fluxionOpenAIClient: null, _fluxionAnthropicClient: null,
    _nvidiaNimClient: null, _litellmClient: null,
    nativelyKey: null, isLocalOnlyMode: false,
    getDisabledProviderFamilies: () => [],
    assertOutboundScopes: () => {},
    rateLimiters: {},
    ...over,
  });
  // fastModelId is a getter over settings; no Fast Response pick in these tests.
  Object.defineProperty(h, 'fastModelId', { value: null, configurable: true });
  h.generateContentStructured = async () => { throw new Error('No reasoning model available'); };
  return h;
}

test('an OpenRouter-only user gets a verdict, from the small tier, without JSON mode', async () => {
  const calls = [];
  const h = helper({ currentModelId: 'openrouter/anthropic/claude-sonnet-5' });
  h.openrouterClient = fakeOpenAIClient(calls);
  const out = await h.generateJudgeVerdict('judge prompt');
  assert.equal(out, '{"is_ask":true}');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, OPENROUTER_JUDGE_MODEL.replace(/^openrouter\//, ''), 'the small tier, not the answer model');
  assert.equal(calls[0].temperature, 0);
  assert.equal(calls[0].response_format, undefined, 'no JSON mode');
});

test('a 9Router-only user judges on the model they chose to answer with', async () => {
  const calls = [];
  const h = helper({ currentModelId: 'ninerouter/cc/claude-sonnet-5' });
  h.ninerouterClient = fakeOpenAIClient(calls);
  h.ninerouterWireModel = (id) => id.replace(/^ninerouter\//, '');
  assert.equal(await h.generateJudgeVerdict('judge prompt'), '{"is_ask":true}');
  assert.equal(calls[0].model, 'cc/claude-sonnet-5');
});

test('without a gateway selected the ladder is unchanged (the structured ladder still ends it)', async () => {
  const calls = [];
  const h = helper({ currentModelId: 'natively' });
  h.openrouterClient = fakeOpenAIClient(calls);      // a key, but not the selected provider
  await assert.rejects(() => h.generateJudgeVerdict('judge prompt'), /No reasoning model/);
  assert.equal(calls.length, 0);
});

test('a gateway that fails falls through to the structured ladder instead of hanging', async () => {
  const h = helper({ currentModelId: 'openrouter/anthropic/claude-sonnet-5' });
  h.openrouterClient = { chat: { completions: { create: async () => { throw new Error('502'); } } } };
  let ladder = false;
  h.generateContentStructured = async () => { ladder = true; return '{"ladder":true}'; };
  assert.equal(await h.generateJudgeVerdict('judge prompt'), '{"ladder":true}');
  assert.equal(ladder, true);
});
