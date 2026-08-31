// electron/rag/__tests__/OpenRouterEmbeddingProvider.test.mjs
//
// OpenRouter embeddings. Verified against openrouter.ai docs AND a live probe of
// the public models endpoint (2026-08-31):
//
//   POST https://openrouter.ai/api/v1/embeddings
//        {model, input: string|string[], dimensions?, encoding_format?}
//     -> {data: [{index, embedding}]}          (OpenAI-shaped)
//   GET  https://openrouter.ai/api/v1/models?output_modalities=embeddings
//        -> {data: [{id, name, architecture:{output_modalities:['embeddings']}}]}
//        A SERVER-SIDE capability filter — 34 models, no name guessing, and it
//        needs no key.
//
// Model ids are namespaced (`voyageai/voyage-4-lite`) and may carry a variant
// suffix (`nvidia/nemotron-3-embed-1b:free`).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const load = p => import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/rag', p)).href);
const { OpenRouterEmbeddingProvider } = await load('providers/OpenRouterEmbeddingProvider.js');

const DIMS = 1024;
const vec = seed => Array.from({ length: DIMS }, (_, i) => (i === 0 ? seed : 0.01));

let server, baseUrl, requests = [], respond = null;

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : {};
      requests.push({ url: req.url, headers: req.headers, body: parsed });
      if (respond) return respond(req, res, parsed);
      const inputs = Array.isArray(parsed.input) ? parsed.input : [parsed.input];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // Deliberately reversed: the schema carries an index for a reason.
      const data = inputs.map((_, i) => ({ index: i, embedding: vec(i + 1) })).reverse();
      res.end(JSON.stringify({ data, model: parsed.model }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
});
after(async () => { await new Promise(r => server.close(r)); });

const make = (opts = {}) => new OpenRouterEmbeddingProvider({
  apiKey: 'sk-or-test', model: 'voyageai/voyage-4-lite', dimensions: DIMS, baseUrl, ...opts,
});

describe('identity', () => {
  test('it is its own provider, not "custom"', () => {
    assert.equal(make().name, 'openrouter');
  });

  test('the space names openrouter and the full namespaced model', () => {
    const p = new OpenRouterEmbeddingProvider({ apiKey: 'k', model: 'voyageai/voyage-4-lite', dimensions: 1024 });
    assert.equal(p.space, 'openrouter:voyageai/voyage-4-lite:1024');
  });

  test('a variant suffix is preserved — :free is a different model', () => {
    const free = new OpenRouterEmbeddingProvider({ apiKey: 'k', model: 'nvidia/nemotron-3-embed-1b:free', dimensions: 768 });
    const paid = new OpenRouterEmbeddingProvider({ apiKey: 'k', model: 'nvidia/nemotron-3-embed-1b', dimensions: 768 });
    assert.notEqual(free.space, paid.space);
  });

  test('a width change is a different space', () => {
    const a = new OpenRouterEmbeddingProvider({ apiKey: 'k', model: 'm', dimensions: 512 });
    const b = new OpenRouterEmbeddingProvider({ apiKey: 'k', model: 'm', dimensions: 1024 });
    assert.notEqual(a.space, b.space);
  });

  test('the space does NOT carry the host — openrouter is one service', () => {
    // Unlike the custom endpoint, where the host is part of the identity because
    // two servers can serve different weights under one name.
    const a = new OpenRouterEmbeddingProvider({ apiKey: 'k', model: 'm', dimensions: 512 });
    const b = new OpenRouterEmbeddingProvider({ apiKey: 'k', model: 'm', dimensions: 512, baseUrl: 'https://proxy.example/api/v1' });
    assert.equal(a.space, b.space);
  });
});

describe('embedding', () => {
  test('embed() returns a vector of the declared width', async () => {
    assert.equal((await make().embed('hello')).length, DIMS);
  });

  test('embedBatch() sends ONE request with an input array', async () => {
    requests = [];
    const out = await make().embedBatch(['a', 'b', 'c']);
    assert.equal(out.length, 3);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].body.input, ['a', 'b', 'c']);
  });

  test('batch results are ordered by data[].index, not array position', async () => {
    assert.deepEqual((await make().embedBatch(['a', 'b', 'c'])).map(v => v[0]), [1, 2, 3]);
  });

  test('it posts to /embeddings under the api/v1 base', async () => {
    requests = [];
    await make().embed('x');
    assert.equal(requests[0].url, '/api/v1/embeddings');
  });
});

describe('authentication', () => {
  test('the key is sent as a bearer token', async () => {
    requests = [];
    await make().embed('x');
    assert.equal(requests[0].headers.authorization, 'Bearer sk-or-test');
  });

  test('attribution headers identify the app to OpenRouter', async () => {
    // OpenRouter uses HTTP-Referer / X-Title for per-app attribution.
    requests = [];
    await make().embed('x');
    assert.ok(requests[0].headers['http-referer'] || requests[0].headers['x-title']);
  });
});

describe('errors', () => {
  test('a 401 is a permanent auth failure so the resolver demotes promptly', async () => {
    respond = (req, res) => { res.writeHead(401); res.end('{}'); };
    try {
      const err = await make().embed('x').catch(e => e);
      assert.equal(err.permanentAuthFailure, true);
    } finally { respond = null; }
  });

  test('the key never appears in an error message', async () => {
    respond = (req, res) => { res.writeHead(500); res.end('boom'); };
    try {
      const err = await make({ apiKey: 'sk-or-super-secret' }).embed('x').catch(e => e);
      assert.ok(!String(err.message).includes('sk-or-super-secret'));
    } finally { respond = null; }
  });

  test('a wrong-length vector is rejected rather than indexed', async () => {
    respond = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ index: 0, embedding: [1, 2, 3] }] }));
    };
    try { await assert.rejects(() => make().embed('x'), /dimension/i); }
    finally { respond = null; }
  });

  test('isAvailable() is false without a key', async () => {
    assert.equal(await new OpenRouterEmbeddingProvider({ apiKey: '', model: 'm', dimensions: 8, baseUrl }).isAvailable(), false);
  });
});
