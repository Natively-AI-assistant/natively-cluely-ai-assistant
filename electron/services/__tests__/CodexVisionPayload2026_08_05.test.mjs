// electron/services/__tests__/CodexVisionPayload2026_08_05.test.mjs
//
// Codex CLI vision: wire shape + the boundaries that must still hold now that
// screenshots ACTUALLY leave through this transport.
//
// BACKGROUND
// buildRequestBody used to drop `imagePaths` on the floor with a comment saying
// image-bearing Codex calls were unsupported. The user-visible symptom was the
// model replying "I am not an image model" — the image never reached it. The
// fix encodes each screenshot as a Responses-API `input_image` item.
//
// THE REGRESSION THESE TESTS PIN
// The Responses API and the Chat Completions API disagree on the shape:
//     Responses         { type: 'input_image',  image_url: '<data URL string>' }
//     Chat Completions  { type: 'image_url',    image_url: { url: '<data URL>' } }
// This endpoint is /v1/responses. Sending the Chat Completions shape does NOT
// error — the backend ignores the unknown item and the model answers as if no
// image were attached, which is exactly the bug being fixed. The first commit
// on this branch shipped the wrong one, so `image_url` being a STRING is a
// load-bearing assertion, not a style preference.
//
// AND THE BOUNDARIES
// Codex routes to chatgpt.com/backend-api. visionPolicy.ts deliberately keeps
// it out of isLocalVisionProvider(), and CodexNotLocalVisionGuard pins the
// registry entry. Those guard the REGISTRY path; the tests at the bottom guard
// the LLMHelper path (streamVisionWithFallback → streamWithCodexCli), which is
// the one this change newly wired for images.
//
// Run via: npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/CodexVisionPayload2026_08_05.test.mjs

import { test, describe } from 'node:test';
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
// `app` at module scope. Without this shim the live policy readers fail open
// and the private_vision assertions below would be vacuous.
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: {
    app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};

const { CodexCliService } = require(dist('services/CodexCliService.js'));
// NOTE: deliberately NOT requiring dist/services/CodexOAuthService.js — see
// seedSignedIn() for why that instance is the wrong one.
const { LLMHelper } = require(dist('LLMHelper.js'));
const { SettingsManager } = require(dist('services/SettingsManager.js'));

const sharp = require('sharp');

// ── fixtures ────────────────────────────────────────────────────────────────

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-vision-'));

/** A real, decodable PNG. 2400px wide so the 1920 downscale is observable. */
async function makeBigPng(name = 'shot.png') {
  const file = path.join(TMP, name);
  const buf = await sharp({
    create: { width: 2400, height: 1400, channels: 3, background: { r: 200, g: 30, b: 90 } },
  }).png().toBuffer();
  fs.writeFileSync(file, buf);
  return { file, bytes: buf.length };
}

const CRED_SLOT = '__nativelyCredentialsManagerV1__';

/**
 * Make Codex look signed in to the CodexOAuthService copy that is INLINED into
 * the CodexCliService bundle.
 *
 * `__setCachedTokensForTest` on the standalone dist/services/CodexOAuthService.js
 * does NOT work here: esbuild inlines that module per entry bundle, so the
 * instance the test would touch is a different object from the one
 * CodexCliService.stream() calls. The seam that IS shared is
 * getCredentialsManager() — a LAZY runtime require, which resolves through the
 * `__nativelyCredentialsManagerV1__` global slot from whichever bundle asks.
 */
function seedSignedIn() {
  globalThis[CRED_SLOT] = {
    getCodexOAuthTokens: () => ({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      accountId: 'acct_test',
      expiresAt: Date.now() + 3_600_000,
    }),
    getDisabledProviders: () => [],
    anyVisionProviderConfigured: () => true,
    anyLocalVisionProviderConfigured: () => false,
  };
}

