/**
 * The one-time image test, wired into LLMHelper (2026-10-01): asked through
 * the same adapter a real screenshot uses, only when it should be, and without
 * touching anything a real answer records.
 */
import { test, describe, beforeEach } from 'node:test';
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
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: { app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' }, safeStorage: { isEncryptionAvailable: () => false } },
};
const { LLMHelper } = require(dist('LLMHelper.js'));
const { VisionCapabilityStore, __setVisionCapabilityStore } = require(dist('llm/visionCapabilityStore.js'));

let store;
beforeEach(() => { store = new VisionCapabilityStore({ filePath: null }); __setVisionCapabilityStore(store); });

function helper(state = {}) {
  const h = Object.create(LLMHelper.prototype);
  Object.assign(h, {
    useOllama: false, customProvider: null, activeCurlProvider: null, currentModelId: '', ollamaModel: '',
    ollamaVisionCache: new Map(), ninerouterVisionModels: new Set(), configuredCustomProviders: [],
    isLocalOnlyMode: false, isProviderDisabled: () => false, litellmBaseURL: 'http://localhost:4000/v1', ninerouterBaseURL: 'http://localhost:20128/v1',
    assertOutboundImagesAllowed: () => {}, getDeniedOutboundScopes: () => [],
    visionHealth: new Map(), modelVersionManager: { getAllVisionTiers: () => [], onModelError: () => { throw new Error('a probe must never trigger discovery'); } },
    directProviderHasCredential: () => true,
    ...state,
  });
  return h;
}
/** Adapters stubbed to read the test image and answer with the digits they can "see" in its file name. */
function withAdapters(h, reply) {
  const seen = [];
  const adapter = (name) => async function* (_prompt, _system, imagePaths) {
    seen.push({ name, imagePaths: [...(imagePaths || [])], existed: (imagePaths || []).every((p) => fs.existsSync(p)) });
    const r = typeof reply === 'function' ? reply(name) : reply;
    if (r instanceof Error) throw r;
    yield r;
  };
  for (const name of ['streamWithFluxion', 'streamWithAgentRouter', 'streamWithOpenRouter', 'streamWithLiteLLM', 'streamWithNvidiaNim', 'streamWithNinerouter']) h[name] = adapter(name);
  h.streamWithOpenaiMultimodal = async function* (_prompt, imagePaths) { seen.push({ name: 'streamWithOpenaiMultimodal', imagePaths: [...imagePaths], existed: imagePaths.every((p) => fs.existsSync(p)) }); const r = typeof reply === 'function' ? reply('openai') : reply; if (r instanceof Error) throw r; yield r; };
  return seen;
}
const settle = () => new Promise((r) => setTimeout(r, 30));

