// Fast Response Mode answers with the Background Model (2026-09-26).
//
// The mode was built as "Groq fast text" and later generalised: Settings →
// Background Model is where the user picks the model it answers with, and
// Auto answers on the fastest connected model by this user's own measurements
// (the old Codex → Groq → Natively ladder is only a fallback now). The
// Codex card also carried its own "Fast Mode Model", which contradicted that
// pick; it is gone. A Codex model is now picked AS the Background Model, and
// may differ from the Codex default exactly as the old fast model could.
//
// These tests EXECUTE the dispatch (openFastModelStream) on the built bundle
// with stub streamers, rather than grepping for it: a source grep once passed
// while a family had no dispatch branch at all (see the Fluxion rung comment
// in LLMHelper.ts). The last block pins the two call sites structurally,
// because _streamChatInner / chatWithGemini are too entangled to drive here.
//
// Run via: npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/FastResponseBackgroundModel2026_09_26.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

process.env.CODEX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-codex-home-'));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, '../../..');
const dist = (p) => path.join(root, 'dist-electron/electron', p);

const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: {
    app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};

const { LLMHelper } = require(dist('LLMHelper.js'));

const STREAMERS = [
  'streamWithOpenai', 'streamWithClaude', 'streamWithDeepseek', 'streamWithGroq',
  'streamWithGeminiModel', 'streamWithOpenRouter', 'streamWithLiteLLM',
  'streamWithNvidiaNim', 'streamWithNinerouter', 'streamWithFluxion', 'streamWithCodexCli', 'streamWithNatively',
  'streamWithCustom',
];

/**
 * A bare LLMHelper with every family's client present and every streamer
 * stubbed to record its arguments. The model classifiers stay REAL, so the
 * family each pick resolves to is the production answer.
 */
function helper({ pick = null, fastMode = true, localOnly = false, clients = true } = {}) {
  const h = Object.create(LLMHelper.prototype);
  h.groqFastTextMode = fastMode;
  h.isLocalOnlyMode = localOnly;
  h.currentModelId = 'gemini-3.8-flash';
  h._groqLocalDisabled = false;
  h.injectLanguageInstruction = (s) => `${s}|lang`;
  Object.defineProperty(h, 'fastModelId', { get: () => pick });
  const client = clients ? {} : null;
  for (const k of ['openaiClient', 'claudeClient', 'deepseekClient', 'groqClient', 'client',
    'openrouterClient', 'litellmClient', 'nvidiaNimClient', 'ninerouterClient']) h[k] = client;
  h.hasFluxionCredential = () => clients;
  h.isCodexAvailable = () => clients;
  h.codexCliConfig = { model: 'gpt-5.5' };
  h.calls = [];
  for (const name of STREAMERS) {
    h[name] = async function* (...args) { h.calls.push({ name, args }); yield `from ${name}`; };
  }
  return h;
}

const open = (h, opts = {}) => LLMHelper.prototype.openFastModelStream.call(
  h, 'USER', opts.override, 'BASE_SYS', opts.signal, opts.skip === true,
);

async function drain(stream) {
  let out = '';
  for await (const chunk of stream) out += chunk;
  return out;
}

describe('openFastModelStream — what Fast Response Mode answers with', () => {
  test('Auto with every provider connected and nothing measured: the shipped order\'s first, Groq', () => {
    const h = helper({ pick: null });
    const res = withMeasurements({}, () => open(h));
    assert.equal(res.modelId, 'qwen/qwen3.8-27b');
    assert.equal(res.auto, true);
  });

  test('Fast Response Mode off returns null even with a pick — the pick alone never reroutes answers', () => {
    assert.equal(open(helper({ pick: 'gpt-5.4-mini', fastMode: false })), null);
  });

  test('local-only mode returns null before any cloud streamer is opened', () => {
    const h = helper({ pick: 'gpt-5.4-mini', localOnly: true });
    assert.equal(open(h), null);
    assert.equal(h.calls.length, 0);
  });

  test('a pick whose provider is not configured returns null, so the ladder still answers', () => {
    const h = helper({ pick: 'gpt-5.4-mini', clients: false });
    assert.equal(open(h), null);
    assert.equal(h.calls.length, 0);
  });

  test('an id no family can dispatch returns null', () => {
    const h = helper({ pick: 'antigravity:gemini-3-pro' });
    assert.equal(open(h), null);
    assert.equal(h.calls.length, 0);
  });

  // [pick, streamer, index of the model-id argument]
  const CASES = [
    ['gpt-5.4-mini', 'streamWithOpenai', 2],
    ['claude-haiku-4-5', 'streamWithClaude', 2],
    ['deepseek-flash', 'streamWithDeepseek', 2],
    ['qwen/qwen3.6-27b', 'streamWithGroq', 1],
    ['gemini-3.1-flash-lite', 'streamWithGeminiModel', 1],
    ['openrouter/openai/gpt-5.6-terra', 'streamWithOpenRouter', 4],
    ['litellm/openai/gpt-4o-mini', 'streamWithLiteLLM', 4],
    ['nvidia_nim/meta/llama-4-scout', 'streamWithNvidiaNim', 4],
    ['ninerouter/cc/claude-haiku', 'streamWithNinerouter', 4],
    ['fluxion/gpt-5.4-mini', 'streamWithFluxion', 4],
  ];
  for (const [pick, streamer, modelArg] of CASES) {
    test(`${pick} streams through ${streamer} with the pick as an explicit model id`, async () => {
      const h = helper({ pick });
      const signal = new AbortController().signal;
      // Gateways are opt-in: the picker offers only models ticked in the card.
      const res = withAllowLists({ openrouter: [pick], litellm: [pick], ninerouter: [pick] }, () => open(h, { signal }));
      assert.ok(res, 'a configured pick must dispatch');
      assert.equal(res.modelId, pick);
      assert.equal(await drain(res.stream), `from ${streamer}`);
      assert.equal(h.calls.length, 1);
      const { name, args } = h.calls[0];
      assert.equal(name, streamer);
      assert.equal(args[0], 'USER');
      assert.equal(args[modelArg], pick,
        'the model must be passed explicitly — reading this.currentModelId would answer on the Active Model');
      assert.ok(args.includes(signal), 'the abort signal must reach the streamer');
      assert.equal(h.currentModelId, 'gemini-3.8-flash',
        'currentModelId must never be swapped: Auto Answer and manual chat share this helper concurrently');
    });
  }

  test('Groq picks run strict, so a retired id fails over to the ladder instead of a different Groq model', async () => {
    const h = helper({ pick: 'qwen/qwen3.6-27b' });
    await drain(open(h).stream);
    assert.equal(h.calls[0].args[4], true);
  });

  test('system prompts follow each family\'s own answer rung, and skipSystemPrompt sends none', async () => {
    const h = helper({ pick: 'claude-haiku-4-5' });
    await drain(open(h, { override: 'MODE' }).stream);
    assert.equal(h.calls[0].args[1], 'MODE|lang', 'a mode override must shape the fast answer too');

    const g = helper({ pick: 'gemini-3.1-flash-lite' });
    await drain(open(g).stream);
    assert.equal(g.calls[0].args[3], 'BASE_SYS', 'Gemini takes the same system prompt its answer rung gets');

    const s = helper({ pick: 'gpt-5.4-mini' });
    await drain(open(s, { override: 'MODE', skip: true }).stream);
    assert.equal(s.calls[0].args[1], undefined);
  });
});

