// electron/rag/__tests__/CustomEmbeddingProvider.test.mjs
//
// A user-hosted, OpenAI-compatible embedding endpoint — LM Studio
// (http://localhost:1234/v1), llama.cpp's llama-server (:8080/v1), vLLM,
// text-embeddings-inference, a LiteLLM proxy. All of them speak the same
// POST /v1/embeddings, so one provider covers the lot.
//
// Verified against current docs (2026-08-29):
//   LM Studio  — POST /v1/embeddings {model, input} -> {data:[{embedding}], model};
//                GET /v1/models (OpenAI shape) and a NATIVE GET /api/v1/models
//                that carries type: 'llm' | 'embedding'.
//   llama.cpp  — POST /v1/embeddings, requires --embedding and a pooling type
//                other than 'none'; output is L2-normalized.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const load = p => import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/rag', p)).href);
const { CustomEmbeddingProvider, normalizeCustomBaseUrl } = await load('providers/CustomEmbeddingProvider.js');

const DIMS = 1024;
const vec = seed => Array.from({ length: DIMS }, (_, i) => (i === 0 ? seed : 0.02));

let server, baseUrl, requests = [];
let respond = null;

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : {};
      requests.push({ url: req.url, headers: req.headers, body: parsed });
      if (respond) return respond(req, res, parsed);
      if (req.url === '/v1/embeddings') {
        const inputs = Array.isArray(parsed.input) ? parsed.input : [parsed.input];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // OpenAI shape: data[] carries an index, deliberately returned OUT OF
        // ORDER here so an implementation that trusts array position is caught.
        const data = inputs.map((t, i) => ({ index: i, embedding: vec(i + 1) })).reverse();
        return res.end(JSON.stringify({ data, model: parsed.model }));
      }
      res.writeHead(404); res.end('{}');
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
});

after(async () => { await new Promise(r => server.close(r)); });

const make = (opts = {}) => new CustomEmbeddingProvider({
  baseUrl, model: 'my-embedder', dimensions: DIMS, ...opts,
});

describe('base URL normalization', () => {
  test('a bare host gains the /v1 prefix these servers all use', () => {
    assert.equal(normalizeCustomBaseUrl('http://localhost:1234'), 'http://localhost:1234/v1');
  });

  test('an explicit /v1 is left alone rather than doubled', () => {
    assert.equal(normalizeCustomBaseUrl('http://localhost:8080/v1'), 'http://localhost:8080/v1');
  });

  test('trailing slashes are trimmed', () => {
    assert.equal(normalizeCustomBaseUrl('http://localhost:1234/v1/'), 'http://localhost:1234/v1');
    assert.equal(normalizeCustomBaseUrl('http://localhost:1234/'), 'http://localhost:1234/v1');
  });

  test('a nested path is preserved — proxies are often mounted under a prefix', () => {
    // A LiteLLM/nginx deployment at /proxy/v1 must not be rewritten.
    assert.equal(normalizeCustomBaseUrl('https://gw.example.com/proxy/v1'), 'https://gw.example.com/proxy/v1');
  });

  test('blank input yields null rather than a bogus URL', () => {
    assert.equal(normalizeCustomBaseUrl('   '), null);
    assert.equal(normalizeCustomBaseUrl(undefined), null);
  });

  test('a scheme-less host:port is coerced, not silently accepted broken', () => {
    // THE trap. `new URL('localhost:1234')` PARSES — `localhost:` becomes the
    // scheme and `1234` the path, leaving the host empty. That used to be
    // stored verbatim as a valid endpoint, and every request then failed with
    // "could not reach the custom embedding endpoint", which sends the user to
    // debug their server instead of their typo. Dropping http:// is the most
    // likely thing anyone types.
    assert.equal(normalizeCustomBaseUrl('localhost:1234'), 'http://localhost:1234/v1');
    assert.equal(normalizeCustomBaseUrl('127.0.0.1:8080'), 'http://127.0.0.1:8080/v1');
    assert.equal(normalizeCustomBaseUrl('my-server.local:1234'), 'http://my-server.local:1234/v1');
    assert.equal(normalizeCustomBaseUrl('localhost'), 'http://localhost/v1');
  });

  test('a non-HTTP scheme is refused', () => {
    // These also parse, and were stored. fetch would reject them later, with a
    // message about the network rather than about the URL.
    assert.equal(normalizeCustomBaseUrl('ftp://x/v1'), null);
    assert.equal(normalizeCustomBaseUrl('file:///etc/passwd'), null);
    assert.equal(normalizeCustomBaseUrl('javascript:alert(1)'), null);
  });

  test('genuinely unusable input is still null', () => {
    assert.equal(normalizeCustomBaseUrl('not a url at all'), null);
    assert.equal(normalizeCustomBaseUrl('http://'), null);
  });

  test('https and explicit ports survive the coercion path', () => {
    assert.equal(normalizeCustomBaseUrl('https://embeddings.example.com'), 'https://embeddings.example.com/v1');
    assert.equal(normalizeCustomBaseUrl('http://192.168.1.50:8080/v1'), 'http://192.168.1.50:8080/v1');
  });
});

