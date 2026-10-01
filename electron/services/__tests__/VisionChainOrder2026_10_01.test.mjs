/**
 * Who reads a screenshot, and in what order (2026-10-01).
 *
 * Phase 5a moves the user's SELECTED model to the front of the chat screenshot
 * chain. This records the order for every combination of configured keys and
 * selected model BEFORE that change, so the change can be held to exactly one
 * difference: the selection's own rung leads. Every other rung keeps its place.
 *
 * Regenerate the baseline ONLY on the commit that extracted buildVisionChain
 * and changed nothing else:
 *   VISION_ORDER_WRITE=1 node --test electron/services/__tests__/VisionChainOrder2026_10_01.test.mjs
 */
import { test } from 'node:test';
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
__setVisionCapabilityStore(new VisionCapabilityStore({ filePath: null }));

const FIXTURE = path.join(__dirname, 'fixtures/visionChainOrder2026_10_01.json');

const TIERS = [
  { family: 'openai', tier1: 'gpt-5.4', tier2: 'gpt-5.4', tier3: 'gpt-5.4' },
  { family: 'claude', tier1: 'claude-sonnet-4-6', tier2: 'claude-sonnet-4-6', tier3: 'claude-sonnet-4-6' },
  { family: 'gemini_flash', tier1: 'gemini-3.8-flash', tier2: 'gemini-3.8-flash', tier3: 'gemini-3.8-flash' },
  { family: 'gemini_pro', tier1: 'gemini-3.1-pro-preview', tier2: 'gemini-3.1-pro-preview', tier3: 'gemini-3.1-pro-preview' },
];
// Which providers are configured. Each name maps to the state that makes its rung possible.
const KEYS = {
  openai: { openaiClient: {} }, claude: { claudeClient: {} }, gemini: { client: {} }, groq: { groqClient: {} },
  natively: { hasNatively: () => true }, deepseek: { deepseekClient: {} }, openrouter: { openrouterClient: {} },
  litellm: { litellmClient: {} }, nvidia_nim: { nvidiaNimClient: {} }, ninerouter: { ninerouterClient: {} },
  fluxion: { hasFluxionCredential: () => true }, agentrouter: { hasAgentRouterCredential: () => true },
  codex: { isCodexAvailable: () => true },
  // As the real method: the user's own Antigravity selection, else the first discovered model.
  antigravity: { antigravityFallbackModel() { return this.currentModelId.startsWith('antigravity:') ? this.currentModelId.slice('antigravity:'.length) : 'gemini-3-pro-high'; } },
};
const VENDORS = ['openai', 'claude', 'gemini', 'groq', 'natively'];
const EVERYTHING = [...VENDORS, 'deepseek', 'openrouter', 'litellm', 'nvidia_nim', 'ninerouter', 'fluxion', 'agentrouter', 'codex', 'antigravity'];
const KEY_SETS = [
  [], ['gemini'], ['openai'], ['claude'], ['deepseek'], ['openai', 'gemini'], ['claude', 'gemini'], VENDORS, EVERYTHING,
];
// A selection is a model id, or `[label, state]` for the ones that are not just an id.
const SELECTIONS = [
  'gpt-5.4', 'gpt-5.5', 'o3', 'gpt-3.5-turbo', 'claude-sonnet-4-6', 'claude-opus-5', 'gemini-3.1-flash-lite', 'gemini-3.8-flash',
  'gemini-3.1-pro-preview', 'gemini-2.5-flash', 'qwen/qwen3.8-27b', 'llama-3.3-70b-versatile', 'natively', 'deepseek-v4-flash',
  'deepseek-v4-pro', 'openrouter/openai/gpt-4o', 'fluxion/claude-opus-5', 'agentrouter/gpt-6-astra', 'litellm/internal-model',
  'nvidia_nim/meta/llama-3.2-90b-vision-instruct', 'ninerouter/openai/gpt-5', 'codex-cli', 'antigravity:claude-opus-5',
  ['ollama llava', { useOllama: true, ollamaModel: 'llava', ollamaVisionModel: 'llava', currentModelId: 'gemini-3.8-flash' }],
  ['custom with an image placeholder', { customProvider: { id: 'c1', name: 'Mine', curlCommand: 'curl https://example.com -d \'{"image":"{{IMAGE_BASE64}}"}\'' }, currentModelId: 'gemini-3.8-flash' }],
];

