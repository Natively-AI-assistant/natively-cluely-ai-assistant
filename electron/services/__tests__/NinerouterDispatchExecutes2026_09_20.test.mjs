/**
 * Does a selected 9Router model ACTUALLY reach the 9Router adapter?
 *
 * Deliberately modelled on FluxionDispatchExecutes2026_09_18.test.mjs rather
 * than on FluxionProvider2026_09_18.test.mjs. The latter is 27 source-text
 * ordering guards that all passed while `_streamChatInner` had no Fluxion
 * branch at all: every predicate correctly EXCLUDED a `fluxion/` id from the
 * other vendors, the turn fell through, and Gemini answered it on the user's
 * own key. Excluding a family from the predicates prevents misrouting; it says
 * nothing about a dispatch branch nobody wrote.
 *
 * 9Router is the same trap with a sharper edge. Its ids are vendor-namespaced
 * (`ninerouter/gemini/gemini-3.6-flash`, `ninerouter/openai/gpt-5`), so a
 * missing branch does not merely fall through to *a* vendor — it falls through
 * to the vendor whose name is literally inside the id, on the user's own key,
 * and the log line naming Gemini looks exactly right.
 *
 * So these tests EXECUTE the cascade and assert on WHICH STREAMER WAS CALLED.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);

// CredentialsManager computes paths from app.getPath() at MODULE scope; without
// this shim the import throws, the read fails open, and every assertion below
// would silently test nothing.
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: {
    app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};

const { LLMHelper } = require(dist('LLMHelper.js'));

// The worst-case id on purpose: `gemini/` is a real vendor segment, and a
// Gemini key is configured in the silent-misroute test below.
const NINEROUTER_MODEL = 'ninerouter/gemini/gemini-3.6-flash';

function makeHelper({ model = NINEROUTER_MODEL, alsoGemini = false, ninerouterConfigured = true } = {}) {
  const captured = [];
  const h = Object.create(LLMHelper.prototype);
  h.useOllama = false;
  h.checkOllamaAvailable = async () => false;
  h.ensureOllamaModelSelected = async () => false;
  h.currentModelId = model;
  h.pickConfiguredCustomProviderForFallback = () => null;
  h.getActiveModeGroundingInfo = () => null;
  h.isLocalOnlyMode = false;
  h.customProvider = null;
  h.activeCurlProvider = null;
  h.textHealth = new Map();
  h.visionHealth = new Map();
  h.rateLimiters = { ninerouter: { acquire: async () => {} } };
  // answerLatencyKey() returns `model:<id>` for a user endpoint, so the failover
  // wrapper reads this map on the way in. Reaching it at all is evidence the
  // 9Router branch fired — an unstubbed map threw there, not before.
  h.answerLatency = new Map();
  h.assertOutboundScopes = () => {};
  h.ninerouterMaxTokens = undefined;
  h.ninerouterModelBudgets = new Map();
  // The base URL is the presence gate, matching LiteLLM: a 9Router instance
  // running with REQUIRE_API_KEY=false is legitimately keyless.
  if (ninerouterConfigured) h._ninerouterClient = {};
  // The competing provider. Its presence is what turns a missing 9Router branch
  // from a loud failure into a SILENT one, so the important test configures it.
  if (alsoGemini) h._client = {};
  for (const k of Object.getOwnPropertyNames(LLMHelper.prototype)) {
    if (/^(streamWith|generateWith)/.test(k)) {
      h[k] = async function* () { captured.push(k); yield 'ok'; };
    }
  }
  // The Gemini cascade is not a streamWith* name, so it needs its own recorder —
  // without this the silent-misroute test would pass for the wrong reason.
  h.streamGeminiTextCascade = async function* () { captured.push('streamGeminiTextCascade'); yield 'ok'; };
  return { h, captured };
}

async function drainInner(h) {
  let error = null;
  try {
    for await (const _ of LLMHelper.prototype._streamChatInner.call(
      h, 'hello', undefined, undefined, 'SYS', true, true, [], undefined, 0, { v3Owned: true },
    )) { /* drain */ }
  } catch (e) { error = e; }
  return error;
}

