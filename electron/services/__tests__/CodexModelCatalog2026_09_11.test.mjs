import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
process.env.CODEX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-codex-catalog-test-'));
const catalog = await import(pathToFileURL(path.join(root, 'dist-electron/electron/services/CodexModelCatalog.js')).href);
const modelUtils = await import(pathToFileURL(path.join(root, 'src/utils/modelUtils.ts')).href);

const {
  CODEX_MODELS_URL,
  parseCodexModelsPayload,
  parseCodexModelsCache,
  readCachedCodexModelCatalog,
  fetchLiveCodexModels,
  refreshCodexModelCatalog,
  resetCodexCatalogRefreshForTest,
  resolveCodexHome,
  getCodexModelCapabilities,
  activateCodexModelCatalog,
} = catalog;

const MODELS = {
  fetched_at: '2026-09-17T19:15:54Z',
  client_version: '0.154.0',
  models: [
    {
      slug: 'gpt-current', display_name: 'GPT Current', visibility: 'list', priority: 2,
      default_reasoning_level: 'medium',
      supported_reasoning_levels: [{ effort: 'low', description: 'Fast' }, { effort: 'medium' }, { effort: 'ultra' }],
      service_tiers: [{ id: 'priority', name: 'Fast', description: 'Higher usage' }],
    },
    { slug: 'hidden', display_name: 'Hidden', visibility: 'hide', priority: 1 },
    { slug: 'gpt-current', display_name: 'Duplicate', visibility: 'list', priority: 3 },
    { slug: 'gpt-next', display_name: 'GPT Next', visibility: 'list', priority: 4, supported_reasoning_levels: [] },
  ],
};

describe('paths', () => {
  test('resolves default and overridden Codex homes cross-platform', () => {
    assert.equal(resolveCodexHome({}, '/Users/ana', path.posix), '/Users/ana/.codex');
    assert.equal(resolveCodexHome({}, 'C:\\Users\\Ana', path.win32), 'C:\\Users\\Ana\\.codex');
    assert.equal(resolveCodexHome({ CODEX_HOME: ' /opt/codex ' }, '/Users/ana', path.posix), '/opt/codex');
  });
});

describe('payload parsing', () => {
  test('filters visibility, orders, deduplicates, and preserves capabilities', () => {
    const parsed = parseCodexModelsPayload(MODELS);
    assert.deepEqual(parsed.models.map(({ id, name }) => ({ id, name })), [
      { id: 'gpt-current', name: 'GPT Current' },
      { id: 'gpt-next', name: 'GPT Next' },
    ]);
    assert.deepEqual(parsed.models[0].reasoningLevels.map(level => level.id), ['low', 'medium', 'ultra']);
    assert.deepEqual(parsed.models[0].serviceTiers, [{ id: 'priority', name: 'Fast', description: 'Higher usage' }]);
    assert.equal(parsed.models[0].defaultReasoningLevel, 'medium');
    activateCodexModelCatalog(parsed.models);
    assert.equal(getCodexModelCapabilities('gpt-current').reasoningLevels[2].id, 'ultra');
  });

  test('rejects malformed schemas and unsafe capability values', () => {
    assert.equal(parseCodexModelsPayload(null), null);
    assert.equal(parseCodexModelsPayload({ data: [] }), null);
    const parsed = parseCodexModelsPayload({ models: [{
      slug: 'safe', visibility: 'list',
      supported_reasoning_levels: [{ effort: 'bad value' }, { effort: 'low' }],
      service_tiers: [{ id: 'priority' }, { id: 'bad/value' }],
    }] });
    assert.deepEqual(parsed.models[0].reasoningLevels.map(x => x.id), ['low']);
    assert.deepEqual(parsed.models[0].serviceTiers.map(x => x.id), ['priority']);
  });

  test('cache parser never throws', () => {
    assert.equal(parseCodexModelsCache('nope'), null);
    assert.equal(parseCodexModelsCache('{}'), null);
    assert.equal(parseCodexModelsCache(JSON.stringify(MODELS)).models.length, 2);
  });
});