describe('a Codex Background Model can differ from the Codex default', () => {
  // [pick, the Codex model that must be requested]
  const CODEX = [
    ['codex-cli:gpt-5.6-luna', 'gpt-5.6-luna'],   // differs from the default gpt-5.5
    ['codex-cli', 'gpt-5.5'],                      // the bare entry IS the default
    ['codex-cli:gpt-5.4', 'gpt-5.5'],              // ChatGPT-rejected → the default
  ];
  for (const [pick, model] of CODEX) {
    test(`Fast Response on ${pick} streams Codex with ${model}`, async () => {
      const h = helper({ pick });
      const signal = new AbortController().signal;
      const res = open(h, { signal });
      assert.ok(res, 'a signed-in Codex pick must dispatch');
      assert.equal(await drain(res.stream), 'from streamWithCodexCli');
      const { name, args } = h.calls[0];
      assert.equal(name, 'streamWithCodexCli');
      assert.deepEqual(args, ['USER', 'BASE_SYS', true, undefined, signal, model],
        'the pick must reach Codex as modelOverride — the Codex default must not answer instead');
      assert.equal(h.codexCliConfig.model, 'gpt-5.5', 'picking a Background Model never moves the Codex default');
    });
  }

  test('Codex signed out or switched off: null, so the ladder answers', () => {
    const h = helper({ pick: 'codex-cli:gpt-5.6-luna', clients: false });
    assert.equal(open(h), null);
    assert.equal(h.calls.length, 0);
  });

  test('main offers Codex models to the Background Model picker', () => {
    const h = Object.create(LLMHelper.prototype);
    assert.equal(LLMHelper.prototype.canDispatchFastModel.call(h, 'codex-cli:gpt-5.6-luna'), true);
    assert.equal(LLMHelper.prototype.canDispatchFastModel.call(h, 'codex-cli'), true);
  });

  test('Auto Answer and quick decisions run on the Codex pick too (callFastModel)', async () => {
    const h = helper({ pick: 'codex-cli:gpt-5.6-luna' });
    h.streamWithCodexCli = async function* (...args) {
      h.calls.push({ name: 'streamWithCodexCli', args });
      yield '```json\n{"answer":true}\n```';
    };
    const out = await LLMHelper.prototype.callFastModel.call(h, 'JUDGE', { timeoutMs: 5000, json: true });
    assert.equal(out, '{"answer":true}', 'a fenced reply must be unwrapped, as for every family');
    const { args } = h.calls[0];
    assert.equal(args[0], 'JUDGE');
    assert.equal(args[5], 'gpt-5.6-luna');
    assert.ok(args[4] instanceof AbortSignal, 'the call must be bounded by its budget');
  });

  test('callFastModel with Codex unavailable returns null, so the judge ladder runs', async () => {
    const h = helper({ pick: 'codex-cli:gpt-5.6-luna', clients: false });
    assert.equal(await LLMHelper.prototype.callFastModel.call(h, 'JUDGE', { timeoutMs: 5000 }), null);
    assert.equal(h.calls.length, 0);
  });
});

describe('the Codex rung has no fast model of its own', () => {
  test('fast or not, Codex runs the Codex default — a stale persisted fastModel is ignored', () => {
    const h = Object.create(LLMHelper.prototype);
    h.currentModelId = 'natively';
    h.codexCliConfig = { model: 'gpt-5.6-luna', fastModel: 'gpt-5.3-codex' };
    assert.equal(LLMHelper.prototype.getSelectedCodexCliModel.call(h), 'gpt-5.6-luna');
  });

  test('an explicitly picked codex-cli:<model> still wins (issue #315)', () => {
    const h = Object.create(LLMHelper.prototype);
    h.currentModelId = 'codex-cli:gpt-5.6-terra';
    h.codexCliConfig = { model: 'gpt-5.5' };
    assert.equal(LLMHelper.prototype.getSelectedCodexCliModel.call(h), 'gpt-5.6-terra');
  });
});

// ── Auto: the fastest connected model, by this user's own measurements ────

const { __setProviderPerformanceStore } = require(dist('llm/performance/ProviderPerformanceStore.js'));
/** A fake Provider Performance Store: `ids` maps `provider|model` to small-bucket evidence. */
function withMeasurements(ids, fn, extra = {}) {
  const profile = ({ p50, n, ok = n, bad = 0 }) => ({ lastUpdated: Date.now(), workloads: { small: {
    ttft: { p50Ms: p50, maxMs: p50 * 2, count: n },
    reliability: { ok, timeout: bad, stall: 0, rateLimit: 0, serverError: 0, clientError: 0, connectionFailure: 0 },
  } } });
  __setProviderPerformanceStore({
    // Exact rows only: lookup() falls back to "any model of this provider",
    // which is how an unmeasured candidate borrowed another model's speed.
    getExact: (provider, model) => (ids[`${provider}|${model}`] ? profile(ids[`${provider}|${model}`]) : null),
    lookup: () => { throw new Error('Auto must not read lookup()'); },
    ...extra,
  });
  try { return fn(); } finally { __setProviderPerformanceStore(null); }
}
/** A fake CredentialsManager for the model allow-lists (anchored on globalThis). */
function withAllowLists(lists, fn) {
  const KEY = '__nativelyCredentialsManagerV1__';
  const before = globalThis[KEY];
  globalThis[KEY] = { getCloudEnabledModels: (p) => lists[p] ?? [], getDisabledProviders: () => [] };
  try { return fn(); } finally { if (before === undefined) delete globalThis[KEY]; else globalThis[KEY] = before; }
}

const CLIENT = { groq: 'groqClient', deepseek: 'deepseekClient', gemini: 'client', openai: 'openaiClient', claude: 'claudeClient', openrouter: 'openrouterClient', litellm: 'litellmClient' };
const autoHelper = ({ active, vendors = [], disabled = [], codex = false, natively = false, pick = null }) => {
  const h = helper({ pick });
  for (const k of ['openaiClient', 'claudeClient', 'deepseekClient', 'groqClient', 'client', 'openrouterClient', 'litellmClient', 'nvidiaNimClient', 'ninerouterClient']) h[k] = null;
  h.hasFluxionCredential = () => false;
  for (const v of vendors) h[CLIENT[v]] = {};
  h.isCodexAvailable = () => codex;
  h.hasNatively = () => natively;
  h.isProviderDisabled = (f) => disabled.includes(f);
  h.currentModelId = active;
  return h;
};
const dispatched = async (h) => {
  const res = open(h);
  if (!res) return null;
  await drain(res.stream);
  const { name, args } = h.calls[0];
  const i = { streamWithGeminiModel: 1, streamWithGroq: 1, streamWithCodexCli: 5, streamWithNatively: -1 }[name] ?? 2;
  return { name, model: i === -1 ? 'natively' : args[i], auto: res.auto };
};

