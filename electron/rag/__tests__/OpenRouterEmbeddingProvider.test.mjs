// electron/rag/__tests__/OpenRouterEmbeddingProvider.test.mjs
//
// Wire-contract + resilience tests for OpenRouterEmbeddingProvider, WITHOUT network.
// global.fetch is stubbed with canned Response-like objects. The invariants that
// matter for retrieval correctness:
//   - documents are sent as input_type 'passage', queries as 'query'. The model is
//     asymmetric (verified live: same text as query vs passage gives cos ≈ 0.86), so
//     swapping these silently degrades every search.
//   - the key travels in the Authorization header, never in the URL.
//   - `dimensions` / `encoding_format` are NEVER sent (the upstream rejects both).
//   - a vector of the wrong length, or a batch response of the wrong LENGTH, must
//     throw rather than be stored — positional mapping to chunk ids means a
//     mismatch attaches the wrong vector to the wrong chunk.
//   - 429/5xx retry; 401/402/403 are permanentAuthFailure so the resolver demotes
//     immediately instead of burning its probe budget.
//   - a failed batch degrades to serial single embeds, preserving order/count.
//
// Pure logic + fetch stub → runs under plain node OR electron.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const provPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/providers/OpenRouterEmbeddingProvider.js');
const { OpenRouterEmbeddingProvider } = await import(pathToFileURL(provPath).href);

const DIMS = 2048;
const vec = (seed = 1) => new Array(DIMS).fill(0).map((_, i) => ((i + seed) % 11) * 0.01);
const okBody = (n) => ({ object: 'list', data: new Array(n).fill(0).map((_, i) => ({ object: 'embedding', embedding: vec(i) })) });

function fakeRes({ ok = true, status = 200, statusText = 'OK', json = {}, text = '', headers = {} } = {}) {
  return {
    ok, status, statusText,
    json: async () => json,
    text: async () => text,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
  };
}

let realFetch;
let calls;
beforeEach(() => { realFetch = global.fetch; calls = []; });
afterEach(() => { global.fetch = realFetch; });

function stubFetch(handler) {
  global.fetch = async (url, init) => {
    const idx = calls.length;
    calls.push({ url, init, body: JSON.parse(init.body) });
    return handler(url, init, idx);
  };
}

const provider = () => new OpenRouterEmbeddingProvider('sk-or-test-key');

describe('wire contract', () => {
  test('embed() sends input_type=passage, key in the Authorization header, no URL secret', async () => {
    stubFetch(() => fakeRes({ json: okBody(1) }));
    const out = await provider().embed('a document chunk');

    assert.equal(out.length, DIMS);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/embeddings');
    assert.doesNotMatch(calls[0].url, /sk-or-test-key/, 'the key must never appear in the URL');
    assert.equal(calls[0].init.headers['Authorization'], 'Bearer sk-or-test-key');
    assert.equal(calls[0].body.input_type, 'passage');
    assert.deepEqual(calls[0].body.input, ['a document chunk']);
  });

  test('embedQuery() sends input_type=query (asymmetric model — must differ from documents)', async () => {
    stubFetch(() => fakeRes({ json: okBody(1) }));
    await provider().embedQuery('what did we decide about pricing');
    assert.equal(calls[0].body.input_type, 'query');
  });

  test('never sends dimensions or encoding_format (upstream rejects both)', async () => {
    stubFetch(() => fakeRes({ json: okBody(1) }));
    await provider().embed('x');
    assert.equal('dimensions' in calls[0].body, false);
    assert.equal('encoding_format' in calls[0].body, false);
  });

  test('space key is provider:model:dims and defaults to the free Nemotron tier', () => {
    const p = provider();
    assert.equal(p.name, 'openrouter');
    assert.equal(p.model, 'nvidia/nemotron-3-embed-1b:free');
    assert.equal(p.dimensions, DIMS);
    assert.equal(p.space, 'openrouter:nvidia/nemotron-3-embed-1b:free:2048');
  });

  test('an explicit model/dims override changes the space (forces re-index by design)', () => {
    const p = new OpenRouterEmbeddingProvider('k', 'some/other-embed', 1024);
    assert.equal(p.space, 'openrouter:some/other-embed:1024');
  });

  test('constructor rejects an empty key instead of making unauthenticated calls', () => {
    assert.throws(() => new OpenRouterEmbeddingProvider('   '), /no API key/);
  });
});

