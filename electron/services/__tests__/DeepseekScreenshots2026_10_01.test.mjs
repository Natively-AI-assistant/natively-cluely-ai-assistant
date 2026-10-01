/**
 * Direct DeepSeek Flash reads screenshots (2026-10-01).
 *
 * Measured: api.deepseek.com reads an image sent as an OpenAI `image_url` part
 * on deepseek-flash and deepseek-v4-flash, and Natively never sent one — the
 * adapter had no image argument, and the screenshots scope guard was handed
 * the text only. deepseek-v4-pro answers HTTP 200 with a made-up reply, so the
 * adapter carries images for whichever model it is given and the callers
 * decide who gets one.
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

const image = () => { const p = path.join(os.tmpdir(), `ds-${process.pid}-${Math.random().toString(36).slice(2)}.png`); fs.writeFileSync(p, Buffer.from('89504e470d0a1a0a', 'hex')); return p; };

/** A helper whose DeepSeek client records the request it is given. */
function helper(state = {}) {
  const h = Object.create(LLMHelper.prototype);
  const requests = []; const scopes = [];
  Object.assign(h, {
    useOllama: false, customProvider: null, activeCurlProvider: null, currentModelId: 'deepseek-v4-flash', ollamaModel: '',
    ollamaVisionCache: new Map(), ninerouterVisionModels: new Set(), configuredCustomProviders: [],
    isLocalOnlyMode: false, isProviderDisabled: () => false, deepseekPermanentlyDead: false,
    litellmBaseURL: 'http://localhost:4000/v1', ninerouterBaseURL: 'http://localhost:20128/v1',
    rateLimiters: { deepseek: { acquire: async () => {} } },
    assertOutboundScopes: (provider, text, imagePaths) => { scopes.push({ provider, images: (imagePaths || []).length }); },
    assertOutboundImagesAllowed: () => {}, getDeniedOutboundScopes: () => [],
    visionHealth: new Map(), modelVersionManager: { getAllVisionTiers: () => [], onModelError: async () => {} },
    codexCliConfig: { enabled: false }, isCodexAvailable: () => false, antigravityFallbackModel: () => null, hasNatively: () => false,
    _deepseekClient: { chat: { completions: { create: async (body) => { requests.push(body); return (async function* () { yield { choices: [{ delta: { content: 'ok' } }] }; })(); } } } },
    ...state,
  });
  return { h, requests, scopes };
}
const drain = async (gen) => { const out = []; for await (const t of gen) out.push(t); return out.join(''); };

describe('the adapter', () => {
  test('with an image: an OpenAI image_url part after the text, and the scope guard sees the image', async () => {
    const { h, requests, scopes } = helper(); const img = image();
    assert.equal(await drain(h.streamWithDeepseek('what is this?', 'SYS', 'deepseek-v4-flash', undefined, [img])), 'ok');
    const user = requests[0].messages.at(-1);
    assert.equal(user.role, 'user');
    assert.ok(Array.isArray(user.content), 'multimodal content is an array of parts');
    assert.deepEqual(user.content[0], { type: 'text', text: 'what is this?' });
    assert.equal(user.content[1].type, 'image_url');
    assert.match(user.content[1].image_url.url, /^data:image\/png;base64,/);
    assert.deepEqual(scopes, [{ provider: 'deepseek', images: 1 }], 'the screenshots scope is checked with the image, not the text alone');
    assert.equal(requests[0].model, 'deepseek-v4-flash');
    fs.rmSync(img, { force: true });
  });
  test('without an image: byte-for-byte the text request it always sent', async () => {
    const { h, requests, scopes } = helper();
    await drain(h.streamWithDeepseek('hello', 'SYS', 'deepseek-v4-flash'));
    assert.deepEqual(requests[0].messages, [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'hello' }]);
    assert.deepEqual(scopes, [{ provider: 'deepseek', images: 0 }]);
  });
});

