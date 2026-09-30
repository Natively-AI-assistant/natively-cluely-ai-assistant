/**
 * Does a selected AgentRouter model ACTUALLY reach the AgentRouter adapter?
 *
 * Written first, not after a review, because Fluxion taught what the source
 * greps cannot see (FluxionDispatchExecutes2026_09_18): excluding a family from
 * every vendor predicate prevents MISROUTING, and says nothing about a dispatch
 * branch that was never written. AgentRouter's ids are the vendors' own
 * (`claude-opus-5`, `gpt-6-astra`, `deepseek-v4-flash`), so the silent failure
 * is the same: a good answer, billed to the user's real Anthropic/OpenAI/Gemini
 * key, with nothing in the log naming AgentRouter.
 *
 * So these EXECUTE the real methods on a bare LLMHelper.prototype and assert on
 * WHICH STREAMER WAS CALLED, with competing vendor keys configured — the setup
 * that turns a missing branch from a loud failure into a silent one.
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
const { AGENTROUTER_JUDGE_MODEL } = require(dist('llm/agentRouter.js'));

const PRESETS = [
  'agentrouter/deepseek-v4-flash',
  'agentrouter/claude-opus-5',
  'agentrouter/gpt-6-astra',
  'agentrouter/claude-opus-4-8',
];

/**
 * Bare prototype, every streamWith... and generateWith... method replaced by a
 * recorder that keeps its arguments. The AgentRouter clients are set on the PRIVATE fields,
 * so the real disabled-provider getters are what is under test.
 */
