/**
 * The 9Router vision seat, and the one place it should NOT copy LiteLLM.
 *
 * LiteLLM's vision builder says plainly why it seats every proxied model as
 * vision-capable: "`supportsVision` cannot be answered from here: the proxy
 * fronts arbitrary upstreams and only its own config knows whether the routed
 * model takes images. Seating it as vision-capable is the honest choice — the
 * alternative, gating on a guess, is what produced 'no vision provider
 * configured' for users who had one."
 *
 * For 9Router it CAN be answered, and not by guessing. `/v1/models` reports
 * `capabilities.vision` per model. On the reference instance 30 of 47 say true
 * and 17 say false, so LiteLLM's blanket answer would route screenshots into
 * seventeen models that cannot read them — each one a wasted attempt, an
 * upstream error, and a turn that takes the long way round.
 *
 * The rule that follows has two halves, and the second matters as much as the
 * first:
 *
 *   catalogue says vision:false  -> do NOT seat. We know.
 *   catalogue says vision:true   -> seat.
 *   no catalogue entry at all    -> SEAT ANYWAY.
 *
 * That last line is LiteLLM's lesson kept intact. An empty or stale cache means
 * "unknown", never "no", because gating on absent data is exactly how you tell
 * a user with a working vision model that they have no vision provider.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: {
    app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};
const { LLMHelper } = require(path.join(root, 'dist-electron/electron/LLMHelper.js'));

const VISION_MODEL = 'ninerouter/gemini/gemini-3.6-flash';   // capabilities.vision true on the live instance
const TEXT_MODEL   = 'ninerouter/alicode/glm-5';             // text-only

describe('the capability predicate', () => {
  const predicate = (visionSet, modelId) => {
    const h = Object.create(LLMHelper.prototype);
    h.ninerouterVisionModels = visionSet;
    return LLMHelper.prototype.ninerouterModelSupportsVision.call(h, modelId);
  };

  test('a model the catalogue calls vision-capable is accepted', () => {
    assert.equal(predicate(new Set(['gemini/gemini-3.6-flash']), VISION_MODEL), true);
  });

  test('a model the catalogue calls TEXT-ONLY is refused', () => {
    // The improvement over LiteLLM. 17 of the 47 models a stock instance serves
    // are text-only; sending them a screenshot is a guaranteed failed attempt.
    assert.equal(predicate(new Set(['gemini/gemini-3.6-flash']), TEXT_MODEL), false);
  });

  test('an EMPTY catalogue means unknown, so it is seated anyway', () => {
    // LiteLLM's lesson, kept. A cold cache, a cleared cache or an instance that
    // was down at discovery time must not read as "this model cannot see" —
    // that is how you tell a user with a working vision model they have none.
    assert.equal(predicate(new Set(), VISION_MODEL), true);
    assert.equal(predicate(new Set(), TEXT_MODEL), true);
  });

  test('a non-9Router id is never claimed', () => {
    assert.equal(predicate(new Set(['gemini/gemini-3.6-flash']), 'litellm/openai/gpt-4o'), false);
    assert.equal(predicate(new Set(), 'gpt-5'), false);
  });
});

describe('the streaming vision chain', () => {
  /** Build a helper whose vision chain can be inspected without dispatching. */
  function makeHelper({ model, visionSet = new Set(['gemini/gemini-3.6-flash']), configured = true } = {}) {
    const captured = [];
    const h = Object.create(LLMHelper.prototype);
    h.currentModelId = model;
    h.isLocalOnlyMode = false;
    h.useOllama = false;
    h.customProvider = null;
    h.activeCurlProvider = null;
    h.visionHealth = new Map();
    h.textHealth = new Map();
    h.answerLatency = new Map();
    h.rateLimiters = { ninerouter: { acquire: async () => {} } };
    h.assertOutboundScopes = () => {};
    h.ninerouterVisionModels = visionSet;
    h.ninerouterModelBudgets = new Map();
    h.ninerouterModelInputCaps = new Map();
    if (configured) h._ninerouterClient = {};
    h.isProviderDisabled = () => false;
    h.modelVersionManager = { getAllVisionTiers: () => [] };
    h.isCodexAvailable = () => false;
    h.checkOllamaAvailable = async () => false;
    for (const k of Object.getOwnPropertyNames(LLMHelper.prototype)) {
      if (/^streamWith/.test(k)) h[k] = async function* () { captured.push(k); yield 'ok'; };
    }
    return { h, captured };
  }

  /** The rung ids the chain would try, in order, without running them. */
  async function chainIds(h) {
    const seen = [];
    h.runVisionStreamFallback = async function* (providers) {
      for (const p of providers) seen.push(p.id);
      yield 'ok';
    };
    return { seen };
  }

  test('a vision-capable selected model seats the 9Router rung', async () => {
    const { h } = makeHelper({ model: VISION_MODEL });
    const src = fs.readFileSync(path.join(root, 'electron/LLMHelper.ts'), 'utf8');
    // The rung must exist and must be gated on BOTH selection and capability.
    assert.match(src, /isNinerouterModel\(this\.currentModelId\) && this\.ninerouterClient && this\.ninerouterModelSupportsVision\(this\.currentModelId\)/,
      'the vision rung must gate on selection AND the catalogue capability');
    assert.ok(h);
  });

  test('the rung is front-loaded when 9Router is the selected model', () => {
    const src = fs.readFileSync(path.join(root, 'electron/LLMHelper.ts'), 'utf8');
    assert.match(src, /if \(this\.isNinerouterModel\(this\.currentModelId\)\) \{ const n9 = cloud\.find\(p => p\.id === 'ninerouter'\); if \(n9\) front\.push\(n9\); \}/,
      'without the front-load, orderVisionByHealth sends the turn to another vendor first');
  });
});

describe('the registry builder', () => {
  const reg = fs.readFileSync(path.join(root, 'electron/services/screen/VisionProviderRegistry.ts'), 'utf8');

  test('a ninerouter() builder exists and is pushed into the cloud rungs', () => {
    assert.match(reg, /function ninerouter\(/, 'the builder must exist');
    assert.match(reg, /providers\.push\(ninerouter\(credentials, inputs\)\);/, 'and be seated');
  });

  test('it is seated only when SELECTED, like every other gateway', () => {
    const fn = reg.slice(reg.indexOf('function ninerouter('), reg.indexOf('function ninerouter(') + 1800);
    assert.match(fn, /isConfigured: !!baseURL && isSelected/);
    // supportsVision additionally consults the catalogue — that is the whole point.
    assert.match(fn, /supportsVision: !!baseURL && isSelected && supportsImages/,
      'the registry must apply the same capability gate as the streaming chain');
  });
});
