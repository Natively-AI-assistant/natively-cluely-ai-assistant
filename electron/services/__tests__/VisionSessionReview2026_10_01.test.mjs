/**
 * Whole-session review of the vision work (2026-10-01): defects found by
 * reading phases 1–5c-2 together, each reproduced here before it was fixed.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  fakeOllama, helper, ask, png, setMode, setScopes, fakeCredentials, isolateSingletons, dist, require, LLMHelper,
} from './fakeOllamaHarness.mjs';

const { PRIVATE_VISION_NO_LOCAL_MESSAGE } = require(dist('llm/visionPolicy.js'));
const { VisionCapabilityStore, __setVisionCapabilityStore } = require(dist('llm/visionCapabilityStore.js'));
isolateSingletons();

const REQ = { userContent: 'u', message: 'm', imagePaths: ['/tmp/x.png'], systemPrompt: 's' };
const TIERS = [
  { family: 'openai', tier1: 'gpt-5.4', tier2: 'gpt-5.4', tier3: 'gpt-5.4' },
  { family: 'claude', tier1: 'claude-sonnet-4-6', tier2: 'claude-sonnet-4-6', tier3: 'claude-sonnet-4-6' },
];
/** A cloud helper for buildVisionChain: nothing configured unless `state` says so. */
function cloudHelper(model, state = {}) {
  const h = Object.create(LLMHelper.prototype);
  Object.assign(h, {
    useOllama: false, customProvider: null, activeCurlProvider: null, currentModelId: model, ollamaModel: '', ollamaVisionModel: null,
    ollamaVisionCache: new Map(), ninerouterVisionModels: new Set(), configuredCustomProviders: [],
    isLocalOnlyMode: false, isProviderDisabled: () => false, deepseekPermanentlyDead: false,
    client: null, openaiClient: null, claudeClient: null, groqClient: null, deepseekClient: null,
    openrouterClient: null, litellmClient: null, nvidiaNimClient: null, ninerouterClient: null,
    litellmBaseURL: 'http://localhost:4000/v1', ninerouterBaseURL: 'http://localhost:20128/v1',
    visionHealth: new Map(), modelVersionManager: { getAllVisionTiers: () => TIERS },
    codexCliConfig: { enabled: false, model: 'gpt-5.5' }, isCodexAvailable: () => false, antigravityFallbackModel: () => null,
    hasNatively: () => false, hasFluxionCredential: () => false, hasAgentRouterCredential: () => false,
    maybeProbeSelectedVision: () => {}, refreshOpenRouterVisionData: async () => {},
    ...state,
  });
  return h;
}

describe('switching between Ollama models in the picker', () => {
  // The picker calls setModel('ollama-<name>'). It did not clear the remembered
  // "model that reads images", so the model picked BEFORE kept answering
  // screenshots after the user selected a different vision model.
  let ollama;
  afterEach(async () => { await ollama?.stop(); ollama = null; setMode('vision_first'); });
  beforeEach(() => { fakeCredentials(); setScopes({}); });
  const pick = (h, name) => { h.releaseOllamaPin = () => {}; LLMHelper.prototype.setModel.call(h, `ollama-${name}`, []); };

  test('keep on device: the newly selected vision model answers, not the one remembered from the previous selection', async () => {
    ollama = fakeOllama({ 'qwen2.5:4b': false, 'llava:7b': true, 'llama3.2-vision:11b': true });
    setMode('private_vision');
    const h = helper(await ollama.start(), 'qwen2.5:4b');
    await ask(h, 'what is on my screen?', [png]);
    assert.equal(ollama.chats().at(-1).body.model, 'llava:7b', 'a text model is selected: the first installed vision model answers');
    pick(h, 'llama3.2-vision:11b');
    await ask(h, 'and now?', [png]);
    assert.equal(ollama.chats().at(-1).body.model, 'llama3.2-vision:11b', 'the user picked a vision model; a different one answered');
  });
  test('the screenshot chain (no privacy mode) follows the new selection too', async () => {
    ollama = fakeOllama({ 'qwen2.5:4b': false, 'llava:7b': true, 'llama3.2-vision:11b': true });
    const h = Object.assign(helper(await ollama.start(), 'qwen2.5:4b'), {
      modelVersionManager: { getAllVisionTiers: () => TIERS }, maybeProbeSelectedVision: () => {}, isCodexAvailable: () => false,
      antigravityFallbackModel: () => null, hasNatively: () => false, hasFluxionCredential: () => false, hasAgentRouterCredential: () => false,
      codexCliConfig: { model: 'x' }, ninerouterVisionModels: new Set(), deepseekPermanentlyDead: false, isProviderDisabled: () => false,
    });
    assert.match((await h.buildVisionChain(REQ))[0].name, /llava:7b/);
    pick(h, 'llama3.2-vision:11b');
    assert.match((await h.buildVisionChain(REQ))[0].name, /llama3\.2-vision:11b/);
  });
  test('re-selecting the same model keeps what was learned (no extra probe)', async () => {
    ollama = fakeOllama({ 'qwen2.5:4b': false, 'llava:7b': true });
    setMode('private_vision');
    const h = helper(await ollama.start(), 'qwen2.5:4b');
    await ask(h, 'q', [png]);
    pick(h, 'qwen2.5:4b');
    assert.equal(h.ollamaVisionModel, 'llava:7b');
  });
});

