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

// ── Found by the independent privacy audit (2026-10-01) ──────────────────────

describe('customProviderIsLocal judges the URL the request GOES to', () => {
  const { customProviderIsLocal } = require(dist('llm/visionCapability.js'));
  const local = (curlCommand) => customProviderIsLocal({ curlCommand });
  test('a loopback URL in a header, a proxy flag or the body does not make a hosted endpoint local', () => {
    // It read the FIRST http(s) string anywhere in the template. OpenRouter's own
    // docs suggest an HTTP-Referer header; with a localhost referer the hosted
    // endpoint was "local": exempt from the cloud data scopes, usable in
    // local-only mode, and — since phase 5c-2 — sent keep-on-device screenshots.
    for (const curl of [
      `curl -H "HTTP-Referer: http://localhost:3000" https://openrouter.ai/api/v1/chat/completions -d '{"messages":[]}'`,
      `curl -H "Origin: http://localhost:5173" https://api.example.com/v1/chat`,
      `curl -x http://127.0.0.1:7890 https://api.openai.com/v1/chat/completions`,
      `curl --proxy http://127.0.0.1:7890 https://api.openai.com/v1/chat/completions`,
      `curl -d '{"callback":"http://localhost:9/x"}' https://api.example.com/v1/chat`,
    ]) assert.equal(local(curl), false, curl);
  });
  test('a public hostname that merely starts like a private address is not local', () => {
    for (const curl of ['curl https://10.example.com/v1/chat', 'curl http://172.16.evil.com/v1', 'curl http://192.168.example.org/x', 'curl http://169.254.attacker.net/x', 'curl http://127.0.0.1.nip.io/v1'])
      assert.equal(local(curl), false, curl);
  });
  test('real local endpoints still are, wherever the URL sits in the command', () => {
    for (const curl of [
      'curl http://localhost:1234/v1/chat/completions -H "Content-Type: application/json"',
      `curl -H "Referer: https://example.com" http://127.0.0.1:8080/v1/chat -d '{}'`,
      'curl http://192.168.1.20:1234/v1/chat', 'curl http://10.0.0.7:8000/v1', 'curl http://172.20.3.4:8000/v1', 'curl http://169.254.10.10/x',
      'curl http://studio.local:1234/v1', 'curl http://[::1]:11434/api/chat', 'curl http://0.0.0.0:11434/api/chat', 'curl http://127.9.9.9:80/x',
      'http://127.0.0.1:11434', 'http://localhost:11434',
    ]) assert.equal(local(curl), true, curl);
  });
  test('an explicit flag still wins, and a command that cannot be parsed is not local', () => {
    assert.equal(customProviderIsLocal({ curlCommand: 'curl https://api.example.com', localOnly: true }), true);
    assert.equal(customProviderIsLocal({ curlCommand: 'curl http://localhost:1', localOnly: false }), false);
    assert.equal(local('not a curl command http://localhost:1'), false);
    assert.equal(local(''), false);
  });
});

describe('keep on device with ANOTHER data scope switched off', () => {
  // The scope block runs before the vision decision and asked for a vision
  // model only when the SCREENSHOTS scope was the denied one. With Transcripts
  // denied instead, a turn carrying a screenshot went to Ollama's selected text
  // model — on a remote daemon that is a screenshot leaving the device in the
  // one state the mode exists to prevent.
  let ollama; let realFetch;
  const REMOTE = 'http://ollama.example.com:11434';
  afterEach(async () => { if (realFetch) globalThis.fetch = realFetch; realFetch = null; await ollama?.stop(); ollama = null; setMode('vision_first'); setScopes({}); });
  beforeEach(() => fakeCredentials());
  test('remote Ollama, text model selected, transcript scope denied: the screenshot is refused, nothing is sent', async () => {
    ollama = fakeOllama({ 'qwen2.5:4b': false });
    const local = await ollama.start();
    realFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => realFetch(String(input).replace(REMOTE, local), init);
    setMode('private_vision'); setScopes({ transcript: false });
    const h = helper(REMOTE, 'qwen2.5:4b');
    assert.equal(await ask(h, 'what is on my screen?', [png]), PRIVATE_VISION_NO_LOCAL_MESSAGE);
    assert.equal(ollama.chats().filter((c) => c.body.messages.at(-1).images?.length).length, 0, 'LEAK: the screenshot was posted to the remote daemon');
  });
  test('local Ollama, text model selected, a vision model installed: the VISION model gets the screenshot', async () => {
    ollama = fakeOllama({ 'qwen2.5:4b': false, 'llava:7b': true });
    setMode('private_vision'); setScopes({ transcript: false });
    const h = helper(await ollama.start(), 'qwen2.5:4b');
    assert.equal(await ask(h, 'what is on my screen?', [png]), 'local model reply');
    const withImage = ollama.chats().filter((c) => c.body.messages.at(-1).images?.length);
    assert.deepEqual(withImage.map((c) => c.body.model), ['llava:7b'], 'the text model must never be handed the image');
  });
  test('a text turn with that scope denied still goes to the selected text model', async () => {
    ollama = fakeOllama({ 'qwen2.5:4b': false });
    setMode('private_vision'); setScopes({ transcript: false });
    const h = helper(await ollama.start(), 'qwen2.5:4b');
    assert.equal(await ask(h, 'hello', undefined), 'local model reply');
    assert.equal(ollama.chats().at(-1).body.model, 'qwen2.5:4b');
  });
});