describe('setModel starts a test only when it should', () => {
  test('an unknown Fluxion model is asked once through the Fluxion adapter, with a real image file, then cleaned up', async () => {
    const h = helper(); h.enableVisionProbing();
    const seen = withAdapters(h, new Error('404 No endpoints found that support image input'));
    h.setModel('fluxion/glm-5.3');
    await settle();
    assert.equal(seen.length, 1);
    assert.equal(seen[0].name, 'streamWithFluxion');
    assert.equal(seen[0].existed, true, 'the adapter was handed a file that exists');
    assert.equal(fs.existsSync(seen[0].imagePaths[0]), false, 'and it is removed afterwards');
    assert.deepEqual(store.tested('fluxion', '', 'glm-5.3')?.reads, false);
  });
  test('probing is off until enabled: tests and benchmarks never send one by accident', async () => {
    const h = helper(); const seen = withAdapters(h, 'x');
    h.setModel('fluxion/glm-5.3');
    await settle();
    assert.equal(seen.length, 0);
  });
  for (const [label, model] of [
    ['a model the name list already knows', 'fluxion/claude-opus-5'],
    ['a direct DeepSeek Flash model (the name list knows it)', 'deepseek-v4-flash'],
    ['a Groq model (its own table decides)', 'llama-3.3-70b-versatile'],
    ['Natively', 'natively'],
  ]) {
    test(`${label}: no test`, async () => {
      const h = helper(); h.enableVisionProbing(); const seen = withAdapters(h, 'x');
      h.setModel(model);
      await settle();
      assert.equal(seen.length, 0);
    });
  }
  test('direct DeepSeek Pro is unknown, so it is tested once through the DeepSeek adapter', async () => {
    const h = helper(); h.enableVisionProbing();
    const seen = [];
    h.streamWithDeepseek = async function* (_prompt, _system, model, _signal, imagePaths) { seen.push({ model, images: (imagePaths || []).length }); yield '42'; };
    h.setModel('deepseek-v4-pro');
    await settle();
    assert.equal(seen.length, 2, 'a wrong number is confirmed with a second, different image');
    assert.deepEqual(seen.map((s) => s.images), [1, 1]);
    assert.equal(store.tested('deepseek', '', 'deepseek-v4-pro')?.reads, false);
  });
  test('a model already tested this month is not asked again', async () => {
    const h = helper(); h.enableVisionProbing(); const seen = withAdapters(h, 'x');
    store.recordTest('fluxion', '', 'glm-5.3', true);
    h.setModel('fluxion/glm-5.3');
    await settle();
    assert.equal(seen.length, 0);
  });
  test('no credential, provider switched off, or screenshots not allowed out: nothing is sent', async () => {
    for (const state of [
      { directProviderHasCredential: () => false },
      { isProviderDisabled: (p) => p === 'fluxion' },
      { getDeniedOutboundScopes: () => ['screenshots'] },
      { assertOutboundImagesAllowed: () => { throw new Error('private vision'); } },
    ]) {
      const h = helper(state); h.enableVisionProbing(); const seen = withAdapters(h, 'x');
      h.setModel('fluxion/glm-5.3');
      await settle();
      assert.equal(seen.length, 0, JSON.stringify(Object.keys(state)));
      assert.equal(store.tested('fluxion', '', 'glm-5.3'), undefined);
    }
  });
  test('a self-hosted proxy is keyed by its address, spelled one way', async () => {
    const h = helper({ litellmBaseURL: 'http://localhost:4000/v1/' }); h.enableVisionProbing();
    withAdapters(h, new Error('this model does not support image input'));
    h.setModel('litellm/internal-model');
    await settle();
    assert.equal(store.tested('litellm', 'http://localhost:4000', 'internal-model')?.reads, false);
  });
});

describe('a test leaves no trace in what real answers record', () => {
  test('no vision health entry, no discovery', async () => {
    const h = helper(); h.enableVisionProbing();
    withAdapters(h, new Error('404 No endpoints found that support image input'));
    h.setModel('fluxion/glm-5.3');
    await settle();
    assert.equal(h.visionHealth.size, 0);
  });
});

