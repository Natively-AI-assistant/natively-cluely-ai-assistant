/**
 * The screen pre-pass: which providers it would try, in what order (2026-10-01).
 *
 * The pre-pass is the quick "describe the screen" step that runs before an
 * answer starts (VisionProviderRegistry → ScreenUnderstandingService, 6 s total
 * budget). This file EXECUTES buildVisionProviders — the older registry tests
 * read its source — with a fake credential store and a fake live helper.
 *
 * A baseline of what the chain would try was recorded before phase 5b changed
 * anything, for every combination below. Each later change is held to a named
 * exception; anything else that moves fails.
 *
 * Regenerate ONLY on the commit that made the credential source injectable:
 *   PREPASS_BASELINE_WRITE=1 node --test electron/services/__tests__/ScreenPrepassRegistry2026_10_01.test.mjs
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
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'prepass-registry-'));
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: { app: { isReady: () => true, getPath: () => userData, getVersion: () => '0.0.0-test' }, safeStorage: { isEncryptionAvailable: () => false } },
};
const { buildVisionProviders } = require(dist('services/screen/VisionProviderRegistry.js'));
const { VisionCapabilityStore, __setVisionCapabilityStore } = require(dist('llm/visionCapabilityStore.js'));

const FIXTURE = path.join(__dirname, 'fixtures/screenPrepassRungs2026_10_01.json');
const FIXED = { openai: 'gpt-5.4', claude: 'claude-sonnet-4-6' };

// ── Fakes ────────────────────────────────────────────────────────────────────

const KEY_SETS = {
  none: [],
  gemini: ['gemini'],
  openai: ['openai'],
  deepseek: ['deepseek'],
  vendors: ['natively', 'openai', 'gemini', 'claude', 'groq'],
  everything: ['natively', 'openai', 'gemini', 'claude', 'groq', 'deepseek', 'openrouter', 'litellm', 'nvidia_nim', 'ninerouter', 'fluxion', 'agentrouter'],
};
function credentials(keys) {
  const has = (k) => keys.includes(k) ? `key-${k}` : undefined;
  return {
    getNativelyApiKey: () => has('natively'), getOpenaiApiKey: () => has('openai'), getGeminiApiKey: () => has('gemini'),
    getClaudeApiKey: () => has('claude'), getGroqApiKey: () => has('groq'), getDeepseekApiKey: () => has('deepseek'),
    getOpenrouterApiKey: () => has('openrouter'), getNvidiaNimApiKey: () => has('nvidia_nim'), getFluxionApiKey: () => has('fluxion'),
    getAgentRouterApiKey: () => has('agentrouter'),
    getLitellmBaseURL: () => keys.includes('litellm') ? 'http://localhost:4000/v1' : undefined,
    getNinerouterBaseURL: () => keys.includes('ninerouter') ? 'http://localhost:20128/v1' : undefined,
    getNinerouterVisionModels: () => ['openai/gpt-5'],
    // As the real store: nothing ever writes an Ollama or Codex field here.
    getAllCredentials: () => ({}),
  };
}

const IMG = ' -d \'{"image":"{{IMAGE_BASE64}}","q":"{{TEXT}}"}\'';
const NOIMG = ' -d \'{"q":"{{TEXT}}"}\'';
const custom = (id, url, body) => ({ id, name: id, curlCommand: `curl ${url}${body}`, responsePath: 'text' });
const providerOf = (m) => m === 'natively' ? 'natively'
  : /^(openrouter|litellm|fluxion|agentrouter|ninerouter|nvidia_nim)\//.test(m) ? m.split('/')[0]
  : m.startsWith('deepseek-') ? 'deepseek' : m.startsWith('claude-') ? 'claude' : m.startsWith('gemini-') ? 'gemini' : 'openai';

/** label → the live helper's state. `stale` is a cloud model id left over while something local is selected. */
const SELECTIONS = {
  'gemini-3.8-flash': {}, 'gpt-3.5-turbo': {}, 'gpt-5.5': {}, 'claude-opus-5': {}, natively: {},
  'deepseek-v4-flash': {}, 'deepseek-v4-pro': {}, 'openrouter/openai/gpt-4o': {}, 'litellm/internal': {},
  'fluxion/claude-opus-5': {}, 'agentrouter/claude-opus-5': {}, 'ninerouter/openai/gpt-5': {}, 'nvidia_nim/meta/llama-3.2-90b-vision-instruct': {},
  'ollama selected': { selection: { provider: 'ollama', model: 'llava' }, stale: 'gemini-3.8-flash' },
  'custom local, reads images': { custom: custom('c-local', 'http://localhost:1234/v1/chat', IMG), stale: 'gemini-3.8-flash' },
  'custom local, text only': { custom: custom('c-local-text', 'http://127.0.0.1:8080/gen', NOIMG), stale: 'gemini-3.8-flash' },
  'custom hosted, reads images': { custom: custom('c-hosted', 'https://api.example.com/v1/chat', IMG), stale: 'gemini-3.8-flash' },
  'curl local, reads images': { curl: custom('u-local', 'http://localhost:9000/chat', IMG), stale: 'gemini-3.8-flash' },
  'curl hosted, reads images': { curl: custom('u-hosted', 'https://llm.example.com/chat', IMG), stale: 'gemini-3.8-flash' },
  'curl local, text only': { curl: custom('u-local-text', 'http://localhost:9000/gen', NOIMG), stale: 'gemini-3.8-flash' },
};
const LOCAL_SELECTIONS = new Set(['ollama selected', 'custom local, reads images', 'custom local, text only', 'curl local, reads images', 'curl local, text only']);
const MODES = ['vision_first', 'private_vision'];