describe('Fast Response on Auto: any connected provider, no provider required', () => {
  test('a Gemini-only user: Auto answers on Gemini 3.1 Flash-Lite — no Groq, Natively or Codex needed', async () => {
    const got = await withMeasurements({}, () => dispatched(autoHelper({ active: 'gemini-3.8-flash', vendors: ['gemini'] })));
    assert.deepEqual(got, { name: 'streamWithGeminiModel', model: 'gemini-3.1-flash-lite', auto: true });
  });

  test('a switched-off provider is never used', async () => {
    const got = await withMeasurements({}, () => dispatched(autoHelper({ active: 'openrouter/openai/gpt-5.6-terra', vendors: ['openrouter', 'gemini', 'deepseek'], disabled: ['deepseek'] })));
    assert.deepEqual(got, { name: 'streamWithGeminiModel', model: 'gemini-3.1-flash-lite', auto: true });
  });

  test('the fastest candidate IS the Active Model: null, so its own rung (with failover) answers', () => {
    withMeasurements({}, () => {
      assert.equal(open(autoHelper({ active: 'gemini-3.1-flash-lite', vendors: ['gemini'] })), null);
      assert.equal(open(autoHelper({ active: 'qwen/qwen3.8-27b', vendors: ['groq', 'gemini'] })), null, 'a Groq Active Model stands for Groq');
    });
  });

  test('an explicitly chosen Codex Active Model is never overridden (issue #315)', () => {
    withMeasurements({}, () => assert.equal(open(autoHelper({ active: 'codex-cli:gpt-5.6-luna', vendors: ['gemini'], codex: true })), null));
  });

  test('a gateway-only install has no fast tier: null — the user picks a Background Model', () => {
    withMeasurements({}, () => assert.equal(open(autoHelper({ active: 'openrouter/openai/gpt-5.6-terra', vendors: ['openrouter'] })), null));
  });

  test('an explicit Background Model still wins over Auto', async () => {
    const got = await withMeasurements({ 'gemini|gemini-3.1-flash-lite': { p50: 200, n: 20 } },
      () => dispatched(autoHelper({ active: 'gemini-3.8-flash', vendors: ['gemini', 'deepseek'], pick: 'deepseek-flash' })));
    assert.deepEqual(got, { name: 'streamWithDeepseek', model: 'deepseek-flash', auto: false });
  });

  test('Natively is a candidate: its server fast tier answers, timed as the server cascade', async () => {
    const got = await withMeasurements({}, () => dispatched(autoHelper({ active: 'openrouter/openai/gpt-5.6-terra', vendors: ['openrouter'], natively: true })));
    assert.deepEqual(got, { name: 'streamWithNatively', model: 'natively', auto: true });
    const h = autoHelper({ active: 'openrouter/openai/gpt-5.6-terra', vendors: ['openrouter'], natively: true });
    withMeasurements({}, () => assert.equal(LLMHelper.prototype.isUsingNativelyServerCascade.call(h), true));
  });
});

describe('Auto ranks by this user\'s measurements, not a fixed order', () => {
  const pickFor = (measurements, opts) => withMeasurements(measurements, () => open(autoHelper(opts))?.modelId ?? null);
  const USER = { active: 'openrouter/openai/gpt-5.6-terra', vendors: ['openrouter', 'gemini', 'deepseek'], codex: true };

  test('cold start (nothing measured): the shipped order — DeepSeek Flash before Gemini Flash-Lite before Codex', () => {
    assert.equal(pickFor({}, USER), 'deepseek-flash');
  });

  test('a candidate measured clearly faster moves to the front', () => {
    assert.equal(pickFor({ 'gemini|gemini-3.1-flash-lite': { p50: 600, n: 8 }, 'gemini|deepseek-flash': { p50: 900, n: 8 } }, USER), 'gemini-3.1-flash-lite');
  });

  test('a near-tie (under 15%) keeps the shipped order, so answers do not flip turn to turn', () => {
    assert.equal(pickFor({ 'gemini|gemini-3.1-flash-lite': { p50: 850, n: 8 }, 'gemini|deepseek-flash': { p50: 900, n: 8 } }, USER), 'deepseek-flash');
  });

  test('a fast but unreliable candidate goes last', () => {
    assert.equal(pickFor({ 'gemini|deepseek-flash': { p50: 300, n: 8, ok: 3, bad: 7 }, 'gemini|gemini-3.1-flash-lite': { p50: 900, n: 8 } }, USER), 'gemini-3.1-flash-lite');
  });

  test('Codex does not jump the queue: measured slower, it loses; measured faster, it wins', () => {
    const slow = { 'codex-cli|codex-cli': { p50: 1900, n: 10 }, 'gemini|deepseek-flash': { p50: 700, n: 10 }, 'gemini|gemini-3.1-flash-lite': { p50: 1000, n: 10 } };
    assert.equal(pickFor(slow, USER), 'deepseek-flash');
    const fast = { 'codex-cli|codex-cli:gpt-5.5': { p50: 400, n: 10 }, 'gemini|deepseek-flash': { p50: 700, n: 10 }, 'gemini|gemini-3.1-flash-lite': { p50: 1000, n: 10 } };
    assert.equal(pickFor(fast, USER), 'codex-cli', 'Codex evidence is read under its prefixed id too');
  });

  test('an unmeasured candidate is neither promoted nor demoted without evidence', () => {
    // Groq ships first. DeepSeek measured very fast still cannot pass an
    // unmeasured Groq: there is no evidence Groq is slower.
    assert.equal(pickFor({ 'gemini|deepseek-flash': { p50: 200, n: 10 } }, { ...USER, vendors: [...USER.vendors, 'groq'] }), 'qwen/qwen3.8-27b');
  });

  test('an explicit Codex Background Model is kept even when something is measured faster', () => {
    assert.equal(pickFor({ 'gemini|deepseek-flash': { p50: 200, n: 10 }, 'codex-cli|codex-cli': { p50: 2000, n: 10 } }, { ...USER, pick: 'codex-cli:gpt-5.6-luna' }), 'codex-cli:gpt-5.6-luna');
  });

  test('the order is frozen for 30s, so one turn\'s deadline, label and dispatch agree', () => {
    const h = autoHelper(USER);
    const first = withMeasurements({}, () => open(h).modelId);
    const later = withMeasurements({ 'gemini|gemini-3.1-flash-lite': { p50: 100, n: 20 } }, () => open(h).modelId);
    assert.equal(first, 'deepseek-flash');
    assert.equal(later, 'deepseek-flash', 'a sample landing mid-turn must not change the answering model');
  });

  test('another model\'s measurements are never borrowed: an unmeasured candidate keeps its shipped slot', () => {
    // The Active Gemini 3.8 Flash is fast and measured; DeepSeek and Flash-Lite
    // are not. Under the old lookup() they inherited 3.8 Flash's row.
    assert.equal(pickFor({ 'gemini|gemini-3.8-flash': { p50: 150, n: 40 }, 'gemini|gemini-3.1-flash-lite': { p50: 2000, n: 10 } }, USER), 'deepseek-flash');
  });

  test('a failure-only record (no successes) is seen and demoted', () => {
    assert.equal(pickFor({ 'gemini|deepseek-flash': { p50: 0, n: 0, ok: 0, bad: 8 } }, USER), 'gemini-3.1-flash-lite');
  });

  test('evidence that cannot be read falls back to the shipped order', () => {
    __setProviderPerformanceStore({ getExact: () => { throw new Error('store unavailable'); }, lookup: () => { throw new Error('store unavailable'); } });
    try { assert.equal(open(autoHelper(USER)).modelId, 'deepseek-flash'); }
    finally { __setProviderPerformanceStore(null); }
  });

  test('the deadline follows the Auto pick: a cloud-gateway Active Model answered by Gemini is not a user endpoint', () => {
    const h = autoHelper({ active: 'openrouter/openai/gpt-5.6-terra', vendors: ['openrouter', 'gemini'] });
    h.answerLatency = new Map();
    withMeasurements({}, () => {
      assert.equal(LLMHelper.prototype.isUsingUserEndpoint.call(h), false);
      LLMHelper.prototype.recordAnswerFirstToken.call(h, 400);
    });
    assert.equal(h.answerLatency.size, 0, "the pick's first tokens must not narrow the gateway's budget");
  });
});
// ── The real answer path: self-hosted, fallback-only ladder, cooldown, profile ──

async function drive(opts = {}, { ignoreKnowledgeMode = true, overrides = {}, signal } = {}) {
  const h = autoHelper(opts);
  h.checkOllamaAvailable = async () => false;
  h.ensureOllamaModelSelected = async () => false;
  h.pickConfiguredCustomProviderForFallback = () => null;
  h.getActiveModeGroundingInfo = () => null;
  h.textHealth = new Map();
  h.answerLatency = new Map();
  if (opts.customProvider) h.customProvider = opts.customProvider;
  Object.assign(h, overrides);
  let out = '';
  const gen = LLMHelper.prototype._streamChatInner.call(
    h, 'What is a thread?', undefined, undefined, 'SYS', ignoreKnowledgeMode, true, [], signal, 0, { v3Owned: true },
  );
  try { for await (const chunk of gen) out += chunk; } catch (e) { out += `[threw: ${e.message}]`; }
  return { h, out, first: h.calls[0]?.name };
}