describe('identity', () => {
  test('the space includes the HOST, not just the model', () => {
    // "Custom" is unconstrained: two different servers can serve genuinely
    // different weights under the same model name. Keying on model alone would
    // silently reuse an incompatible index. A false re-index is recoverable;
    // silent incomparability is not.
    const a = new CustomEmbeddingProvider({ baseUrl: 'http://localhost:1234/v1', model: 'm', dimensions: 768 });
    const b = new CustomEmbeddingProvider({ baseUrl: 'http://localhost:8080/v1', model: 'm', dimensions: 768 });
    assert.notEqual(a.space, b.space);
  });

  test('the same endpoint and model is a stable space across restarts', () => {
    const a = new CustomEmbeddingProvider({ baseUrl: 'http://localhost:1234/v1', model: 'm', dimensions: 768 });
    const b = new CustomEmbeddingProvider({ baseUrl: 'http://localhost:1234/v1/', model: 'm', dimensions: 768 });
    assert.equal(a.space, b.space);
  });

  test('a dimension change is a different space', () => {
    const a = new CustomEmbeddingProvider({ baseUrl, model: 'm', dimensions: 768 });
    const b = new CustomEmbeddingProvider({ baseUrl, model: 'm', dimensions: 1024 });
    assert.notEqual(a.space, b.space);
  });
});

describe('embedding', () => {
  test('embed() returns a vector of the declared width', async () => {
    const v = await make().embed('hello');
    assert.equal(v.length, DIMS);
  });

  test('embedBatch() sends ONE request with an input array', async () => {
    requests = [];
    const out = await make().embedBatch(['a', 'b', 'c']);
    assert.equal(out.length, 3);
    assert.equal(requests.length, 1, 'an OpenAI-compatible server batches natively');
    assert.deepEqual(requests[0].body.input, ['a', 'b', 'c']);
  });

  test('batch results are ordered by data[].index, not array position', async () => {
    // The OpenAI schema carries an index precisely because servers may return
    // out of order. Trusting position silently pairs vectors with the wrong
    // chunks — an index that looks fine and retrieves nonsense.
    const out = await make().embedBatch(['a', 'b', 'c']);
    assert.deepEqual(out.map(v => v[0]), [1, 2, 3]);
  });

  test('an empty batch makes no request', async () => {
    requests = [];
    assert.deepEqual(await make().embedBatch([]), []);
    assert.equal(requests.length, 0);
  });
});

describe('authentication', () => {
  test('a key is sent as a bearer token when one is configured', async () => {
    requests = [];
    await make({ apiKey: 'sk-local-abc' }).embed('x');
    assert.equal(requests[0].headers.authorization, 'Bearer sk-local-abc');
  });

  test('no Authorization header when no key is set — LM Studio and llama.cpp need none', async () => {
    requests = [];
    await make().embed('x');
    assert.equal(requests[0].headers.authorization, undefined);
  });
});

describe('validation', () => {
  test('a wrong-length vector is rejected rather than stored', async () => {
    respond = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ index: 0, embedding: [1, 2, 3] }] }));
    };
    try { await assert.rejects(() => make().embed('x'), /dimension/i); }
    finally { respond = null; }
  });

  test('a short batch is rejected rather than silently dropping chunks', async () => {
    respond = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ index: 0, embedding: vec(1) }] }));
    };
    try { await assert.rejects(() => make().embedBatch(['a', 'b']), /2|count|match/i); }
    finally { respond = null; }
  });
});

describe('errors', () => {
  test('a 404 explains that the endpoint or model is wrong, not just "failed"', async () => {
    respond = (req, res) => { res.writeHead(404); res.end('{"error":"model not found"}'); };
    try {
      const err = await make().embed('x').catch(e => e);
      assert.equal(err.status, 404);
      assert.match(err.message, /404/);
    } finally { respond = null; }
  });

  test('a 401 is a permanent auth failure so the resolver demotes promptly', async () => {
    respond = (req, res) => { res.writeHead(401); res.end('{}'); };
    try {
      const err = await make({ apiKey: 'bad' }).embed('x').catch(e => e);
      assert.equal(err.permanentAuthFailure, true);
    } finally { respond = null; }
  });

  test('the configured key never appears in an error message', async () => {
    respond = (req, res) => { res.writeHead(500); res.end('boom'); };
    try {
      const err = await make({ apiKey: 'sk-super-secret' }).embed('x').catch(e => e);
      assert.ok(!String(err.message).includes('sk-super-secret'));
    } finally { respond = null; }
  });

  test('an unreachable server reports unavailable rather than throwing', async () => {
    const p = new CustomEmbeddingProvider({ baseUrl: 'http://127.0.0.1:1/v1', model: 'm', dimensions: 768 });
    assert.equal(await p.isAvailable(), false);
  });

  test('isAvailable() is false with no base URL configured', async () => {
    const p = new CustomEmbeddingProvider({ baseUrl: '', model: 'm', dimensions: 768 });
    assert.equal(await p.isAvailable(), false);
  });
});
