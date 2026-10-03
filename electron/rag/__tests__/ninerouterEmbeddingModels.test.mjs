// electron/rag/__tests__/ninerouterEmbeddingModels.test.mjs
//
// Covers electron/rag/ninerouterEmbeddingModels.ts — listing a 9Router
// instance's embedding models and probing a model's real output width.
//
// No network: globalThis.fetch is replaced with a recording stub for each test
// and restored afterwards.
//
// Runs against the compiled output in dist-electron/.
// Run: node --test electron/rag/__tests__/ninerouterEmbeddingModels.test.mjs

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const { listNinerouterEmbeddingModels, probeNinerouterEmbeddingDimensions } = require(
  path.join(repoRoot, 'dist-electron/electron/rag/ninerouterEmbeddingModels.js'),
);

const DEFAULT_V1 = 'http://localhost:20128/v1';

const realFetch = globalThis.fetch;
let calls;

/** Install a fetch stub. `respond` returns { ok?, status?, json } or throws. */
function stubFetch(respond) {
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const r = await respond(String(url), init);
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => {
        if (r.jsonError) throw r.jsonError;
        return r.json;
      },
    };
  };
}

const okJson = (json) => () => ({ json });

beforeEach(() => { calls = []; });
afterEach(() => { globalThis.fetch = realFetch; });