describe('cache-only reads', () => {
  test('signed-out reads do not touch disk or network', async () => {
    let reads = 0;
    const result = await readCachedCodexModelCatalog({
      identity: null,
      readFile: async () => { reads++; return JSON.stringify(MODELS); },
    });
    assert.equal(result.source, 'unavailable');
    assert.equal(result.refreshError, 'not-signed-in');
    assert.equal(reads, 0);
  });

  test('CLI auth reads only the CLI cache', async () => {
    const reads = [];
    const result = await readCachedCodexModelCatalog({
      identity: { source: 'codex-cli', key: null },
      env: {}, homeDir: '/Users/ana', pathImpl: path.posix,
      statFile: async () => ({ mtimeMs: 10 }),
      readFile: async file => { reads.push(file); return JSON.stringify(MODELS); },
    });
    assert.equal(result.source, 'codex-cli-cache');
    assert.deepEqual(reads, ['/Users/ana/.codex/models_cache.json']);
  });

  test('rejects a CLI cache older than the current CLI login', async () => {
    const result = await readCachedCodexModelCatalog({
      identity: { source: 'codex-cli', key: null },
      env: {}, homeDir: '/Users/ana', pathImpl: path.posix,
      statFile: async file => ({ mtimeMs: file.endsWith('auth.json') ? 20 : 10 }),
      readFile: async () => JSON.stringify(MODELS),
    });
    assert.equal(result.source, 'unavailable');
  });

  test('Natively OAuth without an account-bound provider cache returns unavailable', async () => {
    let reads = 0;
    const result = await readCachedCodexModelCatalog({
      identity: { source: 'natively', key: null },
      appCacheFile: '/tmp/catalog.json',
      readFile: async () => { reads++; return '{}'; },
    });
    assert.equal(result.source, 'unavailable');
    assert.equal(reads, 0);
  });

  test('provider cache is accepted only for the active account', async () => {
    const key = crypto.createHash('sha256').update('account-1').digest('hex');
    const persisted = JSON.stringify({ schemaVersion: 1, accountKey: key, catalog: parseCodexModelsPayload(MODELS) });
    const matched = await readCachedCodexModelCatalog({
      identity: { source: 'natively', key }, appCacheFile: '/cache/catalog.json', readFile: async () => persisted,
    });
    assert.equal(matched.source, 'provider-cache');
    const mismatched = await readCachedCodexModelCatalog({
      identity: { source: 'natively', key: 'another-account' }, appCacheFile: '/cache/catalog.json', readFile: async () => persisted,
    });
    assert.equal(mismatched.source, 'unavailable');
  });
});

describe('live provider fetch', () => {
  const credential = { source: 'natively', accessToken: 'secret', accountId: 'account-1', email: 'a@example.com' };

  test('uses fixed endpoint, optional client version, and scoped headers', async () => {
    let request;
    const result = await fetchLiveCodexModels({
      credential,
      clientVersion: '0.154.0',
      fetchFn: async (url, init) => {
        request = { url, init };
        return { ok: true, json: async () => MODELS };
      },
    });
    assert.equal(result.error, undefined);
    assert.equal(request.url, `${CODEX_MODELS_URL}?client_version=0.154.0`);
    assert.equal(request.init.headers.Authorization, 'Bearer secret');
    assert.equal(request.init.headers['chatgpt-account-id'], 'account-1');
    assert.equal(request.init.headers.originator, 'codex_cli_rs');
    assert.equal(request.init.headers.version, '0.154.0');
  });

  test('does not fetch before auth exists', async () => {
    let called = false;
    const result = await fetchLiveCodexModels({ credential: null, fetchFn: async () => { called = true; } });
    assert.equal(result.error, 'not-signed-in');
    assert.equal(called, false);
  });

  test('classifies HTTP, network, JSON, and schema failures', async () => {
    for (const [status, expected] of [[401, 'auth'], [403, 'auth'], [429, 'rate-limited'], [500, 'provider']]) {
      const result = await fetchLiveCodexModels({ credential, fetchFn: async () => ({ ok: false, status }) });
      assert.equal(result.error, expected);
    }
    assert.equal((await fetchLiveCodexModels({ credential, fetchFn: async () => { throw new Error('offline'); } })).error, 'network');
    assert.equal((await fetchLiveCodexModels({ credential, fetchFn: async () => ({ ok: true, json: async () => null }) })).error, 'invalid-response');
  });
});