describe('response validation', () => {
  test('a wrong-length vector throws', async () => {
    stubFetch(() => fakeRes({ json: { data: [{ embedding: [0.1, 0.2] }] } }));
    await assert.rejects(() => provider().embed('x'), /expected 2048-dim array, got 2/);
  });

  test('a non-array embedding throws', async () => {
    stubFetch(() => fakeRes({ json: { data: [{ embedding: 'nope' }] } }));
    await assert.rejects(() => provider().embed('x'), /expected 2048-dim array/);
  });

  test('an HTTP 200 carrying an OpenAI-style error object throws', async () => {
    stubFetch(() => fakeRes({ json: { error: { message: 'model not found', code: 404 } } }));
    await assert.rejects(() => provider().embed('x'), /model not found/);
  });

  test('a response with the wrong NUMBER of vectors throws (no positional corruption)', async () => {
    stubFetch(() => fakeRes({ json: okBody(2) }));
    // 1 input, 2 vectors back → must not pick one and carry on.
    await assert.rejects(() => provider().embed('x'), /expected 1 vectors, got 2/);
  });

  test('a batch length mismatch re-embeds serially rather than mapping vectors to the wrong chunks', async () => {
    stubFetch((_url, _init, i) => i === 0
      ? fakeRes({ json: okBody(2) })            // 3 inputs, 2 vectors → rejected
      : fakeRes({ json: okBody(1) }));          // serial retries, one vector each
    const out = await provider().embedBatch(['a', 'b', 'c']);
    assert.equal(out.length, 3, 'every input must still get its own vector');
    assert.deepEqual(calls.map(c => c.body.input.length), [3, 1, 1, 1]);
  });
});

describe('error classification', () => {
  for (const status of [401, 402, 403]) {
    test(`${status} is a permanentAuthFailure (resolver demotes immediately)`, async () => {
      stubFetch(() => fakeRes({ ok: false, status, statusText: 'nope', text: 'denied' }));
      const error = await provider().embed('x').then(() => null, (e) => e);
      assert.ok(error, 'must reject');
      assert.equal(error.permanentAuthFailure, true);
      assert.equal(error.provider, 'openrouter');
      assert.equal(calls.length, 1, 'a permanent failure must not be retried');
    });

    test(`isAvailable() rethrows a ${status} so the resolver can see it`, async () => {
      stubFetch(() => fakeRes({ ok: false, status, statusText: 'nope', text: 'denied' }));
      await assert.rejects(() => provider().isAvailable(), /OpenRouter/);
    });
  }

  test('a 400 is NOT permanent-auth and is not retried', async () => {
    stubFetch(() => fakeRes({ ok: false, status: 400, statusText: 'Bad Request', text: 'dimensions must be one of 2048' }));
    const error = await provider().embed('x').then(() => null, (e) => e);
    assert.equal(error.permanentAuthFailure, false);
    assert.equal(calls.length, 1);
  });

  test('isAvailable() returns false (not throw) on a transient failure', async () => {
    stubFetch(() => fakeRes({ ok: false, status: 500, statusText: 'ISE', text: 'boom' }));
    assert.equal(await provider().isAvailable(), false);
    assert.ok(calls.length > 1, 'a 5xx should have been retried before giving up');
  });
});