describe('listNinerouterEmbeddingModels — request', () => {
  test('defaults to the local instance and asks the dedicated embedding route', async () => {
    stubFetch(okJson({ data: [] }));
    await listNinerouterEmbeddingModels();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${DEFAULT_V1}/models/embedding`);
    assert.ok(calls[0].init.method === undefined || calls[0].init.method === 'GET');
  });

  test('an empty options object or empty base URL also uses the default', async () => {
    stubFetch(okJson({ data: [] }));
    await listNinerouterEmbeddingModels({});
    await listNinerouterEmbeddingModels({ baseUrl: '' });
    await listNinerouterEmbeddingModels({ baseUrl: undefined });
    assert.deepEqual(calls.map((c) => c.url), Array(3).fill(`${DEFAULT_V1}/models/embedding`));
  });

  test('accepts a root URL or a /v1 URL, with or without trailing slashes or padding', async () => {
    stubFetch(okJson({ data: [] }));
    for (const baseUrl of [
      'https://router.example.com',
      'https://router.example.com/',
      'https://router.example.com/v1',
      'https://router.example.com/v1/',
      'https://router.example.com/v1///',
      '  https://router.example.com/v1  ',
    ]) {
      await listNinerouterEmbeddingModels({ baseUrl });
    }
    assert.deepEqual(calls.map((c) => c.url), Array(6).fill('https://router.example.com/v1/models/embedding'));
  });

  test('a path that merely contains "v1" still gets the /v1 suffix', async () => {
    stubFetch(okJson({ data: [] }));
    await listNinerouterEmbeddingModels({ baseUrl: 'https://router.example.com/v1beta' });
    await listNinerouterEmbeddingModels({ baseUrl: 'https://router.example.com/proxy' });
    assert.deepEqual(calls.map((c) => c.url), [
      'https://router.example.com/v1beta/v1/models/embedding',
      'https://router.example.com/proxy/v1/models/embedding',
    ]);
  });

  test('sends no Authorization header without a key (listing is unauthenticated)', async () => {
    stubFetch(okJson({ data: [] }));
    await listNinerouterEmbeddingModels({ baseUrl: 'http://h' });
    await listNinerouterEmbeddingModels({ baseUrl: 'http://h', apiKey: '' });
    for (const c of calls) assert.deepEqual(c.init.headers, {});
  });

  test('sends the key as a Bearer token when one is given', async () => {
    stubFetch(okJson({ data: [] }));
    await listNinerouterEmbeddingModels({ baseUrl: 'http://h', apiKey: 'test-key' });
    assert.deepEqual(calls[0].init.headers, { Authorization: 'Bearer test-key' });
  });

  test('passes an abort signal so a hung instance cannot block forever', async () => {
    stubFetch(okJson({ data: [] }));
    await listNinerouterEmbeddingModels();
    assert.ok(calls[0].init.signal instanceof AbortSignal);
  });
});

describe('listNinerouterEmbeddingModels — response', () => {
  test('maps each row to a catalogue model with an unverified, unknown width', async () => {
    stubFetch(okJson({ data: [{ id: 'voyage/voyage-3', owned_by: 'voyage', object: 'model' }] }));
    assert.deepEqual(await listNinerouterEmbeddingModels(), [{
      id: 'voyage/voyage-3',
      label: 'voyage/voyage-3',
      dimensions: 0,
      dimensionsVerified: false,
      supportedDimensions: undefined,
      note: 'via voyage',
    }]);
  });

  test('offers width choices only for the verified model families', async () => {
    stubFetch(okJson({
      data: [
        { id: 'gemini/gemini-embedding-001' },
        { id: 'gemini/gemini-embedding-exp-03-07' },
        { id: 'openai/text-embedding-3-small' },
        { id: 'openai/text-embedding-3-large' },
        { id: 'openai/text-embedding-ada-002' },
        { id: 'gemini/text-embedding-004' },
        { id: 'other/gemini/gemini-embedding-001' },
        { id: 'openai/text-embedding-3-small-preview' },
        { id: 'text-embedding-3-small' },
      ],
    }));
    const models = await listNinerouterEmbeddingModels();
    assert.deepEqual(Object.fromEntries(models.map((m) => [m.id, m.supportedDimensions])), {
      'gemini/gemini-embedding-001': [768, 1536, 3072],
      'gemini/gemini-embedding-exp-03-07': [768, 1536, 3072],
      'openai/text-embedding-3-small': [512, 1536],
      'openai/text-embedding-3-large': [256, 1024, 3072],
      'openai/text-embedding-ada-002': undefined,
      'gemini/text-embedding-004': undefined,
      'other/gemini/gemini-embedding-001': undefined,
      'openai/text-embedding-3-small-preview': undefined,
      'text-embedding-3-small': undefined,
    });
  });

  test('the note is only set for a string owned_by', async () => {
    stubFetch(okJson({ data: [{ id: 'a/1', owned_by: 'acme' }, { id: 'a/2' }, { id: 'a/3', owned_by: 42 }, { id: 'a/4', owned_by: null }] }));
    const models = await listNinerouterEmbeddingModels();
    assert.deepEqual(models.map((m) => m.note), ['via acme', undefined, undefined, undefined]);
  });

  test('keeps the server order and drops rows without a string id', async () => {
    stubFetch(okJson({ data: [{ id: 'z/last' }, null, { id: 7 }, {}, 'a/string-row', { id: 'a/first' }] }));
    const models = await listNinerouterEmbeddingModels();
    assert.deepEqual(models.map((m) => m.id), ['z/last', 'a/first']);
  });

  test('a payload without a data array is "no models"', async () => {
    for (const json of [{}, { data: null }, { data: 'nope' }, { data: { id: 'x' } }, [], null, 'text', { models: [{ id: 'x' }] }]) {
      stubFetch(okJson(json));
      assert.deepEqual(await listNinerouterEmbeddingModels(), [], JSON.stringify(json));
    }
  });

  test('a non-OK response is "no models" and the body is not read', async () => {
    let bodyRead = false;
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => { bodyRead = true; return { data: [{ id: 'x' }] }; } });
    assert.deepEqual(await listNinerouterEmbeddingModels(), []);
    assert.equal(bodyRead, false);
  });

  test('never throws: network failure and malformed JSON both give "no models"', async () => {
    stubFetch(() => { throw new TypeError('fetch failed'); });
    assert.deepEqual(await listNinerouterEmbeddingModels(), []);
    stubFetch(() => ({ jsonError: new SyntaxError('Unexpected token <') }));
    assert.deepEqual(await listNinerouterEmbeddingModels(), []);
  });
});

describe('probeNinerouterEmbeddingDimensions — request', () => {
  const vector = (n) => ({ data: [{ embedding: Array(n).fill(0.1) }] });

  test('an empty model is rejected without touching the network', async () => {
    stubFetch(okJson(vector(8)));
    assert.equal(await probeNinerouterEmbeddingDimensions(''), null);
    assert.equal(await probeNinerouterEmbeddingDimensions(undefined), null);
    assert.equal(await probeNinerouterEmbeddingDimensions(null, 'key', 'http://h'), null);
    assert.equal(calls.length, 0);
  });

  test('POSTs to the same /embeddings endpoint real embedding uses', async () => {
    stubFetch(okJson(vector(4)));
    await probeNinerouterEmbeddingDimensions('gemini/gemini-embedding-001');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${DEFAULT_V1}/embeddings`);
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(calls[0].init.headers, { 'Content-Type': 'application/json' });
    assert.ok(calls[0].init.signal instanceof AbortSignal);
  });

  test('the body carries the model and a non-empty probe text, and no dimensions by default', async () => {
    stubFetch(okJson(vector(4)));
    await probeNinerouterEmbeddingDimensions('a/model');
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(Object.keys(body).sort(), ['input', 'model']);
    assert.equal(body.model, 'a/model');
    assert.equal(typeof body.input, 'string');
    assert.ok(body.input.trim().length > 0);
  });

  test('a requested width is forwarded as "dimensions"; 0 or undefined is not', async () => {
    stubFetch(okJson(vector(4)));
    await probeNinerouterEmbeddingDimensions('a/model', undefined, undefined, 768);
    await probeNinerouterEmbeddingDimensions('a/model', undefined, undefined, 0);
    await probeNinerouterEmbeddingDimensions('a/model', undefined, undefined, undefined);
    assert.equal(JSON.parse(calls[0].init.body).dimensions, 768);
    assert.ok(!('dimensions' in JSON.parse(calls[1].init.body)));
    assert.ok(!('dimensions' in JSON.parse(calls[2].init.body)));
  });

  test('the key is trimmed and sent as a Bearer token', async () => {
    stubFetch(okJson(vector(4)));
    await probeNinerouterEmbeddingDimensions('a/model', '  test-key \n');
    assert.deepEqual(calls[0].init.headers, { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' });
  });

  test('a blank key sends no Authorization header', async () => {
    stubFetch(okJson(vector(4)));
    await probeNinerouterEmbeddingDimensions('a/model', '   ');
    await probeNinerouterEmbeddingDimensions('a/model', '');
    for (const c of calls) assert.ok(!('Authorization' in c.init.headers));
  });

  test('normalizes the base URL the same way listing does', async () => {
    stubFetch(okJson(vector(4)));
    for (const baseUrl of ['https://r.example.com', 'https://r.example.com/', 'https://r.example.com/v1', ' https://r.example.com/v1/ ']) {
      await probeNinerouterEmbeddingDimensions('a/model', 'k', baseUrl);
    }
    assert.deepEqual(calls.map((c) => c.url), Array(4).fill('https://r.example.com/v1/embeddings'));
  });
});

describe('probeNinerouterEmbeddingDimensions — response', () => {
  const probe = () => probeNinerouterEmbeddingDimensions('a/model', 'k', 'http://h');

  test('returns the length of the vector that came back', async () => {
    for (const n of [1, 768, 3072]) {
      stubFetch(okJson({ data: [{ embedding: Array(n).fill(0) }] }));
      assert.equal(await probe(), n);
    }
  });

  test('the returned length is the truth, even when a different width was requested', async () => {
    stubFetch(okJson({ data: [{ embedding: Array(3072).fill(0) }] }));
    assert.equal(await probeNinerouterEmbeddingDimensions('a/model', 'k', 'http://h', 768), 3072);
  });

  test('only the first embedding is measured', async () => {
    stubFetch(okJson({ data: [{ embedding: [1, 2, 3] }, { embedding: [1, 2, 3, 4, 5] }] }));
    assert.equal(await probe(), 3);
  });

  test('an upstream error status is null (a listed model is not a working model)', async () => {
    for (const status of [401, 404, 429, 500, 503]) {
      stubFetch(() => ({ ok: false, status, json: { data: [{ embedding: [1, 2, 3] }] } }));
      assert.equal(await probe(), null, String(status));
    }
  });

  test('a response without a usable vector is null', async () => {
    for (const json of [
      {},
      null,
      { data: [] },
      { data: null },
      { data: [{}] },
      { data: [{ embedding: [] }] },
      { data: [{ embedding: 'AAAA' }] },
      { data: [{ embedding: { 0: 1, length: 1 } }] },
      { data: { embedding: [1, 2] } },
      { embedding: [1, 2] },
    ]) {
      stubFetch(okJson(json));
      assert.equal(await probe(), null, JSON.stringify(json));
    }
  });

  test('never throws: network failure and malformed JSON are null', async () => {
    stubFetch(() => { throw new TypeError('fetch failed'); });
    assert.equal(await probe(), null);
    stubFetch(() => ({ jsonError: new SyntaxError('Unexpected end of JSON input') }));
    assert.equal(await probe(), null);
  });
});

describe('fetch stub hygiene', () => {
  test('the real fetch is back in place between tests', () => {
    assert.equal(globalThis.fetch, realFetch);
  });
});
