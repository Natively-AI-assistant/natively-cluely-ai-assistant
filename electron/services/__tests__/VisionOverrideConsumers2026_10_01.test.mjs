/**
 * "Reads images: Auto / On / Off" reaches every screenshot path (phase 4).
 *
 * The resolver tests (electron/llm/__tests__/VisionOverride…) prove the rule;
 * these run the REAL consumers — the chat screenshot chain, Direct Assist, the
 * pre-pass registry, the Ollama model check and the one-time image test — and
 * observe what each would send, and to whom.
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
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-override-consumers-'));
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: { app: { isReady: () => true, getPath: () => userData, getVersion: () => '0.0.0-test' }, safeStorage: { isEncryptionAvailable: () => false },
    BrowserWindow: { getAllWindows: () => [] } },
};
const { LLMHelper } = require(dist('LLMHelper.js'));
const { buildVisionProviders } = require(dist('services/screen/VisionProviderRegistry.js'));
const { VisionCapabilityStore, __setVisionCapabilityStore } = require(dist('llm/visionCapabilityStore.js'));

let store;
beforeEach(() => { store = new VisionCapabilityStore({ filePath: null }); __setVisionCapabilityStore(store); });

const TIERS = [
  { family: 'openai', tier1: 'gpt-5.4', tier2: 'gpt-5.4', tier3: 'gpt-5.4' },
  { family: 'claude', tier1: 'claude-sonnet-4-6', tier2: 'claude-sonnet-4-6', tier3: 'claude-sonnet-4-6' },
  { family: 'gemini_flash', tier1: 'gemini-3.8-flash', tier2: 'gemini-3.8-flash', tier3: 'gemini-3.8-flash' },
  { family: 'gemini_pro', tier1: 'gemini-3.1-pro-preview', tier2: 'gemini-3.1-pro-preview', tier3: 'gemini-3.1-pro-preview' },
];
const KEYS = {
  openai: { openaiClient: {} }, claude: { claudeClient: {} }, gemini: { client: {} }, groq: { groqClient: {} },
  natively: { hasNatively: () => true }, deepseek: { deepseekClient: {} }, openrouter: { openrouterClient: {} },
  fluxion: { hasFluxionCredential: () => true }, agentrouter: { hasAgentRouterCredential: () => true },
  codex: { isCodexAvailable: () => true },
  antigravity: { antigravityFallbackModel() { return this.currentModelId.startsWith('antigravity:') ? this.currentModelId.slice('antigravity:'.length) : 'gemini-3-pro-high'; } },
};
function helper(keys, state) {
  const h = Object.create(LLMHelper.prototype);
  Object.assign(h, {
    useOllama: false, customProvider: null, activeCurlProvider: null, currentModelId: '', ollamaModel: '', ollamaVisionModel: null,
    ollamaVisionCache: new Map(), ninerouterVisionModels: new Set(['openai/gpt-5']), configuredCustomProviders: [],
    isLocalOnlyMode: false, isProviderDisabled: () => false, deepseekPermanentlyDead: false,
    client: null, openaiClient: null, claudeClient: null, groqClient: null, deepseekClient: null,
    openrouterClient: null, litellmClient: null, nvidiaNimClient: null, ninerouterClient: null,
    litellmBaseURL: 'http://localhost:4000/v1', ninerouterBaseURL: 'http://localhost:20128/v1',
    visionHealth: new Map(), modelVersionManager: { getAllVisionTiers: () => TIERS },
    codexCliConfig: { enabled: false, model: 'gpt-5.5' }, isCodexAvailable: () => false, antigravityFallbackModel: () => null,
    hasNatively: () => false, hasFluxionCredential: () => false, hasAgentRouterCredential: () => false,
    maybeProbeSelectedVision: () => {}, refreshOpenRouterVisionData: async () => {},
    assertOutboundImagesAllowed: () => {}, getDeniedOutboundScopes: () => [], directProviderHasCredential: () => true,
  });
  for (const k of keys) Object.assign(h, KEYS[k]);
  Object.assign(h, state);
  return h;
}
const REQ = { userContent: 'u', message: 'm', imagePaths: ['/tmp/x.png'], systemPrompt: 's' };
const chain = async (h) => {
  try { return (await h.buildVisionChain(REQ)).map((p) => p.id); }
  catch (e) { return [`THROWS: ${e.message}`]; }
};

describe('the chat screenshot chain', () => {
  test('Off on the SELECTED model: its own rung is gone, the vendor\'s fixed model still answers', async () => {
    const h = helper(['openai', 'gemini'], { currentModelId: 'gpt-5.5' });
    assert.equal((await chain(h))[0], 'openai_selected', 'control: on Auto the selection leads');
    store.setOverride('openai', '', 'gpt-5.5', false);
    const ids = await chain(h);
    assert.ok(!ids.includes('openai_selected'), ids.join());
    assert.ok(ids.includes('openai') && ids.includes('gemini_flash'), ids.join());
  });
  test('Off is about the MODEL: a fixed fallback rung that would send to it is gone too', async () => {
    const h = helper(['claude', 'gemini', 'openai', 'groq', 'natively'], { currentModelId: 'claude-opus-5' });
    const before = await chain(h);
    for (const id of ['gemini_flash', 'gemini_flash_lite', 'openai', 'claude', 'groq', 'natively']) assert.ok(before.includes(id), `control: ${id} is seated on Auto`);
    store.setOverride('gemini', '', 'gemini-3.8-flash', false);
    store.setOverride('openai', '', 'gpt-5.4', false);
    store.setOverride('natively', '', 'natively', false);
    const after = await chain(h);
    assert.deepEqual(before.filter((id) => !after.includes(id)).sort(), ['gemini_flash', 'natively', 'openai']);
    assert.equal(after[0], 'claude_selected', 'and the selection still leads');
  });
  test('Off on the selected Gemini model that IS a fixed rung: that rung is gone, the other two remain', async () => {
    const h = helper(['gemini'], { currentModelId: 'gemini-3.8-flash' });
    store.setOverride('gemini', '', 'gemini-3.8-flash', false);
    assert.deepEqual((await chain(h)).sort(), ['gemini_flash_lite', 'gemini_pro']);
  });
  test('Off on Codex and Antigravity models', async () => {
    const h = helper(['codex', 'antigravity', 'gemini'], { currentModelId: 'gemini-3.8-flash' });
    const before = await chain(h);
    assert.ok(before.includes('codex-cli') && before.includes('antigravity'), before.join());
    store.setOverride('codex-cli', '', 'gpt-5.5', false);
    store.setOverride('antigravity', '', 'antigravity:gemini-3-pro-high', false);
    const after = await chain(h);
    assert.ok(!after.includes('codex-cli') && !after.includes('antigravity'), after.join());
  });
  test('On for a model the name list calls text-only: it reads its own screenshot, first', async () => {
    const h = helper(['openai', 'gemini'], { currentModelId: 'gpt-3.5-turbo' });
    assert.ok(!(await chain(h)).includes('openai_selected'), 'control: not seated on Auto');
    store.setOverride('openai', '', 'gpt-3.5-turbo', true);
    assert.equal((await chain(h))[0], 'openai_selected');
  });
  test('On for a gateway model with a saved "can\'t read images": seated again, and leading', async () => {
    const h = helper(['fluxion', 'gemini'], { currentModelId: 'fluxion/glm-5.3' });
    store.recordTest('fluxion', '', 'glm-5.3', false);
    assert.ok(!(await chain(h)).includes('fluxion'), 'control: the saved test unseats it');
    store.setOverride('fluxion', '', 'glm-5.3', true);
    assert.equal((await chain(h))[0], 'fluxion');
  });
  test('On for an AgentRouter model nothing is known about, and for DeepSeek Pro', async () => {
    const a = helper(['agentrouter'], { currentModelId: 'agentrouter/brand-new' });
    assert.match((await chain(a))[0], /^THROWS/);
    store.setOverride('agentrouter', '', 'brand-new', true);
    assert.deepEqual(await chain(a), ['agentrouter']);
    const d = helper(['deepseek'], { currentModelId: 'deepseek-v4-pro' });
    store.setOverride('deepseek', '', 'deepseek-v4-pro', true);
    assert.deepEqual(await chain(d), ['deepseek']);
  });
  test('nothing left because the user switched it off: the message says so, and names where', async () => {
    const h = helper(['openrouter'], { currentModelId: 'openrouter/openai/gpt-4o' });
    assert.deepEqual(await chain(h), ['openrouter']);
    store.setOverride('openrouter', '', 'openai/gpt-4o', false);
    const [msg] = await chain(h);
    assert.match(msg, /^THROWS: No vision-capable provider configured\./);
    assert.match(msg, /switched off for the selected model \(openai\/gpt-4o\) in Settings › AI Providers/);
    assert.doesNotMatch(msg, /proxy is reachable|lists it as text-only|tested it/);
  });
});

describe('Direct Assist', () => {
  const supports = (h) => h.directSelectionSupportsImages(h.getDirectAssistSelection(), h.customProvider, h.activeCurlProvider);
  test('Off refuses a model that reads images; On forwards one the name list calls text-only', () => {
    const g = helper(['gemini'], { currentModelId: 'gemini-3.8-flash' });
    assert.equal(supports(g), true);
    store.setOverride('gemini', '', 'gemini-3.8-flash', false);
    assert.equal(supports(g), false);
    const o = helper(['openai'], { currentModelId: 'gpt-3.5-turbo' });
    assert.equal(supports(o), false);
    store.setOverride('openai', '', 'gpt-3.5-turbo', true);
    assert.equal(supports(o), true);
  });
  test('Off for Natively, Codex and Antigravity selections (their route always carries an image)', () => {
    for (const [keys, id, provider, model] of [
      [['natively'], 'natively', 'natively', 'natively'],
      [['antigravity'], 'antigravity:claude-opus-5', 'antigravity', 'antigravity:claude-opus-5'],
    ]) {
      const h = helper(keys, { currentModelId: id });
      assert.equal(supports(h), true, id);
      store.setOverride(provider, '', model, false);
      assert.equal(supports(h), false, id);
    }
  });
});

describe('the one-time image test', () => {
  function probing(model) {
    const h = helper(['fluxion'], { currentModelId: model });
    delete h.maybeProbeSelectedVision;                       // the real one
    const asked = [];
    h.getVisionProbe = () => ({ ensure: async (s, opts) => { asked.push({ ...s, force: !!opts?.force }); return 'unknown'; } });
    h.enableVisionProbing();
    return { h, asked };
  }
  test('Auto: an unknown model is tested', () => {
    const { h, asked } = probing('fluxion/glm-5.3');
    h.maybeProbeSelectedVision();
    assert.equal(asked.length, 1);
  });
  test('On or Off: no test image is sent, not even the forced re-test after a refusal', () => {
    for (const value of [true, false]) {
      const { h, asked } = probing('fluxion/glm-5.3');
      store.setOverride('fluxion', '', 'glm-5.3', value);
      h.maybeProbeSelectedVision();
      h.maybeProbeSelectedVision({ force: true });
      assert.deepEqual(asked, [], value ? 'On' : 'Off');
    }
  });
});

describe('Ollama', () => {
  test('the user\'s answer comes before /api/show and the name list, and no request is made for it', async () => {
    const h = helper([], { useOllama: true, ollamaModel: 'qwen2.5:4b', ollamaUrl: 'http://127.0.0.1:1' });
    const realFetch = globalThis.fetch; let calls = 0;
    globalThis.fetch = async () => { calls += 1; throw new Error('no daemon'); };
    try {
      store.setOverride('ollama', '', 'qwen2.5:4b', true);
      assert.equal(await h.probeOllamaVision('qwen2.5:4b'), true);
      store.setOverride('ollama', '', 'llava:7b', false);
      h.ollamaVisionCache.set('llava:7b', true);
      assert.equal(await h.probeOllamaVision('llava:7b'), false, 'Off beats what /api/show said');
      assert.equal(calls, 0);
    } finally { globalThis.fetch = realFetch; }
  });
});

describe('the screen pre-pass', () => {
  const credentials = (keys) => {
    const has = (k) => keys.includes(k) ? `key-${k}` : undefined;
    return {
      getNativelyApiKey: () => has('natively'), getOpenaiApiKey: () => has('openai'), getGeminiApiKey: () => has('gemini'),
      getClaudeApiKey: () => has('claude'), getGroqApiKey: () => has('groq'), getDeepseekApiKey: () => has('deepseek'),
      getOpenrouterApiKey: () => has('openrouter'), getNvidiaNimApiKey: () => has('nvidia_nim'), getFluxionApiKey: () => has('fluxion'),
      getAgentRouterApiKey: () => has('agentrouter'), getLitellmBaseURL: () => undefined, getNinerouterBaseURL: () => undefined,
      getNinerouterVisionModels: () => [], getAllCredentials: () => ({}),
    };
  };
  const install = (model, provider, extra = {}) => {
    globalThis.__nativelyGetLLMHelper = () => ({
      getCurrentModelId: () => model, getActiveCustomProvider: () => null, getActiveCurlProvider: () => null,
      getDirectAssistSelection: () => ({ provider, model }), getFixedVisionModels: () => ({ openai: 'gpt-5.4', claude: 'claude-sonnet-4-6' }),
      getOllamaRecordTarget: () => null, ...extra,
    });
  };
  const eligible = (keys) => buildVisionProviders({ mode: 'vision_first', localOnly: false, scopeAllowsScreenshots: true }, credentials(keys))
    .filter((p) => p.isConfigured && p.supportsVision).map((p) => p.id);

  test('Off on a fixed pre-pass model takes that rung out, and only that rung', () => {
    install('claude-opus-5', 'claude');
    const keys = ['natively', 'openai', 'gemini', 'claude', 'groq'];
    const before = eligible(keys);
    const flashLite = buildVisionProviders({ mode: 'vision_first', localOnly: false, scopeAllowsScreenshots: true }, credentials(keys)).find((p) => p.id === 'gemini_flash_lite').modelId;
    store.setOverride('gemini', '', flashLite, false);
    store.setOverride('openai', '', 'gpt-5.4', false);
    assert.deepEqual(before.filter((id) => !eligible(keys).includes(id)).sort(), ['gemini_flash_lite', 'openai']);
  });
  test('the gateway seats: On seats an unknown AgentRouter model, Off unseats a selected OpenRouter one', () => {
    install('agentrouter/brand-new', 'agentrouter');
    assert.ok(!eligible(['agentrouter']).includes('agentrouter'));
    store.setOverride('agentrouter', '', 'brand-new', true);
    assert.ok(eligible(['agentrouter']).includes('agentrouter'));
    install('openrouter/openai/gpt-4o', 'openrouter');
    assert.ok(eligible(['openrouter']).includes('openrouter'));
    store.setOverride('openrouter', '', 'openai/gpt-4o', false);
    assert.ok(!eligible(['openrouter']).includes('openrouter'));
  });
});

describe('what Settings is told, and what it can change', () => {
  const settings = (state = {}) => {
    const h = helper(['fluxion', 'openrouter', 'gemini', 'openai'], { currentModelId: 'gemini-3.8-flash', ollamaUrl: 'http://127.0.0.1:11434', ...state });
    delete h.maybeProbeSelectedVision;
    h.enableVisionProbing();
    return h;
  };
  test('picker ids are classified by main: vendor, gateway, Ollama, Codex, Antigravity, Natively; a custom id has no row control', () => {
    const h = settings();
    const { states } = { states: h.describeVisionModels(['gemini-3.8-flash', 'fluxion/glm-5.3', 'openrouter/openai/gpt-4o', 'ollama-llava:7b', 'codex-cli', 'codex-cli:gpt-5.5', 'antigravity:claude-opus-5', 'natively', 'a-custom-uuid', '', 42]) };
    assert.deepEqual(Object.fromEntries(Object.entries(states).map(([id, s]) => [id, s && s.provider])), {
      'gemini-3.8-flash': 'gemini', 'fluxion/glm-5.3': 'fluxion', 'openrouter/openai/gpt-4o': 'openrouter', 'ollama-llava:7b': 'ollama',
      'codex-cli': 'codex-cli', 'codex-cli:gpt-5.5': 'codex-cli', 'antigravity:claude-opus-5': 'antigravity', natively: 'natively',
      'a-custom-uuid': null, '': null,
    });
    assert.deepEqual(states['gemini-3.8-flash'], { setting: 'auto', reads: 'yes', source: 'names', auto: { reads: 'yes', source: 'names' }, provider: 'gemini', checking: false, testable: true });
    assert.deepEqual(states['fluxion/glm-5.3'], { setting: 'auto', reads: 'unknown', source: null, auto: { reads: 'unknown', source: null }, provider: 'fluxion', checking: false, testable: true });
    assert.equal(states['ollama-llava:7b'].testable, false, 'Ollama is asked through /api/show, not the image test');
  });
  test('ids that several providers could claim go to the one their prefix names — for a row and for the live selection alike', () => {
    const CASES = {
      'litellm/openai/gpt-4o': 'litellm', 'nvidia_nim/openai/gpt-oss-120b': 'nvidia_nim', 'openrouter/anthropic/claude-sonnet-5': 'openrouter',
      'fluxion/claude-opus-5': 'fluxion', 'fluxion/gemini-3.8-flash': 'fluxion', 'agentrouter/gpt-6-astra': 'agentrouter',
      'ninerouter/gemini/gemini-3.6-flash': 'ninerouter', 'qwen/qwen3.8-27b': 'groq', 'gpt-5.5': 'openai', 'claude-opus-5': 'claude',
      'deepseek-v4-pro': 'deepseek', 'models/gemini-3.8-flash': 'gemini',
    };
    const h = settings();
    const states = h.describeVisionModels(Object.keys(CASES));
    for (const [id, provider] of Object.entries(CASES)) {
      assert.equal(states[id]?.provider, provider, `row: ${id}`);
      h.currentModelId = id;
      assert.deepEqual(h.getDirectAssistSelection(), { provider, model: id }, `selection: ${id}`);
    }
    h.currentModelId = 'no-such-family-model';
    assert.throws(() => h.getDirectAssistSelection(), /no Direct Assist adapter/);
    h.currentModelId = 'codex-cli:gpt-5.5';
    assert.equal(h.getDirectAssistSelection().provider, 'codex-cli');
  });
  test('a saved test shows as the Auto answer with its date; On overrules it and Auto keeps saying what it would be', () => {
    const h = settings();
    store.recordTest('fluxion', '', 'glm-5.3', false);
    const before = h.describeVisionModels(['fluxion/glm-5.3'])['fluxion/glm-5.3'];
    assert.equal(before.reads, 'no'); assert.equal(before.source, 'test'); assert.equal(typeof before.auto.testedAt, 'number');
    const after = h.setVisionSetting('fluxion/glm-5.3', 'on');
    assert.deepEqual({ setting: after.setting, reads: after.reads, source: after.source, auto: after.auto.reads, autoSource: after.auto.source },
      { setting: 'on', reads: 'yes', source: 'override', auto: 'no', autoSource: 'test' });
    assert.equal(store.override('fluxion', '', 'glm-5.3'), true, 'saved under the wire id');
    assert.equal(h.setVisionSetting('fluxion/glm-5.3', 'auto').setting, 'auto');
    assert.equal(store.override('fluxion', '', 'glm-5.3'), undefined);
  });
  test('LiteLLM and 9Router answers are saved under the proxy address the helper is using', () => {
    const h = settings({ litellmBaseURL: 'http://localhost:4000/v1' });
    h.setVisionSetting('litellm/internal', 'off');
    assert.equal(store.override('litellm', 'http://localhost:4000', 'internal'), false);
    assert.equal(h.describeVisionModels(['litellm/internal'])['litellm/internal'].setting, 'off');
    h.litellmBaseURL = 'http://other:4000/v1';
    assert.equal(h.describeVisionModels(['litellm/internal'])['litellm/internal'].setting, 'auto', 'another proxy is another model');
  });
  test('an id with no row control, or a setting that is not one of the three, changes nothing', () => {
    const h = settings();
    assert.equal(h.setVisionSetting('a-custom-uuid', 'on'), null);
    assert.equal(h.setVisionSetting('gemini-3.8-flash', 'maybe'), null);
    assert.equal(store.override('gemini', '', 'gemini-3.8-flash'), undefined);
  });
  test('changing an Ollama model\'s answer forgets the remembered "which installed model reads images"', () => {
    const h = settings({ useOllama: true, ollamaModel: 'qwen2.5:4b', ollamaVisionModel: 'llava:7b', ollamaVisionNegativeUntil: Date.now() + 60_000 });
    h.setVisionSetting('ollama-llava:7b', 'off');
    assert.equal(h.ollamaVisionModel, null);
    assert.equal(h.ollamaVisionNegativeUntil, 0);
  });
  test('every change tells main\'s listener, so open windows ask again', () => {
    const h = settings(); let told = 0;
    h.onVisionCapabilityChanged(() => { told += 1; });
    h.setVisionSetting('fluxion/glm-5.3', 'off');
    assert.equal(told, 1);
    h.onVisionCapabilityChanged(() => { throw new Error('a listener must never break a turn'); });
    assert.equal(h.setVisionSetting('fluxion/glm-5.3', 'auto').setting, 'auto');
  });

  describe('"Test again"', () => {
    const withProbe = (h, outcome) => {
      const asked = [];
      const { VisionProbe } = require(dist('llm/visionProbe.js'));
      const wire = (s) => s.model.startsWith(`${s.provider}/`) ? s.model.slice(s.provider.length + 1) : s.model;
      h.visionProbe = new VisionProbe({
        ask: async function* (s) { asked.push(s.model); if (outcome instanceof Error) throw outcome; yield outcome; },
        writeImage: () => path.join(os.tmpdir(), 'x.png'), removeImage: () => {},
        recorded: (s) => store.tested(s.provider, '', wire(s)),
        record: (s, reads) => store.recordTest(s.provider, '', wire(s), reads),
        keyOf: (s) => `${s.provider}|${wire(s)}`,
        random: () => 0.5,
      });
      return asked;
    };
    test('a saved "can\'t read images" is asked again, and a pass replaces it — for a model that is NOT the selected one', async () => {
      const h = settings();
      store.recordTest('fluxion', '', 'glm-5.3', false);
      const { newVisionTestNumber } = require(dist('llm/visionTestImage.js'));
      const asked = withProbe(h, newVisionTestNumber(() => 0.5));
      const state = await h.retestVision('fluxion/glm-5.3');
      assert.deepEqual(asked, ['fluxion/glm-5.3']);
      assert.deepEqual({ reads: state.reads, source: state.source, checking: state.checking }, { reads: 'yes', source: 'test', checking: false });
    });
    test('an inconclusive re-test leaves the model "not known", not confirmed as before', async () => {
      const h = settings();
      store.recordTest('fluxion', '', 'glm-5.3', false);
      withProbe(h, new Error('503 upstream unavailable'));
      const state = await h.retestVision('fluxion/glm-5.3');
      assert.deepEqual({ reads: state.reads, source: state.source }, { reads: 'unknown', source: null });
      assert.equal(store.tested('fluxion', '', 'glm-5.3'), undefined);
    });
    test('nothing is sent when the user answered for the model, in local-only mode, without a key, or when screenshots stay on this device', async () => {
      for (const [label, prepare] of [
        ['Off', (h) => store.setOverride('fluxion', '', 'glm-5.3', false)],
        ['On', (h) => store.setOverride('fluxion', '', 'glm-5.3', true)],
        ['local-only', (h) => { h.isLocalOnlyMode = true; }],
        ['no key', (h) => { h.directProviderHasCredential = () => false; }],
        ['provider off', (h) => { h.isProviderDisabled = (p) => p === 'fluxion'; }],
        ['screenshots kept on device', (h) => { h.assertOutboundImagesAllowed = () => { throw new Error('private'); }; }],
        ['screenshots scope denied', (h) => { h.getDeniedOutboundScopes = () => ['screenshots']; }],
      ]) {
        store = new VisionCapabilityStore({ filePath: null }); __setVisionCapabilityStore(store);
        const h = settings(); prepare(h);
        const asked = withProbe(h, '7392');
        const state = await h.retestVision('fluxion/glm-5.3');
        assert.deepEqual(asked, [], label);
        assert.ok(state, label);
        if (!['Off', 'On'].includes(label)) assert.equal(state.testable, false, `${label}: the row offers no test`);
      }
    });
  });
});
