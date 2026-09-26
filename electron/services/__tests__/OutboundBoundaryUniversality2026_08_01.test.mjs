// The outbound boundary is not universal by construction (2026-08-01, round 2).
//
// The previous round commented assertOutboundScopes as holding "by construction
// … for any path that reaches a provider call another way". An adversarial
// review falsified that and drove a screenshot to three cloud providers:
//
//   GEMINI generateContent:          NO THROW -> payload carries screenshot base64
//   GROQ   generateWithGroqMultimodal: NO THROW -> payload carries screenshot base64
//   CLAUDE generateWithClaude:       NO THROW (reached the SDK)
//   OPENAI generateWithOpenai:       BLOCKED - VisionPolicyError   <- the control
//
// plus generateWithCodexCli / streamWithCodexCli, which had no boundary at all
// and are the sharpest case (visionPolicy.ts keeps Codex OUT of
// isLocalVisionProvider precisely because it routes to chatgpt.com).
//
// EVERY test here asserts on WHAT THE PROVIDER CLIENT RECEIVED, not on the
// throw. A test shaped `assert.throws(..., e => e.name === 'VisionPolicyError')`
// passes even when the gate is placed after the bytes are assembled, and the
// defect being fixed is precisely "the payload went out". Each gated case is
// therefore paired with a vision_first BASELINE proving the stub does receive
// the pixels when policy allows — without it, a stub that is never called for
// an unrelated reason reads as green.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);

// `electron` is an esbuild external; SettingsManager/CredentialsManager touch
// `app` at module scope. Without this shim the live policy readers fail OPEN and
// every assertion below is vacuous.
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: {
    app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};

const { LLMHelper } = require(dist('LLMHelper.js'));
const { SettingsManager } = require(dist('services/SettingsManager.js'));
const { PRIVATE_VISION_NO_LOCAL_MESSAGE } = require(dist('llm/visionPolicy.js'));

const SETTINGS_SLOT = '__nativelySettingsManagerV1__';
const CRED_SLOT = '__nativelyCredentialsManagerV1__';
let settingsBefore, credBefore;

// A REAL file on disk: processImage / fs.existsSync are not stubbed, so the
// base64 that reaches each stub is produced by the shipped encoding path. A
// fake path would make "payload carries pixels" unfalsifiable.
const IMG = path.join(os.tmpdir(), 'natively-boundary-probe.png');
// 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

beforeEach(() => {
  settingsBefore = globalThis[SETTINGS_SLOT];
  credBefore = globalThis[CRED_SLOT];
  fs.writeFileSync(IMG, PNG);
  setCreds({});
});
afterEach(() => {
  if (settingsBefore === undefined) delete globalThis[SETTINGS_SLOT]; else globalThis[SETTINGS_SLOT] = settingsBefore;
  if (credBefore === undefined) delete globalThis[CRED_SLOT]; else globalThis[CRED_SLOT] = credBefore;
  try { fs.unlinkSync(IMG); } catch { /* best effort */ }
  const sm = SettingsManager.getInstance();
  sm.setScreenUnderstandingMode('vision_first');
  sm.set('providerDataScopes', {});
});

const setMode = (mode) => SettingsManager.getInstance().setScreenUnderstandingMode(mode);
const setScopes = (scopes) => SettingsManager.getInstance().set('providerDataScopes', scopes);
const setCreds = ({ disabled = [], anyVision = true } = {}) => {
  globalThis[CRED_SLOT] = {
    getDisabledProviders: () => disabled,
    anyVisionProviderConfigured: () => anyVision,
    anyLocalVisionProviderConfigured: () => false,
  };
};

/** Does a serialized provider payload contain the encoded screenshot? */
const carriesPixels = (payload) => {
  const json = JSON.stringify(payload ?? null);
  // The shipped encoders emit either a bare base64 `data` field (Gemini
  // inlineData / Claude image source) or a `data:image/...;base64,` URL
  // (OpenAI / Groq image_url). Match the encoded bytes themselves so the check
  // cannot be satisfied by a mere filename appearing in the prompt text.
  return /"data"\s*:\s*"[A-Za-z0-9+/]{16,}={0,2}"/.test(json)
    || /data:image\/[a-z]+;base64,[A-Za-z0-9+/]{16,}/.test(json);
};

