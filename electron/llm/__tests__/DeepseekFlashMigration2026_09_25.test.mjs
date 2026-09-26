// electron/llm/__tests__/DeepseekFlashMigration2026_09_25.test.mjs
//
// DeepSeek released DeepSeek-V4.1-Flash on 2026-09-10 as `deepseek-flash` and
// retired the V4 Flash ids (`deepseek-v4-flash`, `deepseek-v4-flash-vision-exp`),
// which it only "temporarily" routes to the new model
// (api-docs.deepseek.com/updates). `deepseek-v4-pro` continues. Live
// `GET /models` on 2026-09-25 listed exactly `deepseek-flash` and
// `deepseek-v4-pro`.
//
// Here is what broke: every DeepSeek classifier in the app was a copy of
// `/^deepseek-v\d/` (or `/^deepseek-v/i`), and `deepseek-flash` matches none of
// them. So the model fetcher dropped it from Refresh, leaving only V4 Pro.
// Routing, availability and capability checks would also have treated it as
// "unknown" if it had been picked. All five sites now use one predicate
// (llm/deepseekModels.ts). This file tests that predicate by calling it, and it
// also checks that the picker's presets agree with it.
//
// Platform: pure constants and string matching, so one run covers darwin and
// win32.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/DeepseekFlashMigration2026_09_25.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const load = (rel) => import(pathToFileURL(path.resolve(repoRoot, rel)).href);

const ds = await load('dist-electron/electron/llm/deepseekModels.js');
const { getModelCapabilities } = await load('dist-electron/electron/llm/modelCapabilities.js');
const { LLMHelper } = await load('dist-electron/electron/LLMHelper.js');
// src/utils/modelUtils.ts is imported for REAL (node >= 22.6 strips the types).
const { STANDARD_CLOUD_MODELS } = await load('src/utils/modelUtils.ts');

describe('the DeepSeek model ids', () => {
  test('the default is the model DeepSeek serves today', () => {
    assert.equal(ds.DEEPSEEK_DEFAULT_MODEL, 'deepseek-flash');
    assert.equal(ds.DEEPSEEK_PRO_MODEL, 'deepseek-v4-pro');
  });

  test('THE BUG: the one predicate claims deepseek-flash, and still claims the V4 ids', () => {
    for (const id of ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-0731',
      'DeepSeek-Flash', 'DEEPSEEK-V4-PRO', 'deepseek-flash-0910']) {
      assert.equal(ds.isDeepseekModelId(id), true, id);
    }
  });

  test('never claims local, discontinued, gateway-routed or look-alike ids', () => {
    for (const id of [
      // Ollama's local families, routed by the `ollama-` prefix instead.
      'deepseek-coder', 'deepseek-coder-v2:16b-lite', 'deepseek-r1', 'deepseek-r1:8b',
      // Discontinued 2026-07-24.
      'deepseek-chat', 'deepseek-reasoner',
      // A gateway's id bills the gateway's key, not the DeepSeek key.
      'fluxion/deepseek-flash', 'openrouter/deepseek/deepseek-flash', 'litellm/deepseek-v4-chat',
      'ninerouter/deepseek/deepseek-flash', 'ollama-deepseek-v3',
      'deepseek-flashy', '', null, undefined,
    ]) {
      assert.equal(ds.isDeepseekModelId(id), false, String(id));
    }
  });

  test('a retired id goes on the wire as the successor DeepSeek named', () => {
    assert.equal(ds.deepseekWireModel('deepseek-v4-flash'), 'deepseek-flash');
    assert.equal(ds.deepseekWireModel('deepseek-v4-flash-vision-exp'), 'deepseek-flash');
    assert.equal(ds.deepseekWireModel('deepseek-flash'), 'deepseek-flash');
    assert.equal(ds.deepseekWireModel('deepseek-v4-pro'), 'deepseek-v4-pro', 'a live id is never rerouted');
  });
});

describe('capabilities: the new id behaves exactly like the one it replaces', () => {
  test('cloud tier, same budgets, still text-only as Natively routes it', () => {
    // `name` echoes the id back, so it is the one field that must differ.
    const { name, ...now } = getModelCapabilities('deepseek-flash', false);
    const { name: _old, ...before } = getModelCapabilities('deepseek-v4-flash', false);
    assert.equal(name, 'deepseek-flash');
    assert.deepEqual(now, before);
    assert.equal(now.tier, 'cloud');
    assert.equal(now.supportsImages, false);
  });
});

describe('the picker presets agree with routing', () => {
  test('every DeepSeek preset is claimed by the predicate, the default first', () => {
    const { ids, names, descs } = STANDARD_CLOUD_MODELS.deepseek;
    assert.deepEqual(ids, [ds.DEEPSEEK_DEFAULT_MODEL, ds.DEEPSEEK_PRO_MODEL]);
    for (const id of ids) assert.equal(ds.isDeepseekModelId(id), true, id);
    // Zipped by position in the picker; a length mismatch mislabels a row.
    assert.equal(names.length, ids.length);
    assert.equal(descs.length, ids.length);
  });
});

describe('LLMHelper routes and sends the new id', () => {
  const harness = (currentModelId) => {
    const seen = [];
    const self = Object.create(LLMHelper.prototype);
    self._deepseekClient = {
      chat: { completions: { create: async (req) => { seen.push(req); return (async function* () {})(); } } },
    };
    self.isProviderDisabled = () => false;
    self.assertOutboundScopes = () => {};
    self.rateLimiters = { deepseek: { acquire: async () => {} } };
    self.currentModelId = currentModelId;
    return { self, seen };
  };

  test('deepseek-flash is recognised as a DeepSeek model', () => {
    const { self } = harness('deepseek-flash');
    assert.equal(self.isDeepseekModel('deepseek-flash'), true);
    assert.equal(self.isDeepseekModel('deepseek-chat'), false);
  });

  test('a selected deepseek-flash is what reaches the wire', async () => {
    const { self, seen } = harness('deepseek-flash');
    for await (const _ of self.streamWithDeepseek('q')) { /* drain */ }
    assert.equal(seen[0].model, 'deepseek-flash');
  });

  test('a persisted deepseek-v4-flash is sent as deepseek-flash, so the alias going away cannot break it', async () => {
    const { self, seen } = harness('deepseek-v4-flash');
    for await (const _ of self.streamWithDeepseek('q')) { /* drain */ }
    assert.equal(seen[0].model, 'deepseek-flash');
  });

  test('with a non-DeepSeek model selected, the fallback rung uses the new default', async () => {
    const { self, seen } = harness('gpt-5.4');
    for await (const _ of self.streamWithDeepseek('q')) { /* drain */ }
    assert.equal(seen[0].model, 'deepseek-flash');
  });
});
