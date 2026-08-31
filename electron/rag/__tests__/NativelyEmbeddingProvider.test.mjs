// electron/rag/__tests__/NativelyEmbeddingProvider.test.mjs
//
// The Natively-managed embedding provider (POST /v1/embed → gemini-embedding-2).
// Drives a real local HTTP stub rather than mocking fetch, so the request shape,
// headers and response parsing are all exercised as they will run in production.
//
// The load-bearing behaviours:
//   • embedBatch sends ONE request with `input: [...]` and gets N vectors back,
//     in order. Sending N separate requests would bill N times.
//   • Batches larger than the server's cap are split, not rejected.
//   • Trial users authenticate with x-trial-token, NOT x-natively-key — the
//     sentinel key is not a real credential.
//   • A response served by a DIFFERENT model than this provider declares must
//     throw. gemini-embedding-2 and -001 are both 768d, so a silent breaker flip
//     would otherwise write vectors from an incompatible space into the index
//     under this provider's space key, undetectable by any dimension check.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/providers/NativelyEmbeddingProvider.js');
const { NativelyEmbeddingProvider } = await import(pathToFileURL(modPath).href);

const DIMS = 3072;
const vec = (seed) => Array.from({ length: DIMS }, (_, i) => (i === 0 ? seed : 0.01));

let server, baseUrl, requests = [];
let respond = null; // per-test override

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      requests.push({ url: req.url, headers: req.headers, body: parsed });
      if (respond) return respond(req, res, parsed);
      const texts = Array.isArray(parsed.input) ? parsed.input : [parsed.text ?? parsed.input];
      const payload = Array.isArray(parsed.input)
        ? { embeddings: texts.map((t, i) => vec(i + 1)), model: 'gemini-embedding-2', dimensions: DIMS }
        : { embedding: vec(1), model: 'gemini-embedding-2', dimensions: DIMS };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => { await new Promise(r => server.close(r)); });

const make = (key = 'nk_test_key') => new NativelyEmbeddingProvider(key, { baseUrl });

describe('identity', () => {
  test('declares the space it actually stores vectors in', () => {
    const p = make();
    assert.equal(p.name, 'natively');
    assert.equal(p.model, 'gemini-embedding-2');
    assert.equal(p.dimensions, DIMS);
    assert.equal(p.space, 'natively:gemini-embedding-2:3072');
  });

  test('does NOT share a space key with the direct-Gemini provider', () => {
    // Same underlying model, but a different transport with its own truncation
    // cap and formatting. Sharing the key would create an invariant spanning two
    // repos with no test able to fail when either side drifts.
    assert.notEqual(make().space, 'gemini:gemini-embedding-2:3072');
  });
});

describe('embedding', () => {
  test('embed() returns a vector of the declared dimensionality', async () => {
    const out = await make().embed('hello');
    assert.equal(out.length, DIMS);
  });

  test('embedBatch() sends ONE request and returns one vector per input, in order', async () => {
    requests = [];
    const out = await make().embedBatch(['a', 'b', 'c']);
    assert.equal(out.length, 3);
    assert.equal(requests.length, 1, 'a batch must be one billed request, not three');
    assert.deepEqual(requests[0].body.input, ['a', 'b', 'c']);
    assert.deepEqual(out.map(v => v[0]), [1, 2, 3], 'vectors must stay in input order');
  });

  test('a batch larger than the server cap is split rather than refused', async () => {
    requests = [];
    const texts = Array.from({ length: 70 }, (_, i) => `chunk-${i}`);
    const out = await make().embedBatch(texts);
    assert.equal(out.length, 70);
    assert.ok(requests.length > 1, 'expected the batch to be split');
    for (const r of requests) assert.ok(r.body.input.length <= 32, 'each request must respect the server cap');
  });

  test('an empty batch makes no request at all', async () => {
    requests = [];
    const out = await make().embedBatch([]);
    assert.deepEqual(out, []);
    assert.equal(requests.length, 0);
  });
});

describe('authentication', () => {
  test('a real key is sent as x-natively-key', async () => {
    requests = [];
    await make('nk_live_abc').embed('x');
    assert.equal(requests[0].headers['x-natively-key'], 'nk_live_abc');
    assert.equal(requests[0].headers['x-trial-token'], undefined);
  });

  test('a trial uses x-trial-token, never the sentinel as a key', async () => {
    requests = [];
    const p = new NativelyEmbeddingProvider('__trial__', { baseUrl, trialToken: 'natively_trial_xyz' });
    await p.embed('x');
    assert.equal(requests[0].headers['x-trial-token'], 'natively_trial_xyz');
    assert.equal(requests[0].headers['x-natively-key'], undefined);
  });
});

describe('vector-space safety', () => {
  test('a response from a different model throws instead of storing a wrong-space vector', async () => {
    respond = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // Same 768 dims — only the model name reveals the incompatible space.
      res.end(JSON.stringify({ embedding: vec(9), model: 'gemini-embedding-001', dimensions: DIMS }));
    };
    try {
      await assert.rejects(() => make().embed('drifted'), /model/i);
    } finally { respond = null; }
  });

  test('a drift error is retryable, so it cannot demote the user to MiniLM', async () => {
    // EmbeddingPipeline promotes the local fallback after N consecutive HARD
    // failures. A permanent-auth flag would short-circuit that hysteresis.
    respond = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ embedding: vec(9), model: 'gemini-embedding-001', dimensions: DIMS }));
    };
    try {
      const err = await make().embed('drifted').catch(e => e);
      assert.equal(err.permanentAuthFailure, undefined);
      assert.equal(err.retryable, true);
    } finally { respond = null; }
  });

  test('a wrong-length vector is rejected', async () => {
    respond = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ embedding: [1, 2, 3], model: 'gemini-embedding-2', dimensions: 3 }));
    };
    try {
      await assert.rejects(() => make().embed('short'), /dimension/i);
    } finally { respond = null; }
  });
});

describe('errors', () => {
  test('a 429 carries retryAfter so the pipeline backs off instead of failing over', async () => {
    respond = (req, res) => {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '7' });
      res.end(JSON.stringify({ error: 'embedding_quota_exceeded' }));
    };
    try {
      const err = await make().embed('x').catch(e => e);
      assert.equal(err.status, 429);
      assert.equal(Number(err.retryAfter), 7);
    } finally { respond = null; }
  });

  test('a 401 is marked a permanent auth failure so the resolver demotes promptly', async () => {
    respond = (req, res) => { res.writeHead(401); res.end(JSON.stringify({ error: 'invalid_key' })); };
    try {
      const err = await make().embed('x').catch(e => e);
      assert.equal(err.permanentAuthFailure, true);
    } finally { respond = null; }
  });

  test('the API key never appears in an error message', async () => {
    respond = (req, res) => { res.writeHead(500); res.end('boom'); };
    try {
      const err = await make('nk_super_secret').embed('x').catch(e => e);
      assert.ok(!String(err.message).includes('nk_super_secret'));
    } finally { respond = null; }
  });
});

describe('availability', () => {
  test('isAvailable() is false without a key rather than throwing', async () => {
    const p = new NativelyEmbeddingProvider('', { baseUrl });
    assert.equal(await p.isAvailable(), false);
  });

  test('isAvailable() is true when the endpoint answers', async () => {
    assert.equal(await make().isAvailable(), true);
  });
});