describe("the test goes through Direct Assist's own boundary", () => {
  const request = (provider, model, imagePath) => ({ requestId: 'r', selection: { provider, model }, systemPrompt: 's', userPrompt: 'What number is shown in this image?', imagePaths: [imagePath] });
  const image = () => { const p = path.join(os.tmpdir(), `vpw-${process.pid}-${Math.random().toString(36).slice(2)}.png`); fs.writeFileSync(p, 'x'); return p; };
  test('a normal Direct Assist request for an unknown model is still refused; only the probe option passes that one gate', async () => {
    const h = helper(); const seen = withAdapters(h, 'ok'); const img = image();
    await assert.rejects(async () => { for await (const _ of h.streamDirectAssistFrozen(request('openai', 'gpt-next-unknown', img), null, null)) { /* drain */ } }, /does not support image input/);
    assert.equal(seen.length, 0);
    for await (const _ of h.streamDirectAssistFrozen(request('openai', 'gpt-next-unknown', img), null, null, undefined, undefined, { visionProbe: true })) { /* drain */ }
    assert.equal(seen.at(-1).name, 'streamWithOpenaiMultimodal');
    fs.rmSync(img, { force: true });
  });
  test('the probe option skips no privacy gate: provider off, private vision, screenshots scope', async () => {
    const img = image();
    for (const [state, pattern] of [
      [{ isProviderDisabled: (p) => p === 'fluxion' }, /./],
      [{ assertOutboundImagesAllowed: () => { throw new Error('private vision'); } }, /private vision/],
      [{ getDeniedOutboundScopes: () => ['screenshots'] }, /disabled for cloud providers/],
    ]) {
      const h = helper(state); const seen = withAdapters(h, 'ok');
      await assert.rejects(async () => { for await (const _ of h.streamDirectAssistFrozen(request('fluxion', 'fluxion/glm-5.3', img), null, null, undefined, undefined, { visionProbe: true })) { /* drain */ } }, pattern);
      assert.equal(seen.length, 0, 'nothing reached an adapter');
    }
    fs.rmSync(img, { force: true });
  });
});
describe('a saved test result decides the seat (phase 3)', () => {
  async function chain(model, extra = {}) {
    const opened = [];
    const stub = (name) => async function* () { opened.push(name); yield 'ok'; };
    const h = helper({
      currentModelId: model, client: {}, openaiClient: null, claudeClient: null, groqClient: null,
      litellmClient: {}, nvidiaNimClient: {}, hasFluxionCredential: () => true, hasAgentRouterCredential: () => true,
      codexCliConfig: { enabled: false }, isCodexAvailable: () => false, antigravityFallbackModel: () => null, hasNatively: () => false,
      streamWithLiteLLM: stub('litellm'), streamWithNvidiaNim: stub('nvidia_nim'), streamWithFluxion: stub('fluxion'),
      streamWithAgentRouter: stub('agentrouter'), streamWithGeminiModel: stub('gemini'), ...extra,
    });
    for await (const _ of h.streamVisionWithFallback({ userContent: 'u', message: 'm', imagePaths: ['/tmp/x.png'], systemPrompt: 's' })) { /* drain */ }
    return opened;
  }
  for (const [provider, model, base] of [['fluxion', 'fluxion/glm-5.3', ''], ['nvidia_nim', 'nvidia_nim/meta/text-model', ''], ['litellm', 'litellm/internal-model', 'http://localhost:4000']]) {
    test(`${provider}: tested "no" → another provider answers; untested → the selected model still leads`, async () => {
      assert.equal((await chain(model))[0], provider, 'untested: seated as before');
      store.recordTest(provider, base, model.slice(provider.length + 1), false);
      const opened = await chain(model);
      assert.ok(!opened.includes(provider), `opened: ${opened}`);
      assert.equal(opened[0], 'gemini');
    });
  }
  test('AgentRouter: an unknown model is not seated until its test says yes', async () => {
    assert.ok(!(await chain('agentrouter/glm-5.3')).includes('agentrouter'));
    store.recordTest('agentrouter', '', 'glm-5.3', true);
    assert.equal((await chain('agentrouter/glm-5.3'))[0], 'agentrouter');
  });
  test('Direct Assist: a gateway model tested "no" is refused; untested still forwards; a direct model tested "yes" forwards', () => {
    const h = helper();
    assert.equal(h.directSelectionSupportsImages({ provider: 'fluxion', model: 'fluxion/glm-5.3' }, null, null), true);
    store.recordTest('fluxion', '', 'glm-5.3', false);
    assert.equal(h.directSelectionSupportsImages({ provider: 'fluxion', model: 'fluxion/glm-5.3' }, null, null), false);
    assert.equal(h.directSelectionSupportsImages({ provider: 'openai', model: 'gpt-next-unknown' }, null, null), false);
    store.recordTest('openai', '', 'gpt-next-unknown', true);
    assert.equal(h.directSelectionSupportsImages({ provider: 'openai', model: 'gpt-next-unknown' }, null, null), true);
  });
  test('Direct Assist: untested LiteLLM, NVIDIA NIM and 9Router models keep their image; a 9Router model its catalogue marks text-only is refused', () => {
    const h = helper();
    for (const [provider, model] of [['litellm', 'litellm/internal-model'], ['nvidia_nim', 'nvidia_nim/meta/text-model'], ['ninerouter', 'ninerouter/alicode/glm-5']]) {
      assert.equal(h.directSelectionSupportsImages({ provider, model }, null, null), true, provider);
    }
    // 9Router answers HTTP 200 for an image sent to a text-only model, so
    // forwarding a catalogued "no" was a blind answer.
    const catalogued = helper({ ninerouterVisionModels: new Set(['gemini/gemini-3.6-flash']) });
    assert.equal(catalogued.directSelectionSupportsImages({ provider: 'ninerouter', model: 'ninerouter/alicode/glm-5' }, null, null), false);
    assert.equal(catalogued.directSelectionSupportsImages({ provider: 'ninerouter', model: 'ninerouter/gemini/gemini-3.6-flash' }, null, null), true);
  });
});

