// FIX 3 (2026-08-01): "Keep screenshots on this device" was honored on exactly
// one path.
//
// `screenUnderstandingMode` is written by the Privacy panel, whose copy promises
// "Use a local vision model (Ollama) only. Cloud vision is never called." It was
// read at ONE runtime call site — generate-what-to-say → ScreenUnderstandingService.
// The primary Ask-AI-with-screenshot flow (NativelyInterface → gemini-chat-stream
// → LLMHelper.streamChat(imagePaths)), generate-code-hint and generate-brainstorm
// all forwarded imagePaths into LLMHelper, which had no notion of the enum. So
// the screenshot went to the cloud cascade while the UI said it never would.
//
// The load-bearing tests capture the ACTUAL provider dispatch and assert that no
// cloud streamer ever received a non-empty imagePaths under private_vision.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);

// `electron` is an esbuild external; SettingsManager and CredentialsManager both
// touch app at module/constructor scope. Without this shim the live readers fail
// open and every assertion below would be vacuous.
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: {
    app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};

const {
  resolveVisionPolicy, isLocalVisionProvider, readScreenUnderstandingMode,
  PRIVATE_VISION_NO_LOCAL_MESSAGE, VISION_ONLY_NO_PROVIDER_MESSAGE,
} = require(dist('llm/visionPolicy.js'));
const { LLMHelper } = require(dist('LLMHelper.js'));
const { SettingsManager } = require(dist('services/SettingsManager.js'));

const IMAGE = ['/tmp/screenshot-under-test.png'];

const SETTINGS_SLOT = '__nativelySettingsManagerV1__';
const CRED_SLOT = '__nativelyCredentialsManagerV1__';
let settingsBefore, credBefore;

beforeEach(() => {
  settingsBefore = globalThis[SETTINGS_SLOT];
  credBefore = globalThis[CRED_SLOT];
});
afterEach(() => {
  if (settingsBefore === undefined) delete globalThis[SETTINGS_SLOT]; else globalThis[SETTINGS_SLOT] = settingsBefore;
  if (credBefore === undefined) delete globalThis[CRED_SLOT]; else globalThis[CRED_SLOT] = credBefore;
});

const setMode = (mode) => {
  const sm = SettingsManager.getInstance();
  sm.setScreenUnderstandingMode(mode);
  return sm;
};
const setVisionProviders = ({ anyVision = true } = {}) => {
  globalThis[CRED_SLOT] = {
    getDisabledProviders: () => [],
    anyVisionProviderConfigured: () => anyVision,
    anyLocalVisionProviderConfigured: () => false,
  };
};

// ── the resolver ────────────────────────────────────────────────────────────

describe('resolveVisionPolicy', () => {
  const base = { hasImages: true, mode: 'vision_first', screenshotsScopeAllowed: true, visionProviderAvailable: true };

  test('no images: nothing to decide', () => {
    assert.equal(resolveVisionPolicy({ ...base, hasImages: false, mode: 'private_vision' }).action, 'allow');
  });

  test('vision_first is unchanged (the shipped default)', () => {
    assert.equal(resolveVisionPolicy(base).action, 'allow');
  });

  test('private_vision is local-only and BLOCKS rather than dropping or falling through', () => {
    const d = resolveVisionPolicy({ ...base, mode: 'private_vision' });
    assert.equal(d.action, 'local_only');
    assert.equal(d.whenLocalUnavailable, 'block', 'a silent drop would let the user believe the image was read locally');
    assert.match(d.message, /not sent anywhere/i);
  });

  test('private_vision outranks an allowed screenshots scope', () => {
    assert.equal(resolveVisionPolicy({ ...base, mode: 'private_vision', screenshotsScopeAllowed: true }).action, 'local_only');
  });

  test('screenshots scope denied: local-only, then drop (never cloud)', () => {
    const d = resolveVisionPolicy({ ...base, screenshotsScopeAllowed: false });
    assert.equal(d.action, 'local_only');
    assert.equal(d.whenLocalUnavailable, 'drop_images');
  });

  test('vision_only upgrades a drop into a block', () => {
    const d = resolveVisionPolicy({ ...base, mode: 'vision_only', screenshotsScopeAllowed: false });
    assert.equal(d.whenLocalUnavailable, 'block', 'vision_only means "do not answer without the screenshot"');
  });

  test('vision_only with no vision provider blocks instead of answering blind', () => {
    const d = resolveVisionPolicy({ ...base, mode: 'vision_only', visionProviderAvailable: false });
    assert.equal(d.action, 'block');
    assert.equal(d.message, VISION_ONLY_NO_PROVIDER_MESSAGE);
  });

  test('Codex CLI is NOT a local vision provider', () => {
    assert.equal(isLocalVisionProvider('ollama'), true);
    assert.equal(isLocalVisionProvider('codex'), false, 'Codex CLI routes to chatgpt.com — counting it as local would ship the screenshot');
    for (const p of ['openai', 'gemini', 'claude', 'groq', 'natively', 'custom_provider']) {
      assert.equal(isLocalVisionProvider(p), false);
    }
  });
});

// ── the live setting ────────────────────────────────────────────────────────

