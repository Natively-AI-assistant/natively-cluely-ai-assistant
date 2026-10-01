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

/** What `before` must have become. One named rule per allowed difference; none yet. */
function expected(_name, before) {
  return before;
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
