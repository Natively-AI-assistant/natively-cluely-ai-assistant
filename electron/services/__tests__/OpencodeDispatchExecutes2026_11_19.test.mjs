/**
 * Does a selected OpenCode model ACTUALLY reach streamWithOpencode?
 *
 * This is the test the Fluxion campaign did not have. Its 27 source-grep
 * guards all passed while `_streamChatInner` had no Fluxion branch at all: the
 * vendor predicates correctly refused the id, the turn fell through, and Gemini
 * answered it on the user's own key. Excluding a family from the predicates
 * prevents MISROUTING; it says nothing about a dispatch branch nobody wrote.
 *
 * OpenCode is that trap with the widest surface: its ids ARE the vendors' own
 * (`opencode/claude-sonnet-5`, `opencode/gpt-6.1-sol`), so a missing branch
 * falls through to the vendor whose name is literally inside the id, on the
 * user's own account, and every log line looks right.
 *
 * Run: node --test electron/services/__tests__/OpencodeDispatchExecutes2026_11_19.test.mjs
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
const { opencodePresetMeta } = require(dist('llm/opencode/catalog.js'));

const OPENCODE_MODEL = 'opencode/claude-sonnet-5';

function makeHelper({ model = OPENCODE_MODEL, alsoGemini = false, configured = true } = {}) {
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
  h.rateLimiters = { opencode: { acquire: async () => {} } };
  h.answerLatency = new Map();
  h.assertOutboundScopes = () => {};
  h.opencodeApiKey = configured ? 'oc_sk_test' : null;
  h._opencodeOpenAIClient = configured ? {} : null;
  h._opencodeAnthropicClient = configured ? {} : null;
  h.opencodeModelMeta = { ...opencodePresetMeta() };
  // The competing provider. Its presence is what turns a missing OpenCode
  // branch from a loud failure into a SILENT one, so the important test
  // configures it.
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

describe('the primary answer path dispatches to OpenCode', () => {
  test('BASELINE: a selected OpenCode model reaches streamWithOpencode', async () => {
    const { h, captured } = makeHelper();
    const error = await drainInner(h);
    assert.equal(error, null, `the turn must succeed, got: ${error?.message}`);
    assert.deepEqual(captured, ['streamWithOpencode']);
  });

  test('THE SILENT BUG: `opencode/claude-…` is not answered by Claude on the user\'s own key', async () => {
    // A real Anthropic client is NOT enough to catch this: isClaudeModel must
    // also refuse the prefixed id. Both halves are asserted, because either
    // one alone leaves a path to the wrong vendor.
    const { h, captured } = makeHelper({ alsoGemini: true });
    h._claudeClient = {};
    const error = await drainInner(h);
    assert.equal(error, null, `the turn must succeed, got: ${error?.message}`);
    assert.ok(!captured.includes('streamWithClaude'), `WRONG VENDOR — Claude answered: ${captured.join(', ')}`);
    assert.ok(!captured.includes('streamWithClaudeMultimodal'));
    assert.ok(!captured.includes('streamGeminiTextCascade'));
    assert.deepEqual(captured, ['streamWithOpencode']);
  });

  test('the vendor predicates themselves refuse every OpenCode id', () => {
    const h = Object.create(LLMHelper.prototype);
    h._groqLocalDisabled = false;
    for (const id of [
      'opencode/claude-sonnet-5',
      'opencode/gpt-6.1-sol',
      'opencode/gemini-3.8-flash',
      'opencode/deepseek-v4.1-flash',
      'opencode/grok-4.7',
    ]) {
      assert.equal(h.isOpenAiModel(id), false, `isOpenAiModel claimed ${id}`);
      assert.equal(h.isClaudeModel(id), false, `isClaudeModel claimed ${id}`);
      assert.equal(h.isGeminiModel(id), false, `isGeminiModel claimed ${id}`);
      assert.equal(h.isDeepseekModel(id), false, `isDeepseekModel claimed ${id}`);
      assert.equal(h.isGroqModel(id), false, `isGroqModel claimed ${id}`);
    }
  });

  test('an OpenCode-only profile is not told "No AI provider configured"', async () => {
    const { h, captured } = makeHelper({ alsoGemini: false });
    const error = await drainInner(h);
    assert.equal(error, null, `a user whose only provider is OpenCode must get an answer, not: ${error?.message}`);
    assert.deepEqual(captured, ['streamWithOpencode']);
  });

  test('not configured: it does NOT call OpenCode, and does not misroute', async () => {
    const { h, captured } = makeHelper({ configured: false, alsoGemini: true });
    await drainInner(h);
    assert.ok(!captured.includes('streamWithOpencode'), 'no client — OpenCode must not be called');
    assert.ok(!captured.includes('streamWithClaude'), 'no OpenCode client — the id must not fall to Claude');
  });

  test('a switched-off provider is never dispatched', async () => {
    const { h, captured } = makeHelper();
    h.getDisabledProviderFamilies = () => ['opencode'];
    await drainInner(h);
    assert.ok(!captured.includes('streamWithOpencode'),
      'a provider switched off in Settings answered a question');
  });

  test('hasAnyConfiguredProvider sees an OpenCode-only profile', () => {
    const h = Object.create(LLMHelper.prototype);
    h.useOllama = false;
    h._opencodeOpenAIClient = {};
    h._opencodeAnthropicClient = {};
    h.opencodeApiKey = 'oc_sk_test';
    h.isProviderDisabled = () => false;
    h.isCodexAvailable = () => false;
    h.antigravityFallbackModel = () => null;
    h.hasNatively = () => false;
    h.hasFluxionCredential = () => false;
    h.hasAgentRouterCredential = () => false;
    assert.equal(h.hasAnyConfiguredProvider(), true);
  });

  test('classifyCloudModel names OpenCode, not the vendor inside the id', () => {
    const h = Object.create(LLMHelper.prototype);
    h._groqLocalDisabled = false;
    assert.deepEqual(
      h.classifyCloudModel('opencode/claude-sonnet-5'),
      { provider: 'opencode', model: 'opencode/claude-sonnet-5' },
    );
    assert.deepEqual(
      h.classifyCloudModel('opencode/gpt-6.1-sol'),
      { provider: 'opencode', model: 'opencode/gpt-6.1-sol' },
    );
  });

  test('the Background Model resolves to the opencode family', () => {
    const h = Object.create(LLMHelper.prototype);
    h._opencodeOpenAIClient = {};
    h.opencodeApiKey = 'k';
    assert.equal(h.resolveFastModelFamily('opencode/gpt-6.1-sol'), 'opencode');
    assert.equal(h.canDispatchFastModel('opencode/gpt-6.1-sol'), true);
  });
});
