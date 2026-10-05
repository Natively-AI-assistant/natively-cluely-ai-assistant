// FIX 2 (2026-08-01): a provider switched off in Settings > AI Providers was
// still used as a routing fallback.
//
// CredentialsManager:87 documents "A disabled provider keeps its stored
// credential but contributes no models to the picker and is never chosen as a
// routing fallback." The second half was false. `disabledProviders` was honoured
// only by the model PICKER and by refreshRuntimeDefaultIfUnavailable(); the
// router had no term for it, and the streaming cascade in _streamChatInner
// selects providers by testing the client fields directly. So when the primary
// rate-limited or 503'd, the cascade fell onto the provider the user had
// explicitly turned off — with transcript, reference-file context and
// screenshots attached.
//
// The load-bearing tests below assert on WHICH PROVIDER STREAMER WAS CALLED,
// not on a routing table. The router assertions are there for the reason code.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);

// `electron` is an esbuild external, so the bundles resolve it through Node at
// runtime. CredentialsManager computes its file paths from app.getPath() at
// MODULE scope, so without this the module init throws, the read fails open,
// and every disabled-provider assertion below would silently test nothing.
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: {
    app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};

const {
  routeLLMProviders, disabledRouterProviders, isProviderFamilyDisabled,
  ProviderDisabledError, DISABLED_PROVIDER_FAMILY_MAP,
} = require(dist('llm/ProviderRouter.js'));
const { LLMHelper } = require(dist('LLMHelper.js'));

// CredentialsManager is anchored on globalThis (one instance across the 22
// bundles that inline it), so seeding that slot is how the shipped read path is
// exercised without a real credential store.
const CRED_SLOT = '__nativelyCredentialsManagerV1__';
let credBefore;
const setDisabled = (list) => {
  globalThis[CRED_SLOT] = { getDisabledProviders: () => list };
};
beforeEach(() => { credBefore = globalThis[CRED_SLOT]; });
afterEach(() => {
  if (credBefore === undefined) delete globalThis[CRED_SLOT];
  else globalThis[CRED_SLOT] = credBefore;
});

// ── id-space mapping ────────────────────────────────────────────────────────

describe('the store id space and the router id space are reconciled', () => {
  test('one stored "gemini" disables BOTH router tiers', () => {
    const off = disabledRouterProviders(['gemini']);
    assert.equal(off.has('gemini_flash'), true, 'gemini_flash stayed routable');
    assert.equal(off.has('gemini_pro'), true, 'gemini_pro stayed routable');
  });

  test('the stored "codex-cli" spelling disables the router\'s "codex"', () => {
    assert.equal(disabledRouterProviders(['codex-cli']).has('codex'), true);
    assert.equal(isProviderFamilyDisabled('codex-cli', ['codex']), true, 'aliases must resolve in both directions');
    assert.equal(isProviderFamilyDisabled('gemini_pro', ['gemini']), true);
  });

  test('every provider the router can select has a family mapping', () => {
    const routed = routeLLMProviders({
      capability: 'chat',
      availability: { hasNatively: true, hasGroq: true, hasCodex: true, hasGemini: true, hasOpenAI: true, hasClaude: true, hasDeepseek: true, hasOllama: true },
    }).map((a) => a.provider);
    const mapped = new Set(Object.values(DISABLED_PROVIDER_FAMILY_MAP).flat());
    for (const p of routed) {
      assert.ok(mapped.has(p), `router provider ${p} can never be switched off — no family maps to it`);
    }
  });

  test('unknown ids and an empty list are inert', () => {
    assert.equal(disabledRouterProviders(['nonsense']).size, 0);
    assert.equal(disabledRouterProviders([]).size, 0);
    assert.equal(disabledRouterProviders(undefined).size, 0);
    assert.equal(isProviderFamilyDisabled('openai', undefined), false);
  });
});

// ── the routing table (reason code) ─────────────────────────────────────────

describe('routeLLMProviders honours disabledProviders', () => {
  const base = {
    capability: 'chat',
    availability: { hasOpenAI: true, hasGroq: true, hasGemini: true, hasClaude: true, hasOllama: true },
    models: { ollama: 'llama3.2' },
  };

  test('a disabled provider is unavailable, and the reason says so', () => {
    const attempts = routeLLMProviders({ ...base, disabledProviders: ['openai', 'gemini'] });
    const by = (p) => attempts.find((a) => a.provider === p);
    assert.equal(by('openai').status, 'unavailable');
    assert.equal(by('openai').unavailableReason, 'disabled', 'must not masquerade as a missing key');
    assert.equal(by('gemini_flash').status, 'unavailable');
    assert.equal(by('gemini_pro').status, 'unavailable');
    assert.equal(by('groq').status, 'available', 'an unrelated provider must be untouched');
  });

  test('Ollama is NOT exempt from the user\'s own switch', () => {
    const attempts = routeLLMProviders({ ...base, disabledProviders: ['ollama'] });
    assert.equal(attempts.find((a) => a.provider === 'ollama').status, 'unavailable');
  });

  test('REGRESSION: with nothing disabled the routing table is byte-identical', () => {
    assert.deepEqual(routeLLMProviders({ ...base, disabledProviders: [] }), routeLLMProviders(base));
    assert.deepEqual(routeLLMProviders({ ...base, disabledProviders: ['nonsense'] }), routeLLMProviders(base));
  });
});

