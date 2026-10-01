/**
 * Behaviour that had no EXECUTING test (test audit, 2026-10-01).
 *
 * The audit of the vision work's tests found rules covered only by source-text
 * greps, by a stand-in the test wrote itself, or by reading a property instead
 * of running the code. Each test here runs the real path and observes what it
 * does: the one-time image test through the real VisionProbe and Direct Assist
 * boundary, the fallback engine with real attempt counting, and the pre-pass
 * registry's real rung list.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);
const electronPath = require.resolve('electron');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-test-gaps-'));
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: { app: { isReady: () => true, getPath: () => userData, getVersion: () => '0.0.0-test' }, safeStorage: { isEncryptionAvailable: () => false },
    BrowserWindow: { getAllWindows: () => [] } },
};
const { LLMHelper } = require(dist('LLMHelper.js'));
const { buildVisionProviders } = require(dist('services/screen/VisionProviderRegistry.js'));
const { VisionCapabilityStore, __setVisionCapabilityStore, normalizeVisionBaseURL } = require(dist('llm/visionCapabilityStore.js'));
const { renderDigitsPng, newVisionTestNumber } = require(dist('llm/visionTestImage.js'));

let store;
const realRandom = Math.random;
beforeEach(() => { store = new VisionCapabilityStore({ filePath: null }); __setVisionCapabilityStore(store); Math.random = () => 0.5; });
afterEach(() => { Math.random = realRandom; });
/** The number the one-time test draws while Math.random is pinned (and the one its confirmation attempt switches to). */
const SHOWN = newVisionTestNumber(() => 0.5);
const SHOWN_SECOND = String(1000 + ((Number(SHOWN) - 1000 + 4567) % 9000));
/** What a model that really reads images would answer for this file: the number in a test image, else a description. */
const see = (imagePath) => {
  const bytes = fs.readFileSync(imagePath);
  for (const n of [SHOWN, SHOWN_SECOND]) if (Buffer.compare(bytes, renderDigitsPng(n)) === 0) return n;
  return 'a screenshot of an editor';
};
const isTestImage = (p) => path.basename(p).startsWith('natively-vision-test-');
const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));

const TIERS = [
  { family: 'openai', tier1: 'gpt-5.4', tier2: 'gpt-5.4', tier3: 'gpt-5.4' },
  { family: 'claude', tier1: 'claude-sonnet-4-6', tier2: 'claude-sonnet-4-6', tier3: 'claude-sonnet-4-6' },
  { family: 'gemini_flash', tier1: 'gemini-3.8-flash', tier2: 'gemini-3.8-flash', tier3: 'gemini-3.8-flash' },
  { family: 'gemini_pro', tier1: 'gemini-3.1-pro-preview', tier2: 'gemini-3.1-pro-preview', tier3: 'gemini-3.1-pro-preview' },
];
function helper(state) {
  const h = Object.create(LLMHelper.prototype);
  Object.assign(h, {
    useOllama: false, customProvider: null, activeCurlProvider: null, currentModelId: '', ollamaModel: '', ollamaVisionModel: null,
    ollamaVisionCache: new Map(), ninerouterVisionModels: new Set(), configuredCustomProviders: [],
    isLocalOnlyMode: false, isProviderDisabled: () => false, deepseekPermanentlyDead: false,
    client: null, openaiClient: null, claudeClient: null, groqClient: null, deepseekClient: null,
    openrouterClient: null, litellmClient: null, nvidiaNimClient: null, ninerouterClient: null,
    litellmBaseURL: 'http://localhost:4000/v1', ninerouterBaseURL: 'http://localhost:20128/v1',
    visionHealth: new Map(), modelVersionManager: { getAllVisionTiers: () => TIERS, onModelError: async () => {} },
    codexCliConfig: { enabled: false, model: 'gpt-5.5' }, isCodexAvailable: () => false, antigravityFallbackModel: () => null,
    hasNatively: () => false, hasFluxionCredential: () => false, hasAgentRouterCredential: () => false,
    refreshOpenRouterVisionData: async () => {},
    assertOutboundImagesAllowed: () => {}, getDeniedOutboundScopes: () => [], directProviderHasCredential: () => true,
    ...state,
  });
  h.enableVisionProbing();
  return h;
}
const SCREENSHOT = path.join(userData, 'screen.png');
fs.writeFileSync(SCREENSHOT, renderDigitsPng('1234').subarray(0, 64));        // any bytes that are not a test image
const REQ = { userContent: 'what is this?', message: 'what is this?', imagePaths: [SCREENSHOT], systemPrompt: 's' };
const run = async (h) => { const out = []; for await (const piece of h.streamVisionWithFallback(REQ)) out.push(piece); return out; };

