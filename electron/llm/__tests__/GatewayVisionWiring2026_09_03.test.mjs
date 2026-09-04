// electron/llm/__tests__/GatewayVisionWiring2026_09_03.test.mjs
//
// The LiteLLM / NVIDIA NIM image path, pinned at the four places it was broken.
//
// WHAT WAS WRONG (all four reproduced in a live Natively session against a
// recording proxy, 2026-09-03):
//
//   1. `_streamChatInner` routes EVERY image-bearing request into
//      streamVisionWithFallback and returns. Neither gateway was in that chain,
//      so `streamWithLiteLLM` could not receive an image no matter what the
//      routing branch below said — its `imagePaths` argument was dead code. A
//      profile whose only configured provider was a LiteLLM proxy answered every
//      screen question with "all vision models are unavailable… check your API
//      keys (OpenAI, Claude, Gemini, or Groq)" while the proxy logged zero
//      requests.
//   2. Both gateways hardcoded `data:image/png;base64,` over whatever bytes were
//      on disk. ImageOptimizer re-encodes to JPEG, so the wire carried
//      declared=image/png actual=image/jpeg (magic FFD8FFDB).
//   3. Neither downscaled: a raw 1470x956 capture was 1491 KB on the wire versus
//      293 KB through processImage.
//   4. Neither guarded a vanished file, so an ENOENT killed the turn.
//
// AND the capability table classified `litellm/*` / `nvidia_nim/*` by the ROUTED
// id, which no predicate matches, so every gateway model reported
// supportsImages:false and Code Hint refused with "The current local model
// (litellm/anthropic/claude-sonnet-5) … e.g. llava".
//
// Platform: pure string/predicate logic plus a filesystem read. No platform
// branch anywhere in the paths under test — identical on darwin and win32.
//
// Run: npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --test \
//        electron/llm/__tests__/GatewayVisionWiring2026_09_03.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (f) => path.resolve(__dirname, '../../../dist-electron/electron', f);

const { LLMHelper } = require(dist('LLMHelper.js'));
const { getModelCapabilities, stripProviderRoutingPrefix } = require(dist('llm/modelCapabilities.js'));

const helper = () => Object.create(LLMHelper.prototype);
const call = (name, self, ...args) => LLMHelper.prototype[name].call(self, ...args);

// ── 1. Capability classification ───────────────────────────────────────────

describe('a gateway-routed id is classified as the model it actually is', () => {
  test('the routing prefix and the upstream segment both come off', () => {
    assert.equal(stripProviderRoutingPrefix('litellm/gpt-4o'), 'gpt-4o');
    assert.equal(stripProviderRoutingPrefix('litellm/openai/gpt-4o'), 'gpt-4o');
    assert.equal(stripProviderRoutingPrefix('nvidia_nim/meta/llama-3.2-90b-vision-instruct'),
      'llama-3.2-90b-vision-instruct');
  });

  test('an id that is not gateway-routed is returned untouched', () => {
    // Groq ids and Ollama tags carry slashes/colons of their own; stripping them
    // would misclassify models that were previously classified correctly.
    for (const id of ['gpt-4o', 'openai/gpt-oss-20b', 'qwen2.5-vl:7b', 'claude-sonnet-5', '']) {
      assert.equal(stripProviderRoutingPrefix(id), id);
    }
  });

  test('vision-capable models keep supportsImages through a gateway', () => {
    for (const id of [
      'litellm/gpt-4o',
      'litellm/openai/gpt-4o',
      'litellm/claude-sonnet-5',
      'litellm/vertex_ai/gemini-2.5-pro',
      'nvidia_nim/gpt-4o',
    ]) {
      assert.equal(getModelCapabilities(id, false).supportsImages, true,
        `${id} must report vision — this is what made Code Hint refuse every gateway model`);
    }
  });

  test('the routed id survives as the display name', () => {
    // The classification uses the bare id; the NAME must still say which route
    // the model came through, or log lines and the Settings label lose it.
    assert.equal(getModelCapabilities('litellm/openai/gpt-4o', false).name, 'litellm/openai/gpt-4o');
  });

  test('a genuinely text-only gateway model still reports no vision', () => {
    // The fix must not make everything vision-capable.
    assert.equal(getModelCapabilities('litellm/deepseek-v4-chat', false).supportsImages, false);
    assert.equal(getModelCapabilities('litellm/mistral/mistral-large', false).supportsImages, false);
  });

  test('open-weights vision models are recognised through a gateway too', () => {
    // The first cut of this fix only rescued models whose bare name matched a
    // known CLOUD family, so Code Hint went on refusing these while the vision
    // chain and the provider registry had both been taught to call them —
    // three subsystems, two answers (code review, 2026-09-03).
    for (const id of [
      'nvidia_nim/meta/llama-3.2-90b-vision-instruct', // size sits between family and marker
      'litellm/mistral/pixtral-12b',
      'litellm/qwen/qwen2.5-vl-72b',
      'litellm/ollama/llava',
    ]) {
      assert.equal(getModelCapabilities(id, false).supportsImages, true, `${id} must report vision`);
    }
  });

  test("Groq's tables never claim a gateway-routed id", () => {
    // isLargeGroqModel matches any "qwen" with a 72b/32b/27b size, so a proxied
    // qwen-VL was answered with groqSupportsImages() — false for it — and the
    // vision hint never got a say. The small-model regex is the same hazard on
    // the budget side: it drops the model to the tiny prompt tier and an 8k
    // context off nothing but a size in the name.
    assert.equal(getModelCapabilities('litellm/qwen/qwen2.5-vl-72b', false).supportsImages, true);
    assert.equal(getModelCapabilities('litellm/meta/llama-3.1-8b-instant', false).tier, 'cloud');
    // …while a real Groq id keeps its authoritative answer.
    assert.equal(getModelCapabilities('qwen/qwen3.6-27b', false).supportsImages, true);
    assert.equal(getModelCapabilities('llama-3.1-8b-instant', false).tier, 'local-small');
  });
});