/** A helper whose provider clients are capture stubs. */
function helper() {
  const h = Object.create(LLMHelper.prototype);
  const seen = { gemini: [], claude: [], groq: [], ollama: [], codex: [] };

  h.currentModelId = 'gpt-test';
  h.geminiModel = 'gemini-test';
  h.isLocalOnlyMode = false;
  h.useOllama = false;
  h.ollamaUrl = 'http://127.0.0.1:11434';
  h.ollamaModel = 'llava:7b';
  h.checkOllamaAvailable = async () => false;
  h.ensureOllamaModelSelected = async () => false;
  h.rateLimiters = {
    gemini: { acquire: async () => {} }, groq: { acquire: async () => {} },
    openai: { acquire: async () => {} }, claude: { acquire: async () => {} },
    deepseek: { acquire: async () => {} },
  };
  h.withRetry = (fn) => fn();
  h.withTimeout = (p) => p;
  h.getClaudeMaxOutput = () => 4096;
  h.buildClaudeSystemBlocks = (s) => [{ type: 'text', text: s }];
  h.isClaudeModel = () => true;
  h.modelVersionManager = {
    getAllVisionTiers: () => [{ family: 'gemini_flash', tier1: 'g1', tier2: 'g2', tier3: 'g3' }],
    onModelError: async () => {},
  };
  h.isCodexAvailable = () => false;
  h.codexCliConfig = { path: '/nonexistent/codex', model: 'm', fastModel: 'fm', timeoutMs: 1000 };
  h.customProvider = null;
  h.activeCurlProvider = null;

  // Private client FIELDS, so the real disabled-provider getters still run.
  h._client = {
    models: {
      generateContent: async (req) => {
        seen.gemini.push(req);
        return { text: 'gemini-ok', candidates: [{ content: { parts: [{ text: 'gemini-ok' }] } }] };
      },
    },
  };
  h._claudeClient = {
    messages: {
      stream: (req) => {
        seen.claude.push(req);
        return { finalMessage: async () => ({ content: [{ type: 'text', text: 'claude-ok' }], usage: {} }) };
      },
    },
  };
  h._groqClient = {
    chat: {
      completions: {
        create: async (req) => {
          seen.groq.push(req);
          return { choices: [{ message: { content: 'groq-ok' } }] };
        },
      },
    },
  };
  h.callOllama = async (prompt, imagePaths) => { seen.ollama.push({ prompt, imagePaths }); return 'ollama-ok'; };

  return { h, seen };
}

// ── DEFECT 1: the three ungated cloud methods ───────────────────────────────

describe('DEFECT 1 — generateContent (the image rides inside `contents`)', () => {
  const inlineParts = () => [
    { text: 'what is on my screen?' },
    { inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } },
  ];
  // The OTHER shape the codebase builds (runVisionRequest's gemini branch).
  const roleParts = () => [{
    role: 'user',
    parts: [{ text: 'q' }, { inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } }],
  }];

  test('BASELINE: vision_first really does hand the pixels to the Gemini SDK', async () => {
    setMode('vision_first');
    const { h, seen } = helper();
    await LLMHelper.prototype.generateContent.call(h, inlineParts());
    assert.equal(seen.gemini.length, 1, 'the SDK stub was never reached — every assertion below would be vacuous');
    assert.equal(carriesPixels(seen.gemini[0]), true, 'baseline must actually ship the screenshot');
  });

  test('private_vision: the Gemini SDK is NEVER called (bare inlineData part)', async () => {
    setMode('private_vision');
    const { h, seen } = helper();
    await assert.rejects(
      () => LLMHelper.prototype.generateContent.call(h, inlineParts()),
      (e) => e?.name === 'VisionPolicyError',
    );
    assert.deepEqual(seen.gemini, [], 'LEAK: the screenshot reached the Gemini SDK under private_vision');
  });

  test('private_vision: covered for the role-shaped `parts` form too', async () => {
    setMode('vision_first');
    const base = helper();
    await LLMHelper.prototype.generateContent.call(base.h, roleParts());
    assert.equal(carriesPixels(base.seen.gemini[0]), true, 'baseline for the role-shaped form');

    setMode('private_vision');
    const { h, seen } = helper();
    await assert.rejects(
      () => LLMHelper.prototype.generateContent.call(h, roleParts()),
      (e) => e?.name === 'VisionPolicyError',
    );
    assert.deepEqual(seen.gemini, [], 'LEAK: the role-shaped `parts` form bypassed the derived-image check');
  });

  test('the `screenshots` SCOPE is enforced here too, not just the mode', async () => {
    // The second switch over the same bytes. generateContent has no imagePaths,
    // so before the fix scopesForPayload could not classify `screenshots` at
    // all and the Privacy panel's toggle was inert on this path.
    setMode('vision_first');
    setScopes({ screenshots: false });
    const { h, seen } = helper();
    await assert.rejects(
      () => LLMHelper.prototype.generateContent.call(h, inlineParts()),
      (e) => e?.name === 'ProviderScopeError',
    );
    assert.deepEqual(seen.gemini, [], 'LEAK: screenshots scope denied, pixels still reached Gemini');
  });

  test('a text-only generateContent is unaffected by either switch', async () => {
    setMode('private_vision');
    setScopes({ screenshots: false });
    const { h, seen } = helper();
    const out = await LLMHelper.prototype.generateContent.call(h, [{ text: 'no image here' }]);
    assert.equal(out, 'gemini-ok');
    assert.equal(seen.gemini.length, 1, 'over-blocking: a text turn must not be caught by the screenshot gates');
  });
});