describe('Auto never moves a self-hosted Active Model\'s turns to another provider', () => {
  for (const [label, opts, own] of [
    ['LiteLLM', { active: 'litellm/openai/gpt-4o', vendors: ['litellm', 'gemini', 'deepseek'], codex: true }, 'streamWithLiteLLM'],
    ['9Router', { active: 'ninerouter/cc/claude-haiku', vendors: ['gemini'], codex: true, overrides: { ninerouterClient: {} } }, 'streamWithNinerouter'],
    ['a custom provider', { active: 'my-proxy', vendors: ['gemini'], codex: true, customProvider: { id: 'my-proxy', name: 'My proxy', curlCommand: 'curl x' } }, 'streamWithCustom'],
  ]) {
    test(`${label}: neither Auto nor the old Codex ladder takes the turn — the user's endpoint answers`, async () => {
      const { h } = await withMeasurements({}, () => drive(opts, { overrides: opts.overrides }));
      assert.deepEqual(h.calls.map((c) => c.name), [own], `calls: ${h.calls.map((c) => c.name).join(', ')}`);
    });
  }

  test('NVIDIA NIM is a hosted provider, like Groq — not self-hosted, so Auto applies', async () => {
    const { first, h } = await withMeasurements({}, () => drive({ active: 'nvidia_nim/openai/gpt-oss-20b', vendors: ['gemini'], overrides: { nvidiaNimClient: {} } }, { overrides: { nvidiaNimClient: {} } }));
    assert.equal(LLMHelper.prototype.activeIsSelfHosted.call(h), false);
    assert.equal(first, 'streamWithGeminiModel');
  });

  test('an explicit Background Model still applies — the user named it', async () => {
    const { first } = await withMeasurements({}, () => drive({ active: 'litellm/openai/gpt-4o', vendors: ['litellm', 'deepseek'], pick: 'deepseek-flash' }));
    assert.equal(first, 'streamWithDeepseek');
  });
});

describe('the old Codex → Groq → Natively ladder is only a fallback now', () => {
  test('Codex signed in, Groq Active ranked fastest: Groq answers — Codex does not jump ahead', async () => {
    const { first, h } = await withMeasurements({}, () => drive({ active: 'qwen/qwen3.8-27b', vendors: ['groq', 'gemini'], codex: true }));
    assert.equal(first, 'streamWithGroq');
    assert.equal(h.calls[0].args[1], 'qwen/qwen3.8-27b');
  });

  test('a failed pick falls back to the ladder, and steps aside for 90s', async () => {
    const opts = { active: 'openrouter/openai/gpt-5.6-terra', vendors: ['openrouter', 'gemini', 'deepseek'] };
    const failing = { streamWithDeepseek: async function* () { this.calls.push({ name: 'streamWithDeepseek' }); throw new Error('503 upstream'); } };
    const first = await withMeasurements({}, () => drive(opts, { overrides: failing }));
    assert.deepEqual(first.h.calls.map((c) => c.name), ['streamWithDeepseek', 'streamWithOpenRouter'],
      `with no ladder provider connected, the Active Model answers after the failed pick (out: ${first.out})`);
    // Same instance, next turn: DeepSeek is cooling down, so the next-fastest answers.
    const h = first.h;
    h.calls.length = 0;
    const next = await withMeasurements({}, async () => {
      const res = open(h);
      return res && res.modelId;
    });
    assert.equal(next, 'gemini-3.1-flash-lite');
    const realNow = Date.now;
    Date.now = () => realNow() + 91_000;
    try {
      h._autoFastOrder = undefined;
      assert.equal(withMeasurements({}, () => open(h).modelId), 'deepseek-flash', 'after the cooldown DeepSeek is back');
    } finally { Date.now = realNow; }
  });

  test('a failed pick is recorded as a FAILURE for that model, so Auto can learn it is unreliable', async () => {
    // The turn is rescued and filed as a success under the pick (its identity is
    // fixed at turn start), so without this sample a model failing every turn
    // would keep a clean record.
    const recorded = [];
    __setProviderPerformanceStore({ lookup: () => null, getExact: () => null, record: (sample) => recorded.push(sample), currentGeneration: () => 0 });
    const failing = { streamWithDeepseek: async function* () { this.calls.push({ name: 'streamWithDeepseek' }); throw new Error('503 Service Unavailable'); } };
    try {
      await drive({ active: 'openrouter/openai/gpt-5.6-terra', vendors: ['openrouter', 'gemini', 'deepseek'] }, { overrides: failing });
    } finally { __setProviderPerformanceStore(null); }
    const failure = recorded.find((r) => r.modelId === 'deepseek-flash');
    assert.ok(failure, `no sample for the failed pick; recorded: ${JSON.stringify(recorded.map((r) => r.modelId))}`);
    assert.equal(failure.sampleClass, 'server_error');
    assert.equal(failure.providerId, 'gemini', 'filed under the key the ranking reads');
    assert.equal(failure.workload, 'small', 'in the bucket the ranking compares');
    assert.equal(failure.ttftMs, null);
  });

  test('a user cancel is not a failure: no cooldown', async () => {
    const ctrl = new AbortController();
    const cancelling = { streamWithDeepseek: async function* () { ctrl.abort(); throw Object.assign(new Error('aborted'), { name: 'AbortError' }); } };
    const { h } = await withMeasurements({}, () => drive({ active: 'openrouter/openai/gpt-5.6-terra', vendors: ['openrouter', 'gemini', 'deepseek'] }, { overrides: cancelling, signal: ctrl.signal }));
    assert.equal(LLMHelper.prototype.inFastPickCooldown.call(h, 'deepseek-flash'), false);
  });
});

describe('Fast Response keeps the profile / résumé step', () => {
  test('the persona and résumé context reach the fast answer', async () => {
    let asked = 0;
    const knowledge = {
      knowledgeOrchestrator: {
        isKnowledgeMode: () => true,
        feedForDepthScoring: () => {},
        processQuestion: async () => { asked++; return { systemPromptInjection: 'PERSONA_MARKER', contextBlock: 'RESUME_MARKER' }; },
      },
      isPremiumKnowledgeInterceptAllowed: () => true,
    };
    const { h, first } = await withMeasurements({}, () => drive(
      { active: 'gemini-3.8-flash', vendors: ['gemini', 'openai'], pick: 'gpt-5.4-mini' },
      { ignoreKnowledgeMode: false, overrides: knowledge },
    ));
    assert.equal(asked, 1, 'fast mode used to skip the profile step entirely');
    assert.equal(first, 'streamWithOpenai');
    assert.match(h.calls[0].args[1], /PERSONA_MARKER/, 'the persona must shape the fast answer\'s system prompt');
    assert.match(h.calls[0].args[0], /RESUME_MARKER/, 'the résumé context must reach the fast answer');
  });
});