function helper(keys, selection) {
  const [, state] = Array.isArray(selection) ? selection : [selection, { currentModelId: selection }];
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
  });
  for (const k of keys) Object.assign(h, KEYS[k]);
  Object.assign(h, state);
  return h;
}

const REQ = { userContent: 'u', message: 'm', imagePaths: ['/tmp/x.png'], systemPrompt: 's' };

/** `case → [rung id, …]`, or `["THROWS: <first words>"]` when nothing can read the screenshot. */
async function orders() {
  const out = {};
  for (const keys of KEY_SETS) for (const selection of SELECTIONS) {
    const label = Array.isArray(selection) ? selection[0] : selection;
    const h = helper(keys, selection);
    let ids;
    try { ids = (await h.buildVisionChain(REQ)).map((p) => p.id); }
    catch (e) { ids = [`THROWS: ${String(e.message).split('.').slice(0, 2).join('.')}`]; }
    out[`[${keys.join(',')}] ${label}`] = ids;
  }
  return out;
}

/** Rung ids that belong to a selection: the ones allowed to move to (or appear at) the front. */
function ownRungs(label) {
  if (/^(?:gpt-|o\d)/.test(label)) return ['openai_selected', 'openai'];
  if (label.startsWith('claude-')) return ['claude_selected', 'claude'];
  if (label.startsWith('gemini-')) return ['gemini_selected', 'gemini_flash_lite', 'gemini_flash', 'gemini_pro'];
  if (label === 'natively') return ['natively'];
  if (label.startsWith('antigravity:')) return ['antigravity'];
  if (label.startsWith('qwen/') || label.startsWith('llama-')) return ['groq'];
  return [];
}

test('the chain order changes only by the selection moving to the front', async () => {
  const now = await orders();
  if (process.env.VISION_ORDER_WRITE === '1') {
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, JSON.stringify({ written: '2026-10-01', note: 'order at the buildVisionChain extraction commit, before phase 5a', orders: now }, null, 1) + '\n');
    return;
  }
  const before = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).orders;
  assert.deepEqual(Object.keys(now).sort(), Object.keys(before).sort(), 'the case list changed');
  for (const [name, was] of Object.entries(before)) {
    const is = now[name];
    if (JSON.stringify(is) === JSON.stringify(was)) continue;
    const label = name.slice(name.indexOf('] ') + 2);
    const own = ownRungs(label);
    assert.ok(own.includes(is[0]), `${name}: the first rung is ${is[0]}, which is not the selection's own (was ${was.join(' > ')}; now ${is.join(' > ')})`);
    const rest = is.slice(1).filter((id) => id !== is[0]);
    const wasRest = was.filter((id) => id !== is[0]);
    assert.deepEqual(rest, wasRest, `${name}: rungs other than the selection's changed order (was ${was.join(' > ')}; now ${is.join(' > ')})`);
  }
});

const chainIds = async (keys, selection, state = {}) => {
  const h = Object.assign(helper(keys, selection), state);
  return (await h.buildVisionChain(REQ)).map((p) => p.id);
};
const coolingUntil = (id, until) => new Map([[id, { openUntil: until, consecutiveFails: 3, ttftEma: null }]]);

test('a selected model whose breaker is open does not lead its screenshot turn; it leads again after', async () => {
  const cooling = await chainIds(EVERYTHING, 'fluxion/claude-opus-5', { visionHealth: coolingUntil('fluxion', Date.now() + 60_000) });
  assert.equal(cooling[0], 'openai', `a failing selection must not cost its first-token budget on every screenshot (got ${cooling.join(' > ')})`);
  assert.equal(cooling.at(-1), 'fluxion', 'still tried, last');
  const recovered = await chainIds(EVERYTHING, 'fluxion/claude-opus-5', { visionHealth: coolingUntil('fluxion', Date.now() - 1) });
  assert.equal(recovered[0], 'fluxion');
});