describe('DEFECT 1 — generateWithClaude had no boundary at all', () => {
  test('BASELINE: vision_first hands base64 image blocks to the Anthropic SDK', async () => {
    setMode('vision_first');
    const { h, seen } = helper();
    await LLMHelper.prototype.generateWithClaude.call(h, 'q', 'sys', [IMG]);
    assert.equal(seen.claude.length, 1);
    assert.equal(carriesPixels(seen.claude[0]), true, 'baseline must actually ship the screenshot');
  });

  test('private_vision: the Anthropic SDK is NEVER reached', async () => {
    setMode('private_vision');
    const { h, seen } = helper();
    await assert.rejects(
      () => LLMHelper.prototype.generateWithClaude.call(h, 'q', 'sys', [IMG]),
      (e) => e?.name === 'VisionPolicyError',
    );
    assert.deepEqual(seen.claude, [], 'LEAK: the screenshot reached the Anthropic SDK under private_vision');
  });

  test('a switched-off Claude is refused at the boundary as well', async () => {
    setCreds({ disabled: ['claude'] });
    const { h, seen } = helper();
    await assert.rejects(
      () => LLMHelper.prototype.generateWithClaude.call(h, 'q', 'sys'),
      (e) => e?.name === 'ProviderDisabledError' || /not initialized/.test(e?.message ?? ''),
    );
    assert.deepEqual(seen.claude, []);
  });
});

describe('DEFECT 1 — generateWithGroqMultimodal had no boundary at all', () => {
  test('BASELINE: vision_first hands a base64 image_url to the Groq SDK', async () => {
    setMode('vision_first');
    const { h, seen } = helper();
    await LLMHelper.prototype.generateWithGroqMultimodal.call(h, 'q', [IMG], 'sys');
    assert.equal(seen.groq.length, 1);
    assert.equal(carriesPixels(seen.groq[0]), true, 'baseline must actually ship the screenshot');
  });

  test('private_vision: the Groq SDK is NEVER reached', async () => {
    setMode('private_vision');
    const { h, seen } = helper();
    await assert.rejects(
      () => LLMHelper.prototype.generateWithGroqMultimodal.call(h, 'q', [IMG], 'sys'),
      (e) => e?.name === 'VisionPolicyError',
    );
    assert.deepEqual(seen.groq, [], 'LEAK: the screenshot reached the Groq SDK under private_vision');
  });

  test('screenshots scope denied: the Groq SDK is NEVER reached', async () => {
    setScopes({ screenshots: false });
    const { h, seen } = helper();
    await assert.rejects(
      () => LLMHelper.prototype.generateWithGroqMultimodal.call(h, 'q', [IMG], 'sys'),
      (e) => e?.name === 'ProviderScopeError',
    );
    assert.deepEqual(seen.groq, []);
  });
});