describe('the mode is read live', () => {
  test('reads the persisted value, and re-reads it after a change', () => {
    setMode('private_vision');
    assert.equal(readScreenUnderstandingMode(), 'private_vision');
    setMode('vision_first');
    assert.equal(readScreenUnderstandingMode(), 'vision_first', 'the mode was cached');
  });
});

// ── what actually reaches a provider ────────────────────────────────────────

function runInner(message, { imagePaths, ollamaVision = false } = {}) {
  const captured = [];
  const h = Object.create(LLMHelper.prototype);
  h.useOllama = ollamaVision;
  // Both halves of the 2026-08-01 probe split. resolveOutboundVisionDecision
  // now uses the MUTATING variant (it dispatches to Ollama on local_only), so
  // stubbing only the pure one would silently probe the real daemon and every
  // "routed to Ollama" case would fail for the wrong reason.
  h.checkOllamaAvailable = async () => ollamaVision;
  h.ensureOllamaModelSelected = async () => ollamaVision;
  h.currentModelId = 'gpt-test';
  h.pickConfiguredCustomProviderForFallback = () => null;
  h.getActiveModeGroundingInfo = () => null;
  h.isOpenAiModel = () => true;
  h._openaiClient = {};
  // streamVisionWithFallback is the UNIFIED multimodal dispatcher — every
  // image-bearing turn goes through it, so it is the thing that must never be
  // reached with a screenshot under private_vision.
  for (const k of Object.getOwnPropertyNames(LLMHelper.prototype)) {
    if (/^streamWith|^streamVisionWithFallback$/.test(k)) {
      h[k] = async function* (...args) {
        captured.push({ provider: k, args });
        yield 'ok';
      };
    }
  }
  return (async () => {
    let out = '';
    for await (const tok of LLMHelper.prototype._streamChatInner.call(
      h, message, imagePaths, undefined, 'SYS', true, true, [], undefined, 0, { v3Owned: true },
    )) out += tok;
    // Images ride either as a positional array or inside the vision chain's
    // options object; scan both so a leak cannot hide in the shape.
    const hasImage = (v) => Array.isArray(v) && v.some((x) => typeof x === 'string' && x.endsWith('.png'));
    const cloudImageArgs = captured
      .filter((c) => !/Ollama/i.test(c.provider))
      .flatMap((c) => c.args.filter((a) => hasImage(a) || (a && typeof a === 'object' && hasImage(a.imagePaths))));
    return { out, captured, cloudImageArgs, providers: captured.map((c) => c.provider) };
  })();
}

describe('private_vision: a screenshot never reaches a cloud provider', () => {
  test('BASELINE: vision_first sends the screenshot to the cloud provider', async () => {
    setMode('vision_first');
    setVisionProviders();
    const r = await runInner('what is on my screen?', { imagePaths: IMAGE });
    assert.deepEqual(r.providers, ['streamVisionWithFallback'], 'every image turn goes through the unified vision chain');
    assert.equal(r.cloudImageArgs.length, 1, 'baseline must actually ship the image — otherwise every assertion below is vacuous');
  });

  test('private_vision with no local vision model: BLOCKED, nothing dispatched', async () => {
    setMode('private_vision');
    setVisionProviders();
    const r = await runInner('what is on my screen?', { imagePaths: IMAGE, ollamaVision: false });
    assert.equal(r.cloudImageArgs.length, 0, 'LEAK: the screenshot was sent to a cloud provider under private_vision');
    assert.deepEqual(r.providers, [], 'no provider should have been called at all');
    assert.equal(r.out, PRIVATE_VISION_NO_LOCAL_MESSAGE, 'the user must be told, not silently answered without the image');
  });

  test('private_vision with a local vision model: routed to Ollama, no cloud dispatch', async () => {
    setMode('private_vision');
    setVisionProviders();
    const r = await runInner('what is on my screen?', { imagePaths: IMAGE, ollamaVision: true });
    assert.deepEqual(r.providers, ['streamWithOllama']);
    assert.equal(r.cloudImageArgs.length, 0, 'LEAK: a cloud provider received the screenshot');
  });

  test('private_vision does not interfere with a text-only turn', async () => {
    setMode('private_vision');
    setVisionProviders();
    const r = await runInner('a question with no screenshot', {});
    assert.deepEqual(r.providers, ['streamWithOpenai'], 'a text turn must be unaffected by the screenshot setting');
  });

  test('vision_only with no vision provider: blocked with an actionable message', async () => {
    setMode('vision_only');
    setVisionProviders({ anyVision: false });
    const r = await runInner('what is on my screen?', { imagePaths: IMAGE });
    assert.deepEqual(r.providers, []);
    assert.equal(r.out, VISION_ONLY_NO_PROVIDER_MESSAGE);
  });

  test('LAST BOUNDARY: a direct cloud call with an image throws under private_vision', () => {
    setMode('private_vision');
    const h = Object.create(LLMHelper.prototype);
    assert.throws(
      () => LLMHelper.prototype.assertOutboundScopes.call(h, 'openai', 'text', IMAGE),
      (e) => e?.name === 'VisionPolicyError',
    );
    // Text-only through the same boundary is unaffected.
    LLMHelper.prototype.assertOutboundScopes.call(h, 'openai', 'text');
    setMode('vision_first');
    LLMHelper.prototype.assertOutboundScopes.call(h, 'openai', 'text', IMAGE);
  });
});
