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

// ── Phase 5a: a selected direct model reads its own screenshot (defect 10) ────

const chainOf = async (keys, selection, state = {}) => {
  const h = Object.assign(helper(keys, selection), state);
  const chain = await h.buildVisionChain(REQ);
  return { h, chain, ids: chain.map((p) => p.id), names: chain.map((p) => p.name) };
};
const drain = async (gen) => { for await (const _ of gen) { /* drain */ } };

test('a selected Gemini model leads even when an OpenAI key exists', async () => {
  assert.equal((await chainOf(['openai', 'gemini'], 'gemini-3.8-flash')).ids[0], 'gemini_flash');
  assert.equal((await chainOf(VENDORS, 'gemini-3.1-pro-preview')).ids[0], 'gemini_pro');
  assert.equal((await chainOf(VENDORS, 'gemini-3.1-flash-lite')).ids[0], 'gemini_flash_lite');
});
test('a `models/`-prefixed Gemini id is the same model: no second rung for it', async () => {
  const r = await chainOf(VENDORS, 'models/gemini-3.8-flash');
  assert.equal(r.ids[0], 'gemini_flash');
  assert.ok(!r.ids.includes('gemini_selected'));
});
test('a selected Gemini model that is none of the three fixed ones gets its own rung, for that model', async () => {
  const r = await chainOf(VENDORS, 'gemini-2.5-flash');
  assert.equal(r.ids[0], 'gemini_selected');
  assert.match(r.names[0], /gemini-2\.5-flash/);
  assert.deepEqual(r.ids.slice(1), ['openai', 'claude', 'gemini_flash_lite', 'gemini_flash', 'gemini_pro', 'groq', 'natively'], 'everything else keeps its place');
});
test('a selected OpenAI or Claude model reads with ITSELF; the fixed vision model stays as the fallback', async () => {
  const o = await chainOf(VENDORS, 'gpt-5.5');
  assert.deepEqual(o.ids.slice(0, 2), ['openai_selected', 'openai']);
  assert.match(o.names[0], /gpt-5\.5/);
  const c = await chainOf(VENDORS, 'claude-opus-5');
  assert.equal(c.ids[0], 'claude_selected');
  assert.match(c.names[0], /claude-opus-5/);
  assert.ok(c.ids.includes('claude'), 'the fixed Claude vision model is still there to fall back to');
  // (`o3-pro`, not bare `o3`: isOpenAiModel does not claim a bare o-series id, so the app cannot route one at all.)
  assert.equal((await chainOf(VENDORS, 'o3-pro')).ids[0], 'openai_selected');
});
test('a selection equal to the fixed vision model is not tried twice', async () => {
  const o = await chainOf(VENDORS, 'gpt-5.4');
  assert.equal(o.ids[0], 'openai');
  assert.ok(!o.ids.includes('openai_selected'));
  const c = await chainOf(VENDORS, 'claude-sonnet-4-6');
  assert.equal(c.ids[0], 'claude');
  assert.ok(!c.ids.includes('claude_selected'));
});
test('a text-only selected model gets no rung of its own: the vendor vision model answers', async () => {
  const r = await chainOf(['openai'], 'gpt-3.5-turbo');
  assert.deepEqual(r.ids, ['openai']);
  assert.doesNotMatch(r.names.join(' '), /gpt-3\.5/);
});
test('a model nothing is known about gets no rung of its own until its test passes; a failed test keeps it out', async () => {
  const before = await chainOf(VENDORS, 'gpt-next-unknown');
  assert.ok(!before.ids.includes('openai_selected'));
  try {
    const yes = new VisionCapabilityStore({ filePath: null }); yes.recordTest('openai', '', 'gpt-next-unknown', true);
    __setVisionCapabilityStore(yes);
    assert.equal((await chainOf(VENDORS, 'gpt-next-unknown')).ids[0], 'openai_selected');
    const no = new VisionCapabilityStore({ filePath: null }); no.recordTest('openai', '', 'gpt-5.5', false);
    __setVisionCapabilityStore(no);
    const refused = await chainOf(VENDORS, 'gpt-5.5');
    assert.ok(!refused.ids.includes('openai_selected'), 'a model TESTED as text-only is not sent the screenshot, whatever its name says');
    assert.equal(refused.ids[0], 'openai');
  } finally { __setVisionCapabilityStore(new VisionCapabilityStore({ filePath: null })); }
});
test('Natively selected leads; a selected Groq vision model leads; a Groq text model does not', async () => {
  assert.equal((await chainOf(VENDORS, 'natively')).ids[0], 'natively');
  const g = await chainOf(VENDORS, 'qwen/qwen3.8-27b');
  assert.equal(g.ids[0], 'groq');
  assert.match(g.names[0], /qwen3\.8-27b/);
  const t = await chainOf(VENDORS, 'llama-3.3-70b-versatile');
  assert.equal(t.ids[0], 'openai');
  assert.doesNotMatch(t.names.join(' '), /llama-3\.3/, 'the Groq rung still uses the Groq vision model');
});
test('a selected Antigravity model leads', async () => {
  const r = await chainOf(EVERYTHING, 'antigravity:claude-opus-5');
  assert.equal(r.ids[0], 'antigravity');
  assert.match(r.names[0], /claude-opus-5/);
});
test('no key, or the provider switched off: no rung for the selection, and the chain still works', async () => {
  const noKey = await chainOf(['gemini'], 'gpt-5.5');
  assert.deepEqual(noKey.ids, ['gemini_flash_lite', 'gemini_flash', 'gemini_pro']);
  const off = await chainOf(VENDORS, 'gpt-5.5', { isProviderDisabled: (p) => p === 'openai' });
  assert.ok(!off.ids.some((id) => id.startsWith('openai')), off.ids.join(' > '));
  assert.equal(off.ids[0], 'claude');
});
test('Ollama or a custom provider selected: a leftover cloud model id does not lead', async () => {
  const o = await chainOf(VENDORS, SELECTIONS.find((s) => Array.isArray(s) && s[0] === 'ollama llava'));
  assert.deepEqual(o.ids.slice(0, 2), ['ollama', 'openai']);
  const c = await chainOf(VENDORS, SELECTIONS.find((s) => Array.isArray(s) && s[0].startsWith('custom')));
  assert.deepEqual(c.ids.slice(0, 2), ['custom', 'openai']);
});
test('local-only mode: a selected cloud model gets no rung', async () => {
  await assert.rejects(() => chainOf(VENDORS, 'gpt-5.5', { isLocalOnlyMode: true }), /Local-only mode is on/);
});
test('each selected rung opens the SELECTED model, with the screenshot', async () => {
  const calls = [];
  const stubs = {
    streamWithOpenaiMultimodal: async function* (_u, imgs, _sys, model) { calls.push(['openai', model, imgs.length]); yield 'ok'; },
    streamWithClaudeMultimodal: async function* (_u, imgs, _sys, model) { calls.push(['claude', model, imgs.length]); yield 'ok'; },
    streamWithGeminiModel: async function* (_u, model, imgs) { calls.push(['gemini', model, imgs.length]); yield 'ok'; },
    streamWithGroqMultimodal: async function* (_u, imgs, _sys, _sig, model) { calls.push(['groq', model, imgs.length]); yield 'ok'; },
  };
  for (const model of ['gpt-5.5', 'claude-opus-5', 'gemini-2.5-flash', 'qwen/qwen3.6-27b']) {
    const { chain } = await chainOf(VENDORS, model, stubs);
    await drain(chain[0].open(new AbortController().signal, 1));
  }
  assert.deepEqual(calls, [['openai', 'gpt-5.5', 1], ['claude', 'claude-opus-5', 1], ['gemini', 'gemini-2.5-flash', 1], ['groq', 'qwen/qwen3.6-27b', 1]]);
});
test('a selected rung refused as image-unsupported re-tests the selected model', async () => {
  const forced = [];
  // Only the SELECTED model refuses; the vendor's fixed vision model answers.
  const openai = async function* (_u, _imgs, _sys, model) {
    if (model === 'gpt-5.5') { const e = new Error('This model does not support image input'); e.status = 400; throw e; }
    yield `seen by ${model}`;
  };
  const h = Object.assign(helper(['openai', 'gemini'], 'gpt-5.5'), {
    streamWithOpenaiMultimodal: openai,
    maybeProbeSelectedVision: (o) => { if (o?.force) forced.push(o); },
  });
  const out = [];
  for await (const t of h.streamVisionWithFallback(REQ)) out.push(t);
  assert.deepEqual(out, ['seen by gpt-5.4'], 'the screenshot is still answered, by the next rung');
  assert.equal(forced.length, 1, 'the refusal contradicts "reads images": test the selected model again');
});
