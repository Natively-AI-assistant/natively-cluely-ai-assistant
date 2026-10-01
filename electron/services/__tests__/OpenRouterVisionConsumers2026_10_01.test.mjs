/**
 * OpenRouter's catalogue, written by the real parser and read by every real
 * OpenRouter screenshot site (2026-10-01). The likeliest bug is a key mismatch
 * between writer and reader (routing prefix, `:free` ids), which would make the
 * whole feature a silent no-op — so nothing here hand-builds a store entry.
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
const { parseOpenRouterVision } = require(dist('llm/providerVisionData.js'));
const catalogue = JSON.parse(fs.readFileSync(path.join(__dirname, '../../llm/__tests__/fixtures/openrouterModels2026_10_01.json'), 'utf8'));
const parsed = parseOpenRouterVision(catalogue);

function loadCatalogue() {
  const store = new VisionCapabilityStore({ filePath: null });
  store.replaceProviderAnswers('openrouter', '', parsed);
  __setVisionCapabilityStore(store);
}
function helper(state = {}) {
  const h = Object.create(LLMHelper.prototype);
  Object.assign(h, {
    useOllama: false, customProvider: null, activeCurlProvider: null, currentModelId: '',
    ollamaModel: '', ollamaVisionCache: new Map(), ninerouterVisionModels: new Set(),
    isLocalOnlyMode: false, isProviderDisabled: () => false, modelVersionManager: { getAllVisionTiers: () => [] }, visionHealth: new Map(),
    codexCliConfig: { enabled: false }, isCodexAvailable: () => false, antigravityFallbackModel: () => null,
    hasNatively: () => false, ...state,
  });
  return h;
}
const TEXT_ONLY = 'openrouter/deepseek/deepseek-v4-flash';   // OpenRouter: ['text']
const VISION = 'openrouter/openai/gpt-4o';                   // OpenRouter: ['text','image','file']
const FREE = [...parsed.keys()].find((id) => id.endsWith(':free'));

async function chainOrder(model, extra = {}) {
  const opened = [];
  const stub = (name) => async function* () { opened.push(name); yield 'ok'; };
  const h = helper({
    currentModelId: model, openrouterClient: {}, client: extra.gemini ? {} : null, openaiClient: null, claudeClient: null, groqClient: null,
    streamWithOpenRouter: stub('openrouter'), streamWithGeminiModel: stub('gemini'), ...extra.state,
  });
  let error = null;
  try { for await (const _ of h.streamVisionWithFallback({ userContent: 'u', message: 'm', imagePaths: ['/tmp/x.png'], systemPrompt: 's' })) { /* drain */ } } catch (e) { error = e; }
  return { opened, error };
}

beforeEach(loadCatalogue);

describe('the streaming chain', () => {
  test('a model OpenRouter lists as text-only is not handed the screenshot; another provider answers', async () => {
    const { opened, error } = await chainOrder(TEXT_ONLY, { gemini: true });
    assert.equal(error, null, error?.message);
    assert.ok(!opened.includes('openrouter'), `opened: ${opened}`);
    assert.equal(opened[0], 'gemini');
  });
  test('a vision model still leads its own turn', async () => {
    const { opened } = await chainOrder(VISION, { gemini: true });
    assert.equal(opened[0], 'openrouter');
  });
  test('a :free id is matched by the same key the parser wrote', async () => {
    assert.ok(FREE, 'the fixture has :free ids');
    const reads = parsed.get(FREE);
    const { opened } = await chainOrder(`openrouter/${FREE}`, { gemini: true });
    assert.equal(opened[0] === 'openrouter', reads, `${FREE}: OpenRouter says ${reads}, opened ${opened}`);
  });
  test('nothing else configured: the user is told OpenRouter lists the model as text-only', async () => {
    const { error } = await chainOrder(TEXT_ONLY);
    assert.match(error?.message ?? '', /^No vision-capable provider configured\./);
    assert.match(error.message, /deepseek\/deepseek-v4-flash/);
    assert.match(error.message, /OpenRouter lists it as text-only/);
    assert.doesNotMatch(error.message, /proxy is reachable/);
  });
  test('no catalogue yet: seated exactly as before', async () => {
    __setVisionCapabilityStore(new VisionCapabilityStore({ filePath: null }));
    const { opened } = await chainOrder(TEXT_ONLY, { gemini: true });
    assert.equal(opened[0], 'openrouter');
  });
});