function installHelper(label, over = {}) {
  const s = SELECTIONS[label] ?? {};
  const model = s.stale ?? label;
  const selection = s.selection
    ?? (s.custom ? { provider: 'custom', model: s.custom.id } : s.curl ? { provider: 'curl', model: s.curl.id } : { provider: providerOf(model), model });
  globalThis.__nativelyGetLLMHelper = () => ({
    getCurrentModelId: () => model,
    getActiveCustomProvider: () => s.custom ?? null,
    getActiveCurlProvider: () => s.curl ?? null,
    getDirectAssistSelection: () => selection,
    getFixedVisionModels: () => FIXED,
    ...over,
  });
}

/** What the chain would try, in order: `id=modelId` for every rung it would not skip. */
function eligible(keySet, label, mode, over) {
  installHelper(label, over);
  const providers = buildVisionProviders(
    { mode, localOnly: mode === 'private_vision', scopeAllowsScreenshots: true },
    credentials(KEY_SETS[keySet]),
  );
  return providers
    .filter((p) => p.isConfigured && p.supportsVision && p.scopeAllowsScreenshots && (mode !== 'private_vision' || p.isLocal))
    .map((p) => `${p.id}=${p.modelId ?? ''}${p.isLocal ? ' (local)' : ''}`);
}
const all = (keySet, label, mode, over) => {
  installHelper(label, over);
  return buildVisionProviders({ mode, localOnly: mode === 'private_vision', scopeAllowsScreenshots: true }, credentials(KEY_SETS[keySet]));
};

beforeEach(() => { __setVisionCapabilityStore(new VisionCapabilityStore({ filePath: null })); });

// ── The baseline ─────────────────────────────────────────────────────────────

function matrix() {
  const out = {};
  for (const keySet of Object.keys(KEY_SETS)) for (const label of Object.keys(SELECTIONS)) for (const mode of MODES) {
    __setVisionCapabilityStore(new VisionCapabilityStore({ filePath: null }));
    out[`${mode} | keys: ${keySet} | ${label}`] = eligible(keySet, label, mode);
  }
  return out;
}

/** What `before` must have become. One named rule per allowed difference. */
function expected(name, before) {
  let rungs = [...before];
  const label = name.split(' | ')[2];
  // (a) Evin, 2026-10-01: with a local model selected, the pre-pass stays off
  //     cloud providers. Only rungs that keep the screenshot on the machine remain.
  if (LOCAL_SELECTIONS.has(label)) rungs = rungs.filter((r) => r.endsWith(' (local)'));
  const [mode, keys] = [name.split(' | ')[0], name.split(' | ')[1].replace('keys: ', '')];
  // (b) A selected DeepSeek Flash can run the pre-pass (cloud, last). Pro cannot read images.
  if (label === 'deepseek-v4-flash' && KEY_SETS[keys].includes('deepseek') && mode === 'vision_first') rungs.push('deepseek=deepseek-v4-flash');
  // (c) A selected cURL provider that reads images: a local one in both modes, a hosted one only where cloud is allowed.
  if (label === 'curl local, reads images') rungs.push('curl= (local)');
  if (label === 'curl hosted, reads images' && mode === 'vision_first') rungs.push('curl=');
  // (d) Defect 9: the OpenAI rung said `gpt-4o` while the request went to the
  //     SELECTED OpenAI model. It now names, and sends to, the fixed vision model.
  rungs = rungs.map((r) => (r === 'openai=gpt-4o' ? `openai=${FIXED.openai}` : r));
  return rungs;
}

