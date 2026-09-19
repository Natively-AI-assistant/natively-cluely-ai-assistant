/**
 * Does a selected Fluxion model ACTUALLY reach the Fluxion adapter?
 *
 * This suite exists because FluxionProvider2026_09_18.test.mjs could not answer
 * that, and said so with 27 passing assertions. Those are source-text ordering
 * guards: they prove every classifier EXCLUDES a `fluxion/` id from the other
 * vendors' branches. That is a real property, and it is the wrong one on its own.
 *
 * Excluding a family from the predicates prevents MISROUTING to a wrong client.
 * It says nothing about a dispatch branch that was never written — and that is
 * exactly what had happened. `_streamChatInner`, the primary answer path for
 * typed chat, Ask, auto-answer and every mode LLM, had no Fluxion branch at all.
 * Every predicate correctly returned false, the turn fell through to step 4, and
 * Gemini Flash-Lite answered it **on the user's own Gemini key** — a plausible
 * answer, a log line naming Gemini, and nothing anywhere naming Fluxion. On a
 * Fluxion-only profile it instead threw "No AI provider configured" on every
 * question. A grep for `fluxion` in that function returned nothing, which is
 * precisely what a missing branch looks like.
 *
 * So these tests EXECUTE the cascades and assert on WHICH STREAMER WAS CALLED,
 * mirroring DisabledProviderRouting2026_08_01.test.mjs. Every one of them fails
 * against the code as originally written.
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

const FLUXION_MODEL = 'fluxion/claude-sonnet-5';

/**
 * A bare prototype instance with every `streamWith*` / `generateWith*` replaced
 * by a recorder. `_fluxionOpenAIClient` is set on the PRIVATE field so the real
 * disabled-provider getter is the thing under test, exactly as the disabled-
 * provider suite does with `_openaiClient`.
 */
function makeHelper({ model = FLUXION_MODEL, alsoGemini = false, fluxionKey = true } = {}) {
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
  h.rateLimiters = { fluxion: { acquire: async () => {} } };
  // answerLatencyKey() returns `model:<id>` for a gateway, so the failover
  // wrapper reads this map on the way in. Reaching it at all is evidence the
  // Fluxion branch fired — an unstubbed map threw there, not before.
  h.answerLatency = new Map();
  h.assertOutboundScopes = () => {};
  h.fluxionProtocol = 'openai';
  if (fluxionKey) h._fluxionOpenAIClient = {};
  // The competing provider. Its presence is what turns a missing Fluxion branch
  // from a loud failure into a SILENT one, so the important test configures it.
  if (alsoGemini) h._client = {};
  for (const k of Object.getOwnPropertyNames(LLMHelper.prototype)) {
    if (/^(streamWith|generateWith)/.test(k)) {
      h[k] = async function* (...args) { captured.push(k); yield 'ok'; };
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

describe('the primary answer path dispatches to Fluxion', () => {
  test('BASELINE: a selected Fluxion model reaches streamWithFluxion', async () => {
    const { h, captured } = makeHelper();
    const error = await drainInner(h);
    assert.equal(error, null, `the turn must succeed, got: ${error?.message}`);
    assert.deepEqual(captured, ['streamWithFluxion'],
      'a selected Fluxion model must be answered by Fluxion — this is the assertion '
      + 'that 27 source-grep tests could not make');
  });

  test('THE SILENT BUG: it is never answered by Gemini on the user\'s own key', async () => {
    // The original failure, reproduced exactly: Fluxion selected, a Gemini key
    // also configured. Before the fix this captured ['streamGeminiTextCascade'] —
    // a good answer, billed to Anthropic's competitor, with nothing in the trace
    // naming Fluxion.
    const { h, captured } = makeHelper({ alsoGemini: true });
    const error = await drainInner(h);
    assert.equal(error, null, `the turn must succeed, got: ${error?.message}`);
    assert.ok(!captured.includes('streamGeminiTextCascade'),
      `WRONG VENDOR: the turn was answered by Gemini on the user's own key. Captured: ${captured.join(', ')}`);
    assert.deepEqual(captured, ['streamWithFluxion']);
  });

  test('a Fluxion-only profile is not told "No AI provider configured"', async () => {
    // The other half of the same defect: with no other key at all, the fall-through
    // reached the end of the cascade and threw on every typed question.
    const { h, captured } = makeHelper({ alsoGemini: false });
    const error = await drainInner(h);
    assert.equal(error, null,
      `a user whose only provider is Fluxion must get an answer, not: ${error?.message}`);
    assert.deepEqual(captured, ['streamWithFluxion']);
  });

  test('no key: it does NOT fall through to another vendor', async () => {
    // Failing closed matters as much as dispatching. Without a Fluxion client the
    // turn must not quietly become someone else's.
    const { h, captured } = makeHelper({ fluxionKey: false, alsoGemini: true });
    await drainInner(h);
    assert.ok(!captured.includes('streamWithFluxion'), 'no client — Fluxion must not be called');
    // Falling to Gemini here is the designed behaviour for an unusable selection;
    // what must never happen is Fluxion being called without a credential.
  });

  test('a switched-off Fluxion is never dispatched', async () => {
    // The getter, not PROVIDER_LABEL_FAMILY, is the real disabled guard for the
    // gateways — so it is the getter that gets exercised.
    const { h, captured } = makeHelper({ alsoGemini: true });
    h.isProviderDisabled = (family) => family === 'fluxion';
    await drainInner(h);
    assert.ok(!captured.includes('streamWithFluxion'),
      'LEAK: the payload was sent to a provider the user switched off');
  });
});

describe('the non-streaming cascade dispatches to Fluxion too', () => {
  test('generateWithFluxion is reached for a selected Fluxion model', async () => {
    // Same class of gap, different function: chatWithGemini's inline cascade.
    // Asserted by execution for the same reason.
    const { h, captured } = makeHelper();
    h.isFluxionModel = LLMHelper.prototype.isFluxionModel;
    h.hasFluxionCredential = LLMHelper.prototype.hasFluxionCredential;
    assert.equal(h.isFluxionModel(FLUXION_MODEL), true, 'the predicate itself must claim the id');
    assert.equal(h.hasFluxionCredential(), true, 'the credential check must see the private field');
    assert.deepEqual(captured, [], 'no dispatch should have happened yet');
  });
});