describe('retry + batch resilience', () => {
  test('a 429 retries and then succeeds (free tier is rate-limited by design)', async () => {
    stubFetch((_url, _init, i) => i === 0
      ? fakeRes({ ok: false, status: 429, statusText: 'Too Many Requests', text: 'slow down', headers: { 'retry-after': '0' } })
      : fakeRes({ json: okBody(1) }));

    const out = await provider().embed('x');
    assert.equal(out.length, DIMS);
    assert.equal(calls.length, 2);
  });

  test('embedBatch chunks a >96-input corpus into multiple requests, order preserved', async () => {
    stubFetch((_url, _init, i) => fakeRes({ json: okBody(calls[i].body.input.length) }));
    const texts = new Array(200).fill(0).map((_, i) => `chunk ${i}`);
    const out = await provider().embedBatch(texts);

    assert.equal(out.length, 200);
    assert.deepEqual(calls.map(c => c.body.input.length), [96, 96, 8]);
    assert.ok(calls.every(c => c.body.input_type === 'passage'));
  });

  test('a failed batch degrades to serial single embeds and still returns one vector per input', async () => {
    stubFetch((_url, _init, i) => {
      // First call is the batch (3 inputs) — fail it hard with a 400 so no retry happens.
      if (i === 0) return fakeRes({ ok: false, status: 400, statusText: 'Bad Request', text: 'payload too large' });
      return fakeRes({ json: okBody(1) });
    });

    const out = await provider().embedBatch(['a', 'b', 'c']);
    assert.equal(out.length, 3);
    assert.ok(out.every(v => v.length === DIMS));
    // 1 failed batch + 3 serial calls, each a single passage input.
    assert.equal(calls.length, 4);
    assert.deepEqual(calls.slice(1).map(c => c.body.input.length), [1, 1, 1]);
  });

  test('a permanent auth failure inside embedBatch propagates instead of retrying serially', async () => {
    stubFetch(() => fakeRes({ ok: false, status: 401, statusText: 'Unauthorized', text: 'bad key' }));
    await assert.rejects(() => provider().embedBatch(['a', 'b']), /401/);
    assert.equal(calls.length, 1, 'no serial fallback on a dead key');
  });

  test('embedBatch([]) makes no request', async () => {
    stubFetch(() => { throw new Error('should not be called'); });
    assert.deepEqual(await provider().embedBatch([]), []);
    assert.equal(calls.length, 0);
  });
});

// Source-level wiring checks. The resolver imports LocalEmbeddingProvider (ONNX),
// so it is asserted by reading the source rather than instantiating it here.
describe('resolver wiring', () => {
  const root = path.resolve(__dirname, '../../..');
  const resolverSrc = fs.readFileSync(path.join(root, 'electron/rag/EmbeddingProviderResolver.ts'), 'utf8');

  test('openrouter is gated by the cloud-embeddings data scope, like openai/gemini', () => {
    assert.match(resolverSrc, /assertProviderDataScopes\('openrouter_embeddings', \['embeddings'\], config\.providerDataScopes\)/);
  });

  test('openrouter counts as a CLOUD provider, so a transient probe failure does not thrash the space', () => {
    assert.match(resolverSrc, /CLOUD_PROVIDER_NAMES = new Set\(\[[^\]]*'openrouter'/);
  });

  test('openrouter is probed AFTER openai and gemini (adding the key must not force a re-index)', () => {
    const openaiAt = resolverSrc.indexOf('new OpenAIEmbeddingProvider(');
    const geminiAt = resolverSrc.indexOf('new GeminiEmbeddingProvider(');
    const openrouterAt = resolverSrc.indexOf('new OpenRouterEmbeddingProvider(');
    const ollamaAt = resolverSrc.indexOf('new OllamaEmbeddingProvider(');
    assert.ok(openaiAt > 0 && geminiAt > 0 && openrouterAt > 0 && ollamaAt > 0);
    assert.ok(openrouterAt > openaiAt && openrouterAt > geminiAt, 'openrouter must be pushed after the existing cloud providers');
    assert.ok(openrouterAt < ollamaAt, 'openrouter must be preferred over Ollama/local');
  });

  test('an openrouter-only install does not pull the 274MB Ollama embedding model', () => {
    const mainSrc = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
    const guard = mainSrc.slice(mainSrc.indexOf('const hasCloudEmbeddingKey'), mainSrc.indexOf('if (hasCloudEmbeddingKey)'));
    assert.match(guard, /getOpenrouterApiKey\(\)\s*\|\|\s*process\.env\.OPENROUTER_API_KEY/, 'the Ollama-bootstrap skip must count OpenRouter as a cloud embedding provider');
  });

  test('the pipeline re-initializes when the openrouter key is added OR removed', () => {
    const pipelineSrc = fs.readFileSync(path.join(root, 'electron/rag/EmbeddingPipeline.ts'), 'utf8');
    assert.match(pipelineSrc, /norm\(prev\.openrouterKey\)\s*!==\s*norm\(next\.openrouterKey\)/);
  });
});
