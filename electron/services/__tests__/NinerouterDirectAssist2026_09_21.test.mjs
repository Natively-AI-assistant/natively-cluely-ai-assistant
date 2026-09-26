/**
 * Direct Assist, the cascade with no exhaustiveness guard.
 *
 * `DIRECT_ASSIST_PROVIDERS` is a const tuple referenced only by types.ts and
 * requestBuilder.ts. Nothing checks that every member has a dispatch arm, so a
 * provider can be added to the union, classified correctly, reported as
 * configured, and then fall off the end of a switch — silently. That is the
 * Fluxion failure exactly, and the reason these tests EXECUTE the chain and
 * assert on which streamer was called rather than grepping for a case label.
 *
 * Four things have to line up, and each is a separate way to fail quietly:
 *   1. the classifier claims the id BEFORE the vendor predicates;
 *   2. providerConfigured() sees the client;
 *   3. the dispatch arm exists;
 *   4. the capability id is stripped correctly, or the turn is sized against
 *      the wrong model's context window.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
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
const { DIRECT_ASSIST_PROVIDERS } = require(path.join(root, 'dist-electron/electron/direct-assist/types.js'));

// The worst-case id again: `openai/` is a real vendor segment and an OpenAI key
// is configured in the misroute test below.
const MODEL = 'ninerouter/openai/gpt-5';

function makeHelper({ model = MODEL, configured = true, alsoOpenAI = false } = {}) {
  const h = Object.create(LLMHelper.prototype);
  h.currentModelId = model;
  h.useOllama = false;
  h.customProvider = null;
  h.activeCurlProvider = null;
  h.isLocalOnlyMode = false;
  h.ollamaVisionCache = new Map();
  h.isProviderDisabled = () => false;
  if (configured) h._ninerouterClient = {};
  if (alsoOpenAI) h._openaiClient = {};
  return h;
}

describe('the provider union knows about 9Router', () => {
  test("'ninerouter' is a DirectAssistProvider", () => {
    assert.ok(DIRECT_ASSIST_PROVIDERS.includes('ninerouter'),
      'without this the request contract cannot even name the provider');
  });

  test('it is ladder-ELIGIBLE, like the other streaming gateways', () => {
    const { DIRECT_ASSIST_LADDER_INELIGIBLE_PROVIDERS } =
      require(path.join(root, 'dist-electron/electron/direct-assist/types.js'));
    // The ineligible two are blocking, non-streaming calls with no commit point.
    // 9Router streams, so a retry has a first token to reason about.
    assert.ok(!DIRECT_ASSIST_LADDER_INELIGIBLE_PROVIDERS.includes('ninerouter'));
  });
});

describe('classification happens before the vendor predicates', () => {
  const classify = (h) => LLMHelper.prototype.getDirectAssistSelection.call(h);

  test('ninerouter/openai/gpt-5 classifies as ninerouter, not openai', () => {
    const sel = classify(makeHelper());
    assert.equal(sel.provider, 'ninerouter',
      'classified late, the turn is billed to the user\'s own OpenAI key');
    assert.equal(sel.model, MODEL, 'the model stays PREFIXED — the dispatch arm strips it');
  });

  test('a gemini-shaped id is also claimed', () => {
    assert.equal(classify(makeHelper({ model: 'ninerouter/gemini/gemini-3.6-flash' })).provider, 'ninerouter');
  });

  test('a bare vendor id is still that vendor', () => {
    // The exclusion must not have been written so broadly that it swallows real
    // OpenAI ids.
    assert.equal(classify(makeHelper({ model: 'gpt-5' })).provider, 'openai');
  });
});

describe('configured-ness reads the real client', () => {
  const configured = (h, provider) => LLMHelper.prototype.directProviderHasCredential.call(h, provider);

  test('a constructed client counts as configured', () => {
    assert.equal(configured(makeHelper(), 'ninerouter'), true);
  });

  test('no client means not configured', () => {
    assert.equal(configured(makeHelper({ configured: false }), 'ninerouter'), false);
  });

  test('a switched-off 9Router is not configured', () => {
    // The disabled-aware getter is the guard, so it is the getter under test.
    const h = makeHelper();
    h.isProviderDisabled = (family) => family === 'ninerouter';
    assert.equal(configured(h, 'ninerouter'), false);
  });
});

describe('images and capabilities', () => {
  const supportsImages = (model) => LLMHelper.prototype.directSelectionSupportsImages.call(
    makeHelper({ model }), { provider: 'ninerouter', model }, null, null,
  );

  test('9Router forwards images even for a model the static table calls text-only', () => {
    // The id chosen deliberately. `ninerouter/openai/gpt-5` proves NOTHING here:
    // the switch's default branch resolves it through getModelCapabilities,
    // which strips both segments to `gpt-5` and answers true on its own — so
    // that assertion passes with or without the case label. These ids resolve
    // to FALSE by that route, so only the explicit `case 'ninerouter'` can
    // return true, and the test fails the moment the label is removed.
    for (const id of [
      'ninerouter/alicode/glm-5',
      'ninerouter/minimax/MiniMax-M2.7',
      'ninerouter/cx/a-model-the-table-has-never-seen',
    ]) {
      assert.equal(supportsImages(id), true,
        `${id}: an image-forwarding gateway must preserve the image; an unsupported `
        + 'upstream returns a normal provider error rather than a silent text-only retry');
    }
  });

  test('...and the whole point: Direct Assist has no other rung', () => {
    // The vision CHAIN gates 9Router per model, because refusing there costs
    // nothing — another rung answers. Direct Assist has no other rung: the user
    // picked this model for this question, so dropping the image would answer
    // blind and say nothing. Two different correct answers, same provider.
    assert.equal(supportsImages('ninerouter/alicode/glm-5'), true);
  });
});

describe('the dispatch arm exists and is reached', () => {
  test('a selected 9Router model reaches streamWithNinerouter', async () => {
    const h = makeHelper();
    const captured = [];
    for (const k of Object.getOwnPropertyNames(LLMHelper.prototype)) {
      if (/^streamWith/.test(k)) h[k] = async function* () { captured.push(k); yield 'ok'; };
    }
    // Drive the dispatch switch directly with a resolved selection, so this
    // asserts on the arm rather than on everything upstream of it.
    const gen = LLMHelper.prototype.streamDirectAssistFrozen.call(
      h,
      {
        selection: { provider: 'ninerouter', model: MODEL },
        systemPrompt: 'SYS',
        userPrompt: 'hello',
        imagePaths: [],
      },
      null, null, undefined,
    );
    for await (const _ of gen) { /* drain */ }
    assert.deepEqual(captured, ['streamWithNinerouter'],
      'a missing arm here falls off the switch silently — the Fluxion failure');
  });
});