describe('the on-the-spot test, through the real probe and the real Direct Assist boundary', () => {
  test('an untested AgentRouter model that CAN read images: tested, saved under its wire id, then sent the screenshot', async () => {
    const calls = [];
    const h = helper({ currentModelId: 'agentrouter/brand-new', hasAgentRouterCredential: () => true });
    h.streamWithAgentRouter = async function* (_u, _s, imagePaths, _sig, model) {
      calls.push({ model: model ?? this.currentModelId, test: isTestImage(imagePaths[0]) });
      yield see(imagePaths[0]);
    };
    assert.deepEqual(await run(h), ['a screenshot of an editor']);
    assert.deepEqual(calls.map((c) => c.test), [true, false], 'one test image, then the screenshot');
    assert.equal(calls[0].model, 'agentrouter/brand-new');
    assert.equal(store.tested('agentrouter', '', 'brand-new')?.reads, true, 'saved under the WIRE id, where the resolver looks');
    assert.equal(fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('natively-vision-test-')).length, 0, 'no test image left behind');
  });
  test('one that cannot: two test images, saved as "no", the screenshot is never sent', async () => {
    const calls = [];
    const h = helper({ currentModelId: 'agentrouter/blind', hasAgentRouterCredential: () => true });
    h.streamWithAgentRouter = async function* (_u, _s, imagePaths) { calls.push(isTestImage(imagePaths[0])); yield '42'; };
    await assert.rejects(() => run(h), /No vision-capable provider configured/);
    assert.deepEqual(calls, [true, true], 'a wrong number is confirmed with a second image; the screenshot never goes');
    assert.equal(store.tested('agentrouter', '', 'blind')?.reads, false);
  });
  test('it JOINS a background test already running for that model: one test request, not two', async () => {
    const calls = []; let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const h = helper({ hasAgentRouterCredential: () => true });
    h.streamWithAgentRouter = async function* (_u, _s, imagePaths) {
      calls.push(isTestImage(imagePaths[0]));
      if (isTestImage(imagePaths[0])) await gate;
      yield see(imagePaths[0]);
    };
    h.setModel('agentrouter/brand-new');                       // starts the background test
    await settle(20);
    assert.deepEqual(calls, [true], 'the background test is in flight');
    const answer = run(h);                                      // a screenshot arrives meanwhile
    await settle(20);
    release();
    assert.deepEqual(await answer, ['a screenshot of an editor']);
    assert.deepEqual(calls, [true, false]);
  });
});

describe('a real screenshot refused as "no image input" — through the engine, to a real re-test', () => {
  test('a gateway model the name list calls capable: the next provider answers, the model is re-tested and not seated again', async () => {
    const seen = [];
    const h = helper({ currentModelId: 'fluxion/claude-opus-5', hasFluxionCredential: () => true, client: {} });
    h.streamWithFluxion = async function* (_u, _s, imagePaths) {
      seen.push(isTestImage(imagePaths[0]) ? 'test' : 'screenshot');
      throw Object.assign(new Error('404 No endpoints found that support image input'), { status: 404 });
    };
    h.streamWithGeminiModel = async function* () { yield 'gemini read it'; };
    assert.equal((await h.buildVisionChain(REQ))[0].id, 'fluxion', 'control: the name list seats it, leading');
    assert.deepEqual(await run(h), ['gemini read it']);
    await settle();
    assert.deepEqual(seen, ['screenshot', 'test'], 'the refusal triggered ONE forced test (an image refusal needs no confirmation)');
    assert.equal(store.tested('fluxion', '', 'claude-opus-5')?.reads, false);
    assert.ok(!(await h.buildVisionChain(REQ)).some((p) => p.id === 'fluxion'), 'the next screenshot does not go to it');
    assert.notEqual((h.visionHealth.get('fluxion')?.openUntil ?? 0) > Date.now() + 3600_000, true, 'and the refusal did not demote the rung for a day as a "retired model"');
  });
  test('a `<vendor>_selected` rung: the selected OpenAI model is re-tested, through the OpenAI adapter', async () => {
    const seen = [];
    const h = helper({ currentModelId: 'gpt-5.5', openaiClient: {} });
    h.streamWithOpenaiMultimodal = async function* (_u, imagePaths, _s, model) {
      seen.push(`${model}:${isTestImage(imagePaths[0]) ? 'test' : 'screenshot'}`);
      if (model === 'gpt-5.5') throw Object.assign(new Error('This model does not support image input'), { status: 400 });
      yield `seen by ${model}`;
    };
    assert.deepEqual(await run(h), ['seen by gpt-5.4']);
    await settle();
    // (The re-test starts as soon as the refusal is seen, beside the fallback rung.)
    assert.deepEqual([...seen].sort(), ['gpt-5.4:screenshot', 'gpt-5.5:screenshot', 'gpt-5.5:test']);
    assert.equal(store.tested('openai', '', 'gpt-5.5')?.reads, false);
  });
});