describe('a selected Groq vision model that Groq has retired', () => {
  // qwen/qwen3.6-27b is retired for free and developer tiers (groqModels.ts).
  // The text path substitutes its successor; the screenshot rung sent the
  // retired id, got a 404, and was demoted for a day — with no other Groq rung.
  test('the Groq rung uses the current vision model, not the retired selection', async () => {
    const chain = await cloudHelper('qwen/qwen3.6-27b', { groqClient: {} }).buildVisionChain(REQ);
    assert.deepEqual(chain.map((p) => p.id), ['groq']);
    assert.match(chain[0].name, /qwen3\.8-27b/, `the rung would send to ${chain[0].name}`);
  });
  test('the request names the current model', async () => {
    const sent = [];
    const h = cloudHelper('qwen/qwen3.6-27b', {
      groqClient: {},
      streamWithGroqMultimodal: async function* (_u, _imgs, _sys, _sig, model) { sent.push(model); yield 'ok'; },
    });
    const [rung] = await h.buildVisionChain(REQ);
    for await (const _ of rung.open(new AbortController().signal, 1)) { /* drain */ }
    assert.deepEqual(sent, ['qwen/qwen3.8-27b']);
  });
  test('a current selected Groq vision model still leads with itself', async () => {
    const chain = await cloudHelper('qwen/qwen3.8-27b', { groqClient: {}, openaiClient: {} }).buildVisionChain(REQ);
    assert.equal(chain[0].id, 'groq');
    assert.match(chain[0].name, /qwen3\.8-27b/);
  });
});