describe('a stalled or silent fast answer is a failure the turn falls back from', () => {
  const opts = { active: 'openrouter/openai/gpt-5.6-terra', vendors: ['openrouter', 'gemini', 'deepseek'] };

  test('a pick that never says a word is abandoned at its budget: the Active Model answers IN the same turn, and it is recorded as a timeout', async () => {
    const recorded = [];
    __setProviderPerformanceStore({ lookup: () => null, getExact: () => null, record: (sample) => recorded.push(sample), currentGeneration: () => 0 });
    const stalling = {
      fastPickFirstTokenBudgetMs: () => 50,
      streamWithDeepseek: async function* (_u, _s, _m, signal) {
        this.calls.push({ name: 'streamWithDeepseek' });
        await new Promise((resolve) => signal?.addEventListener('abort', resolve));
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      },
    };
    let res;
    try { res = await drive(opts, { overrides: stalling }); } finally { __setProviderPerformanceStore(null); }
    assert.deepEqual(res.h.calls.map((c) => c.name), ['streamWithDeepseek', 'streamWithOpenRouter'], `out: ${res.out}`);
    assert.equal(LLMHelper.prototype.inFastPickCooldown.call(res.h, 'deepseek-flash'), true, 'a stall must step the pick aside');
    const sample = recorded.find((r) => r.modelId === 'deepseek-flash');
    assert.equal(sample?.sampleClass, 'timeout', 'a stall is a timeout, not a user cancel');
  });

  test('a pick that ends without a word is a failure too (streaming)', async () => {
    const silent = { streamWithDeepseek: async function* () { this.calls.push({ name: 'streamWithDeepseek' }); yield '  '; } };
    const res = await withMeasurements({}, () => drive(opts, { overrides: silent }));
    assert.deepEqual(res.h.calls.map((c) => c.name), ['streamWithDeepseek', 'streamWithOpenRouter']);
    assert.equal(LLMHelper.prototype.inFastPickCooldown.call(res.h, 'deepseek-flash'), true);
  });

  test('the budget is half the pick\'s own route budget', () => {
    const h = autoHelper(opts);
    h.answerLatency = new Map();
    const P = LLMHelper.prototype;
    // Always under the outer text deadline's floor (8s shipped / gateway, 13s
    // Natively, 30s Codex), so the fallback still has time inside the turn.
    assert.equal(P.fastPickFirstTokenBudgetMs.call(h, { modelId: 'deepseek-flash', family: 'deepseek' }), 4000);
    assert.equal(P.fastPickFirstTokenBudgetMs.call(h, { modelId: 'codex-cli', family: 'codex' }), 15000);
    assert.equal(P.fastPickFirstTokenBudgetMs.call(h, { modelId: 'natively', family: 'natively' }), 6500);
    assert.equal(P.fastPickFirstTokenBudgetMs.call(h, { modelId: 'openrouter/x/y', family: 'openrouter' }), 7500, 'unmeasured gateway');
    // A gateway measured fast narrows with its budget: 5 samples at ~1s → 8s budget → 4s guard.
    for (let i = 0; i < 5; i++) { P.recordAnswerFirstToken.call(Object.assign(Object.create(h), { answerLatencyKey: () => 'model:openrouter/x/y' }), 1000); }
    assert.equal(P.fastPickFirstTokenBudgetMs.call(h, { modelId: 'openrouter/x/y', family: 'openrouter' }), 4000);
  });
});

describe('Fast Response honours the provider cards\' model lists', () => {
  const USER = { active: 'openrouter/openai/gpt-5.6-terra', vendors: ['openrouter', 'gemini', 'deepseek'] };
  test('an Auto tier un-ticked in its card is skipped', () => {
    const got = withAllowLists({ deepseek: ['deepseek-v4-pro'] }, () => withMeasurements({}, () => open(autoHelper(USER))?.modelId));
    assert.equal(got, 'gemini-3.1-flash-lite');
  });
  test('an un-ticked Background Model answers nothing — as the picker\'s "(not supported)" says', () => {
    const got = withAllowLists({ deepseek: ['deepseek-v4-pro'] }, () => withMeasurements({}, () => open(autoHelper({ ...USER, pick: 'deepseek-flash' }))));
    assert.equal(got, null);
  });
  test('an opt-in gateway pick must be ticked; empty means none', () => {
    const h = () => autoHelper({ active: 'gemini-3.8-flash', vendors: ['gemini', 'openrouter'], pick: 'openrouter/google/gemini-3.1-flash-lite' });
    assert.equal(withAllowLists({}, () => withMeasurements({}, () => open(h()))), null);
    assert.equal(withAllowLists({ openrouter: ['openrouter/google/gemini-3.1-flash-lite'] }, () => withMeasurements({}, () => open(h())?.modelId)), 'openrouter/google/gemini-3.1-flash-lite');
  });
  test('the bare Codex candidate is checked as the Codex default', () => {
    const h = () => autoHelper({ active: 'openrouter/openai/gpt-5.6-terra', vendors: ['openrouter'], codex: true });
    assert.equal(withAllowLists({ 'codex-cli': ['codex-cli:gpt-6-astra'] }, () => withMeasurements({}, () => open(h()))), null, 'gpt-5.5 un-ticked');
    assert.equal(withAllowLists({ 'codex-cli': ['codex-cli:gpt-5.5'] }, () => withMeasurements({}, () => open(h())?.modelId)), 'codex-cli');
  });
});

describe('a Background Model that IS the Active Model', () => {
  test('steps aside, so the Active Model answers with its own failover', () => {
    assert.equal(withMeasurements({}, () => open(autoHelper({ active: 'deepseek-flash', vendors: ['deepseek'], pick: 'deepseek-flash' }))), null);
  });
});

// ── Screenshots with Fast Response Mode on ─────────────────────────────────
//
// _streamChatInner is driven for real (the ProviderDataScopeOutbound harness):
// only the provider streamers, the vision chain and the availability probes are
// stubbed. Fast Response is text-only by design, so an image turn must reach the
// vision chain WITH its images, and neither the Background Model nor the Auto
// ladder may answer it blind.

function runInner({ imagePaths, pick = 'gpt-5.4-mini', codex = false } = {}) {
  const calls = [];
  const h = Object.create(LLMHelper.prototype);
  h.useOllama = false;
  h.checkOllamaAvailable = async () => false;
  h.ensureOllamaModelSelected = async () => false;
  h.currentModelId = 'gemini-3.8-flash';
  h.pickConfiguredCustomProviderForFallback = () => null;
  h.getActiveModeGroundingInfo = () => null;
  h.groqFastTextMode = true;
  h.isLocalOnlyMode = false;
  h._groqLocalDisabled = false;
  Object.defineProperty(h, 'fastModelId', { get: () => pick });
  h.openaiClient = {}; h.client = {}; h.groqClient = {};
  h.isCodexAvailable = () => codex;
  h.codexCliConfig = { model: 'gpt-5.5' };
  for (const k of Object.getOwnPropertyNames(LLMHelper.prototype)) {
    if (/^streamWith/.test(k)) h[k] = async function* (...args) { calls.push({ name: k, args }); yield `from ${k}`; };
  }
  h.streamVisionWithFallback = async function* (req) { calls.push({ name: 'streamVisionWithFallback', args: [req] }); yield 'saw the screen'; };
  return (async () => {
    let out = '';
    const gen = LLMHelper.prototype._streamChatInner.call(
      h, 'What is on my screen?', imagePaths, undefined, 'SYS', true, true, [], undefined, 0, { v3Owned: true },
    );
    for await (const chunk of gen) out += chunk;
    return { calls, out };
  })();
}

describe('screenshot analysis with Fast Response Mode on', () => {
  const shot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fast-shot-')), 'screen.png');
  fs.writeFileSync(shot, Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(64)]));

  for (const [label, opts] of [
    ['a Background Model pick', { pick: 'gpt-5.4-mini' }],
    ['a Codex Background Model pick', { pick: 'codex-cli:gpt-5.6-luna', codex: true }],
    ['Auto (the Codex → Groq → Natively ladder)', { pick: null, codex: true }],
    ['Auto on a connected vendor\'s fast tier (no Codex)', { pick: null, codex: false }],
  ]) {
    test(`${label}: the screenshot goes to the vision chain, with its image`, async () => {
      const { calls, out } = await runInner({ imagePaths: [shot], ...opts });
      assert.deepEqual(calls.map((c) => c.name), ['streamVisionWithFallback'],
        'an image turn must never be answered by the text-only fast path');
      assert.deepEqual(calls[0].args[0].imagePaths, [shot], 'the screenshot must reach the vision chain');
      assert.equal(out, 'saw the screen');
    });
  }

  test('the same turn without a screenshot IS answered by the Background Model (control)', async () => {
    const { calls } = await runInner({ pick: 'gpt-5.4-mini' });
    assert.deepEqual(calls.map((c) => c.name), ['streamWithOpenai']);
    assert.equal(calls[0].args[2], 'gpt-5.4-mini');
  });
});