describe('a real screenshot refused as image-unsupported re-tests the model', () => {
  test('the engine reports it, and the chain forces a re-test of the selection', async () => {
    const { runStreamingVisionFallback, DEFAULT_VISION_FALLBACK_CONFIG } = require(dist('llm/visionStreamFallback.js'));
    const reported = [];
    const refuse = { id: 'fluxion', name: 'Fluxion (glm-5.3)', isLocal: false, priority: 0, open: async function* () { throw new Error('this model does not support image input'); } };
    const ok = { id: 'gemini_flash', name: 'Gemini', isLocal: false, priority: 1, open: async function* () { yield 'ok'; } };
    for await (const _ of runStreamingVisionFallback([refuse, ok], { ...DEFAULT_VISION_FALLBACK_CONFIG, hedgeEnabled: false }, new Map(), { onNoVision: (id) => reported.push(id), sleep: async () => {} })) { /* drain */ }
    assert.deepEqual(reported, ['fluxion']);
  });
  test('registry rungs pass the test fact', () => {
    const src = fs.readFileSync(path.join(__dirname, '../screen/VisionProviderRegistry.ts'), 'utf8');
    for (const fn of ['litellm', 'nvidiaNim', 'fluxion', 'agentrouter', 'ninerouter', 'openrouter']) {
      const start = src.indexOf(`function ${fn}(`);
      const body = src.slice(start, src.indexOf('\n}\n', start));
      assert.match(body, /gatewaySeatReadsImages\(/, fn);
      assert.match(body, /registryVisionFacts\(/, fn);
    }
  });
});

describe("LiteLLM's supports_vision", () => {
  test('only true is saved; false and missing stay unknown', async () => {
    const h = helper({ litellmBaseURL: 'http://localhost:4000/v1', litellmApiKey: 'k', litellmModelBudgetsFetchedAt: 0, litellmModelBudgetsFetch: null, litellmModelBudgets: new Map(), litellmModelInputCaps: new Map() });
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: [
      { model_name: 'internal-mm', model_info: { supports_vision: true } },
      { model_name: 'plain', model_info: { supports_vision: false } },
      { model_name: 'unset', model_info: {} },
    ] }) });
    try { await h.refreshLitellmModelBudgets(); } finally { globalThis.fetch = realFetch; }
    assert.equal(store.answer('litellm', 'http://localhost:4000', 'internal-mm'), true);
    assert.equal(store.answer('litellm', 'http://localhost:4000', 'plain'), undefined);
    assert.equal(store.answer('litellm', 'http://localhost:4000', 'unset'), undefined);
    assert.equal(h.getCapabilities.call(helper({ currentModelId: 'litellm/internal-mm', litellmBaseURL: 'http://localhost:4000/v1' })).supportsImages, true);
  });
});

describe('startup', () => {
  test('ProcessingHelper enables the test before it restores the saved model, so that selection is tested too', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../ProcessingHelper.ts'), 'utf8');
    const enable = src.indexOf('this.llmHelper.enableVisionProbing()');
    const restore = src.indexOf('this.llmHelper.setModel(defaultModel, allProviders)');
    assert.ok(enable > 0 && restore > 0 && enable < restore);
  });
});