describe('a leading `<vendor>_selected` rung gets ONE attempt, counted by the engine', () => {
  test('a transient failure on the selected model is not retried: the vendor\'s fixed model follows at once', async () => {
    const attempts = { 'gpt-5.5': 0, 'gpt-5.4': 0 };
    const h = helper({ currentModelId: 'gpt-5.5', openaiClient: {} });
    h.maybeProbeSelectedVision = () => {};
    h.streamWithOpenaiMultimodal = async function* (_u, _imgs, _s, model) {
      attempts[model] += 1;
      if (model === 'gpt-5.5') throw Object.assign(new Error('503 Service Unavailable'), { status: 503 });
      yield 'seen';
    };
    assert.deepEqual(await run(h), ['seen']);
    assert.deepEqual(attempts, { 'gpt-5.5': 1, 'gpt-5.4': 1 }, 'the engine default is three attempts per rung');
  });
  test('control: when it is the only rung, it keeps the full attempts', async () => {
    let attempts = 0;
    const h = helper({ currentModelId: 'fluxion/claude-opus-5', hasFluxionCredential: () => true });
    h.maybeProbeSelectedVision = () => {};
    h.streamWithFluxion = async function* () { attempts += 1; throw Object.assign(new Error('503 Service Unavailable'), { status: 503 }); };
    await assert.rejects(() => run(h));
    assert.equal(attempts, 3);
  });
});

describe('the pre-pass gateway seats obey saved answers (run, not grepped)', () => {
  const credentials = (keys) => {
    const has = (k) => keys.includes(k) ? `key-${k}` : undefined;
    return {
      getNativelyApiKey: () => undefined, getOpenaiApiKey: () => undefined, getGeminiApiKey: () => undefined, getClaudeApiKey: () => undefined,
      getGroqApiKey: () => undefined, getDeepseekApiKey: () => has('deepseek'), getOpenrouterApiKey: () => has('openrouter'),
      getNvidiaNimApiKey: () => has('nvidia_nim'), getFluxionApiKey: () => has('fluxion'), getAgentRouterApiKey: () => has('agentrouter'),
      getLitellmBaseURL: () => keys.includes('litellm') ? 'http://localhost:4000/v1' : undefined,
      getNinerouterBaseURL: () => keys.includes('ninerouter') ? 'http://localhost:20128/v1' : undefined,
      getNinerouterVisionModels: () => credentials.ninerouterCatalogue ?? [], getAllCredentials: () => ({}),
    };
  };
  const seated = (model, provider, key) => {
    globalThis.__nativelyGetLLMHelper = () => ({
      getCurrentModelId: () => model, getActiveCustomProvider: () => null, getActiveCurlProvider: () => null,
      getDirectAssistSelection: () => ({ provider, model }), getFixedVisionModels: () => ({}), getOllamaRecordTarget: () => null,
    });
    return buildVisionProviders({ mode: 'vision_first', localOnly: false, scopeAllowsScreenshots: true }, credentials([key]))
      .some((p) => p.id === provider && p.isConfigured && p.supportsVision);
  };
  afterEach(() => { delete globalThis.__nativelyGetLLMHelper; credentials.ninerouterCatalogue = undefined; });

  for (const [provider, model, wire] of [
    ['fluxion', 'fluxion/glm-5.3', 'glm-5.3'], ['nvidia_nim', 'nvidia_nim/meta/some-model', 'meta/some-model'], ['openrouter', 'openrouter/x-ai/grok-4.7', 'x-ai/grok-4.7'],
  ]) {
    test(`${provider}: seated while unknown, not after a saved "can't read images", seated again after a pass`, () => {
      assert.equal(seated(model, provider, provider), true);
      store.recordTest(provider, '', wire, false);
      assert.equal(seated(model, provider, provider), false);
      store.recordTest(provider, '', wire, true);
      assert.equal(seated(model, provider, provider), true);
    });
  }
  test('OpenRouter: its catalogue\'s "text-only" unseats the model', () => {
    store.replaceProviderAnswers('openrouter', '', new Map([['x-ai/grok-4.7', false]]));
    assert.equal(seated('openrouter/x-ai/grok-4.7', 'openrouter', 'openrouter'), false);
  });
  test('LiteLLM: a result saved for THIS proxy counts; one saved for another proxy does not', () => {
    store.recordTest('litellm', normalizeVisionBaseURL('http://other-proxy:4000/v1'), 'internal', false);
    assert.equal(seated('litellm/internal', 'litellm', 'litellm'), true, 'another proxy\'s "no" is not this one\'s');
    store.recordTest('litellm', normalizeVisionBaseURL('http://localhost:4000/v1'), 'internal', false);
    assert.equal(seated('litellm/internal', 'litellm', 'litellm'), false);
  });
  test('9Router: never fetched seats; a fetched catalogue seats only what it lists', () => {
    assert.equal(seated('ninerouter/alicode/glm-5', 'ninerouter', 'ninerouter'), true);
    credentials.ninerouterCatalogue = ['gemini/gemini-3.6-flash'];
    assert.equal(seated('ninerouter/alicode/glm-5', 'ninerouter', 'ninerouter'), false);
    assert.equal(seated('ninerouter/gemini/gemini-3.6-flash', 'ninerouter', 'ninerouter'), true);
  });
  test('AgentRouter needs evidence; DeepSeek Pro needs a passed test', () => {
    assert.equal(seated('agentrouter/never-heard-of-it', 'agentrouter', 'agentrouter'), false);
    assert.equal(seated('agentrouter/claude-opus-5', 'agentrouter', 'agentrouter'), true);
    assert.equal(seated('deepseek-v4-pro', 'deepseek', 'deepseek'), false);
    store.recordTest('deepseek', '', 'deepseek-v4-pro', true);
    assert.equal(seated('deepseek-v4-pro', 'deepseek', 'deepseek'), true);
  });
});