// ── Deadlines and latency follow the model that answers ────────────────────
//
// The live deadline, the adaptive latency map and the performance profile are
// chosen BEFORE dispatch. They read the Active Model, so a Background Model
// answer got the Active Model's deadline and its first-token times were filed
// under the Active Model's endpoint.

describe('the route the deadline code sees is the model that answers a text turn', () => {
  const routed = (opts) => {
    const h = helper(opts);
    h.answerLatency = new Map();
    h.currentModelId = opts.active;
    // Codex signed out, so Codex never becomes the Auto candidate here.
    h.isCodexAvailable = () => false;
    return h;
  };
  const P = LLMHelper.prototype;

  test('a gateway pick behind a shipped Active Model gets the user-endpoint deadline', () => {
    const h = routed({ pick: 'openrouter/openai/gpt-5.6-terra', active: 'gemini-3.8-flash' });
    const ticked = { openrouter: ['openrouter/openai/gpt-5.6-terra'] };
    assert.equal(withAllowLists(ticked, () => P.isUsingUserEndpoint.call(h)), true, 'a 8s shipped-provider cap would cut a gateway pick short');
    const id = withAllowLists(ticked, () => P.performanceIdentity.call(h, false));
    assert.equal(id.modelId, 'openrouter/openai/gpt-5.6-terra');
    assert.equal(id.route, 'user_endpoint');
  });

  test('a shipped pick behind a gateway Active Model: not a user endpoint, and nothing is measured', () => {
    const h = routed({ pick: 'gemini-3.1-flash-lite', active: 'litellm/openai/gpt-4o' });
    assert.equal(P.isUsingUserEndpoint.call(h), false);
    P.recordAnswerFirstToken.call(h, 400);
    assert.equal(h.answerLatency.size, 0,
      "the pick's sub-second first token must not narrow the LiteLLM proxy's adaptive budget");
    assert.equal(P.observedAnswerLatency.call(h), null);
  });

  test('a gateway pick is measured under its OWN key, never the Active Model\'s', () => {
    const h = routed({ pick: 'openrouter/openai/gpt-5.6-terra', active: 'litellm/openai/gpt-4o' });
    withAllowLists({ openrouter: ['openrouter/openai/gpt-5.6-terra'] }, () => P.recordAnswerFirstToken.call(h, 2500));
    assert.deepEqual([...h.answerLatency.keys()], ['model:openrouter/openai/gpt-5.6-terra']);
  });

  test('the Natively cascade deadline does not apply while a pick answers', () => {
    assert.equal(P.isUsingNativelyServerCascade.call(routed({ pick: 'gemini-3.1-flash-lite', active: 'natively' })), false);
    assert.equal(P.isUsingNativelyServerCascade.call(routed({ pick: null, fastMode: false, active: 'natively' })), true);
  });

  test('a pick answer has no engine retry, so the caller keeps its regeneration', () => {
    assert.equal(P.hasEngineLevelRetry.call(routed({ pick: 'gemini-3.1-flash-lite', active: 'litellm/openai/gpt-4o' })), false);
    assert.equal(P.hasEngineLevelRetry.call(routed({ pick: null, fastMode: false, active: 'litellm/openai/gpt-4o' })), true,
      'with fast mode off the Active gateway still runs through the engine');
  });

  test('with Codex signed in, a non-Codex pick is not a 30s "local" Codex turn; a Codex pick and Auto are', () => {
    const signedIn = (opts) => { const h = routed(opts); h.isCodexAvailable = () => true; return h; };
    assert.equal(P.isUsingCodexCli.call(signedIn({ pick: 'gemini-3.1-flash-lite', active: 'gemini-3.8-flash' })), false,
      'the Gemini pick answers, so the turn takes its 8s budget, not Codex\'s 30s');
    assert.equal(P.isUsingCodexCli.call(signedIn({ pick: 'codex-cli:gpt-5.6-luna', active: 'gemini-3.8-flash' })), true);
    // Auto: long budget only when Auto actually picks Codex.
    const onlyCodex = routed({ pick: null, active: 'gemini-3.8-flash' });
    for (const k of ['openaiClient', 'claudeClient', 'deepseekClient', 'groqClient', 'client', 'openrouterClient', 'litellmClient', 'nvidiaNimClient', 'ninerouterClient']) onlyCodex[k] = null;
    onlyCodex.isCodexAvailable = () => true;
    assert.equal(withMeasurements({}, () => P.isUsingCodexCli.call(onlyCodex)), true, 'Auto picked Codex: the long budget');
    assert.equal(withMeasurements({}, () => P.isUsingCodexCli.call(signedIn({ pick: null, active: 'gemini-3.8-flash' }))), false,
      'Auto picked a faster model: Codex being signed in no longer makes the turn Codex\'s');
  });

  test('a screenshot turn keeps the Active Model identity — it never takes the fast path', () => {
    const id = P.performanceIdentity.call(routed({ pick: 'gemini-3.1-flash-lite', active: 'natively' }), true);
    assert.equal(id.modelId, 'natively');
    assert.equal(id.route, 'server_cascade');
  });

  test('fast mode off, local Ollama or local-only: everything reads the Active Model as before', () => {
    for (const opts of [{ pick: null, fastMode: false }, { pick: 'openrouter/openai/gpt-5.6-terra', fastMode: false }, { pick: 'openrouter/openai/gpt-5.6-terra', localOnly: true }]) {
      const h = routed({ ...opts, active: 'litellm/openai/gpt-4o' });
      assert.equal(P.isUsingUserEndpoint.call(h), true);
      P.recordAnswerFirstToken.call(h, 900);
      assert.deepEqual([...h.answerLatency.keys()], ['model:litellm/openai/gpt-4o']);
    }
    const ollama = routed({ pick: 'openrouter/openai/gpt-5.6-terra', active: 'gemini-3.8-flash' });
    ollama.useOllama = true;
    assert.equal(P.isUsingUserEndpoint.call(ollama), false, 'an Ollama turn stays local; the pick never answers it');
  });
});

describe('Codex is skipped where its first token cannot fit the budget', () => {
  for (const timeoutMs of [1800, 1500]) {
    test(`a ${timeoutMs}ms rung (judge / query rewrite) skips Codex and returns at once`, async () => {
      const h = helper({ pick: 'codex-cli:gpt-5.5' });
      const t0 = Date.now();
      assert.equal(await LLMHelper.prototype.callFastModel.call(h, 'JUDGE', { timeoutMs, json: true }), null);
      assert.equal(h.calls.length, 0, 'spending the budget on Codex would leave the ladder ~700ms');
      assert.ok(Date.now() - t0 < 200);
    });
  }
});