describe('Direct Assist', () => {
  const request = (model, img) => ({ requestId: 'r', selection: { provider: 'deepseek', model }, systemPrompt: 's', userPrompt: 'What is on screen?', imagePaths: img ? [img] : [] });
  test('a screenshot on DeepSeek Flash reaches DeepSeek with the image', async () => {
    const { h, requests } = helper(); const img = image();
    await drain(h.streamDirectAssistFrozen(request('deepseek-v4-flash', img), null, null));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].messages.at(-1).content.at(-1).type, 'image_url');
    fs.rmSync(img, { force: true });
  });
  test('a screenshot on DeepSeek Pro is refused before any request: it would be answered blind', async () => {
    const { h, requests } = helper({ currentModelId: 'deepseek-v4-pro' }); const img = image();
    await assert.rejects(() => drain(h.streamDirectAssistFrozen(request('deepseek-v4-pro', img), null, null)), /does not support image input/);
    assert.equal(requests.length, 0);
    fs.rmSync(img, { force: true });
  });
});
describe('the streaming vision chain', () => {
  async function chain(state = {}) {
    const opened = [];
    const stub = (name) => async function* (...args) { opened.push({ name, args }); yield 'ok'; };
    const { h } = helper({ client: null, openaiClient: null, claudeClient: null, groqClient: null, ...state });
    h.streamWithDeepseek = stub('deepseek'); h.streamWithGeminiModel = stub('gemini');
    let error = null;
    try { for await (const _ of h.streamVisionWithFallback({ userContent: 'u', message: 'm', imagePaths: ['/tmp/x.png'], systemPrompt: 's' })) { /* drain */ } } catch (e) { error = e; }
    return { opened, error };
  }
  test('DeepSeek Flash selected, nothing else configured: DeepSeek reads the screenshot', async () => {
    const { opened, error } = await chain();
    assert.equal(error, null, error?.message);
    assert.equal(opened[0].name, 'deepseek');
    assert.deepEqual(opened[0].args[4], ['/tmp/x.png'], 'the image is handed to the adapter');
    assert.equal(opened[0].args[2], 'deepseek-v4-flash', 'for the selected model');
  });
  test('DeepSeek Flash selected with another vision key: the selected model still leads its own turn', async () => {
    const { opened } = await chain({ client: {} });
    assert.equal(opened[0].name, 'deepseek');
  });
  test('DeepSeek Pro selected: never seated; another provider answers', async () => {
    const { opened, error } = await chain({ currentModelId: 'deepseek-v4-pro', client: {} });
    assert.equal(error, null);
    assert.ok(!opened.some((o) => o.name === 'deepseek'), 'Pro answers blind, so it gets no screenshot');
    assert.equal(opened[0].name, 'gemini');
  });
  test('DeepSeek Pro selected and nothing else: the user is told this model cannot read screenshots, and that Flash can', async () => {
    const { error } = await chain({ currentModelId: 'deepseek-v4-pro' });
    assert.match(error?.message ?? '', /^No vision-capable provider configured\./);
    assert.match(error.message, /deepseek-v4-pro/);
    assert.match(error.message, /DeepSeek Flash/);
    assert.doesNotMatch(error.message, /OpenAI, Claude, Gemini, or Groq/);
  });
  test('a DeepSeek key with ANOTHER model selected seats no DeepSeek rung', async () => {
    for (const state of [
      { currentModelId: 'gemini-3.1-flash-lite', client: {} },
      { customProvider: { id: 'c', name: 'c', multimodal: false }, client: {} },
      { useOllama: true, ollamaModel: 'llama3.1:8b', ollamaVisionModel: null, resolveOllamaVisionModelForChain: async () => null, client: {} },
    ]) {
      const { opened } = await chain(state);
      assert.ok(!opened.some((o) => o.name === 'deepseek'), JSON.stringify(Object.keys(state)));
    }
  });
  test('a key marked dead for this session (402) is not seated', async () => {
    const { opened } = await chain({ deepseekPermanentlyDead: true, client: {} });
    assert.ok(!opened.some((o) => o.name === 'deepseek'));
  });
  test('a DeepSeek model a one-time test passed is seated', async () => {
    store.recordTest('deepseek', '', 'deepseek-v5-next', true);
    const { opened } = await chain({ currentModelId: 'deepseek-v5-next' });
    assert.equal(opened[0]?.name, 'deepseek');
  });
});
