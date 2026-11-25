/**
 * OpenCode catalogue + protocol resolution.
 *
 * The live 2026-11-19 catalogue answered with 89 chat models across FOUR wire
 * protocols. Every one of them is dispatched by the metadata this module
 * produces, so a parse bug here is not cosmetic: it sends a Claude id to the
 * OpenAI protocol, or a text-only model a screenshot.
 *
 * Fixtures are trimmed copies of real entries (one per family) rather than
 * invented shapes — the field names are the contract.
 *
 * Run: node --test electron/llm/__tests__/OpencodeCatalogue2026_11_19.test.mjs
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);

const {
  parseOpencodeCatalogue,
  mergeOpencodeCatalogues,
  resolveOpencodeFamily,
  opencodePresetMeta,
  opencodeVisionSubset,
  opencodeFamilyBaseUrl,
  OPENCODE_PRESET_MODELS,
  isFreeOpencodeModel,
  opencodeDisplayName,
} = require(dist('llm/opencode/catalog.js'));

const OPENAI_BASE = 'https://opencode.ai/inference/openai/v1';
const ANTHROPIC_V1 = 'https://opencode.ai/inference/anthropic/v1';
const GOOGLE_BETA = 'https://opencode.ai/inference/google/v1beta';

const chat = (id, extra = {}) => ({
  id,
  object: 'model',
  type: 'chat',
  name: id,
  recommended_api: 'chat-completions',
  api: { 'chat-completions': { base_url: OPENAI_BASE, sdk: { aisdk: '@ai-sdk/openai-compatible' } } },
  modalities: { input: ['text'], output: ['text'] },
  limit: { context: 200000, output: 32000 },
  capabilities: { reasoning: { supported: true, effort: ['low', 'high'] } },
  ...extra,
});

const messages = (id, extra = {}) => ({
  id,
  type: 'chat',
  name: id,
  recommended_api: 'messages',
  api: { messages: { base_url: ANTHROPIC_V1, sdk: { aisdk: '@ai-sdk/anthropic' } } },
  modalities: { input: ['text', 'image/jpeg', 'image/png', 'application/pdf'], output: ['text'] },
  limit: { context: 1000000, output: 128000 },
  capabilities: { reasoning: { supported: true, effort: ['low', 'medium', 'high', 'xhigh', 'max'] } },
  ...extra,
});

const responses = (id, extra = {}) => ({
  id,
  type: 'chat',
  name: id,
  recommended_api: 'responses',
  api: { responses: { base_url: OPENAI_BASE, sdk: { aisdk: '@ai-sdk/openai' } } },
  modalities: { input: ['text', 'image/jpeg', 'image/png'], output: ['text'] },
  limit: { context: 1050000, output: 128000 },
  capabilities: { reasoning: { supported: true, effort: ['low', 'medium', 'high'] } },
  ...extra,
});

const gemini = (id, extra = {}) => ({
  id,
  type: 'chat',
  name: id,
  recommended_api: 'generate-content',
  api: { 'generate-content': { base_url: GOOGLE_BETA, sdk: { aisdk: '@ai-sdk/google' } } },
  modalities: { input: ['text', 'image/png', 'image/jpeg', 'application/pdf'], output: ['text'] },
  limit: { context: 1048576, output: 65536 },
  capabilities: { reasoning: { supported: true } },
  ...extra,
});

const list = (...models) => ({ object: 'list', data: models });

describe('the parser reads the live shape', () => {
  const parsed = parseOpencodeCatalogue(list(
    chat('deepseek-v4.1-flash'),
    messages('claude-sonnet-5'),
    responses('gpt-6.1-sol'),
    gemini('gemini-3.8-flash'),
  ));

  test('one model per family, each on its own protocol', () => {
    assert.equal(parsed['deepseek-v4.1-flash'].api, 'chat-completions');
    assert.equal(parsed['claude-sonnet-5'].api, 'messages');
    assert.equal(parsed['gpt-6.1-sol'].api, 'responses');
    assert.equal(parsed['gemini-3.8-flash'].api, 'generate-content');
  });

  test('vision comes from modalities.input, both ways', () => {
    assert.equal(parsed['claude-sonnet-5'].vision, true);
    assert.equal(parsed['gpt-6.1-sol'].vision, true);
    assert.equal(parsed['gemini-3.8-flash'].vision, true);
    assert.equal(parsed['deepseek-v4.1-flash'].vision, false);
  });

  test('limits are read per model', () => {
    assert.equal(parsed['deepseek-v4.1-flash'].outputTokens, 32000);
    assert.equal(parsed['deepseek-v4.1-flash'].contextTokens, 200000);
    assert.equal(parsed['claude-sonnet-5'].outputTokens, 128000);
    assert.equal(parsed['gemini-3.8-flash'].outputTokens, 65536);
  });

  test('reasoning support and effort are carried verbatim', () => {
    assert.deepEqual(parsed['claude-sonnet-5'].reasoningEffort, ['low', 'medium', 'high', 'xhigh', 'max']);
    assert.equal(parsed['claude-sonnet-5'].reasoning, true);
  });
});

describe('base URLs are normalised for the client that consumes them', () => {
  const parsed = parseOpencodeCatalogue(list(
    chat('a'),
    messages('b'),
    responses('c'),
    gemini('d'),
  ));

  test('the Anthropic base loses the /v1 the SDK appends itself', () => {
    // Catalogue says `.../anthropic/v1`; Anthropic SDK adds `/v1/messages`.
    assert.equal(parsed.b.baseUrl, 'https://opencode.ai/inference/anthropic');
  });

  test('the Gemini base loses the version the adapter appends', () => {
    // Catalogue says `.../google/v1beta`; the adapter adds `/v1beta/models/...`.
    assert.equal(parsed.d.baseUrl, 'https://opencode.ai/inference/google');
  });

  test('the OpenAI base keeps /v1, which the SDK does NOT append', () => {
    assert.equal(parsed.a.baseUrl, 'https://opencode.ai/inference/openai/v1');
    assert.equal(parsed.c.baseUrl, 'https://opencode.ai/inference/openai/v1');
  });

  test('family defaults match the same shapes when the catalogue omits api', () => {
    assert.equal(opencodeFamilyBaseUrl('messages'), 'https://opencode.ai/inference/anthropic');
    assert.equal(opencodeFamilyBaseUrl('generate-content'), 'https://opencode.ai/inference/google');
    assert.equal(opencodeFamilyBaseUrl('chat-completions'), 'https://opencode.ai/inference/openai/v1');
    assert.equal(opencodeFamilyBaseUrl('responses'), 'https://opencode.ai/inference/openai/v1');
  });

  test('a base on any other origin is refused: the bearer key would travel there', () => {
    const entry = (id, base_url) => ({
      id, type: 'chat', recommended_api: 'chat-completions',
      api: { 'chat-completions': { base_url } }, modalities: { input: ['text'] },
    });
    const parsedHostile = parseOpencodeCatalogue([
      entry('other-host', 'https://example.com/inference/openai/v1'),
      entry('plain-http', 'http://opencode.ai/inference/openai/v1'),
      entry('look-alike', 'https://opencode.ai.evil.example/openai/v1'),
      entry('not-a-url', 'opencode/openai/v1'),
      entry('go-base', 'https://opencode.ai/inference/go/openai/v1'),
    ]);
    for (const id of ['other-host', 'plain-http', 'look-alike', 'not-a-url']) {
      assert.equal(parsedHostile[id].baseUrl, OPENAI_BASE, `${id} must fall back to the family default`);
    }
    assert.equal(parsedHostile['go-base'].baseUrl, 'https://opencode.ai/inference/go/openai/v1',
      'OpenCode\'s own Go base is kept');
  });
});

describe('free models are withheld, not offered-and-refused', () => {
  test('a -free id is dropped', () => {
    const parsed = parseOpencodeCatalogue(list(chat('deepseek-v4.1-flash-free'), chat('glm-5.3')));
    assert.deepEqual(Object.keys(parsed), ['glm-5.3']);
  });

  test('the predicate is the suffix, not the word in a model name', () => {
    assert.equal(isFreeOpencodeModel('longcat-2.5-free'), true);
    assert.equal(isFreeOpencodeModel('freestyle-pro'), false);
    assert.equal(isFreeOpencodeModel('glm-5.3'), false);
  });
});

describe('degraded catalogues never throw', () => {
  test('null, undefined, a string and an empty object all return {}', () => {
    for (const bad of [null, undefined, 'nope', 42, {}, { data: null }, { data: {} }]) {
      assert.deepEqual(parseOpencodeCatalogue(bad), {});
    }
  });

  test('entries with no id, or a non-chat type, are skipped', () => {
    const parsed = parseOpencodeCatalogue(list(
      { id: '', type: 'chat' },
      { type: 'chat' },
      { id: 'embed-1', type: 'embedding' },
      chat('kept'),
    ));
    assert.deepEqual(Object.keys(parsed), ['kept']);
  });

  test('a missing api block falls back to the name heuristic', () => {
    const parsed = parseOpencodeCatalogue([
      { id: 'claude-opus-5', type: 'chat' },
      { id: 'qwen3.8-flash', type: 'chat' },
      { id: 'gpt-6-sol', type: 'chat' },
      { id: 'gemini-4-argon', type: 'chat' },
      { id: 'kimi-k3', type: 'chat' },
    ]);
    assert.equal(parsed['claude-opus-5'].api, 'messages');
    assert.equal(parsed['qwen3.8-flash'].api, 'messages');
    assert.equal(parsed['gpt-6-sol'].api, 'responses');
    assert.equal(parsed['gemini-4-argon'].api, 'generate-content');
    assert.equal(parsed['kimi-k3'].api, 'chat-completions');
  });
});

describe('the cold-start heuristic matches the live split', () => {
  test('qwen only claims messages for plus/flash, not max', () => {
    // Live 2026-11-19: qwen3.8-max is chat-completions, qwen3.8-flash is messages.
    assert.equal(resolveOpencodeFamily('qwen3.8-max'), 'chat-completions');
    assert.equal(resolveOpencodeFamily('qwen3.8-flash'), 'messages');
    assert.equal(resolveOpencodeFamily('qwen3.5-plus'), 'messages');
  });

  test('grok/muse are responses, not chat-completions', () => {
    assert.equal(resolveOpencodeFamily('grok-4.7'), 'responses');
    assert.equal(resolveOpencodeFamily('muse-spark-1.3'), 'responses');
  });

  test('metadata wins over the name', () => {
    assert.equal(resolveOpencodeFamily('claude-sonnet-5', { api: 'chat-completions', baseUrl: '', vision: false }), 'chat-completions');
  });

  test('prefixed and bare ids resolve identically', () => {
    assert.equal(resolveOpencodeFamily('opencode/claude-sonnet-5'), 'messages');
  });
});

describe('Go merge', () => {
  // The Go list is public (200 with no key, live 2026-11-25), so a collision
  // must never replace the pay-as-you-go route: that sent every key's shared
  // models to the Go-only base. Go is recorded beside it instead.
  test('a collision keeps the pay-as-you-go route and records Go beside it', () => {
    const main = parseOpencodeCatalogue([chat('glm-5.3', { limit: { context: 1000000, output: 131072 } })]);
    const go = parseOpencodeCatalogue([{
      id: 'glm-5.3',
      type: 'chat',
      recommended_api: 'generate-content',
      api: { 'generate-content': { base_url: GOOGLE_BETA } },
      limit: { context: 500000 },
    }], { go: true });
    const merged = mergeOpencodeCatalogues(main, go);
    assert.equal(merged['glm-5.3'].api, 'chat-completions');
    assert.equal(merged['glm-5.3'].baseUrl, OPENAI_BASE);
    // The route carries Go's own reasoning answer (none listed here = false).
    assert.deepEqual(merged['glm-5.3'].goRoute, { api: 'generate-content', baseUrl: 'https://opencode.ai/inference/google', reasoning: false });
    assert.equal(merged['glm-5.3'].goOnly, undefined);
    assert.equal(merged['glm-5.3'].go, true);
    // Go did not list output; main's ceiling survives.
    assert.equal(merged['glm-5.3'].outputTokens, 131072);
    assert.equal(merged['glm-5.3'].contextTokens, 1000000);
  });

  test('a collision takes the safer capabilities of the two routes', () => {
    const main = parseOpencodeCatalogue([chat('qwen3.8-max', {
      modalities: { input: ['text', 'image/png'] }, limit: { output: 131072 },
    })]);
    const go = parseOpencodeCatalogue([chat('qwen3.8-max', {
      modalities: { input: ['text'] }, limit: { output: 65536 },
    })], { go: true });
    const merged = mergeOpencodeCatalogues(main, go);
    // Either route may serve the turn; a text-only route answers an image blind.
    assert.equal(merged['qwen3.8-max'].vision, false);
    assert.equal(merged['qwen3.8-max'].outputTokens, 65536);
  });

  test('a Go-only model is marked goOnly with the Go route', () => {
    const go = parseOpencodeCatalogue([chat('hy4', {
      api: { 'chat-completions': { base_url: 'https://opencode.ai/inference/go/openai/v1' } },
    })], { go: true });
    const merged = mergeOpencodeCatalogues({}, go);
    assert.equal(merged.hy4.goOnly, true);
    assert.equal(merged.hy4.baseUrl, 'https://opencode.ai/inference/go/openai/v1');
    assert.equal(merged.hy4.goRoute.api, 'chat-completions');
    assert.equal(merged.hy4.goRoute.baseUrl, 'https://opencode.ai/inference/go/openai/v1');
  });

  test('each route keeps its own reasoning levels (kimi-k3, live 2026-11-25)', () => {
    const main = parseOpencodeCatalogue([chat('kimi-k3', {
      capabilities: { reasoning: { supported: true, toggle: true, effort: ['low', 'high', 'max'] } },
    })]);
    const go = parseOpencodeCatalogue([chat('kimi-k3', {
      api: { 'chat-completions': { base_url: 'https://opencode.ai/inference/go/openai/v1' } },
      capabilities: { reasoning: { supported: true, effort: ['max'] } },
    })], { go: true });
    const merged = mergeOpencodeCatalogues(main, go);
    assert.deepEqual(merged['kimi-k3'].reasoningEffort, ['low', 'high', 'max'], 'pay-as-you-go levels on the entry');
    assert.deepEqual(merged['kimi-k3'].goRoute.reasoningEffort, ['max'], 'Go levels on the Go route');
  });

  test('a main-only model is untouched', () => {
    const merged = mergeOpencodeCatalogues(parseOpencodeCatalogue([chat('kimi-k3')]), {});
    assert.equal(merged['kimi-k3'].api, 'chat-completions');
    assert.equal(merged['kimi-k3'].go, undefined);
  });
});

describe('presets', () => {
  test('cover all four protocols', () => {
    const families = new Set(OPENCODE_PRESET_MODELS.map((p) => p.api));
    assert.deepEqual([...families].sort(), [
      'chat-completions', 'generate-content', 'messages', 'responses',
    ]);
  });

  test('produce dispatchable metadata without a fetch', () => {
    const meta = opencodePresetMeta();
    for (const preset of OPENCODE_PRESET_MODELS) {
      assert.ok(meta[preset.id], `${preset.id} missing from preset metadata`);
      assert.equal(meta[preset.id].api, preset.api);
      assert.ok(meta[preset.id].baseUrl, `${preset.id} has no base URL`);
    }
  });

  test('the vision subset is exactly the vision presets', () => {
    const vision = opencodeVisionSubset(opencodePresetMeta());
    assert.ok(vision.includes('claude-sonnet-5'));
    assert.ok(!vision.includes('glm-5.3'));
  });

  test('no preset id is a free model', () => {
    for (const preset of OPENCODE_PRESET_MODELS) {
      assert.equal(isFreeOpencodeModel(preset.id), false, preset.id);
    }
  });

  test('DRIFT GUARD: the overlay picker offers exactly these presets, in order', () => {
    // Two hand-synced lists: the main process dispatches on OPENCODE_PRESET_MODELS
    // and the renderer shows STANDARD_CLOUD_MODELS.opencode. A preset added to
    // one and not the other is a picker row the adapters cannot route, or a
    // routable preset nobody can pick.
    const src = fs.readFileSync(path.join(__dirname, '../../../src/utils/modelUtils.ts'), 'utf8');
    const block = src.slice(src.indexOf('    opencode: {'), src.indexOf("pmKey: 'opencodePreferredModel'"));
    const list = (key) => {
      const body = block.slice(block.indexOf(`${key}: [`), block.indexOf('],', block.indexOf(`${key}: [`)));
      return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    };
    assert.deepEqual(list('ids'), OPENCODE_PRESET_MODELS.map((p) => `opencode/${p.id}`));
    assert.deepEqual(list('names'), OPENCODE_PRESET_MODELS.map((p) => `${p.name} (OpenCode)`));
  });
});

describe('display names', () => {
  test('readable for ids the catalogue has not named', () => {
    assert.equal(opencodeDisplayName('claude-sonnet-5-5'), 'Claude Sonnet 5.5');
    assert.equal(opencodeDisplayName('gpt-6.1-sol'), 'GPT 6.1 Sol');
    assert.equal(opencodeDisplayName('glm-5.3'), 'GLM 5.3');
    assert.equal(opencodeDisplayName('opencode/kimi-k3'), 'Kimi K3');
  });
});