// ── 2. The wire shape ──────────────────────────────────────────────────────

describe('buildOpenAiImageParts — the single image-part builder', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-vision-'));
  // A real JPEG and a real PNG, by magic bytes.
  const jpg = path.join(tmp, 'optimized.jpg');
  const png = path.join(tmp, 'capture.png');
  fs.writeFileSync(jpg, Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xDB]), Buffer.alloc(64)]));
  fs.writeFileSync(png, Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(64)]));

  // processImage is stubbed to the SHARED helper's fallback contract (sharp
  // cannot decode these 68-byte stubs, which is exactly the fallback branch we
  // need to pin): the media type must come from the file, never a literal.
  const withStubbedProcessImage = () => {
    const h = helper();
    h.processImage = async (p) => {
      const { imageMimeTypeFromPath } = require(dist('utils/curlUtils.js'));
      return { mimeType: imageMimeTypeFromPath(p), data: fs.readFileSync(p).toString('base64') };
    };
    return h;
  };

  test('a JPEG on disk is declared image/jpeg, not image/png', async () => {
    const parts = await call('buildOpenAiImageParts', withStubbedProcessImage(), [jpg]);
    assert.equal(parts.length, 1);
    assert.ok(parts[0].image_url.url.startsWith('data:image/jpeg;base64,'),
      `declared type must match the bytes; got ${parts[0].image_url.url.slice(0, 40)}`);
  });

  test('a PNG on disk is still declared image/png', async () => {
    const parts = await call('buildOpenAiImageParts', withStubbedProcessImage(), [png]);
    assert.ok(parts[0].image_url.url.startsWith('data:image/png;base64,'));
  });

  test('a file that vanished is skipped, not thrown', async () => {
    const gone = path.join(tmp, 'gone.png');
    const parts = await call('buildOpenAiImageParts', withStubbedProcessImage(), [png, gone, jpg]);
    assert.equal(parts.length, 2,
      'an ENOENT used to escape the generator and kill the whole turn');
    assert.ok(parts[0].image_url.url.startsWith('data:image/png'));
    assert.ok(parts[1].image_url.url.startsWith('data:image/jpeg'));
  });

  test('every part goes through processImage, so the bytes are compressed', async () => {
    // The size fix and the type fix are the same call site: routing through
    // processImage is what bounds a 1491 KB raw screenshot to ~293 KB.
    const seen = [];
    const h = helper();
    h.processImage = async (p) => { seen.push(p); return { mimeType: 'image/jpeg', data: 'AAAA' }; };
    await call('buildOpenAiImageParts', h, [png, jpg]);
    assert.deepEqual(seen, [png, jpg]);
  });

  test('the builder emits no hardcoded media type at all', () => {
    // A source assertion, deliberately: the defect was a literal, and a literal
    // is what would come back. Reads the COMPILED bundle so a re-introduction in
    // either gateway is caught wherever it is written.
    const src = fs.readFileSync(dist('LLMHelper.js'), 'utf8');
    assert.equal(/data:image\/png;base64,\$\{/.test(src), false,
      'a hardcoded png data-URI prefix is back in LLMHelper');
  });
});

// ── 3. The chain the images actually travel down ───────────────────────────

