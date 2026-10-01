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
    ['a direct DeepSeek model (its adapter carries no image)', 'deepseek-v4-flash'],
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