test('the pre-pass tries what it tried before, except where a named rule says otherwise', () => {
  const now = matrix();
  if (process.env.PREPASS_BASELINE_WRITE === '1') {
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, JSON.stringify({ written: '2026-10-01', note: 'eligible pre-pass rungs, in order, before phase 5b', rungs: now }, null, 1) + '\n');
    return;
  }
  const before = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).rungs;
  assert.deepEqual(Object.keys(now).sort(), Object.keys(before).sort(), 'the case list changed');
  for (const [name, was] of Object.entries(before)) {
    assert.deepEqual(now[name], expected(name, was), `${name}\n  was: ${was.join(' > ') || '(nothing)'}\n  now: ${now[name].join(' > ') || '(nothing)'}`);
  }
});

export { eligible, all, expected, matrix, KEY_SETS, SELECTIONS, LOCAL_SELECTIONS, MODES, FIXED, FIXTURE, installHelper, credentials };

// ── Defect 9: the pre-pass sent the screenshot to the SELECTED OpenAI model ────

const { LLMHelper } = require(dist('LLMHelper.js'));
const TIERS = [
  { family: 'openai', tier1: 'gpt-5.4', tier2: 'gpt-5.4', tier3: 'gpt-5.4' },
  { family: 'claude', tier1: 'claude-sonnet-4-6', tier2: 'claude-sonnet-4-6', tier3: 'claude-sonnet-4-6' },
];
function bareHelper(state = {}) {
  const calls = [];
  const h = Object.create(LLMHelper.prototype);
  const record = (name) => async (...args) => { calls.push({ name, args }); return `from ${name}`; };
  Object.assign(h, {
    currentModelId: 'gpt-3.5-turbo', modelVersionManager: { getAllVisionTiers: () => TIERS },
    generateWithOpenai: record('openai'), generateWithClaude: record('claude'), generateWithGroqMultimodal: record('groq'),
    ...state,
  });
  return { h, calls };
}

describe('runVisionRequest: each vendor rung names its own vision model', () => {
  test('OpenAI: a text-only selected model never receives the pre-pass screenshot', async () => {
    const { h, calls } = bareHelper({ currentModelId: 'gpt-3.5-turbo' });
    assert.equal(await h.runVisionRequest('openai', 'user', 'system', '/tmp/x.png'), 'from openai');
    const [user, system, images, model] = calls[0].args;
    assert.deepEqual([user, system, images], ['user', 'system', ['/tmp/x.png']]);
    assert.equal(model, 'gpt-5.4', 'with no model argument generateWithOpenai falls back to the SELECTED OpenAI model');
  });
  test('OpenAI: a selected vision model does not lead the pre-pass either (cloud order stays fast)', async () => {
    const { h, calls } = bareHelper({ currentModelId: 'gpt-5.5' });
    await h.runVisionRequest('openai', 'u', 's', '/tmp/x.png');
    assert.equal(calls[0].args[3], 'gpt-5.4');
  });
  test('Claude: the fixed vision model, whatever Claude model is selected', async () => {
    const { h, calls } = bareHelper({ currentModelId: 'claude-opus-5-5' });
    await h.runVisionRequest('claude', 'u', 's', '/tmp/x.png');
    assert.equal(calls[0].args[3], 'claude-sonnet-4-6');
  });
  test('the fixed models follow the version manager, and fall back to the built-in ones', () => {
    assert.deepEqual(bareHelper().h.getFixedVisionModels(), { openai: 'gpt-5.4', claude: 'claude-sonnet-4-6' });
    const promoted = bareHelper({ modelVersionManager: { getAllVisionTiers: () => [{ family: 'openai', tier1: 'gpt-6-vision', tier2: 'x', tier3: 'x' }] } }).h.getFixedVisionModels();
    assert.equal(promoted.openai, 'gpt-6-vision');
    assert.match(promoted.claude, /^claude-/, 'no Claude tier → the built-in Claude model');
    const broken = bareHelper({ modelVersionManager: { getAllVisionTiers: () => { throw new Error('not ready'); } } }).h.getFixedVisionModels();
    assert.match(broken.openai, /^gpt-/);
  });
  test('the registry labels the OpenAI and Claude rungs with those models', () => {
    const rungs = all('vendors', 'gpt-3.5-turbo', 'vision_first', { getFixedVisionModels: () => ({ openai: 'gpt-6-vision', claude: 'claude-next' }) });
    assert.equal(rungs.find((p) => p.id === 'openai').modelId, 'gpt-6-vision');
    assert.equal(rungs.find((p) => p.id === 'claude').modelId, 'claude-next');
  });
});
test('Groq: the pre-pass adapter sends to the Groq vision model, never the selected Groq model', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../LLMHelper.ts'), 'utf8');
  const start = src.indexOf('private async generateWithGroqMultimodal(');
  const body = src.slice(start, src.indexOf('\n  }\n', start));
  assert.match(body, /model: GROQ_VISION_MODEL,/);
  assert.doesNotMatch(body, /currentModelId/);
});