describe('a gateway model id left over from an earlier selection', () => {
  // setModel keeps currentModelId when Ollama or a custom provider is selected.
  // The gateway seats read it raw, so the LAST gateway model the user had
  // picked was seated — and could lead — a turn they had pointed elsewhere.
  const gateways = [
    ['openrouter/meta-llama/llama-3.3-70b-instruct', 'openrouter', { openrouterClient: {} }],
    ['litellm/internal-model', 'litellm', { litellmClient: {} }],
    ['nvidia_nim/meta/some-model', 'nvidia_nim', { nvidiaNimClient: {} }],
    ['fluxion/glm-5.3', 'fluxion', { hasFluxionCredential: () => true }],
    ['ninerouter/openai/gpt-5', 'ninerouter', { ninerouterClient: {} }],
    ['agentrouter/claude-opus-5', 'agentrouter', { hasAgentRouterCredential: () => true }],
  ];
  for (const [leftover, id, state] of gateways) {
    test(`${id}: not seated while Ollama or a custom provider is selected`, async () => {
      const ollama = cloudHelper(leftover, { ...state, client: {}, useOllama: true, ollamaModel: 'llava', ollamaVisionModel: 'llava' });
      assert.ok(!(await ollama.buildVisionChain(REQ)).some((p) => p.id === id), 'seated behind Ollama');
      const custom = cloudHelper(leftover, { ...state, client: {}, customProvider: { id: 'c', name: 'c', curlCommand: `curl https://api.example.com -d '{"q":"{{TEXT}}"}'` } });
      assert.ok(!(await custom.buildVisionChain(REQ)).some((p) => p.id === id), 'seated for a custom selection');
    });
  }
  test('selected for real, each gateway is still seated and leads', async () => {
    for (const [model, id, state] of gateways) {
      const chain = await cloudHelper(model, { ...state, client: {}, ninerouterVisionModels: new Set(['openai/gpt-5']) }).buildVisionChain(REQ);
      assert.equal(chain[0].id, id, model);
    }
  });
  test('a leftover Codex selection does not lead a local selection\'s turn', async () => {
    const h = cloudHelper('codex-cli', { isCodexAvailable: () => true, useOllama: true, ollamaModel: 'llava', ollamaVisionModel: 'llava', client: {} });
    const ids = (await h.buildVisionChain(REQ)).map((p) => p.id);
    assert.equal(ids[0], 'ollama');
    assert.notEqual(ids[1], 'codex-cli', `codex was front-loaded on a stale id: ${ids.join(' > ')}`);
  });
});

describe('Direct Assist and an AgentRouter model nothing is known about', () => {
  // The chat path and the pre-pass refuse it (AgentRouter's deepseek-v4-pro
  // answers HTTP 200 without seeing the image); Direct Assist forwarded it.
  beforeEach(() => { __setVisionCapabilityStore(new VisionCapabilityStore({ filePath: null })); });
  test('untested: refused; tested yes: forwarded; known by name: forwarded', () => {
    const h = cloudHelper('agentrouter/glm-5.3', { hasAgentRouterCredential: () => true });
    const reads = (model) => h.directSelectionSupportsImages({ provider: 'agentrouter', model }, null, null);
    assert.equal(reads('agentrouter/glm-5.3'), false);
    assert.equal(reads('agentrouter/deepseek-v4-pro'), false);
    assert.equal(reads('agentrouter/claude-opus-5'), true);
    const store = new VisionCapabilityStore({ filePath: null }); store.recordTest('agentrouter', '', 'glm-5.3', true);
    __setVisionCapabilityStore(store);
    assert.equal(reads('agentrouter/glm-5.3'), true);
  });
  test('the other gateways still forward a model nothing is known about', () => {
    const h = cloudHelper('fluxion/glm-5.3');
    for (const [provider, model] of [['fluxion', 'fluxion/glm-5.3'], ['litellm', 'litellm/x'], ['nvidia_nim', 'nvidia_nim/x'], ['openrouter', 'openrouter/x/y'], ['ninerouter', 'ninerouter/x/y']])
      assert.equal(h.directSelectionSupportsImages({ provider, model }, null, null), true, provider);
  });
});

describe('small ones from the audit', () => {
  test('Ollama switched off in Settings is not seated for a screenshot', async () => {
    const h = cloudHelper('gemini-3.8-flash', { client: {}, useOllama: true, ollamaModel: 'llava', ollamaVisionModel: 'llava', isProviderDisabled: (f) => f === 'ollama' });
    assert.ok(!(await h.buildVisionChain(REQ)).some((p) => p.id === 'ollama'));
  });
  test('the DeepSeek rung sends to the model that was approved when the chain was built', async () => {
    const sent = [];
    const h = cloudHelper('deepseek-v4-flash', { deepseekClient: {}, streamWithDeepseek: async function* (_u, _s, model) { sent.push(model); yield 'ok'; } });
    const [rung] = await h.buildVisionChain(REQ);
    h.currentModelId = 'deepseek-v4-pro';                             // the user switches model before the rung opens
    for await (const _ of rung.open(new AbortController().signal, 1)) { /* drain */ }
    assert.deepEqual(sent, ['deepseek-v4-flash']);
  });
});