describe('DEFECT 1 — Codex CLI had no boundary at all', () => {
  // CodexCliService.run/stream spawn a process, so the observable is whether
  // execution got PAST the boundary into transport setup. getSelectedCodexCliModel
  // is the first statement after it; a sentinel throw there is reached on the
  // baseline and must NOT be reached when the policy refuses.
  function codexHelper() {
    const { h, seen } = helper();
    h.isCodexAvailable = () => true;
    h.getSelectedCodexCliModel = () => {
      seen.codex.push('reached-transport');
      throw new Error('SENTINEL_REACHED_TRANSPORT');
    };
    return { h, seen };
  }

  test('BASELINE: vision_first gets past the boundary into transport setup', async () => {
    setMode('vision_first');
    const { h, seen } = codexHelper();
    await assert.rejects(
      () => LLMHelper.prototype.generateWithCodexCli.call(h, 'q', 'sys', false, [IMG]),
      (e) => /SENTINEL_REACHED_TRANSPORT/.test(e?.message ?? ''),
    );
    assert.equal(seen.codex.length, 1, 'baseline must reach transport, else the negative below proves nothing');
  });

  test('private_vision: generateWithCodexCli stops BEFORE transport', async () => {
    setMode('private_vision');
    const { h, seen } = codexHelper();
    await assert.rejects(
      () => LLMHelper.prototype.generateWithCodexCli.call(h, 'q', 'sys', false, [IMG]),
      (e) => e?.name === 'VisionPolicyError',
    );
    assert.deepEqual(seen.codex, [], 'LEAK: Codex routes to chatgpt.com — this is a CLOUD send under private_vision');
  });

  test('private_vision: streamWithCodexCli stops BEFORE transport (generator, so iterate)', async () => {
    // A generator body does not run until the first next(); a test that merely
    // CALLS it would pass with no gate at all.
    setMode('vision_first');
    const base = codexHelper();
    await assert.rejects(
      () => base.h.streamWithCodexCli('q', 'sys', false, [IMG]).next(),
      (e) => /SENTINEL_REACHED_TRANSPORT/.test(e?.message ?? ''),
    );
    assert.equal(base.seen.codex.length, 1, 'baseline must reach transport');

    setMode('private_vision');
    const { h, seen } = codexHelper();
    await assert.rejects(
      () => h.streamWithCodexCli('q', 'sys', false, [IMG]).next(),
      (e) => e?.name === 'VisionPolicyError',
    );
    assert.deepEqual(seen.codex, []);
  });
});

// ── DEFECT 2: generateWithVisionFallback / analyzeImageFiles ────────────────

describe('DEFECT 2 — the fourth image-dispatch chain had none of the three gates', () => {
  test('BASELINE: analyzeImageFiles really does send the pixels to Gemini', async () => {
    setMode('vision_first');
    const { h, seen } = helper();
    const r = await LLMHelper.prototype.analyzeImageFiles.call(h, [IMG]);
    assert.equal(r.text, 'gemini-ok');
    assert.equal(seen.gemini.length >= 1, true);
    assert.equal(carriesPixels(seen.gemini[0]), true, 'baseline must ship pixels or every case below is vacuous');
  });

  test('private_vision + screenshots denied + no local vision: NOTHING leaves', async () => {
    // The reviewer drove exactly this and observed
    // "gemini payload carries SCREENSHOT_PIXELS: true" with BOTH switches off.
    setMode('private_vision');
    setScopes({ screenshots: false });
    const { h, seen } = helper();
    const r = await LLMHelper.prototype.analyzeImageFiles.call(h, [IMG]);
    assert.deepEqual(seen.gemini, [], 'LEAK: pixels reached Gemini with both switches off');
    assert.deepEqual(seen.claude, []);
    assert.deepEqual(seen.groq, []);
    assert.deepEqual(seen.ollama, []);
    assert.equal(r.text, PRIVATE_VISION_NO_LOCAL_MESSAGE, 'the user must be told, not silently answered');
  });

  test('private_vision with a local vision model: routed to Ollama, no cloud dispatch', async () => {
    setMode('private_vision');
    const { h, seen } = helper();
    h.useOllama = true;
    h.checkOllamaAvailable = async () => true;
    h.ensureOllamaModelSelected = async () => true;
    const r = await LLMHelper.prototype.analyzeImageFiles.call(h, [IMG]);
    assert.equal(r.text, 'ollama-ok');
    assert.deepEqual(seen.ollama[0].imagePaths, [IMG], 'the local model must actually receive the image');
    assert.deepEqual(seen.gemini, [], 'LEAK: a cloud provider was called anyway');
  });

  test('screenshots scope denied, no local model: image DROPPED, text still answered', async () => {
    // Not a block: this matches the Privacy panel's own "Omitted" badge.
    setMode('vision_first');
    setScopes({ screenshots: false });
    const { h, seen } = helper();
    const r = await LLMHelper.prototype.analyzeImageFiles.call(h, [IMG]);
    assert.equal(r.text, 'gemini-ok', 'the turn should still be answered without the image');
    assert.equal(seen.gemini.length, 1);
    assert.equal(carriesPixels(seen.gemini[0]), false, 'LEAK: the denied screenshot was still serialized into the payload');
  });

  test('a text-only vision-fallback turn is unaffected', async () => {
    setMode('private_vision');
    const { h, seen } = helper();
    const out = await LLMHelper.prototype.generateWithVisionFallback.call(h, 'sys', 'a text question', []);
    assert.equal(out, 'gemini-ok');
    assert.equal(seen.gemini.length, 1, 'over-blocking: a text turn must not be caught by the screenshot gate');
  });
});