// ── A local selection keeps the pre-pass off the cloud ───────────────────────

describe('with a local model selected, no cloud provider gets the pre-pass screenshot', () => {
  const ids = (list) => list.map((r) => r.split('=')[0]);
  test('Ollama selected, every cloud key present: nothing cloud is tried', () => {
    assert.deepEqual(eligible('everything', 'ollama selected', 'vision_first'), [],
      'Ollama reads the screenshot in the answer itself; the pre-pass must not send it to a cloud first');
  });
  test('a leftover gateway model id does not seat that gateway while Ollama is selected', () => {
    const rungs = eligible('everything', 'ollama selected', 'vision_first', { getCurrentModelId: () => 'openrouter/openai/gpt-4o' });
    assert.deepEqual(rungs, []);
  });
  test('a local custom endpoint that reads images runs the pre-pass alone', () => {
    assert.deepEqual(ids(eligible('everything', 'custom local, reads images', 'vision_first')), ['custom']);
  });
  test('a local custom endpoint that is text-only: no pre-pass, and still nothing cloud', () => {
    assert.deepEqual(eligible('everything', 'custom local, text only', 'vision_first'), []);
  });
  test('a HOSTED custom endpoint is a cloud selection: the cloud order is untouched', () => {
    const rungs = ids(eligible('vendors', 'custom hosted, reads images', 'vision_first'));
    assert.deepEqual(rungs, ['natively', 'openai', 'gemini_flash_lite', 'gemini_flash', 'claude', 'gemini_pro', 'groq_scout', 'custom']);
  });
  test('a cloud selection: the cloud order is untouched', () => {
    assert.deepEqual(ids(eligible('vendors', 'claude-opus-5', 'vision_first')),
      ['natively', 'openai', 'gemini_flash_lite', 'gemini_flash', 'claude', 'gemini_pro', 'groq_scout']);
  });
  test('no live helper, or one that cannot name a selection: today\'s behaviour, not a refusal', () => {
    const want = ids(eligible('vendors', 'gemini-3.8-flash', 'vision_first'));
    assert.deepEqual(ids(eligible('vendors', 'gemini-3.8-flash', 'vision_first', { getDirectAssistSelection: () => { throw new Error('no adapter'); } })), want);
    assert.deepEqual(ids(eligible('vendors', 'gemini-3.8-flash', 'vision_first', { getDirectAssistSelection: undefined })), want);
    installHelper('gemini-3.8-flash');
    delete globalThis.__nativelyGetLLMHelper;
    const { buildVisionProviders: build } = require(dist('services/screen/VisionProviderRegistry.js'));
    const rungs = build({ mode: 'vision_first', localOnly: false, scopeAllowsScreenshots: true }, credentials(KEY_SETS.vendors))
      .filter((p) => p.isConfigured && p.supportsVision).map((p) => p.id);
    assert.deepEqual(rungs, want);
  });
});

// ── Selected-only rungs: DeepSeek Flash and a cURL provider ──────────────────

