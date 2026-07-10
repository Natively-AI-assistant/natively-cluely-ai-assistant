// electron/rag/__tests__/EmbeddingProviderAuthClassify.test.mjs
//
// Auth/account failures from embedding providers must be classified as permanent
// so resolver/pipeline can demote immediately instead of retrying a removed or
// denied key. 429s remain transient cooldowns and should not be marked permanent.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const geminiPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/providers/GeminiEmbeddingProvider.js');
const openaiPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/providers/OpenAIEmbeddingProvider.js');
const resolverPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/EmbeddingProviderResolver.js');

const { GeminiEmbeddingProvider } = await import(pathToFileURL(geminiPath).href);
const { OpenAIEmbeddingProvider } = await import(pathToFileURL(openaiPath).href);
const { EmbeddingProviderResolver } = await import(pathToFileURL(resolverPath).href);
const probeAvailable = EmbeddingProviderResolver['probeAvailable'].bind(EmbeddingProviderResolver);

const DIMS = 768;
const goodVec = (n = DIMS) => new Array(n).fill(0.01);

function fakeRes({ ok = true, status = 200, statusText = 'OK', json = {}, text = '' } = {}) {
  return {
    ok,
    status,
    statusText,
    json: async () => json,
    text: async () => text,
  };
}

let realFetch;
let fetchCalls;
beforeEach(() => {
  realFetch = global.fetch;
  fetchCalls = [];
});
afterEach(() => { global.fetch = realFetch; });

function stubFetch(handler) {
  global.fetch = async (url, init) => {
    const idx = fetchCalls.length;
    fetchCalls.push({ url, init });
    return handler(url, init, idx);
  };
}

describe('GeminiEmbeddingProvider permanent auth classification', () => {
  test('403 PERMISSION_DENIED marks the key auth-dead and throws permanentAuthFailure', async () => {
    const p = new GeminiEmbeddingProvider('BAD_KEY', 'gemini-embedding-2', DIMS);
    stubFetch(() => fakeRes({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'Please use API Key' } }),
    }));

    await assert.rejects(
      () => p.embed('x'),
      (err) => err?.permanentAuthFailure === true && err?.status === 403 && err?.provider === 'gemini',
    );
    assert.equal(p.healthyKeyCount(), 0, 'auth-dead key should no longer count as healthy');
  });

  test('multi-key pool skips auth-dead key and succeeds with a later healthy key', async () => {
    const p = new GeminiEmbeddingProvider(['BAD_KEY', 'GOOD_KEY'], 'gemini-embedding-2', DIMS);
    stubFetch((_url, init, idx) => {
      if (idx === 0) {
        assert.equal(init.headers['x-goog-api-key'], 'BAD_KEY');
        return fakeRes({ ok: false, status: 403, statusText: 'Forbidden', text: 'PERMISSION_DENIED' });
      }
      assert.equal(init.headers['x-goog-api-key'], 'GOOD_KEY');
      return fakeRes({ json: { embedding: { values: goodVec() } } });
    });

    const out = await p.embed('x');
    assert.equal(out.length, DIMS);
    assert.equal(fetchCalls.length, 2, 'should retry with the next healthy key in the same provider lifetime');
    assert.equal(p.healthyKeyCount(), 1);
  });

  test('429 remains transient cooldown, not permanent auth failure', async () => {
    const p = new GeminiEmbeddingProvider(['RATE_KEY', 'GOOD_KEY'], 'gemini-embedding-2', DIMS);
    stubFetch((_url, init, idx) => {
      if (idx === 0) {
        assert.equal(init.headers['x-goog-api-key'], 'RATE_KEY');
        return fakeRes({ ok: false, status: 429, statusText: 'Too Many Requests', text: '{"retryDelay":"1s"}' });
      }
      assert.equal(init.headers['x-goog-api-key'], 'GOOD_KEY');
      return fakeRes({ json: { embedding: { values: goodVec() } } });
    });

    const out = await p.embed('x');
    assert.equal(out.length, DIMS);
    assert.equal(p.healthyKeyCount(), 1, '429 should cool the rate-limited key, not mark every key auth-dead');
  });

  test('isAvailable rethrows permanent auth failure so resolver can demote immediately', async () => {
    const p = new GeminiEmbeddingProvider('BAD_KEY', 'gemini-embedding-2', DIMS);
    stubFetch(() => fakeRes({ ok: false, status: 401, statusText: 'Unauthorized', text: 'API_KEY_INVALID' }));

    await assert.rejects(
      () => p.isAvailable(),
      (err) => err?.permanentAuthFailure === true && err?.status === 401,
    );
  });
});

describe('OpenAIEmbeddingProvider permanent auth classification', () => {
  test('embed() turns 401/403 HTTP responses into permanentAuthFailure errors with status/body', async () => {
    const p = new OpenAIEmbeddingProvider('BAD_KEY');
    stubFetch(() => fakeRes({ ok: false, status: 401, statusText: 'Unauthorized', text: '{"error":"invalid_api_key"}' }));

    await assert.rejects(
      () => p.embed('x'),
      (err) => err?.permanentAuthFailure === true
        && err?.status === 401
        && err?.provider === 'openai'
        && /invalid_api_key/.test(err.message),
    );
  });

  test('embedBatch() also carries permanentAuthFailure metadata for 403', async () => {
    const p = new OpenAIEmbeddingProvider('BAD_KEY');
    stubFetch(() => fakeRes({ ok: false, status: 403, statusText: 'Forbidden', text: '{"error":"billing disabled"}' }));

    await assert.rejects(
      () => p.embedBatch(['a', 'b']),
      (err) => err?.permanentAuthFailure === true && err?.status === 403 && /billing disabled/.test(err.message),
    );
  });

  test('429 is not marked as permanent auth failure', async () => {
    const p = new OpenAIEmbeddingProvider('RATE_KEY');
    stubFetch(() => fakeRes({ ok: false, status: 429, statusText: 'Too Many Requests', text: 'rate limit' }));

    await assert.rejects(
      () => p.embed('x'),
      (err) => err?.permanentAuthFailure === false && err?.status === 429,
    );
  });
});

describe('EmbeddingProviderResolver permanent auth probing', () => {
  test('probeAvailable does not retry permanent auth failures', async () => {
    let calls = 0;
    const provider = {
      name: 'gemini',
      dimensions: 768,
      space: 'gemini:test:768',
      isAvailable: async () => {
        calls++;
        throw Object.assign(new Error('PERMISSION_DENIED'), { permanentAuthFailure: true, status: 403 });
      },
      embed: async () => [],
      embedQuery: async () => [],
      embedBatch: async () => [],
    };

    const ok = await probeAvailable(provider);
    assert.equal(ok, false);
    assert.equal(calls, 1, 'permanent auth failures should demote immediately, not consume hysteresis retries');
  });
});