// ── DEFECT 3: custom / cURL providers escape the disabled-provider gate ─────

describe('DEFECT 3 — the `custom` family toggle reaches the boundary', () => {
  test('BASELINE: with custom providers ON, the boundary lets them through', async () => {
    setCreds({ disabled: [] });
    const { h } = helper();
    // No throw.
    LLMHelper.prototype.assertOutboundScopes.call(h, 'custom_provider', 'transcript text');
    LLMHelper.prototype.assertOutboundScopes.call(h, 'custom_curl', 'transcript text');
  });

  test('the family id the UI actually writes (`custom`) is refused at the boundary', async () => {
    setCreds({ disabled: ['custom'] });
    const { h } = helper();
    for (const label of ['custom_provider', 'custom_curl']) {
      assert.throws(
        () => LLMHelper.prototype.assertOutboundScopes.call(h, label, 'transcript text'),
        (e) => e?.name === 'ProviderDisabledError',
        `LEAK: ${label} still sent user data after "Disable custom providers" was switched on`,
      );
    }
  });

  test('streamWithCustom refuses before touching the network', async () => {
    setCreds({ disabled: ['custom'] });
    const { h } = helper();
    h.customProvider = { id: 'cp1', name: 'OpenRouter', curlCommand: 'curl https://openrouter.ai/api' };
    let fetched = false;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => { fetched = true; return { ok: true, body: null }; };
    try {
      await assert.rejects(
        () => h.streamWithCustom('transcript text', undefined, undefined, 'sys').next(),
        (e) => e?.name === 'ProviderDisabledError',
      );
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(fetched, false, 'LEAK: the user data reached the custom endpoint');
  });

  test('the structured cascade does not build a custom rung when the family is off', async () => {
    // Every OTHER rung is removed on purpose. An earlier version of this test
    // left Gemini configured and asserted the answer came from Gemini — which
    // passes with the gate deleted, because Gemini is priority 6 and custom is
    // priority 7, so the custom rung is merely never REACHED. That proved
    // ordering, not gating. Mutation-probed: with the gate removed this now
    // fails.
    setCreds({ disabled: ['custom'] });
    const { h } = helper();
    h.customProvider = { id: 'cp1', name: 'OpenRouter', curlCommand: 'curl https://openrouter.ai/api' };
    h.nativelyKey = null;
    h._openaiClient = null;
    h._claudeClient = null;
    h._client = null;
    h.executeCustomProvider = async () => 'custom-ok';
    await assert.rejects(
      () => LLMHelper.prototype.generateContentStructured.call(h, 'a question'),
      (e) => /No reasoning model available/.test(e?.message ?? ''),
      'LEAK: the cascade still built a rung onto the user endpoint they switched off',
    );
  });

  // chatWithGemini's own rungs (the non-streaming Ask-AI path). Driven for
  // real: a legacy caller (no routeOptions) skips mode injection, so the
  // cascade is reachable with a modest stub set. The `.catch` shape matters —
  // chatWithGemini swallows downstream errors into a user-facing string, so the
  // assertion is on whether the rung RAN, never on the return value.
  const chatWithGeminiCustomRung = async (disabled) => {
    setCreds({ disabled });
    const { h } = helper();
    h.groqFastTextMode = false;
    h.isCodexCliModel = () => false;
    h.processResponse = (x) => x;
    h.customProvider = { id: 'cp1', name: 'OpenRouter', curlCommand: 'curl https://openrouter.ai/api' };
    h._client = null; h._groqClient = null; h._openaiClient = null;
    h._claudeClient = null; h._deepseekClient = null;
    h.nativelyKey = null;
    let used = false;
    h.executeCustomProvider = async () => { used = true; return 'custom-ok'; };
    await LLMHelper.prototype.chatWithGemini.call(h, 'a question').catch(() => {});
    return used;
  };

  test('BASELINE: chatWithGemini DOES use the custom rung when the family is on', async () => {
    assert.equal(await chatWithGeminiCustomRung([]), true,
      'if this is false the negative below proves nothing about the gate');
  });

  test('chatWithGemini skips the custom rung when the family is off', async () => {
    assert.equal(await chatWithGeminiCustomRung(['custom']), false,
      'LEAK: the non-streaming Ask-AI path still dispatched to a disabled custom endpoint');
  });

  test('executeCustomProvider and chatWithCurl refuse before any network call', async () => {
    // These are the send paths behind chatWithGemini's `if (this.activeCurlProvider)`
    // / `if (this.customProvider)` rungs. Gating those reads gives a cleaner
    // error; THIS is what makes the data-egress guarantee hold regardless.
    setCreds({ disabled: ['custom'] });
    const { h } = helper();
    h.customProvider = { id: 'cp1', name: 'OpenRouter', curlCommand: 'curl https://openrouter.ai/api' };
    h.activeCurlProvider = { id: 'cc1', name: 'MyCurl', curlCommand: 'curl https://example.com', responsePath: 'x' };
    let fetched = false;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => { fetched = true; return { ok: true, json: async () => ({}) }; };
    try {
      await assert.rejects(
        () => LLMHelper.prototype.executeCustomProvider.call(h, h.customProvider.curlCommand, 'transcript text', 'sys', 'q', ''),
        (e) => e?.name === 'ProviderDisabledError',
      );
      await assert.rejects(
        () => LLMHelper.prototype.chatWithCurl.call(h, 'transcript text', 'sys'),
        (e) => e?.name === 'ProviderDisabledError',
      );
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(fetched, false, 'LEAK: user data reached a custom endpoint that was switched off');
  });

  test('the vision-fallback local rung is not built when the family is off', async () => {
    setCreds({ disabled: ['custom'] });
    const { h } = helper();
    h.customProvider = { id: 'cp1', name: 'OpenRouter', curlCommand: 'curl https://openrouter.ai/api' };
    h._client = { models: { generateContent: async () => { throw new Error('401 unauthorized'); } } };
    let used = false;
    h.executeCustomProvider = async () => { used = true; return 'custom-ok'; };
    await assert.rejects(
      () => LLMHelper.prototype.generateWithVisionFallback.call(h, 'sys', 'q', []),
      (e) => /All AI providers failed/.test(e?.message ?? ''),
    );
    assert.equal(used, false, 'LEAK: the last-resort local rung called a disabled custom endpoint');
  });

  test('BASELINE: the vision-fallback local rung IS built when the family is on', async () => {
    setCreds({ disabled: [] });
    const { h } = helper();
    h.customProvider = { id: 'cp1', name: 'OpenRouter', curlCommand: 'curl https://openrouter.ai/api' };
    h._client = { models: { generateContent: async () => { throw new Error('401 unauthorized'); } } };
    let used = false;
    h.executeCustomProvider = async () => { used = true; return 'custom-ok'; };
    const out = await LLMHelper.prototype.generateWithVisionFallback.call(h, 'sys', 'q', []);
    assert.equal(used, true, 'the rung must exist when enabled, or the negative above is vacuous');
    assert.equal(out, 'custom-ok');
  });

  test('BASELINE: the structured cascade DOES fall through to custom when it is on', async () => {
    setCreds({ disabled: [] });
    const { h } = helper();
    h.customProvider = { id: 'cp1', name: 'OpenRouter', curlCommand: 'curl https://openrouter.ai/api' };
    h.nativelyKey = null;
    h._openaiClient = null;
    h._claudeClient = null;
    h._client = null; // no Gemini either, so custom is the only rung left
    let used = false;
    h.executeCustomProvider = async () => { used = true; return 'custom-ok'; };
    const out = await LLMHelper.prototype.generateContentStructured.call(h, 'a question');
    assert.equal(used, true, 'the custom rung must exist when enabled, or the negative test above is vacuous');
    assert.equal(out, 'custom-ok');
  });
});

// ── DEFECT 4: checkOllamaAvailable must be a pure predicate ─────────────────

describe('DEFECT 4 — the availability probe no longer reassigns the user model', () => {
  const realFetch = globalThis.fetch;
  const probeHelper = ({ selected, models }) => {
    const h = Object.create(LLMHelper.prototype);
    h.useOllama = true;
    h.ollamaUrl = 'http://127.0.0.1:11434';
    h.ollamaModel = selected;
    h.getOllamaModels = async () => models;
    return h;
  };
  beforeEach(() => { globalThis.fetch = async () => ({ ok: true }); });
  afterEach(() => { globalThis.fetch = realFetch; });

  test('checkOllamaAvailable does NOT write this.ollamaModel', async () => {
    // The Settings pane polls scopeFallbackAvailable, which routes here. Before
    // the split this reassigned the user's runtime selection twice every three
    // seconds for as long as the pane was open.
    const h = probeHelper({ selected: 'gone:7b', models: ['llava:7b', 'llama3'] });
    const ok = await LLMHelper.prototype.checkOllamaAvailable.call(h, false);
    assert.equal(ok, true, 'the probe must still answer, or purity is being proven by failure');
    assert.equal(h.ollamaModel, 'gone:7b', 'MUTATION: a query reassigned the user model selection');
  });

  test('scopeFallbackAvailable is pure across repeated polls', async () => {
    const h = probeHelper({ selected: 'gone:7b', models: ['llava:7b'] });
    for (let i = 0; i < 5; i++) await LLMHelper.prototype.scopeFallbackAvailable.call(h, false);
    assert.equal(h.ollamaModel, 'gone:7b', 'MUTATION: polling reassigned the user model selection');
  });

  test('canUseLocalFallback is pure too (WhatToAnswerLLM polls it per turn)', async () => {
    const h = probeHelper({ selected: 'gone:7b', models: ['llava:7b'] });
    await LLMHelper.prototype.canUseLocalFallback.call(h, false);
    assert.equal(h.ollamaModel, 'gone:7b');
  });

  test('BASELINE: ensureOllamaModelSelected still performs the repair', async () => {
    // The auto-selection was not deleted, only made explicit. If this fails the
    // dispatch sites are now handing an uninstalled model name to Ollama.
    const h = probeHelper({ selected: 'gone:7b', models: ['llava:7b', 'llama3'] });
    const ok = await LLMHelper.prototype.ensureOllamaModelSelected.call(h, false);
    assert.equal(ok, true);
    assert.equal(h.ollamaModel, 'llava:7b', 'the repair the dispatch sites rely on is gone');
  });

  test('ensureOllamaModelSelected leaves an INSTALLED selection alone', async () => {
    const h = probeHelper({ selected: 'llama3', models: ['llava:7b', 'llama3'] });
    await LLMHelper.prototype.ensureOllamaModelSelected.call(h, false);
    assert.equal(h.ollamaModel, 'llama3', 'the repair must not override a valid user choice');
  });

  test('the two return the SAME boolean — the split changed side effects only', async () => {
    for (const models of [['llava:7b'], ['nomic-embed-text']]) {
      for (const needsVision of [true, false]) {
        const a = probeHelper({ selected: 'gone:7b', models });
        const b = probeHelper({ selected: 'gone:7b', models });
        assert.equal(
          await LLMHelper.prototype.checkOllamaAvailable.call(a, needsVision),
          await LLMHelper.prototype.ensureOllamaModelSelected.call(b, needsVision),
          `predicates diverged for models=${models} needsVision=${needsVision}`,
        );
      }
    }
  });

  test('a dispatching path still uses the MUTATING variant', async () => {
    // resolveOutboundVisionDecision goes on to call callOllama with
    // this.ollamaModel, so it is one of the sites that must repair.
    const h = probeHelper({ selected: 'gone:7b', models: ['llava:7b'] });
    setMode('private_vision');
    const r = await LLMHelper.prototype.resolveOutboundVisionDecision.call(h, [IMG], true);
    assert.equal(r.localAvailable, true);
    assert.equal(h.ollamaModel, 'llava:7b', 'a site that dispatches to Ollama did not repair the model');
  });
});

// ── ALSO: the transcript strip, and policy errors reaching the user ─────────

describe('ALSO — the `# Conversation so far` strip matches what the detector accepts', () => {
  const strip = (msg) => LLMHelper.prototype.stripDeniedScopedBlocksFromMessage.call(
    Object.create(LLMHelper.prototype), msg, ['transcript'],
  );

  test('a section preceded by a SINGLE newline is stripped (it was not before)', () => {
    // The detector is /^# Conversation so far$/m, whose ^ matches after ANY
    // newline; the strip required \n\n, so this input was classified as
    // transcript-bearing and then left intact.
    const msg = '# Question\nQ\n# Conversation so far\nUSER SAID SECRET\nMORE SECRET\n\n# Evidence\nE';
    const out = strip(msg);
    assert.equal(/SECRET/.test(out), false, 'LEAK: the conversation survived the transcript strip');
    assert.equal(out.includes('# Evidence'), true, 'over-stripping: the evidence block must survive');
  });

  test('the double-newline and start-of-string forms still strip', () => {
    for (const msg of [
      '# Question\nQ\n\n# Conversation so far\nSECRET\n\n# Evidence\nE',
      '# Conversation so far\nSECRET\n\n# Evidence\nE',
    ]) {
      const out = strip(msg);
      assert.equal(/SECRET/.test(out), false);
      assert.equal(out.includes('# Evidence'), true);
    }
  });

  test('a section that runs to the end of the payload is stripped', () => {
    const out = strip('# Question\nQ\n\n# Conversation so far\nSECRET\nMORE');
    assert.equal(/SECRET|MORE/.test(out), false);
  });

  test('detector and strip agree: anything classified transcript loses its body', () => {
    for (const lead of ['', '\n', '\n\n', 'X\n', 'X\n\n']) {
      const msg = `${lead}# Conversation so far\nSECRET`;
      assert.equal(/^# Conversation so far$/m.test(msg), true, 'precondition: the detector accepts this shape');
      assert.equal(/SECRET/.test(strip(msg)), false, `LEAK for lead=${JSON.stringify(lead)}`);
    }
  });

  test('an unrelated payload is untouched', () => {
    const msg = '# Question\nQ\n\n# Evidence\nE';
    assert.equal(strip(msg), msg);
  });
});

describe('ALSO — a policy refusal reaches the user instead of "All AI providers failed"', () => {
  test('VisionPolicyError from inside the cascade surfaces its userMessage', async () => {
    setMode('vision_first');
    const { h, seen } = helper();
    // A provider that refuses on policy grounds mid-cascade. Matched on `.name`
    // because esbuild inlines the error class per entry bundle.
    const { VisionPolicyError } = require(dist('llm/visionPolicy.js'));
    h._client = {
      models: {
        generateContent: async () => { throw new VisionPolicyError('gemini', PRIVATE_VISION_NO_LOCAL_MESSAGE); },
      },
    };
    const out = await LLMHelper.prototype.generateWithVisionFallback.call(h, 'sys', 'q', []);
    assert.equal(out, PRIVATE_VISION_NO_LOCAL_MESSAGE, 'the actionable text was swallowed by the cascade');
    assert.deepEqual(seen.claude, [], 'a refusal must not be retried against another provider');
  });

  test('BASELINE: an ordinary provider error still ends in the generic cascade failure', async () => {
    // Proves the branch above is discriminating on `.name`, not short-circuiting
    // every error. Shaped as an auth failure purely so the cascade classifies it
    // non-retryable and exhausts at once — three rotations of exponential
    // backoff would make this a 24-second test for no extra coverage.
    setMode('vision_first');
    const { h } = helper();
    h._client = { models: { generateContent: async () => { throw new Error('boom: 401 unauthorized'); } } };
    await assert.rejects(
      () => LLMHelper.prototype.generateWithVisionFallback.call(h, 'sys', 'q', []),
      (e) => /All AI providers failed/.test(e?.message ?? ''),
    );
  });
});
