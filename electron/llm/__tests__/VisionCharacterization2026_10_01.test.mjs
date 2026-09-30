/**
 * Characterization of every screenshot decision phase 1 touches (2026-10-01).
 *
 * Phase 1 moves these decisions onto one resolver (electron/llm/visionResolver.ts).
 * The resolver's own tests prove the resolver; this proves the MOVE: for every
 * real model id in the corpus, in every form Natively stores it (direct,
 * gateway-prefixed, Gemini's `models/` form, Ollama tags), each consumer
 * answers exactly as it did at the base commit, except for the additions listed
 * in INTENDED, each with its reason. Nothing may go from "reads images" to
 * "doesn't": phase 1 only widens.
 *
 * The corpus is real: OpenRouter's public catalogue, the model lists of the
 * development OpenAI and Gemini keys, and Ollama library tags (see the fixture's
 * `sources`).
 *
 * Regenerate the baseline ONLY on the unmodified base commit:
 *   VISION_CHAR_WRITE=1 node --test electron/llm/__tests__/VisionCharacterization2026_10_01.test.mjs
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
const { getModelCapabilities } = require(dist('llm/modelCapabilities.js'));
const { LLMHelper } = require(dist('LLMHelper.js'));

const FIXTURE = path.join(__dirname, 'fixtures/visionCorpus2026_10_01.json');
const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

// Which direct provider would hold an OpenRouter vendor's bare id. Vendors
// Natively has no direct adapter for fall to 'groq', whose branch is the name
// table, the same as openai/claude/gemini.
const DIRECT_KIND = { openai: 'openai', anthropic: 'claude', google: 'gemini', deepseek: 'deepseek' };

/** Every form a corpus id is stored in, tagged with the provider kind that holds it. */
function forms(c) {
  const out = [];
  for (const id of c.openrouter) {
    out.push({ kind: 'openrouter', model: `openrouter/${id}` });
    out.push({ kind: 'litellm', model: `litellm/${id}` });
    out.push({ kind: 'ninerouter', model: `ninerouter/${id}` });
    out.push({ kind: DIRECT_KIND[id.split('/')[0]] ?? 'groq', model: id.split('/').pop() });
  }
  for (const id of c.openai) {
    out.push({ kind: 'openai', model: id });
    out.push({ kind: 'agentrouter', model: `agentrouter/${id}` });
    out.push({ kind: 'fluxion', model: `fluxion/${id}` });
  }
  for (const id of c.gemini) {
    out.push({ kind: 'gemini', model: id });
    out.push({ kind: 'gemini', model: `models/${id}` });
  }
  for (const tag of c.ollama) out.push({ kind: 'ollama', model: tag });
  return out;
}

function helper(state = {}) {
  const h = Object.create(LLMHelper.prototype);
  Object.assign(h, {
    useOllama: false, customProvider: null, activeCurlProvider: null, currentModelId: '',
    ollamaVisionCache: new Map(), ninerouterVisionModels: new Set(), ...state,
  });
  return h;
}

/** The `consumer|kind|model` keys whose answer is "reads images". */
function answers() {
  const yes = new Set();
  const plain = helper();
  // A fetched catalogue that marks only gpt-5, so every other 9Router id is a catalogue "no".
  const catalogued = helper({ ninerouterVisionModels: new Set(['openai/gpt-5']) });
  for (const { kind, model } of forms(fixture)) {
    const put = (consumer, value) => { if (value) yes.add(`${consumer}|${kind}|${model}`); };
    put('names', getModelCapabilities(model, kind === 'ollama').supportsImages);
    put('direct', plain.directSelectionSupportsImages({ provider: kind, model }, null, null));
    if (kind === 'ninerouter') {
      put('ninerouter-uncatalogued', plain.ninerouterModelSupportsVision(model));
      put('ninerouter-catalogued', catalogued.ninerouterModelSupportsVision(model));
    }
    if (kind === 'agentrouter') put('agentrouter', plain.agentRouterModelSupportsVision(model));
  }
  return yes;
}

const lastSegment = (key) => key.split('|')[2].split('/').pop().toLowerCase();

/**
 * Every widening phase 1 makes on purpose. A key that turns "yes" must match
 * one of these, and every rule must still match something: a rule that matches
 * nothing is stale, and a stale rule is where the next surprise hides.
 */
const OPENAI_EXTRA = /^(?:o[13](?:-pro)?|o4-mini(?:-high)?|gpt-4-turbo)(?:-\d{4}-\d{2}-\d{2})?$/;
// The Ollama families the drifted copy in modelCapabilities.ts lacked.
const OLLAMA_NEWLY_LISTED = /llama-?4|qwen[0-9.]*-?vl|granite3\.2-vision|mistral-small3\.1|llama-?guard3-vision/;
const INTENDED = [
  { why: 'OpenAI o1/o1-pro/o3/o3-pro/o4-mini/gpt-4-turbo read images (verified 2026-10-01)',
    match: (k) => OPENAI_EXTRA.test(lastSegment(k)) },
  { why: "Gemini's `models/` listing form reads like the bare id",
    match: (k) => k.split('|')[2].startsWith('models/gemini-') },
  { why: 'one Ollama list: the shared list covers families the drifted copy lacked (incl. the no-dash qwen2.5vl)',
    match: (k) => k.split('|')[1] === 'ollama' && OLLAMA_NEWLY_LISTED.test(k.split('|')[2].toLowerCase()) },
];

test('the corpus is the real one', () => {
  assert.ok(fixture.openrouter.length > 300, 'OpenRouter catalogue');
  assert.ok(fixture.openai.length > 30, 'OpenAI key model list');
  assert.ok(fixture.gemini.length > 20, 'Gemini key model list');
  assert.ok(fixture.ollama.length > 30, 'Ollama tags');
});

test('phase 1 changes no screenshot decision except the intended additions', () => {
  if (process.env.VISION_CHAR_WRITE === '1') {
    fixture.baseline = [...answers()].sort();
    fs.writeFileSync(FIXTURE, JSON.stringify(fixture, null, 1) + '\n');
    return;
  }
  assert.ok(fixture.baseline.length > 500, 'baseline was never written');
  const before = new Set(fixture.baseline);
  const now = answers();
  const lost = [...before].filter((k) => !now.has(k));
  assert.deepEqual(lost, [], 'phase 1 only widens: these stopped reading images');
  const gained = [...now].filter((k) => !before.has(k));
  const unexplained = gained.filter((k) => !INTENDED.some((r) => r.match(k)));
  assert.deepEqual(unexplained, [], 'new "reads images" answers with no stated reason');
  for (const r of INTENDED) assert.ok(gained.some((k) => r.match(k)), `stale rule: ${r.why}`);
});
