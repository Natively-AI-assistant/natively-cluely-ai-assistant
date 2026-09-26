// The dispatch contract behind the Fast Model picker.
//
// The picker lists the whole Active Model universe, but callFastModel only has
// branches for five families. Every other id is a PERMANENT silent no-op: it
// saves, it displays, and it never runs. On a Fluxion-only profile that was
// three of eight options (observed live, 2026-09-24).
//
// The fix is one resolver both sides share. A separate boolean beside
// callFastModel would drift from it the first time a branch changed, and the
// drift would be invisible - which is exactly how the gateway egress bug got in.
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
    isLocalOnlyMode: false,
    getDisabledProviderFamilies: () => [],
    assertOutboundScopes: () => {},
    rateLimiters: {},
    ...rest,
  });
  Object.defineProperty(h, 'fastModelId', { value: fastModelId, configurable: true });
  return h;
}

const DISPATCHABLE = [
  ['gpt-5.5', 'openai'],
  ['gpt-5.4-mini', 'openai'],
  ['gemini-3.1-flash-lite', 'gemini'],
  ['deepseek-v4-flash', 'deepseek'],
];

// Gateways WERE in this list. They now dispatch to their own clients - see
// FastModelGatewayDispatch2026_09_24, which pins the wire id and proves each one
// never reaches the OpenAI client. They are named here so the move is explicit
// rather than looking like a lost assertion.
const GATEWAYS_NOW_DISPATCHABLE = [
  ['openrouter/google/gemini-3.8-flash', 'openrouter'],
  ['litellm/azure-openai-gpt4', 'litellm'],
  ['nvidia_nim/openai/gpt-oss-20b', 'nvidia_nim'],
  ['fluxion/gpt-5.5', 'fluxion'],
];

// Still no branch, and the picker must not offer these.
const NOT_DISPATCHABLE = [
  'natively',
  'ollama-llama3',
  'some-retired-model',
];

test('the resolver names a family for every id callFastModel can actually run', () => {
  const h = helper();
  for (const [id, family] of DISPATCHABLE) {
    assert.equal(h.resolveFastModelFamily(id), family, id);
  }
});

test('the resolver returns null for every id the picker offers but cannot run', () => {
  const h = helper();
  for (const id of NOT_DISPATCHABLE) {
    assert.equal(h.resolveFastModelFamily(id), null, id);
  }
});

test('canDispatchFastModel is the resolver, so the renderer cannot drift from main', () => {
  const h = helper();
  for (const [id] of DISPATCHABLE) assert.equal(h.canDispatchFastModel(id), true, id);
  for (const id of NOT_DISPATCHABLE) assert.equal(h.canDispatchFastModel(id), false, id);
});

test('callFastModel returns null for exactly the ids the resolver rejects', async () => {
  for (const id of NOT_DISPATCHABLE) {
    const h = helper({
      fastModelId: id,
      // A client for every family: if any branch were reachable for these ids it
      // would answer here, and that is the egress bug coming back.
      _openaiClient: { chat: { completions: { create: async () => ({ choices: [{ message: { content: 'REACHED' } }] }) } } },
      _deepseekClient: { chat: { completions: { create: async () => ({ choices: [{ message: { content: 'REACHED' } }] }) } } },
    });
    assert.equal(await h.callFastModel('judge'), null, `${id} must not reach any provider`);
  }
});

test('the gateways moved from "refused" to their own families', () => {
  const h = helper();
  for (const [id, family] of GATEWAYS_NOW_DISPATCHABLE) {
    assert.equal(h.resolveFastModelFamily(id), family, id);
    assert.equal(h.canDispatchFastModel(id), true, id);
  }
});