describe('a model that FAILED a real image test is not seated because a catalogue lists it', () => {
  const { resolveVision } = require(dist('llm/visionResolver.js'));
  test('the resolver: a saved "no" beats a catalogue "yes" (OpenRouter, 9Router, LiteLLM); a catalogue "no" is unchanged', () => {
    const failed = { testedVision: () => false };
    assert.deepEqual(resolveVision({ provider: 'openrouter', model: 'openrouter/a/b' }, { ...failed, providerReportsVision: () => true }), { reads: 'no', source: 'test' });
    assert.deepEqual(resolveVision({ provider: 'litellm', model: 'litellm/m' }, { ...failed, providerReportsVision: () => true }), { reads: 'no', source: 'test' });
    assert.deepEqual(resolveVision({ provider: 'ninerouter', model: 'ninerouter/a/b' }, { ...failed, ninerouterVisionModels: ['a/b'] }), { reads: 'no', source: 'test' });
    assert.deepEqual(resolveVision({ provider: 'openrouter', model: 'openrouter/a/b' }, { testedVision: () => true, providerReportsVision: () => false }), { reads: 'no', source: 'provider' });
    assert.deepEqual(resolveVision({ provider: 'openrouter', model: 'openrouter/a/b' }, { providerReportsVision: () => true }), { reads: 'yes', source: 'provider' });
  });
  test('through the chain: OpenRouter lists the model as reading images, it refuses a real screenshot — it is not sent the next one', async () => {
    // Before: the catalogue's "yes" outranked the failed test, so the model was
    // seated again, refused again, and was re-tested every ten minutes forever.
    const seen = [];
    store.replaceProviderAnswers('openrouter', '', new Map([['x-ai/grok-4.7', true]]));
    const h = helper({ currentModelId: 'openrouter/x-ai/grok-4.7', openrouterClient: {}, client: {} });
    h.streamWithOpenRouter = async function* (_u, _s, imagePaths) {
      seen.push(isTestImage(imagePaths[0]) ? 'test' : 'screenshot');
      throw Object.assign(new Error('404 No endpoints found that support image input'), { status: 404 });
    };
    h.streamWithGeminiModel = async function* () { yield 'gemini read it'; };
    assert.deepEqual(await run(h), ['gemini read it']);
    await settle();
    assert.deepEqual(seen, ['screenshot', 'test'], 'one refusal, then one test');
    // Not seated at all — asserted on the chain itself: a rung that is merely
    // cooling after the refusal would also keep the next screenshot away for
    // a while, and then come back.
    assert.ok(!(await h.buildVisionChain(REQ)).some((p) => p.id === 'openrouter'), 'the catalogue\'s "yes" seated it again');
  });
});
