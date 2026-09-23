// Gateway dispatch for the background model.
//
// Every branch here asserts TWO things: the request reached the gateway's OWN
// client, and it never touched the OpenAI client. The second half is the point.
// `isOpenAiModel()` self-excludes Groq and Fluxion but not OpenRouter, LiteLLM,
// NIM or 9Router, and its final clause is `includes('openai')` - so
// `nvidia_nim/openai/gpt-oss-20b` was billed to the user's own OpenAI key with
// the judge prompt's meeting turns in the body. Only a per-branch test catches
// that; `CallFastModel` tested the OpenAI branch alone, which is why it shipped.
//
// The wire id is asserted per gateway because the rule DIFFERS: Fluxion strips
// to a bare id, OpenRouter keeps the vendor segment underneath. Sending
// `claude-sonnet-5` where `anthropic/claude-sonnet-5` was meant is a 404.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { LLMHelper } = require(path.resolve(__dirname, '../../../dist-electron/electron/LLMHelper.js'));

function helper(over = {}) {
  const { fastModelId = null, ...rest } = over;
  const h = Object.create(LLMHelper.prototype);
  Object.assign(h, {
    _client: null, _openaiClient: null, _claudeClient: null, _groqClient: null, _deepseekClient: null,
    _openrouterClient: null, _litellmClient: null, _nvidiaNimClient: null, _ninerouterClient: null,
    _fluxionOpenAIClient: null, _fluxionAnthropicClient: null,
    fluxionProtocol: 'openai',
    isLocalOnlyMode: false,
    getDisabledProviderFamilies: () => [],
    assertOutboundScopes: () => {},
    rateLimiters: {},
    ...rest,
  });
  Object.defineProperty(h, 'fastModelId', { value: fastModelId, configurable: true });
  return h;
}

const okClient = (sink) => ({
  chat: { completions: { create: async (req) => { sink.model = req.model; return { choices: [{ message: { content: '{"is_ask":true}' } }] }; } } },
});
const trap = (sink) => ({
  chat: { completions: { create: async (req) => { sink.leaked = req.model; return { choices: [{ message: { content: 'LEAKED' } }] }; } } },
});

const CASES = [
  { family: 'openrouter', clientKey: '_openrouterClient', id: 'openrouter/anthropic/claude-sonnet-5', wire: 'anthropic/claude-sonnet-5' },
  { family: 'litellm',    clientKey: '_litellmClient',    id: 'litellm/gpt-4o-mini',                 wire: 'gpt-4o-mini' },
  { family: 'nvidia_nim', clientKey: '_nvidiaNimClient',  id: 'nvidia_nim/openai/gpt-oss-20b',       wire: 'openai/gpt-oss-20b' },
  { family: 'ninerouter', clientKey: '_ninerouterClient', id: 'ninerouter/minimax/MiniMax-M3',       wire: 'minimax/MiniMax-M3' },
  { family: 'fluxion',    clientKey: '_fluxionOpenAIClient', id: 'fluxion/claude-fable-5',           wire: 'claude-fable-5' },
];

for (const c of CASES) {
  test(`${c.family}: dispatches to its own client, with its own wire id`, async () => {
    const sink = {};
    const h = helper({ fastModelId: c.id, [c.clientKey]: okClient(sink), _openaiClient: trap(sink) });
    assert.equal(await h.callFastModel('judge'), '{"is_ask":true}');
    assert.equal(sink.leaked, undefined, `${c.id} must NEVER reach the OpenAI client`);
    assert.equal(sink.model, c.wire, `wrong wire id for ${c.family}`);
  });

  test(`${c.family}: resolves to its own family`, () => {
    assert.equal(helper().resolveFastModelFamily(c.id), c.family);
  });

  test(`${c.family}: with no client configured it falls through, never to OpenAI`, async () => {
    const sink = {};
    const h = helper({ fastModelId: c.id, _openaiClient: trap(sink) });
    assert.equal(await h.callFastModel('judge'), null);
    assert.equal(sink.leaked, undefined, 'a missing gateway client must not fall back to OpenAI');
  });
}

test('a disabled gateway family falls through rather than leaking to OpenAI', async () => {
  const sink = {};
  const h = helper({
    fastModelId: 'openrouter/anthropic/claude-sonnet-5',
    _openrouterClient: okClient(sink), _openaiClient: trap(sink),
    getDisabledProviderFamilies: () => ['openrouter'],
  });
  assert.equal(await h.callFastModel('judge'), null);
  assert.equal(sink.leaked, undefined);
});

// Observed live against OpenRouter (google/gemini-2.5-flash-lite, 2026-09-24):
// without response_format the body comes back as ```json ... ``` and JSON.parse
// fails. We DO send response_format, but not every gateway model honours it, and
// the failure is silent - the judge just never gets a verdict. finish() strips
// reasoning blocks; it must strip fences too.
test('a fenced JSON body is unwrapped, not handed back with its backticks', async () => {
  const sink = {};
  const h = helper({
    fastModelId: 'openrouter/google/gemini-2.5-flash-lite',
    _openrouterClient: { chat: { completions: { create: async () => ({
      choices: [{ message: { content: '```json\n{"is_ask": true}\n```' } }],
    }) } } },
    _openaiClient: trap(sink),
  });
  const out = await h.callFastModel('judge', { json: true });
  assert.equal(out, '{"is_ask": true}');
  JSON.parse(out); // must not throw - this is what the judge does with it
});

test('a plain fenced block with no language tag is unwrapped too', async () => {
  const h = helper({
    fastModelId: 'fluxion/claude-fable-5',
    _fluxionOpenAIClient: { chat: { completions: { create: async () => ({
      choices: [{ message: { content: '```\n{"is_ask": false}\n```' } }],
    }) } } },
  });
  assert.equal(await h.callFastModel('judge', { json: true }), '{"is_ask": false}');
});