describe('refresh and account-bound persistence', () => {
  test('deduplicates concurrent refreshes and persists atomically', async () => {
    resetCodexCatalogRefreshForTest();
    const credential = { source: 'natively', accessToken: 'secret', accountId: 'account-1' };
    let fetches = 0;
    const writes = [];
    const renames = [];
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const opts = {
      credential,
      appCacheFile: '/cache/catalog.json',
      fetchFn: async () => { fetches++; await gate; return { ok: true, json: async () => MODELS }; },
      writeFile: async (file, data) => { writes.push([file, data]); },
      rename: async (from, to) => { renames.push([from, to]); },
    };
    const a = refreshCodexModelCatalog(opts);
    const b = refreshCodexModelCatalog(opts);
    release();
    const [first, second] = await Promise.all([a, b]);
    assert.equal(fetches, 1);
    assert.equal(first.source, 'provider-live');
    assert.deepEqual(first, second);
    assert.match(writes[0][0], /^\/cache\/catalog\.json\.\d+\.[\w-]+\.tmp$/);
    assert.deepEqual(renames, [[writes[0][0], '/cache/catalog.json']]);
    const persisted = JSON.parse(writes[0][1]);
    assert.equal(persisted.accountKey, crypto.createHash('sha256').update('account-1').digest('hex'));
    assert.equal(persisted.catalog.models[0].id, 'gpt-current');
  });

  test('returns cached data with a sanitized refresh error', async () => {
    resetCodexCatalogRefreshForTest();
    const result = await refreshCodexModelCatalog({
      credential: { source: 'natively', accessToken: 'secret', accountId: 'account-1' },
      fetchFn: async () => ({ ok: false, status: 429 }),
      readCached: async () => ({ source: 'provider-cache', models: parseCodexModelsPayload(MODELS).models }),
    });
    assert.equal(result.source, 'provider-cache');
    assert.equal(result.refreshError, 'rate-limited');
  });

  test('does not deduplicate different accounts or publish a stale account response', async () => {
    resetCodexCatalogRefreshForTest();
    const accountA = { source: 'natively', accessToken: 'a', accountId: 'account-a' };
    const accountB = { source: 'natively', accessToken: 'b', accountId: 'account-b' };
    let active = accountA;
    let fetches = 0;
    const a = refreshCodexModelCatalog({
      credentialProvider: async () => active,
      fetchFn: async () => {
        fetches++;
        await new Promise(resolve => setTimeout(resolve, 10));
        return { ok: true, json: async () => MODELS };
      },
    });
    active = accountB;
    const b = refreshCodexModelCatalog({
      credentialProvider: async () => active,
      fetchFn: async () => { fetches++; return { ok: true, json: async () => MODELS }; },
    });
    const [stale, current] = await Promise.all([a, b]);
    assert.equal(fetches, 2);
    assert.equal(stale.refreshError, 'auth');
    assert.equal(current.source, 'provider-live');
  });

  test('replaces an existing cache on Windows when direct rename cannot overwrite it', async () => {
    resetCodexCatalogRefreshForTest();
    const calls = [];
    let first = true;
    const result = await refreshCodexModelCatalog({
      credential: { source: 'natively', accessToken: 'secret', accountId: 'account-1' },
      appCacheFile: 'C:\\cache\\catalog.json',
      platform: 'win32',
      fetchFn: async () => ({ ok: true, json: async () => MODELS }),
      writeFile: async () => {},
      unlink: async file => { calls.push(['unlink', file]); },
      rename: async (from, to) => {
        calls.push(['rename', from, to]);
        if (first) { first = false; throw Object.assign(new Error('exists'), { code: 'EEXIST' }); }
      },
    });
    assert.equal(result.source, 'provider-live');
    const temporary = calls.find(call => call[0] === 'rename')[1];
    assert.match(temporary, /^C:\\cache\\catalog\.json\.\d+\.[\w-]+\.tmp$/);
    assert.deepEqual(calls.filter(call => call[0] === 'rename'), [
      ['rename', temporary, 'C:\\cache\\catalog.json'],
      ['rename', 'C:\\cache\\catalog.json', 'C:\\cache\\catalog.json.bak'],
      ['rename', temporary, 'C:\\cache\\catalog.json'],
    ]);
  });
});

describe('renderer helper', () => {
  test('has no hardcoded fallback roster', () => {
    assert.deepEqual(modelUtils.codexModelOptions(null), []);
    assert.deepEqual(modelUtils.codexModelOptions({ source: 'unavailable', models: [] }), []);
    assert.equal('CODEX_CLI_MODEL_PRESETS' in modelUtils, false);
  });
});