const SSE_OK = [
  'event: response.output_text.delta',
  'data: {"type":"response.output_text.delta","delta":"ok"}',
  '',
  'event: response.completed',
  'data: {"type":"response.completed"}',
  '',
  '',
].join('\n');

/**
 * Drive CodexCliService.stream with a stubbed fetch and return the parsed
 * request body. This is the only way to observe buildRequestBody — it is a
 * private static, and asserting on the SERIALIZED payload is the point anyway:
 * that is what the backend actually receives.
 */
async function captureRequestBody(options) {
  seedSignedIn();
  const realFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (_url, init) => {
    captured = JSON.parse(init.body);
    return new Response(SSE_OK, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  try {
    let out = '';
    for await (const chunk of CodexCliService.stream('', { model: 'gpt-5.4', timeoutMs: 30_000, ...options })) {
      out += chunk;
    }
    return { body: captured, out };
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis[CRED_SLOT];
  }
}

const userContent = (body) => body.input.find((i) => i.role === 'user').content;

// ── 1. wire shape ───────────────────────────────────────────────────────────

describe('Codex vision payload — Responses API wire shape', () => {
  test('a screenshot becomes an input_image item with a STRING image_url', async () => {
    const { file } = await makeBigPng();
    const { body } = await captureRequestBody({ prompt: 'what is this?', imagePaths: [file] });

    const content = userContent(body);
    assert.equal(content[0].type, 'input_text', 'the text prompt must lead the content array');
    assert.equal(content[0].text, 'what is this?');

    const image = content[1];
    assert.equal(image.type, 'input_image',
      'Responses API uses input_image. `image_url` (the Chat Completions type) is silently '
      + 'ignored by this endpoint and the model answers as if no screenshot were attached.');
    assert.equal(typeof image.image_url, 'string',
      'Responses API takes image_url as a data-URL STRING. The Chat Completions object form '
      + '{ url: ... } is the exact bug this branch was opened to fix — do not "fix" it back.');
    assert.match(image.image_url, /^data:image\/(jpeg|png|webp|gif);base64,/);
    assert.equal(image.detail, 'auto');
  });

  test('multiple screenshots each get their own item, in order, after the text', async () => {
    const a = await makeBigPng('a.png');
    const b = await makeBigPng('b.png');
    const { body } = await captureRequestBody({ prompt: 'compare', imagePaths: [a.file, b.file] });

    const content = userContent(body);
    assert.equal(content.length, 3);
    assert.equal(content[0].type, 'input_text');
    assert.equal(content[1].type, 'input_image');
    assert.equal(content[2].type, 'input_image');
  });

  test('a text-only call carries no image items (the non-vision path is unchanged)', async () => {
    const { body } = await captureRequestBody({ prompt: 'hello' });
    const content = userContent(body);
    assert.equal(content.length, 1);
    assert.equal(content[0].type, 'input_text');
  });
});

// ── 2. size policy ──────────────────────────────────────────────────────────

describe('Codex vision payload — size policy matches the other cloud providers', () => {
  test('a 2400px screenshot is downscaled and re-encoded, not shipped raw', async () => {
    const { file, bytes } = await makeBigPng('huge.png');
    const { body } = await captureRequestBody({ prompt: 'x', imagePaths: [file] });

    const image = userContent(body)[1];
    assert.match(image.image_url, /^data:image\/jpeg;base64,/,
      'sharp re-encodes to JPEG (resize 1920 inside / quality 85), same as the LLMHelper '
      + 'cloud vision providers');

    const encodedBytes = Buffer.from(image.image_url.split(',')[1], 'base64').length;
    assert.ok(encodedBytes < bytes,
      `re-encoded image (${encodedBytes}B) should be smaller than the raw PNG (${bytes}B)`);

    // The decoded image must actually be capped at 1920 on its long edge.
    const meta = await sharp(Buffer.from(image.image_url.split(',')[1], 'base64')).metadata();
    assert.equal(meta.width, 1920, 'long edge should be clamped to 1920');
  });

  test('one bad image among good ones is dropped; the good ones still go', async () => {
    const good = await makeBigPng('good.png');
    const { body } = await captureRequestBody({
      prompt: 'compare',
      imagePaths: [path.join(TMP, 'does-not-exist.png'), good.file],
    });
    const content = userContent(body);
    assert.equal(content.length, 2, 'the missing image is dropped, the readable one survives');
    assert.equal(content[1].type, 'input_image');
  });

  test('a 0-byte screenshot is skipped, NOT sent as an empty data URL', async () => {
    // sharp cannot decode it, and the raw fallback must reject it on the LOWER
    // bound. Shipping `data:image/png;base64,` makes the backend 400 the whole
    // turn (every content item fails together), which is strictly worse than
    // dropping the image.
    const empty = path.join(TMP, 'empty.png');
    fs.writeFileSync(empty, Buffer.alloc(0));
    const good = await makeBigPng('with-empty.png');
    const { body } = await captureRequestBody({ prompt: 'x', imagePaths: [empty, good.file] });
    const images = userContent(body).filter((c) => c.type === 'input_image');
    assert.equal(images.length, 1, 'the 0-byte file must not produce an item');
    for (const img of images) {
      assert.ok(img.image_url.split(',')[1]?.length > 0, 'no item may carry an empty base64 payload');
    }
  });

  test('a truncated screenshot is skipped, NOT sent as a corrupt data URL', async () => {
    const truncated = path.join(TMP, 'truncated.png');
    fs.writeFileSync(truncated, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')); // 16-byte PNG header
    const good = await makeBigPng('with-truncated.png');
    const { body } = await captureRequestBody({ prompt: 'x', imagePaths: [truncated, good.file] });
    const images = userContent(body).filter((c) => c.type === 'input_image');
    assert.equal(images.length, 1, 'the truncated file must not produce an item');
  });

  test('a readable-but-undecodable oversized file is skipped rather than shipped raw', async () => {
    // sharp cannot decode this; the raw fallback then applies its byte cap.
    const junk = path.join(TMP, 'not-an-image.png');
    fs.writeFileSync(junk, Buffer.alloc(600 * 1024, 0x41)); // over RAW_IMAGE_MAX_BYTES
    const good = await makeBigPng('with-junk.png');
    const { body } = await captureRequestBody({ prompt: 'x', imagePaths: [junk, good.file] });
    const images = userContent(body).filter((c) => c.type === 'input_image');
    assert.equal(images.length, 1, 'oversized raw fallback must be skipped, not sent');
  });
});

// ── 2b. all-images-dropped must FAIL, not answer blind ──────────────────────

describe('a vision turn whose images all fail to encode does not degrade to text', () => {
  // Sending the prompt alone returns HTTP 200 with a confident answer that never
  // saw the screenshot ("I don't see an image" — the symptom this whole change
  // was written to fix), AND marks Codex healthy in VisionProviderFallbackChain
  // so no other provider is tried. Throwing lets the chain fail over.
  const expectNoRequest = async (imagePaths, label) => {
    seedSignedIn();
    const realFetch = globalThis.fetch;
    let fetched = false;
    globalThis.fetch = async () => { fetched = true; throw new Error('unreachable'); };
    try {
      await assert.rejects(async () => {
        for await (const _ of CodexCliService.stream('', {
          prompt: 'what is on my screen?', model: 'gpt-5.4', timeoutMs: 30_000, imagePaths,
        })) { /* drain */ }
      }, /could not read any of the/i, label);
      assert.equal(fetched, false, 'no request may be sent at all — a text-only turn would answer blind');
    } finally {
      globalThis.fetch = realFetch;
      delete globalThis[CRED_SLOT];
    }
  };

  test('every path missing → throws instead of sending a text-only turn', async () => {
    await expectNoRequest(
      [path.join(TMP, 'gone-a.png'), path.join(TMP, 'gone-b.png')],
      'a screenshot turn with no readable screenshot must not silently become a text turn',
    );
  });

  test('the sole image being 0-byte → throws', async () => {
    const empty = path.join(TMP, 'only-empty.png');
    fs.writeFileSync(empty, Buffer.alloc(0));
    await expectNoRequest([empty], 'a 0-byte capture must fail the turn, not answer blind');
  });
});

// ── 3. boundaries on the newly-wired path ───────────────────────────────────

const SETTINGS_SLOT = '__nativelySettingsManagerV1__';
const setMode = (mode) => SettingsManager.getInstance().setScreenUnderstandingMode(mode);

/** A bare LLMHelper with Codex reachable — everything else left real. */
function codexHelper({ localOnly = false } = {}) {
  const h = Object.create(LLMHelper.prototype);
  h.isCodexAvailable = () => true;
  h.isLocalOnlyMode = localOnly;
  h.codexCliConfig = { path: 'codex', model: 'gpt-5.4', fastModel: 'gpt-5.3-codex', timeoutMs: 60_000 };
  h.currentModelId = 'codex-cli';
  return h;
}

describe('streamWithCodexCli refuses before any byte leaves', () => {
  test('private_vision blocks a screenshot bound for Codex', async () => {
    const before = globalThis[SETTINGS_SLOT];
    setMode('private_vision');
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('fetch must not be reached'); };
    try {
      const gen = LLMHelper.prototype.streamWithCodexCli.call(
        codexHelper(), 'describe this', 'SYS', false, ['/tmp/screenshot-under-test.png'],
      );
      // Match on `.name` + `.userMessage`, not `instanceof` — visionPolicy.ts is
      // inlined per entry bundle, so the error class identity differs here.
      await assert.rejects(() => gen.next(), (err) => {
        assert.equal(err.name, 'VisionPolicyError',
          'Codex is a CLOUD destination; "Keep screenshots on this device" must block it. '
          + 'The registry marks it isLocal:true as a ROUTING hint (no API key) — that hint is '
          + 'not a privacy claim. See visionPolicy.ts.');
        assert.equal(err.provider, 'codex');
        assert.match(err.userMessage, /not sent anywhere/i,
          'the user must be told the screenshot did NOT leave the device');
        return true;
      });
    } finally {
      globalThis.fetch = realFetch;
      setMode('vision_first');
      if (before === undefined) delete globalThis[SETTINGS_SLOT]; else globalThis[SETTINGS_SLOT] = before;
    }
  });

  // SCOPE OF THE TWO TESTS BELOW — read before trusting them.
  //
  // They set `isLocalOnlyMode` on the instance DIRECTLY, because nothing in the
  // shipped app ever turns it on: `setLocalOnlyMode()` has no production caller
  // (grep finds only its definition at LLMHelper.ts:1108 and test files), so
  // the field is permanently false and these throws cannot fire in production
  // today.
  //
  // So these are CONSISTENCY tests, not privacy guarantees: they assert Codex
  // carries the same local-only boundary as the eight other cloud providers, so
  // that whenever local-only mode is actually wired up Codex is not the one
  // provider that silently ignores it. The privacy control that IS live is
  // `screenUnderstandingMode === 'private_vision'`, covered by the test above —
  // do not read a green run here as "Codex is boundaried".
  test('local-only mode blocks Codex — consistency with the other cloud providers (see scope note)', async () => {
    const gen = LLMHelper.prototype.streamWithCodexCli.call(
      codexHelper({ localOnly: true }), 'hi', 'SYS', false, undefined,
    );
    await assert.rejects(() => gen.next(), /local-only mode/i);
  });

  test('generateWithCodexCli enforces the same local-only boundary (see scope note)', async () => {
    await assert.rejects(
      () => LLMHelper.prototype.generateWithCodexCli.call(codexHelper({ localOnly: true }), 'hi'),
      /local-only mode/i,
    );
  });
});