describe('the primary answer path dispatches to 9Router', () => {
  test('BASELINE: a selected 9Router model reaches streamWithNinerouter', async () => {
    const { h, captured } = makeHelper();
    const error = await drainInner(h);
    assert.equal(error, null, `the turn must succeed, got: ${error?.message}`);
    assert.deepEqual(captured, ['streamWithNinerouter'],
      'a selected 9Router model must be answered by 9Router');
  });

  test('THE SILENT BUG: `ninerouter/gemini/...` is not answered by Gemini on the user\'s own key', async () => {
    // The Fluxion failure reproduced against the id shape that makes it worse:
    // the vendor segment inside the id is the very vendor that would pick it up.
    const { h, captured } = makeHelper({ alsoGemini: true });
    const error = await drainInner(h);
    assert.equal(error, null, `the turn must succeed, got: ${error?.message}`);
    assert.ok(!captured.includes('streamGeminiTextCascade'),
      `WRONG VENDOR: the turn was answered by Gemini on the user's own key. Captured: ${captured.join(', ')}`);
    assert.deepEqual(captured, ['streamWithNinerouter']);
  });

  test('a 9Router-only profile is not told "No AI provider configured"', async () => {
    const { h, captured } = makeHelper({ alsoGemini: false });
    const error = await drainInner(h);
    assert.equal(error, null,
      `a user whose only provider is 9Router must get an answer, not: ${error?.message}`);
    assert.deepEqual(captured, ['streamWithNinerouter']);
  });

  test('not configured: it does NOT fall through to another vendor', async () => {
    const { h, captured } = makeHelper({ ninerouterConfigured: false, alsoGemini: true });
    await drainInner(h);
    assert.ok(!captured.includes('streamWithNinerouter'),
      'no client — 9Router must not be called');
  });

  test('a switched-off 9Router is never dispatched', async () => {
    // The disabled-aware getter, not PROVIDER_LABEL_FAMILY, is the real guard
    // for the gateways — so it is the getter that gets exercised.
    const { h, captured } = makeHelper({ alsoGemini: true });
    h.isProviderDisabled = (family) => family === 'ninerouter';
    await drainInner(h);
    assert.ok(!captured.includes('streamWithNinerouter'),
      'LEAK: the payload was sent to a provider the user switched off');
  });
});

describe('the 9Router predicates claim their own ids', () => {
  test('isNinerouterModel claims a prefixed id and nothing else', () => {
    const isNinerouter = LLMHelper.prototype.isNinerouterModel;
    assert.equal(typeof isNinerouter, 'function', 'isNinerouterModel must exist');
    assert.equal(isNinerouter.call({}, NINEROUTER_MODEL), true);
    assert.equal(isNinerouter.call({}, 'ninerouter/openai/gpt-5'), true);
    // The ids 9Router's own catalogue is full of, unprefixed. These belong to
    // the real vendors and must NOT be claimed.
    assert.equal(isNinerouter.call({}, 'gemini-3.6-flash'), false);
    assert.equal(isNinerouter.call({}, 'openai/gpt-5'), false);
    assert.equal(isNinerouter.call({}, 'litellm/openai/gpt-5'), false);
    assert.equal(isNinerouter.call({}, 'openrouter/openai/gpt-5'), false);
  });
});

describe('the vendor segment inside a 9Router id never claims the turn', () => {
  // 9Router's live catalogue is vendor-namespaced: `openai/gpt-5`,
  // `gemini/gemini-3.6-flash`, `cc/claude-opus-5`. Prefixed, those become ids
  // the vendor predicates match on their own terms — isOpenAiModel() ends in
  // `modelId.includes("openai")`, which `ninerouter/openai/gpt-5` satisfies.
  //
  // isOpenAiModel already carries two exclusions for exactly this, for Groq and
  // for Fluxion, and its own comment says why they live there rather than in
  // branch ordering: "Excluding it here covers the non-streaming cascade, the
  // streaming cascade and the direct-assist chain at once, so none of them
  // depends on branch order staying correct." 9Router needs the third.
  const OPENAI_SHAPED = 'ninerouter/openai/gpt-5';

  test('isOpenAiModel does not claim ninerouter/openai/*', () => {
    const h = Object.create(LLMHelper.prototype);
    assert.equal(h.isOpenAiModel(OPENAI_SHAPED), false,
      'BILLING LEAK: the id would be routed to api.openai.com on the user\'s own OpenAI key');
    // The bare id is genuinely OpenAI's and must still be claimed, or the
    // exclusion has been written too broadly.
    assert.equal(h.isOpenAiModel('gpt-5'), true);
  });

  test('with an OpenAI key configured, ninerouter/openai/gpt-5 still reaches 9Router', async () => {
    const { h, captured } = makeHelper({ model: OPENAI_SHAPED });
    h._openaiClient = {};   // the competing vendor, named inside the id itself
    const error = await drainInner(h);
    assert.equal(error, null, `the turn must succeed, got: ${error?.message}`);
    assert.ok(!captured.includes('streamWithOpenAI'),
      `WRONG VENDOR: billed to the user's own OpenAI key. Captured: ${captured.join(', ')}`);
    assert.deepEqual(captured, ['streamWithNinerouter']);
  });
});