describe('Direct Assist', () => {
  test("refuses a screenshot for a model OpenRouter lists as text-only (its clear message, not OpenRouter's 404)", () => {
    const h = helper();
    assert.equal(h.directSelectionSupportsImages({ provider: 'openrouter', model: TEXT_ONLY }, null, null), false);
    assert.equal(h.directSelectionSupportsImages({ provider: 'openrouter', model: VISION }, null, null), true);
  });
  test('no catalogue yet: forwards, as before', () => {
    __setVisionCapabilityStore(new VisionCapabilityStore({ filePath: null }));
    assert.equal(helper().directSelectionSupportsImages({ provider: 'openrouter', model: TEXT_ONLY }, null, null), true);
  });
});

describe('getCapabilities', () => {
  test("follows OpenRouter's answer", () => {
    assert.equal(helper({ currentModelId: TEXT_ONLY }).getCapabilities().supportsImages, false);
    assert.equal(helper({ currentModelId: 'openrouter/x-ai/grok-4.7' }).getCapabilities().supportsImages, parsed.get('x-ai/grok-4.7'));
  });
});

describe('data characterization: exactly the ids OpenRouter lists as text-only flip, nothing else', () => {
  test('the seat answer over the whole catalogue', () => {
    const flips = [];
    for (const [id, readsImages] of parsed) {
      __setVisionCapabilityStore(new VisionCapabilityStore({ filePath: null }));
      const before = helper().directSelectionSupportsImages({ provider: 'openrouter', model: `openrouter/${id}` }, null, null);
      loadCatalogue();
      const after = helper().directSelectionSupportsImages({ provider: 'openrouter', model: `openrouter/${id}` }, null, null);
      assert.equal(before, true, 'before: every selected OpenRouter model was forwarded');
      assert.equal(after, readsImages, id);
      if (!after) flips.push(id);
    }
    const textOnly = [...parsed].filter(([, r]) => !r).map(([id]) => id);
    assert.deepEqual(flips.sort(), textOnly.sort());
  });
  test('no provider other than OpenRouter changes', () => {
    for (const [provider, model] of [['fluxion', 'fluxion/gpt-4o'], ['litellm', 'litellm/deepseek/deepseek-v4-flash'], ['agentrouter', 'agentrouter/deepseek-v4-flash'], ['openai', 'gpt-4o'], ['deepseek', 'deepseek-v4-flash']]) {
      __setVisionCapabilityStore(new VisionCapabilityStore({ filePath: null }));
      const before = helper().directSelectionSupportsImages({ provider, model }, null, null);
      loadCatalogue();
      assert.equal(helper().directSelectionSupportsImages({ provider, model }, null, null), before, `${provider} ${model}`);
    }
  });
});

