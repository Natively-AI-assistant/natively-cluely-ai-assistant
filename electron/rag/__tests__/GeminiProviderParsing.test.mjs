// electron/rag/__tests__/GeminiProviderParsing.test.mjs
//
// Mandate #7: response-parsing / validation hardening for GeminiEmbeddingProvider v2,
// WITHOUT network. We monkeypatch global.fetch to return canned Response-like objects
// and assert the provider:
//   - validateVector throws on wrong shape / wrong length / non-array / null,
//     and ACCEPTS a correct-length array (even with NaN — documents that NaN is NOT
//     rejected, only shape/length are checked).
//   - embed/embedQuery throw on non-OK HTTP and never return a malformed vector.
//   - embedBatch: happy path maps 1:1; falls back to SERIAL on network error,
//     non-OK status, AND length mismatch — and the serial fallback still produces
//     exactly texts.length validated vectors.
//   - embedBatch with a per-element malformed `values` THROWS (never silently stores
//     a bad vector positionally mapped to the wrong chunk).
//   - the v2 wire contract: x-goog-api-key header (NOT a URL query param),
//     outputDimensionality in the body, and the document/query prompt prefixes.
//
// Pure logic + fetch stub → runs under plain node OR electron.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const provPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/providers/GeminiEmbeddingProvider.js');
const { GeminiEmbeddingProvider } = await import(pathToFileURL(provPath).href);

const DIMS = 768;
const goodVec = () => new Array(DIMS).fill(0).map((_, i) => (i % 7) * 0.01);

// Build a minimal Response-like object the provider's code path uses:
//   res.ok, res.status, res.statusText, res.json(), res.text()
function fakeRes({ ok = true, status = 200, statusText = 'OK', json = {}, text = '' } = {}) {
  return {
    ok, status, statusText,
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

// Helper: set a fetch handler that records the call and returns a scripted response
// (or scripted sequence). `handler(url, init, callIndex)` returns a fakeRes / throws.
function stubFetch(handler) {
  global.fetch = async (url, init) => {
    const idx = fetchCalls.length;
    fetchCalls.push({ url, init });
    return handler(url, init, idx);
  };
}

describe('embed() — single document', () => {
  test('valid 768-dim response returns the vector', async () => {
    const p = new GeminiEmbeddingProvider('KEY', 'gemini-embedding-2', DIMS);
    const vec = goodVec();
    stubFetch(() => fakeRes({ json: { embedding: { values: vec } } }));
    const out = await p.embed('hello', { title: 'T' });
    assert.deepEqual(out, vec);
  });

  test('wire contract: api key in x-goog-api-key header, NOT the URL', async () => {
    const p = new GeminiEmbeddingProvider('SECRET_KEY', 'gemini-embedding-2', DIMS);
    stubFetch(() => fakeRes({ json: { embedding: { values: goodVec() } } }));
    await p.embed('hi');
    const { url, init } = fetchCalls[0];
    assert.ok(!String(url).includes('SECRET_KEY'), 'API key must NOT appear in the URL');
    assert.equal(init.headers['x-goog-api-key'], 'SECRET_KEY');
    assert.equal(init.headers['Content-Type'], 'application/json');
    const body = JSON.parse(init.body);
    assert.equal(body.outputDimensionality, DIMS, 'outputDimensionality must be sent');
    assert.match(body.content.parts[0].text, /^title: .* \| text: /, 'document prompt prefix');
  });

  test('document prompt uses "none" title when none provided', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch(() => fakeRes({ json: { embedding: { values: goodVec() } } }));
    await p.embed('body text');
    const body = JSON.parse(fetchCalls[0].init.body);
    assert.equal(body.content.parts[0].text, 'title: none | text: body text');
  });

  test('non-OK HTTP throws and returns NO vector', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch(() => fakeRes({ ok: false, status: 429, statusText: 'Too Many Requests', text: 'quota' }));
    await assert.rejects(() => p.embed('x'), /429|Too Many Requests/);
  });

  test('VALIDATION: wrong-length array throws (e.g. 512 dims when 768 expected)', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch(() => fakeRes({ json: { embedding: { values: new Array(512).fill(0) } } }));
    await assert.rejects(() => p.embed('x'), /expected 768-dim array, got 512/);
  });

  test('VALIDATION: non-array values throws', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch(() => fakeRes({ json: { embedding: { values: 'not-an-array' } } }));
    await assert.rejects(() => p.embed('x'), /expected 768-dim array, got string/);
  });

  test('VALIDATION: null values throws', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch(() => fakeRes({ json: { embedding: { values: null } } }));
    await assert.rejects(() => p.embed('x'), /expected 768-dim array, got object/);
  });

  test('VALIDATION: missing embedding object entirely throws (data?.embedding?.values undefined)', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch(() => fakeRes({ json: {} }));
    await assert.rejects(() => p.embed('x'), /expected 768-dim array, got undefined/);
  });

  test('DOCUMENTED GAP: a correct-LENGTH array containing NaN is ACCEPTED (validateVector checks shape/length only, not finiteness)', async () => {
    // The doc-comment for validateVector says "finite-number array" but the
    // implementation only checks Array.isArray + length. A NaN/Infinity slips through.
    // This is low-severity (Gemini won't return NaN), but it contradicts the comment;
    // asserting current behavior so a future finiteness check is a deliberate change.
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    const withNaN = goodVec(); withNaN[0] = NaN; withNaN[1] = Infinity;
    stubFetch(() => fakeRes({ json: { embedding: { values: withNaN } } }));
    const out = await p.embed('x');
    assert.ok(Number.isNaN(out[0]), 'NaN passed through (documented gap vs "finite-number" doc)');
    assert.equal(out[1], Infinity);
  });
});