function makeHelper({ model = 'agentrouter/claude-opus-5', agentrouterKey = true, competitors = true } = {}) {
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
  h.answerLatency = new Map();
  h.rateLimiters = { agentrouter: { acquire: async () => {} } };
  h.assertOutboundScopes = () => {};
  if (agentrouterKey) { h._agentrouterOpenAIClient = {}; h._agentrouterAnthropicClient = {}; }
  // The competitors: every vendor whose own id is byte-identical to an
  // AgentRouter preset once the prefix is gone, plus Gemini (the cascade's
  // step-4 catch-all). Their presence is what makes a missing branch silent.
  if (competitors) { h._client = {}; h._claudeClient = {}; h._openaiClient = {}; h._deepseekClient = {}; }
  for (const k of Object.getOwnPropertyNames(LLMHelper.prototype)) {
    if (/^(streamWith|generateWith)/.test(k)) {
      h[k] = async function* (...args) { captured.push({ name: k, args }); yield 'ok'; };
    }
  }
  h.streamGeminiTextCascade = async function* () { captured.push({ name: 'streamGeminiTextCascade', args: [] }); yield 'ok'; };
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

const names = (captured) => captured.map((c) => c.name);

describe('the primary answer path dispatches to AgentRouter', () => {
  for (const model of PRESETS) {
    test(`${model} reaches streamWithAgentRouter with every competing vendor key configured`, async () => {
      const { h, captured } = makeHelper({ model });
      const error = await drainInner(h);
      assert.equal(error, null, `the turn must succeed, got: ${error?.message}`);
      assert.deepEqual(names(captured), ['streamWithAgentRouter'],
        `WRONG VENDOR for ${model}: captured ${names(captured).join(', ')}`);
    });
  }

  test('an AgentRouter-only profile is not told "No AI provider configured"', async () => {
    const { h, captured } = makeHelper({ competitors: false });
    const error = await drainInner(h);
    assert.equal(error, null, `got: ${error?.message}`);
    assert.deepEqual(names(captured), ['streamWithAgentRouter']);
  });

  test('no key: AgentRouter is never called', async () => {
    const { h, captured } = makeHelper({ agentrouterKey: false });
    await drainInner(h);
    assert.ok(!names(captured).includes('streamWithAgentRouter'));
  });

  test('a switched-off AgentRouter is never dispatched', async () => {
    const { h, captured } = makeHelper();
    h.isProviderDisabled = (family) => family === 'agentrouter';
    await drainInner(h);
    assert.ok(!names(captured).includes('streamWithAgentRouter'),
      'LEAK: the payload was sent to a provider the user switched off');
  });
});

describe('the vendor predicates never claim an AgentRouter id', () => {
  const h = Object.create(LLMHelper.prototype);
  for (const model of PRESETS) {
    test(model, () => {
      assert.equal(h.isAgentRouterModel(model), true);
      assert.equal(h.isClaudeModel(model), false, 'isClaudeModel would bill the user\'s Anthropic key');
      assert.equal(h.isOpenAiModel(model), false, 'isOpenAiModel would bill the user\'s OpenAI key');
      assert.equal(h.isDeepseekModel(model), false, 'isDeepseekModel would bill the user\'s DeepSeek key');
      assert.equal(h.isGeminiModel(model), false);
      assert.equal(h.resolveFastModelFamily(model), 'agentrouter');
    });
  }
  test('bare vendor ids are still the vendors\' own', () => {
    assert.equal(h.isClaudeModel('claude-opus-5'), true);
    assert.equal(h.resolveFastModelFamily('claude-opus-5'), 'claude');
  });
});

describe('images go only to a model that reads them', () => {
  test('the capability gate: Claude reads images, DeepSeek and gpt-6-astra do not', () => {
    const h = Object.create(LLMHelper.prototype);
    assert.equal(h.agentRouterModelSupportsVision('agentrouter/claude-opus-5'), true);
    assert.equal(h.agentRouterModelSupportsVision('agentrouter/claude-opus-4-8'), true);
    assert.equal(h.agentRouterModelSupportsVision('agentrouter/deepseek-v4-flash'), false);
    assert.equal(h.agentRouterModelSupportsVision('agentrouter/gpt-6-astra'), false);
  });

  // Image turns never reach the text branch above: _streamChatInner hands any
  // turn with screenshots to streamVisionWithFallback and returns. So the
  // vision chain is what gets executed here.
  async function drainVision(model) {
    const { h, captured } = makeHelper({ model });
    Object.assign(h, {
      modelVersionManager: { getAllVisionTiers: () => [] },
      codexCliConfig: { enabled: false },
      isCodexAvailable: () => false,
      antigravityFallbackModel: () => null,
      hasNatively: () => false,
      nativelyKey: null,
    });
    let error = null;
    try {
      for await (const _ of h.streamVisionWithFallback({ userContent: 'u', message: 'm', imagePaths: ['/tmp/x.png'], systemPrompt: 's' })) { /* drain */ }
    } catch (e) { error = e; }
    return { error, captured: names(captured) };
  }

  test('a screenshot on a SELECTED AgentRouter Claude model is answered by AgentRouter first', async () => {
    // OpenAI, Claude and Gemini keys are all configured. Without the front-load
    // the unmeasured AgentRouter rung sorts last and a vendor key wins the turn.
    const { error, captured } = await drainVision('agentrouter/claude-opus-5');
    assert.equal(error, null, `got: ${error?.message}`);
    assert.equal(captured[0], 'streamWithAgentRouter', `captured: ${captured.join(', ')}`);
  });

  test('a screenshot on AgentRouter DeepSeek goes to a provider that can see it', async () => {
    const { error, captured } = await drainVision('agentrouter/deepseek-v4-flash');
    assert.equal(error, null, `got: ${error?.message}`);
    assert.ok(!captured.includes('streamWithAgentRouter'),
      `a text-only model must not be seated for a screenshot; captured: ${captured.join(', ')}`);
    assert.ok(captured.length > 0, 'some vision-capable provider must answer');
  });
});

describe('Direct Assist', () => {
  test('selects AgentRouter, keeping the prefixed id, with an OpenAI key also configured', () => {
    const { h } = makeHelper({ model: 'agentrouter/gpt-6-astra' });
    const sel = h.getDirectAssistSelection();
    assert.equal(sel.provider, 'agentrouter');
    assert.equal(sel.model, 'agentrouter/gpt-6-astra', 'the adapter strips the prefix itself');
  });

  test('its credential check reads the AgentRouter clients', () => {
    const { h } = makeHelper();
    assert.equal(h.directProviderHasCredential('agentrouter'), true);
    const { h: none } = makeHelper({ agentrouterKey: false });
    assert.equal(none.directProviderHasCredential('agentrouter'), false);
  });
});

describe('the Auto Answer judge and the fast-model seam', () => {
  test('the judge runs on unrationed DeepSeek, not the selected Claude model', () => {
    const { h } = makeHelper({ model: 'agentrouter/claude-opus-5' });
    assert.equal(h.judgeGatewayModel(), AGENTROUTER_JUDGE_MODEL);
    const { h: none } = makeHelper({ agentrouterKey: false, competitors: false });
    assert.equal(none.judgeGatewayModel(), null);
  });

  test('callFastModel drains the AgentRouter stream with a 256-token cap at temperature 0', async () => {
    const { h, captured } = makeHelper();
    h.streamWithAgentRouter = async function* (...args) { captured.push({ name: 'streamWithAgentRouter', args }); yield '{"answer":'; yield ' true}'; };
    const out = await h.callFastModel('judge this', { modelId: AGENTROUTER_JUDGE_MODEL, timeoutMs: 5000 });
    assert.equal(out, '{"answer": true}');
    const call = captured.find((c) => c.name === 'streamWithAgentRouter');
    assert.ok(call, 'the AgentRouter adapter must be the one called');
    assert.equal(call.args[4], AGENTROUTER_JUDGE_MODEL);
    assert.deepEqual(call.args[5], { maxTokens: 256, temperature: 0 });
  });

  test('a fast call that runs out of budget returns null, never a partial verdict', async () => {
    const { h } = makeHelper();
    // The adapter returns QUIETLY on abort (right for a live answer), so the
    // seam must notice the abort itself.
    h.streamWithAgentRouter = async function* (_m, _s, _i, signal) {
      yield '{"answer": tr';
      await new Promise((r) => setTimeout(r, 80));
      if (signal?.aborted) return;
      yield 'ue}';
    };
    const out = await h.callFastModel('judge this', { modelId: AGENTROUTER_JUDGE_MODEL, timeoutMs: 20 });
    assert.equal(out, null);
  });
});