describe('VisionProviderRegistry asks the same function', () => {
  // Its bundle inlines CredentialsManager, so the rung cannot be built here (as
  // in phase 1); the shared function it calls is executed above.
  const src = fs.readFileSync(path.join(__dirname, '../screen/VisionProviderRegistry.ts'), 'utf8');
  const start = src.indexOf('function openrouter(');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  test('openrouter() seats by gatewaySeatReadsImages with the stored answers', () => {
    assert.match(body, /gatewaySeatReadsImages\('openrouter'/);
    assert.match(body, /storedVisionAnswer/);
  });
});
describe('refreshOpenRouterVisionData', () => {
  const okFetch = (calls) => async (url) => { calls.push(url); return { ok: true, json: async () => catalogue }; };
  const fresh = () => { const s = new VisionCapabilityStore({ filePath: null, now: () => Date.now() }); __setVisionCapabilityStore(s); return s; };
  const ready = (state = {}) => helper({ openrouterClient: {}, openrouterApiKey: 'k', isProviderDisabled: () => false, ...state });

  test('writes the parsed catalogue, once per day', async () => {
    const s = fresh(); const calls = [];
    const h = ready();
    await h.refreshOpenRouterVisionData(okFetch(calls));
    await h.refreshOpenRouterVisionData(okFetch(calls));
    assert.equal(calls.length, 1, 'fresh data is not re-fetched');
    assert.equal(s.answer('openrouter', '', 'deepseek/deepseek-v4-flash'), false);
    assert.equal(s.answer('openrouter', '', 'openai/gpt-4o'), true);
  });
  test('concurrent callers share one request', async () => {
    fresh(); const calls = []; const h = ready();
    await Promise.all([h.refreshOpenRouterVisionData(okFetch(calls)), h.refreshOpenRouterVisionData(okFetch(calls))]);
    assert.equal(calls.length, 1);
  });
  for (const [label, impl] of [
    ['offline', async () => { throw new Error('ENOTFOUND'); }],
    ['a 503', async () => ({ ok: false, status: 503, json: async () => ({}) })],
    ['malformed JSON', async () => ({ ok: true, json: async () => { throw new SyntaxError('bad'); } })],
    ['an empty catalogue', async () => ({ ok: true, json: async () => ({ data: [] }) })],
  ]) {
    test(`${label}: earlier answers stay, nothing is marked fresh, a retry waits for the backoff`, async () => {
      const s = fresh(); const h = ready();
      s.replaceProviderAnswers('openrouter', '', new Map([['openai/gpt-4o', true]]));
      // Make the earlier data stale so a refresh is due.
      s.providers.get('openrouter|').fetchedAt = 0;
      await h.refreshOpenRouterVisionData(impl);
      assert.equal(s.answer('openrouter', '', 'openai/gpt-4o'), true, 'earlier answers kept');
      assert.equal(s.fetchedAt('openrouter', ''), 0, 'not marked fresh');
      const calls = [];
      await h.refreshOpenRouterVisionData(okFetch(calls));
      assert.equal(calls.length, 0, 'a failed attempt backs off before retrying');
    });
  }
  test('local-only mode or OpenRouter switched off: nothing is fetched', async () => {
    fresh(); const calls = [];
    await ready({ isLocalOnlyMode: true }).refreshOpenRouterVisionData(okFetch(calls));
    await ready({ isProviderDisabled: (p) => p === 'openrouter' }).refreshOpenRouterVisionData(okFetch(calls));
    assert.equal(calls.length, 0);
  });
  test('setModel on an OpenRouter model starts the refresh; on anything else it does not', () => {
    const h = ready(); let started = 0;
    h.refreshOpenRouterVisionData = () => { started += 1; return Promise.resolve(); };
    h.setModel('gpt-5.5');
    h.setModel('openrouter/openai/gpt-4o');
    assert.equal(started, 1);
  });
  test("Settings' Refresh writes the same answers", () => {
    const src = fs.readFileSync(path.join(__dirname, '../../utils/modelFetcher.ts'), 'utf8');
    const start = src.indexOf('async function fetchOpenRouterModels(');
    const body = src.slice(start, src.indexOf('\n}\n', start));
    assert.match(body, /parseOpenRouterVision\(/);
    assert.match(body, /replaceProviderAnswers\('openrouter'/);
  });
});

describe('a catalogue "no" is rechecked when it refuses a screenshot (review fix)', () => {
  // The catalogue only refreshed from setModel, so a model kept selected for
  // days could be refused on a "no" OpenRouter had since changed. Refusing on a
  // "no" now asks for a refresh — a no-op while the data is fresh.
  const counting = () => { const c = { n: 0 }; c.fn = () => { c.n += 1; return Promise.resolve(); }; return c; };
  test('the chain asks for a refresh when it skips the OpenRouter seat', async () => {
    const c = counting();
    await chainOrder(TEXT_ONLY, { gemini: true, state: { refreshOpenRouterVisionData: c.fn } });
    assert.equal(c.n, 1);
  });
  test('Direct Assist asks for a refresh when it refuses', () => {
    const c = counting();
    const h = helper({ refreshOpenRouterVisionData: c.fn });
    assert.equal(h.directSelectionSupportsImages({ provider: 'openrouter', model: TEXT_ONLY }, null, null), false);
    assert.equal(c.n, 1);
  });
  test('a model the catalogue says reads images, or has no answer for, asks for nothing', async () => {
    const c = counting();
    await chainOrder(VISION, { gemini: true, state: { refreshOpenRouterVisionData: c.fn } });
    helper({ refreshOpenRouterVisionData: c.fn }).directSelectionSupportsImages({ provider: 'openrouter', model: 'openrouter/never/listed' }, null, null);
    assert.equal(c.n, 0);
  });
});