describe('embedQuery() — asymmetric retrieval', () => {
  test('default query prompt uses "search result" task prefix', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch(() => fakeRes({ json: { embedding: { values: goodVec() } } }));
    await p.embedQuery('what is X?');
    const body = JSON.parse(fetchCalls[0].init.body);
    assert.equal(body.content.parts[0].text, 'task: search result | query: what is X?');
  });

  test('code taskHint switches to "code retrieval" prefix', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch(() => fakeRes({ json: { embedding: { values: goodVec() } } }));
    await p.embedQuery('def foo', { taskHint: 'code' });
    const body = JSON.parse(fetchCalls[0].init.body);
    assert.equal(body.content.parts[0].text, 'task: code retrieval | query: def foo');
  });

  test('embedQuery validates length too (short array throws)', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch(() => fakeRes({ json: { embedding: { values: [1, 2, 3] } } }));
    await assert.rejects(() => p.embedQuery('x'), /expected 768-dim array, got 3/);
  });
});

describe('embedBatch() — batchEmbedContents + fallbacks', () => {
  test('empty input returns [] without any fetch', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch(() => { throw new Error('should not be called'); });
    assert.deepEqual(await p.embedBatch([]), []);
    assert.equal(fetchCalls.length, 0);
  });

  test('happy path: N inputs → N validated vectors, order preserved, ONE batch call', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    const v0 = goodVec().map(x => x + 0.0); const v1 = goodVec().map(x => x + 0.5);
    stubFetch((url) => {
      assert.match(String(url), /batchEmbedContents$/);
      return fakeRes({ json: { embeddings: [{ values: v0 }, { values: v1 }] } });
    });
    const out = await p.embedBatch(['a', 'b']);
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], v0);
    assert.deepEqual(out[1], v1);
    assert.equal(fetchCalls.length, 1, 'one batch request, not serial');
  });

  test('NETWORK error on batch → falls back to SERIAL embedContent (N+1 fetches: 1 failed batch + N serial)', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch((url, _init, idx) => {
      if (idx === 0) throw new Error('ECONNRESET'); // the batch attempt
      return fakeRes({ json: { embedding: { values: goodVec() } } }); // serial embeds
    });
    const out = await p.embedBatch(['a', 'b', 'c']);
    assert.equal(out.length, 3, 'serial fallback produced exactly 3 vectors');
    assert.equal(fetchCalls.length, 4, '1 failed batch + 3 serial embedContent');
    assert.match(String(fetchCalls[1].url), /embedContent$/);
  });

  test('non-OK batch status → falls back to SERIAL', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch((url, _init, idx) => {
      if (idx === 0) return fakeRes({ ok: false, status: 400, statusText: 'Bad Request', text: 'schema err' });
      return fakeRes({ json: { embedding: { values: goodVec() } } });
    });
    const out = await p.embedBatch(['a', 'b']);
    assert.equal(out.length, 2);
    assert.equal(fetchCalls.length, 3, '1 failed batch + 2 serial');
  });

  test('LENGTH MISMATCH (batch returns fewer vectors than inputs) → falls back to SERIAL (never positional-misalign)', async () => {
    // This is the silent-corruption guard: a short batch response would otherwise map
    // vector[i] to the WRONG chunk id. Provider must reject the batch and re-embed serially.
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch((url, _init, idx) => {
      if (idx === 0) return fakeRes({ json: { embeddings: [{ values: goodVec() }] } }); // 1 vec for 3 inputs
      return fakeRes({ json: { embedding: { values: goodVec() } } });
    });
    const out = await p.embedBatch(['a', 'b', 'c']);
    assert.equal(out.length, 3, 'serial fallback recovered exactly 3 vectors');
    assert.equal(fetchCalls.length, 4, '1 misaligned batch + 3 serial');
  });

  test('batch returns non-array embeddings → falls back to SERIAL', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch((url, _init, idx) => {
      if (idx === 0) return fakeRes({ json: { embeddings: null } });
      return fakeRes({ json: { embedding: { values: goodVec() } } });
    });
    const out = await p.embedBatch(['a']);
    assert.equal(out.length, 1);
    assert.equal(fetchCalls.length, 2);
  });

  test('batch with CORRECT length but a per-element malformed vector THROWS (never stores a misshaped vector)', async () => {
    // Length matches (2 for 2) so it does NOT fall back; instead each element is
    // validated and a wrong-length element must throw — the positional store would
    // otherwise persist a 3-dim vector against a chunk expecting 768.
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch(() => fakeRes({ json: { embeddings: [{ values: goodVec() }, { values: [1, 2, 3] }] } }));
    await assert.rejects(() => p.embedBatch(['a', 'b']), /embedBatch\[1\]: expected 768-dim array, got 3/);
  });

  test('batch element with null values THROWS with the element index', async () => {
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch(() => fakeRes({ json: { embeddings: [{ values: null }, { values: goodVec() }] } }));
    await assert.rejects(() => p.embedBatch(['a', 'b']), /embedBatch\[0\]/);
  });

  test('serial fallback that ALSO fails propagates the error (no silent empty result)', async () => {
    // If the batch fails AND a serial embed fails, the error must surface so the
    // queue marks the item for retry — it must NOT resolve with a short/empty array.
    const p = new GeminiEmbeddingProvider('K', 'gemini-embedding-2', DIMS);
    stubFetch((url, _init, idx) => {
      if (idx === 0) throw new Error('batch down');
      return fakeRes({ ok: false, status: 500, statusText: 'ISE' }); // serial also fails
    });
    await assert.rejects(() => p.embedBatch(['a', 'b']), /500|ISE/);
  });
});