describe('a gateway model the one-time test found text-only, with nothing else configured', () => {
  // The message said "check the proxy is reachable and the model is still
  // configured" — wrong advice for a model Natively itself tested and found
  // unable to read images.
  beforeEach(() => { __setVisionCapabilityStore(new VisionCapabilityStore({ filePath: null })); });
  for (const [model, provider, state] of [
    ['fluxion/glm-5.3', 'fluxion', { hasFluxionCredential: () => true }],
    ['nvidia_nim/meta/text-model', 'nvidia_nim', { nvidiaNimClient: {} }],
    ['litellm/internal-model', 'litellm', { litellmClient: {} }],
  ]) {
    test(`${provider}: the message says the model can't read screenshots, not that the proxy is unreachable`, async () => {
      const store = new VisionCapabilityStore({ filePath: null });
      store.recordTest(provider, provider === 'litellm' ? 'http://localhost:4000' : '', model.slice(provider.length + 1), false);
      __setVisionCapabilityStore(store);
      await assert.rejects(() => cloudHelper(model, state).buildVisionChain(REQ), (e) => {
        assert.match(e.message, /No vision-capable provider configured/);
        assert.match(e.message, /can't read screenshots/);
        assert.doesNotMatch(e.message, /check the proxy is reachable/);
        return true;
      });
    });
  }
  test('an untested gateway model that is simply not seated keeps the reachability advice', async () => {
    await assert.rejects(() => cloudHelper('litellm/internal-model', { litellmClient: null }).buildVisionChain(REQ), /check the proxy is reachable/);
  });
});

describe('Ollama selected but no model named yet (startup, or nothing installed)', () => {
  // The pre-pass decides "is the selection local?" from getDirectAssistSelection,
  // which THROWS when Ollama is selected with an empty model name. The registry
  // then saw "no selection" and sent the screenshot to cloud providers.
  const { buildVisionProviders } = require(dist('services/screen/VisionProviderRegistry.js'));
  const creds = {
    getNativelyApiKey: () => undefined, getOpenaiApiKey: () => undefined, getGeminiApiKey: () => 'key', getClaudeApiKey: () => undefined,
    getGroqApiKey: () => undefined, getDeepseekApiKey: () => undefined, getOpenrouterApiKey: () => undefined, getNvidiaNimApiKey: () => undefined,
    getFluxionApiKey: () => undefined, getAgentRouterApiKey: () => undefined, getLitellmBaseURL: () => undefined, getNinerouterBaseURL: () => undefined,
    getNinerouterVisionModels: () => [], getAllCredentials: () => ({}),
  };
  afterEach(() => { delete globalThis.__nativelyGetLLMHelper; });
  test('the pre-pass still stays off the cloud', () => {
    const h = helper('http://127.0.0.1:1', '');                       // useOllama: true, ollamaModel: ''
    assert.throws(() => h.getDirectAssistSelection(), /No model is selected/);
    globalThis.__nativelyGetLLMHelper = () => h;
    const eligible = buildVisionProviders({ mode: 'vision_first', localOnly: false, scopeAllowsScreenshots: true, purpose: 'prepass' }, creds)
      .filter((p) => p.isConfigured && p.supportsVision).map((p) => p.id);
    assert.deepEqual(eligible, [], `the screenshot would go to: ${eligible.join(', ')}`);
  });
});

describe('the image-refusal list', () => {
  const { isImageRefusalMessage } = require(dist('llm/streamFallbackEngine.js'));
  test('a POSITIVE statement about image input is not a refusal', () => {
    // `support(s) image input` matched "This model supports image input, but …",
    // which would have demoted a working model for ten minutes and saved a
    // false "can't read images" for a month.
    assert.equal(isImageRefusalMessage('This model supports image input but the file is corrupt'), false);
    assert.equal(isImageRefusalMessage('Models that support image input: gpt-5.4'), false);
  });
  test('the real refusals still are', () => {
    for (const m of [
      '404 No endpoints found that support image input',
      'This model does not support image input',
      "The model doesn't support vision",
      'image_url is only supported by certain models',
      'Images are not supported by this model',
    ]) assert.equal(isImageRefusalMessage(m), true, m);
  });
});

describe('an Ollama on another machine, non-streaming call', () => {
  // Evin's rule for a remote daemon: the SELECTED model answers. The streaming
  // sites followed it; callOllama picked whichever model the resolver had
  // remembered.
  let ollama; let realFetch;
  const REMOTE = 'http://ollama.example.com:11434';
  afterEach(async () => { if (realFetch) globalThis.fetch = realFetch; realFetch = null; await ollama?.stop(); ollama = null; });
  test('an image goes to the selected model, not to another one remembered from the resolver', async () => {
    ollama = fakeOllama({ 'bakllava:latest': true, 'llava:7b': true });
    const local = await ollama.start();
    realFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => realFetch(String(input).replace(REMOTE, local), init);
    const h = helper(REMOTE, 'bakllava:latest');
    h.ollamaVisionModel = 'llava:7b';                                // what the chat chain's resolver left behind
    await h.callOllama('what is this?', [png], 'SYS');
    assert.equal(ollama.chats().at(-1).body.model, 'bakllava:latest');
  });
  test('on this machine the resolved vision model still answers an image', async () => {
    ollama = fakeOllama({ 'qwen2.5:4b': false, 'llava:7b': true });
    const h = helper(await ollama.start(), 'qwen2.5:4b');
    h.ollamaVisionModel = 'llava:7b';
    await h.callOllama('what is this?', [png], 'SYS');
    assert.equal(ollama.chats().at(-1).body.model, 'llava:7b');
  });
});