describe('a selected DeepSeek model', () => {
  const ids = (list) => list.map((r) => r.split('=')[0]);
  test('Flash, with a DeepSeek key: it runs the pre-pass, after every other cloud rung', () => {
    assert.deepEqual(eligible('deepseek', 'deepseek-v4-flash', 'vision_first'), ['deepseek=deepseek-v4-flash']);
    assert.equal(ids(eligible('everything', 'deepseek-v4-flash', 'vision_first')).at(-1), 'deepseek');
  });
  test('Pro: never seated — it answers without seeing the image', () => {
    assert.ok(!ids(eligible('everything', 'deepseek-v4-pro', 'vision_first')).includes('deepseek'));
  });
  test('not selected, or no key: not seated', () => {
    assert.ok(!ids(eligible('everything', 'gemini-3.8-flash', 'vision_first')).includes('deepseek'));
    assert.deepEqual(eligible('gemini', 'deepseek-v4-flash', 'vision_first').filter((r) => r.startsWith('deepseek')), []);
  });
  test('never in "keep screenshots on this device" mode: it is a cloud provider', () => {
    assert.deepEqual(eligible('everything', 'deepseek-v4-flash', 'private_vision'), []);
    assert.equal(all('everything', 'deepseek-v4-flash', 'vision_first').find((p) => p.id === 'deepseek').isLocal, false);
  });
  test('a saved one-time test overrides the name: a passed unknown id is seated, a failed Flash is not', () => {
    const unknown = { getCurrentModelId: () => 'deepseek-v9-next', getDirectAssistSelection: () => ({ provider: 'deepseek', model: 'deepseek-v9-next' }) };
    assert.ok(!ids(eligible('deepseek', 'deepseek-v4-flash', 'vision_first', unknown)).includes('deepseek'), 'unknown and untested: not seated');
    const store = new VisionCapabilityStore({ filePath: null });
    store.recordTest('deepseek', '', 'deepseek-v9-next', true);
    store.recordTest('deepseek', '', 'deepseek-v4-flash', false);
    __setVisionCapabilityStore(store);
    assert.deepEqual(eligible('deepseek', 'deepseek-v4-flash', 'vision_first', unknown), ['deepseek=deepseek-v9-next'], 'tested yes: seated');
    assert.ok(!ids(eligible('deepseek', 'deepseek-v4-flash', 'vision_first')).includes('deepseek'), 'tested text-only: not seated, whatever its name says');
  });
});

describe('a selected cURL provider', () => {
  const ids = (list) => list.map((r) => r.split('=')[0]);
  test('local and reads images: it alone runs the pre-pass, in both modes', () => {
    assert.deepEqual(ids(eligible('everything', 'curl local, reads images', 'vision_first')), ['curl']);
    assert.deepEqual(ids(eligible('everything', 'curl local, reads images', 'private_vision')), ['curl']);
  });
  test('hosted and reads images: last, after the cloud rungs; never in "keep on this device" mode', () => {
    const rungs = ids(eligible('vendors', 'curl hosted, reads images', 'vision_first'));
    assert.equal(rungs.at(-1), 'curl');
    assert.equal(rungs[0], 'natively', 'the cloud order is untouched');
    assert.deepEqual(eligible('vendors', 'curl hosted, reads images', 'private_vision'), []);
  });
  test('text-only (no image placeholder, no messages body): not seated', () => {
    assert.deepEqual(eligible('everything', 'curl local, text only', 'vision_first'), []);
  });
  test('not selected: no rung', () => {
    assert.ok(!all('everything', 'gemini-3.8-flash', 'vision_first').some((p) => p.id === 'curl' && p.isConfigured));
  });
});

describe('runVisionRequest: the two new rungs go through the existing adapters', () => {
  const stream = (name, calls) => async function* (...args) { calls.push({ name, args }); yield 'two '; yield 'pieces'; };
  test('deepseek: the selected model, with the image, collected into one string', async () => {
    const { h, calls } = bareHelper({ currentModelId: 'deepseek-v4-flash' });
    h.streamWithDeepseek = stream('deepseek', calls);
    const signal = new AbortController().signal;
    assert.equal(await h.runVisionRequest('deepseek', 'user', 'system', '/tmp/x.png', { signal }), 'two pieces');
    assert.deepEqual(calls[0].args, ['user', 'system', 'deepseek-v4-flash', signal, ['/tmp/x.png']]);
  });
  test('curl: the selected provider, with the image', async () => {
    const provider = { id: 'u1', name: 'Mine', curlCommand: 'curl http://localhost:9000', responsePath: 'text' };
    const { h, calls } = bareHelper({ activeCurlProvider: provider });
    h.streamWithDirectCurl = stream('curl', calls);
    const signal = new AbortController().signal;
    assert.equal(await h.runVisionRequest('curl', 'user', 'system', '/tmp/x.png', { signal }), 'two pieces');
    assert.deepEqual(calls[0].args, [provider, 'user', 'system', ['/tmp/x.png'], signal]);
  });
  test('curl with no provider selected: a clear error, no request', async () => {
    const { h, calls } = bareHelper({ activeCurlProvider: null });
    h.streamWithDirectCurl = stream('curl', calls);
    await assert.rejects(() => h.runVisionRequest('curl', 'u', 's', '/tmp/x.png'), /No cURL provider selected/);
    assert.equal(calls.length, 0);
  });
});