// ── what the cascade actually attempts ──────────────────────────────────────

function runInner(message, { disabled = [], model = 'gpt-test' } = {}) {
  const captured = [];
  const h = Object.create(LLMHelper.prototype);
  h.useOllama = false;
  // Both halves of the 2026-08-01 probe split. Dispatch sites call the
  // mutating one; leaving it unstubbed would let the harness make a real
  // request to the local Ollama daemon.
  h.checkOllamaAvailable = async () => false;
  h.ensureOllamaModelSelected = async () => false;
  h.currentModelId = model;
  h.pickConfiguredCustomProviderForFallback = () => null;
  h.getActiveModeGroundingInfo = () => null;
  h.isOpenAiModel = () => true;
  // The REAL getter is exercised: the private field is set, and whether the
  // cascade can see it depends on the disabled-provider read.
  h._openaiClient = {};
  for (const k of Object.getOwnPropertyNames(LLMHelper.prototype)) {
    if (/^streamWith/.test(k)) h[k] = async function* (...args) { captured.push(k); yield 'ok'; };
  }
  setDisabled(disabled);
  return (async () => {
    let error = null;
    try {
      for await (const _ of LLMHelper.prototype._streamChatInner.call(
        h, message, undefined, undefined, 'SYS', true, true, [], undefined, 0, { v3Owned: true },
      )) { /* drain */ }
    } catch (e) { error = e; }
    return { captured, error };
  })();
}

describe('a disabled provider is never attempted', () => {
  test('BASELINE: enabled, the cascade reaches OpenAI', async () => {
    const { captured, error } = await runInner('hello', { disabled: [] });
    assert.equal(error, null, `baseline must succeed, got: ${error?.message}`);
    assert.deepEqual(captured, ['streamWithOpenai'], 'baseline must dispatch — otherwise the disable test is vacuous');
  });

  test('disabled: the cascade never calls the provider\'s streamer', async () => {
    const { captured } = await runInner('hello', { disabled: ['openai'] });
    assert.ok(!captured.includes('streamWithOpenai'),
      'LEAK: the payload was sent to a provider the user switched off');
    assert.equal(captured.length, 0, `no other provider was configured, but these were called: ${captured.join(', ')}`);
  });

  test('when everything is off the error NAMES the setting, it is not an empty cascade', async () => {
    const { error } = await runInner('hello', { disabled: ['openai'] });
    assert.ok(error, 'a turn with no usable provider must fail loudly');
    assert.match(error.message, /switched off in Settings > AI Providers/,
      'the user must be told their own setting caused this, not "add an API key"');
    assert.match(error.message, /openai/);
  });

  test('LAST BOUNDARY: a direct provider call throws rather than sending', () => {
    const h = Object.create(LLMHelper.prototype);
    setDisabled(['claude']);
    assert.throws(
      () => LLMHelper.prototype.assertOutboundScopes.call(h, 'claude', 'some transcript text'),
      // Matched by NAME, not instanceof: esbuild inlines ProviderRouter into
      // every entry bundle, so the class object this test imported is a
      // different identity from the one LLMHelper.js throws. Any consumer that
      // catches this cross-bundle must do the same.
      (e) => e?.name === 'ProviderDisabledError' && /claude/.test(e.message),
    );
    assert.equal(typeof ProviderDisabledError, 'function');
    // An enabled provider is unaffected (no scope policy denies anything here).
    setDisabled([]);
    LLMHelper.prototype.assertOutboundScopes.call(h, 'claude', 'some transcript text');
  });

  test('the local provider honours the switch too, and is not even probed', async () => {
    const h = Object.create(LLMHelper.prototype);
    let probed = false;
    // Made non-vacuous deliberately: an ungated checkOllamaAvailable() also
    // returns false here (the probe fails with no Ollama running), so the
    // RESULT proves nothing. Whether the probe RAN is what distinguishes
    // "honoured the switch" from "happened to be unreachable".
    h.getOllamaModels = async () => { probed = true; return ['llama3.2']; };
    setDisabled(['ollama']);
    assert.equal(await LLMHelper.prototype.checkOllamaAvailable.call(h), false);
    assert.equal(probed, false, 'the local provider was probed despite being switched off');
  });

  test('a credential-store failure fails OPEN (never bricks every provider)', async () => {
    globalThis[CRED_SLOT] = { getDisabledProviders: () => { throw new Error('store unavailable'); } };
    const h = Object.create(LLMHelper.prototype);
    assert.equal(LLMHelper.prototype.isProviderDisabled.call(h, 'openai'), false,
      'an infrastructure failure must not switch every provider off');
  });
});