describe('gateways are seated in the streaming vision chain', () => {
  // streamVisionWithFallback is a generator over live clients, so this pins the
  // wiring at the source level: the ids must exist as chain entries and as
  // runVisionRequest cases. Without both, an image-bearing request cannot reach
  // a gateway at all — the exact dead-end this fix exists to close.
  const src = fs.readFileSync(dist('LLMHelper.js'), 'utf8');

  test("the chain has a 'litellm' rung", () => {
    assert.ok(/id:\s*['"]litellm['"]/.test(src));
  });

  test("the chain has an 'nvidia_nim' rung", () => {
    assert.ok(/id:\s*['"]nvidia_nim['"]/.test(src));
  });

  test('runVisionRequest can dispatch to both', () => {
    assert.ok(/case\s*['"]litellm['"]:/.test(src));
    assert.ok(/case\s*['"]nvidia_nim['"]:/.test(src));
  });

  test('the registry lists both as cloud rungs', () => {
    const reg = fs.readFileSync(dist('services/screen/VisionProviderRegistry.js'), 'utf8');
    assert.ok(/id:\s*['"]litellm['"]/.test(reg));
    assert.ok(/id:\s*['"]nvidia_nim['"]/.test(reg));
  });

  test('a gateway is seated ONLY when it is the selected model', () => {
    // The registry and the streaming chain must agree on this, not merely on
    // ordering. A configured base URL is not a standing offer to serve images:
    // the gateway fronts an arbitrary upstream, so auto-recruiting it as a
    // fallback would ship a screenshot to a proxy the user had not pointed this
    // turn at — something streamVisionWithFallback excludes outright. The first
    // cut of the registry entry gated on the base URL alone (code review,
    // 2026-09-04), so the two subsystems had two privacy policies.
    //
    // Asserted against the source, not by calling buildVisionProviders: it
    // transitively imports CredentialsManager, which evaluates
    // app.getPath('userData') at module load and so cannot be required outside
    // the real Electron runtime — the same constraint VisionProviderRegistryOrder
    // .test.mjs documents. The behaviour itself was confirmed in a live session.
    const reg = fs.readFileSync(dist('services/screen/VisionProviderRegistry.js'), 'utf8');
    for (const fn of ['litellm', 'nvidiaNim']) {
      const start = reg.indexOf(`function ${fn}(`);
      assert.ok(start > 0, `${fn}() builder not found`);
      const body = reg.slice(start, reg.indexOf('\n}', start));
      assert.ok(/isSelected/.test(body), `${fn}() must resolve whether it is the selected model`);
      // Both flags, not just one: a rung that is "configured but not vision"
      // still gets seated and still fails an attempt.
      assert.ok(/isConfigured:[^,]*isSelected/.test(body),
        `${fn}().isConfigured must be gated on the selection`);
      assert.ok(/supportsVision:[^,]*isSelected/.test(body),
        `${fn}().supportsVision must be gated on the selection`);
    }
  });

  test('the registry reads the SELECTED model, not a stored preference', () => {
    // runVisionRequest dispatches against LLMHelper's live currentModelId, so a
    // rung seated off getPreferredModel() would advertise one model and execute
    // another — the same advertise/execute split that was just removed from the
    // custom() rung.
    const reg = fs.readFileSync(dist('services/screen/VisionProviderRegistry.js'), 'utf8');
    const gatewaySection = reg.slice(reg.indexOf('function litellm'), reg.indexOf('function litellm') + 1800);
    assert.ok(/readActiveModelId/.test(gatewaySection),
      'the gateway rungs must resolve the active model from the live helper');
    assert.equal(/getPreferredModel/.test(gatewaySection), false,
      'a stored preference is not what runVisionRequest will dispatch against');
  });
});

// ── 4. The budget cache must not accept another proxy's answer ─────────────

describe('repointing the proxy discards an in-flight /model/info reply', () => {
  test('a reply that lands after a repoint is dropped and does not stamp the TTL', async () => {
    const h = helper();
    h.litellmBaseURL = 'http://a.example/v1';
    h.litellmApiKey = null;
    h.litellmModelBudgets = new Map();
    h.litellmModelBudgetsFetchedAt = 0;
    h.litellmModelBudgetsFetch = null;

    let release;
    const gate = new Promise((r) => { release = r; });
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      await gate; // hold the reply open so the repoint happens mid-flight
      return { ok: true, json: async () => ({ data: [{ model_name: 'from-proxy-a', model_info: { max_output_tokens: 999 } }] }) };
    };

    try {
      const inFlight = call('refreshLitellmModelBudgets', h);
      h.litellmBaseURL = 'http://b.example/v1';   // the user repoints
      h.litellmModelBudgets.clear();
      h.litellmModelBudgetsFetchedAt = 0;
      release();
      await inFlight;

      assert.equal(h.litellmModelBudgets.size, 0,
        "proxy A's budgets were applied after the app was repointed to proxy B");
      assert.equal(h.litellmModelBudgetsFetchedAt, 0,
        'the stale reply stamped the TTL, so proxy B would not be queried for 5 minutes');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('a reply for the CURRENT proxy is still applied', async () => {
    const h = helper();
    h.litellmBaseURL = 'http://a.example/v1';
    h.litellmApiKey = null;
    h.litellmModelBudgets = new Map();
    h.litellmModelBudgetsFetchedAt = 0;
    h.litellmModelBudgetsFetch = null;

    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ data: [{ model_name: 'gpt-4o', model_info: { max_output_tokens: 4096 } }] }),
    });
    try {
      await call('refreshLitellmModelBudgets', h);
      assert.equal(h.litellmModelBudgets.get('gpt-4o'), 4096);
      assert.ok(h.litellmModelBudgetsFetchedAt > 0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