describe('both answer paths try the Background Model before the ladder', () => {
  const src = fs.readFileSync(path.join(root, 'electron/LLMHelper.ts'), 'utf8');

  test('streaming: the pick is tried first, never for images or a local Ollama model', () => {
    const pick = src.indexOf('const fastPick = !isMultimodal && !this.useOllama\n      ? this.openFastModelStream(');
    const ladder = src.indexOf('const fastModeApplies = fastPickFailed && this.groqFastTextMode');
    assert.ok(pick > -1, 'the streaming path must call openFastModelStream behind the image + Ollama guard');
    assert.ok(ladder > pick, 'the pick must run BEFORE the fallback ladder');
    const block = src.slice(pick, ladder);
    assert.match(block, /catch \(e: any\) \{[^}]*?if \(abortSignal\?\.aborted\) return;/,
      'a cancelled turn must not start a second provider');
    assert.match(block, /TRUNCATION_SENTINEL/, 'a failure after the first token must not append a second answer');
  });

  test('non-streaming: the same guard, the same order', () => {
    const pick = src.indexOf('if (!isMultimodal && !this.useOllama) {\n        const fastCtl = new AbortController();\n        const fastPick = this.openFastModelStream(');
    const ladder = src.indexOf('const fastModeAppliesNS = fastPickFailed && this.groqFastTextMode');
    assert.ok(pick > -1, 'chatWithGemini must call openFastModelStream behind the image + Ollama guard');
    assert.ok(ladder > pick, 'the pick must run BEFORE the fallback ladder');
  });
});

// ── One answer, one model (textTurn) ────────────────────────────────────────
//
// The caller reads the deadline, the latency key and the profile identity
// BEFORE the answer is dispatched. Each read used to re-resolve the pick, so a
// 30s order refresh or another turn's failure in between timed and filed the
// answer for one model while another answered it; a failed pick's rescue was
// filed as the pick's SUCCESS; and a screenshot a privacy setting dropped was
// filed as a vision turn under the Active Model while the pick answered text.
// A textTurn(signal) view pins the pick at its first read, the dispatch on the
// same signal uses the pin, and the dispatch records who answered.

describe('one answer is timed, dispatched and filed for ONE model', () => {
  const P = LLMHelper.prototype;
  const USER = { active: 'openrouter/openai/gpt-5.6-terra', vendors: ['openrouter', 'gemini', 'deepseek'] };
  const shot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'turn-shot-')), 'screen.png');
  fs.writeFileSync(shot, Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(64)]));

  /** A fake store for async flows (withMeasurements resets before an await). */
  function storeWith(ids, recorded = []) {
    const profile = ({ p50, n }) => ({ lastUpdated: Date.now(), workloads: { small: {
      ttft: { p50Ms: p50, maxMs: p50 * 2, count: n },
      reliability: { ok: n, timeout: 0, stall: 0, rateLimit: 0, serverError: 0, clientError: 0, connectionFailure: 0 },
    } } });
    const get = (provider, model) => (ids[`${provider}|${model}`] ? profile(ids[`${provider}|${model}`]) : null);
    __setProviderPerformanceStore({
      getExact: get, lookup: get, record: (s) => recorded.push(s), currentGeneration: () => 0, setCapabilities: () => {},
    });
    return recorded;
  }
  function turnHelper(opts) {
    const h = autoHelper(opts);
    h.useOllama = false;
    h.checkOllamaAvailable = async () => false;
    h.ensureOllamaModelSelected = async () => false;
    h.pickConfiguredCustomProviderForFallback = () => null;
    h.getActiveModeGroundingInfo = () => null;
    h.textHealth = new Map();
    h.answerLatency = new Map();
    h.streamVisionWithFallback = async function* () { h.calls.push({ name: 'streamVisionWithFallback' }); yield 'saw the screen'; };
    return h;
  }
  async function answer(h, signal, imagePaths) {
    const gen = P._streamChatInner.call(h, 'What is a thread?', imagePaths, undefined, 'SYS', true, true, [], signal, 0, { v3Owned: true });
    for await (const _ of gen) { /* drain */ }
    return h.calls.map((c) => c.name);
  }
  const failing = async function* () { this.calls.push({ name: 'streamWithDeepseek' }); throw new Error('503 Service Unavailable'); };
  const brief = (a) => a && { modelId: a.identity.modelId, route: a.identity.route, hasImages: a.hasImages };

  test('the ranking changing between the deadline and the dispatch does not move the answer', async () => {
    const h = turnHelper(USER);
    const signal = new AbortController().signal;
    try {
      storeWith({});
      const view = h.textTurn(signal);
      assert.equal(view.performanceIdentity(false).modelId, 'deepseek-flash', 'unmeasured: the shipped order, DeepSeek first');
      // This user's samples now say Flash-Lite is far faster, and the 30s freeze has run out.
      storeWith({ 'gemini|gemini-3.1-flash-lite': { p50: 300, n: 20 }, 'gemini|deepseek-flash': { p50: 2000, n: 20 } });
      h._autoFastOrder = undefined;
      assert.equal(P.fastPickForTextTurn.call(h).modelId, 'gemini-3.1-flash-lite', 'precondition: a fresh read now names Flash-Lite');
      assert.deepEqual(await answer(h, signal), ['streamWithDeepseek'], 'timed and filed for DeepSeek, so DeepSeek answers');
      assert.deepEqual(brief(view.answeredIdentity(false)), { modelId: 'deepseek-flash', route: 'default_provider', hasImages: false });
      // The NEXT answer takes the new ranking.
      h.calls.length = 0;
      assert.deepEqual(await answer(h, new AbortController().signal), ['streamWithGeminiModel']);
    } finally { __setProviderPerformanceStore(null); }
  });

  test('another turn failing on the pick after this answer was timed: this answer still goes to it, the next does not', async () => {
    const h = turnHelper(USER);
    const signal = new AbortController().signal;
    try {
      storeWith({});
      const view = h.textTurn(signal);
      assert.equal(view.isUsingUserEndpoint(), false, 'pinned: DeepSeek, a shipped provider');
      P.noteFastPickFailure.call(h, { modelId: 'deepseek-flash', family: 'deepseek' }, new Error('503'));
      assert.deepEqual(await answer(h, signal), ['streamWithDeepseek']);
      h.calls.length = 0;
      assert.deepEqual(await answer(h, new AbortController().signal), ['streamWithGeminiModel'], 'a new answer respects the cooldown');
    } finally { __setProviderPerformanceStore(null); }
  });

  test('the pin never outlives the user switching its provider off', async () => {
    const disabled = [];
    const h = turnHelper(USER);
    h.isProviderDisabled = (f) => disabled.includes(f);
    const signal = new AbortController().signal;
    try {
      storeWith({});
      const view = h.textTurn(signal);
      assert.equal(view.performanceIdentity(false).modelId, 'deepseek-flash');
      disabled.push('deepseek');
      assert.deepEqual(await answer(h, signal), ['streamWithOpenRouter'], 'a switched-off provider never answers, pinned or not');
      assert.equal(view.answeredIdentity(false).identity.modelId, 'openrouter/openai/gpt-5.6-terra', 'filed under the model that did answer');
      assert.equal(view.isUsingUserEndpoint(), true, 'and every later read names it too');
    } finally { __setProviderPerformanceStore(null); }
  });

  test('a rescued answer is filed under no one and teaches no latency budget; the pick\'s own failure is filed', async () => {
    const h = turnHelper(USER);
    h.streamWithDeepseek = failing;
    const signal = new AbortController().signal;
    let recorded;
    try {
      recorded = storeWith({});
      const view = h.textTurn(signal);
      assert.equal(view.performanceIdentity(false).modelId, 'deepseek-flash');
      assert.deepEqual(await answer(h, signal), ['streamWithDeepseek', 'streamWithOpenRouter']);
      assert.equal(view.answeredIdentity(false), null, 'no one model answered this turn');
      view.recordAnswerFirstToken(900);
      assert.equal(h.answerLatency.size, 0, "the rescue's first token includes the failed pick's wait");
      assert.deepEqual(recorded.map((s) => `${s.modelId}:${s.sampleClass}`), ['deepseek-flash:server_error']);
      assert.equal(view.hasEngineLevelRetry(), true, 'the Active rung that rescued it (an engine-wrapped gateway) is what a regeneration asks about');

      // The recorder, fed this turn's observation, files nothing.
      const { performanceHooks } = require(dist('llm/performance/wiring.js'));
      performanceHooks({ llmHelper: view, hasImages: false, inputTokens: 200 }).observe(OBSERVATION);
      assert.deepEqual(recorded.map((s) => `${s.modelId}:${s.sampleClass}`), ['deepseek-flash:server_error'], 'no success sample for anyone');

      // A later dispatch on the same signal (no caller does this today) picks
      // fresh and leaves the turn's record alone.
      h.calls.length = 0;
      assert.deepEqual(await answer(h, signal), ['streamWithGeminiModel'], 'DeepSeek is cooling down');
      assert.equal(view.answeredIdentity(false), null);
    } finally { __setProviderPerformanceStore(null); }
  });

  test('a screenshot a privacy setting dropped is filed as a TEXT turn under the model that answered', async () => {
    const h = turnHelper(USER);
    const signal = new AbortController().signal;
    process.env.NATIVELY_DENY_PROVIDER_SCOPES = 'screenshots';
    try {
      const recorded = storeWith({});
      const view = h.textTurn(signal);
      assert.equal(view.performanceIdentity(true).route, 'vision', 'at the start the caller can only see a screenshot turn');
      assert.deepEqual(await answer(h, signal, [shot]), ['streamWithDeepseek'], 'the screenshot was dropped, so the pick answers text');
      assert.deepEqual(brief(view.answeredIdentity(true)), { modelId: 'deepseek-flash', route: 'default_provider', hasImages: false });
      const { performanceHooks } = require(dist('llm/performance/wiring.js'));
      performanceHooks({ llmHelper: view, hasImages: true, inputTokens: 200 }).observe(OBSERVATION);
      assert.deepEqual(recorded.map((s) => `${s.modelId}:${s.workload}`), ['deepseek-flash:small'], 'filed as a text turn, not vision');
    } finally {
      delete process.env.NATIVELY_DENY_PROVIDER_SCOPES;
      __setProviderPerformanceStore(null);
    }
  });

  test('a screenshot the vision chain answers stays a vision turn under the Active Model (control)', async () => {
    const h = turnHelper(USER);
    const signal = new AbortController().signal;
    try {
      storeWith({});
      const view = h.textTurn(signal);
      view.performanceIdentity(true);
      assert.deepEqual(await answer(h, signal, [shot]), ['streamVisionWithFallback']);
      assert.deepEqual(brief(view.answeredIdentity(true)), { modelId: 'openrouter/openai/gpt-5.6-terra', route: 'vision', hasImages: true });
    } finally { __setProviderPerformanceStore(null); }
  });

  test('a screenshot turn with a GATEWAY pick teaches the pick\'s latency budget nothing — the vision chain answered', async () => {
    // The vision chain's multi-second first token, filed under
    // model:<pick>, would widen the pick's adaptive budget and its guard.
    const h = turnHelper({ active: 'gemini-3.8-flash', vendors: ['gemini', 'openrouter'], pick: 'openrouter/openai/gpt-5.6-terra' });
    const signal = new AbortController().signal;
    await withAllowLists({ openrouter: ['openrouter/openai/gpt-5.6-terra'] }, async () => {
      try {
        storeWith({});
        const view = h.textTurn(signal);
        assert.equal(view.isUsingUserEndpoint(), true, 'before dispatch the caller reads the pick (the vision budget sits above it)');
        assert.deepEqual(await answer(h, signal, [shot]), ['streamVisionWithFallback']);
        view.recordAnswerFirstToken(9000);
        assert.deepEqual([...h.answerLatency.keys()], [], 'the pick never answered this turn');
        assert.deepEqual(brief(view.answeredIdentity(true)), { modelId: 'gemini-3.8-flash', route: 'vision', hasImages: true });
      } finally { __setProviderPerformanceStore(null); }
    });
  });

  test('without a signal there is no turn to pin: the helper itself', () => {
    const h = turnHelper(USER);
    assert.equal(h.textTurn(undefined), h);
  });
});

