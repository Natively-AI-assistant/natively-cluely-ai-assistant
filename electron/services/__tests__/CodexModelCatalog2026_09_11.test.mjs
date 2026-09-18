import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.CODEX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-codex-catalog-test-'));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const catalog = await import(pathToFileURL(path.join(root, 'dist-electron/electron/services/CodexModelCatalog.js')).href);
const modelUtils = await import(pathToFileURL(path.join(root, 'src/utils/modelUtils.ts')).href);

const {
  CODEX_MODELS_URL, CODEX_PROTOCOL_VERSION, parseCodexModelsPayload,
  readCachedCodexModelCatalog, fetchLiveCodexModels, refreshCodexModelCatalog,
  resetCodexCatalogForTest,
} = catalog;

const MODELS = {
  models: [
    { slug: 'current', display_name: 'Current', visibility: 'list', priority: 2,
      default_reasoning_level: 'medium',
      supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'ultra' }],
      service_tiers: [{ id: 'priority', name: 'Fast' }] },
    { slug: 'hidden', visibility: 'hide', priority: 1 },
    { slug: 'current', visibility: 'list', priority: 3 },
    { slug: 'next', display_name: 'Next', visibility: 'list', priority: 4 },
  ],
};
const credential = { source: 'natively', accessToken: 'header.eyJzdWIiOiJ1c2VyLTEifQ.sig', accountId: 'account-1' };

describe('provider payload', () => {
  test('filters, orders, deduplicates, and preserves capabilities', () => {
    const parsed = parseCodexModelsPayload(MODELS);
    assert.deepEqual(parsed.models.map(model => model.id), ['current', 'next']);
    assert.deepEqual(parsed.models[0].reasoningLevels.map(level => level.id), ['low', 'medium', 'ultra']);
    assert.deepEqual(parsed.models[0].serviceTiers, [{ id: 'priority', name: 'Fast' }]);
    assert.equal(parsed.models[0].defaultReasoningLevel, 'medium');
  });

  test('rejects malformed payloads and unsafe capability values', () => {
    assert.equal(parseCodexModelsPayload(null), null);
    assert.equal(parseCodexModelsPayload({ data: [] }), null);
    const parsed = parseCodexModelsPayload({ models: [{ slug: 'safe', visibility: 'list',
      supported_reasoning_levels: [{ effort: 'bad value' }, { effort: 'low' }],
      service_tiers: [{ id: 'priority' }, { id: 'bad/value' }] }] });
    assert.deepEqual(parsed.models[0].reasoningLevels.map(x => x.id), ['low']);
    assert.deepEqual(parsed.models[0].serviceTiers.map(x => x.id), ['priority']);
  });
});

describe('authenticated refresh', () => {
  test('does not fetch before authentication', async () => {
    resetCodexCatalogForTest();
    let called = false;
    const result = await fetchLiveCodexModels({ credential: null, fetchFn: async () => { called = true; } });
    assert.equal(result.error, 'not-signed-in');
    assert.equal(called, false);
  });

  test('sends the fixed endpoint and protocol headers', async () => {
    let request;
    const result = await fetchLiveCodexModels({ credential, fetchFn: async (url, init) => {
      request = { url, init }; return { ok: true, json: async () => MODELS };
    } });
    assert.equal(result.error, undefined);
    assert.equal(request.url, `${CODEX_MODELS_URL}?client_version=${CODEX_PROTOCOL_VERSION}`);
    assert.equal(request.init.headers.Authorization, `Bearer ${credential.accessToken}`);
    assert.equal(request.init.headers['chatgpt-account-id'], 'account-1');
    assert.equal(request.init.headers.version, CODEX_PROTOCOL_VERSION);
  });

  test('classifies provider failures', async () => {
    for (const [status, expected] of [[401, 'auth'], [403, 'auth'], [429, 'rate-limited'], [500, 'provider']]) {
      assert.equal((await fetchLiveCodexModels({ credential, fetchFn: async () => ({ ok: false, status }) })).error, expected);
    }
    assert.equal((await fetchLiveCodexModels({ credential, fetchFn: async () => { throw new Error('offline'); } })).error, 'network');
    assert.equal((await fetchLiveCodexModels({ credential, fetchFn: async () => ({ ok: true, json: async () => null }) })).error, 'invalid-response');
  });

  test('deduplicates same-account refreshes and keeps account caches separate', async () => {
    resetCodexCatalogForTest();
    let fetches = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const opts = { credential, fetchFn: async () => { fetches++; await gate; return { ok: true, json: async () => MODELS }; } };
    const first = refreshCodexModelCatalog(opts);
    const second = refreshCodexModelCatalog(opts);
    release();
    assert.deepEqual(await first, await second);
    assert.equal(fetches, 1);
    const cached = await readCachedCodexModelCatalog('account-1');
    assert.equal(cached.source, 'memory-cache');
    assert.deepEqual(cached.models.map(model => model.id), ['current', 'next']);
    assert.equal((await readCachedCodexModelCatalog('other-account')).source, 'unavailable');
  });

  test('discards a response if authentication changes in flight', async () => {
    resetCodexCatalogForTest();
    let active = credential;
    const pending = refreshCodexModelCatalog({
      credentialProvider: async () => active,
      fetchFn: async () => { active = { ...credential, accountId: 'account-2' }; return { ok: true, json: async () => MODELS }; },
    });
    assert.equal((await pending).refreshError, 'auth');
  });

});

test('renderer helper has no hardcoded fallback roster', () => {
  assert.deepEqual(modelUtils.codexModelOptions(null), []);
  assert.equal('CODEX_CLI_MODEL_PRESETS' in modelUtils, false);
});