const OBSERVATION = {
  ttftMs: 400, totalMs: 900, interChunkGapsMs: [20, 20], chunkCount: 3, outputChars: 60, reason: 'done',
  firstUsefulBudgetMs: 8000, interTokenStallMs: 8000, speculative: false,
};

describe('the three answer surfaces read their deadline through that answer\'s own view', () => {
  const ipc = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
  const ie = fs.readFileSync(path.join(root, 'electron/IntelligenceEngine.ts'), 'utf8');
  const wta = fs.readFileSync(path.join(root, 'electron/llm/WhatToAnswerLLM.ts'), 'utf8');
  // The reads a deadline / latency map / profile row is built from. Off the bare
  // helper, each re-resolves the pick.
  const READS = /\b(?:llmHelper|this\.llmHelper as any\))\.(?:isUsingOllama|isUsingCodexCli|isUsingNativelyServerCascade|isUsingUserEndpoint|observedAnswerLatency|recordAnswerFirstToken|hasEngineLevelRetry)\b/;
  const between = (src, from, to) => {
    const a = src.indexOf(from);
    const b = src.indexOf(to, a);
    assert.ok(a > -1 && b > a, `anchors not found: ${from} … ${to}`);
    return src.slice(a, b);
  };

  test('manual chat: the view is keyed by the signal its answer call carries', () => {
    assert.match(between(ipc, 'const _manualAnswerArgs: StreamChatArgs = [', '];'), /\n\s*myController\.signal,\n/, 'args[7] is the controller\'s signal');
    const site = between(ipc, 'const answerLlm = llmHelper.textTurn?.(myController?.signal) ?? llmHelper;', 'onFirstUsefulTimeout:');
    assert.doesNotMatch(site, READS, 'every route read goes through answerLlm');
    assert.match(site, /performanceHooks\(\{\s*llmHelper: answerLlm as any/);
    assert.match(site, /\{ llmHelper: answerLlm as any, hasImages/, 'applyAdaptiveTtft reads the same view');
    assert.match(site, /answerLlm\.recordAnswerFirstToken\?\.\(ms\)/);
  });

  test('phone mirror: the same, on phoneController', () => {
    assert.match(ipc, /llmHelper\.streamChat\(message, undefined, context, [^\n]*, \[\], phoneController\.signal, undefined, phoneRouteOptions\)/);
    const site = between(ipc, 'const phoneLlm = llmHelper.textTurn?.(phoneController.signal) ?? llmHelper;', 'onCleanup: () => { try { phoneController.abort()');
    assert.doesNotMatch(site, READS);
    assert.match(site, /performanceHooks\(\{\s*llmHelper: phoneLlm as any/);
    assert.match(site, /\{ llmHelper: phoneLlm as any, hasImages: false/);
  });

  test('Auto Answer: keyed by the run\'s own cancellation token, which generateStream hands streamChat', () => {
    assert.match(ie, /const whatToAnswerCancellationToken = new AbortController\(\);/, 'a per-run controller, not the reassigned field');
    assert.match(ie, /this\.whatToAnswerLLM\.generateStream\([^\n]*whatToAnswerCancellationToken\.signal, wtaTruncation\)/);
    assert.match(wta, /const _wtaArgs: Parameters<LLMHelper\['streamChat'\]> = \[[^\n]*, packetScopes, abortSignal, /, 'the signal reaches streamChat as args[7]');
    const site = between(ie, '(this.llmHelper as any).textTurn(whatToAnswerCancellationToken.signal)', 'const regenUsable =');
    assert.doesNotMatch(site, READS, 'every route read goes through answerLlm');
    assert.match(site, /performanceHooks\(\{\s*llmHelper: answerLlm,/);
    assert.match(site, /\{ llmHelper: answerLlm, hasImages: isVisionTurn/);
    assert.match(site, /answerLlm\.recordAnswerFirstToken\?\.\(ms\)/);
    assert.match(site, /answerLlm\.hasEngineLevelRetry\(\) === true/);
  });
});
