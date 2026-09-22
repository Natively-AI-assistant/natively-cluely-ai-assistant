// The local-test header reaches /v1/embed and /v1/rerank under the SAME gate chat
// uses, and never leaves for a third party (2026-09-19).
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { e2eLocalTestHeader, e2eLocalTestHeaderFor } = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/rag/e2eLocalTest.js')).href);
const { NativelyEmbeddingProvider } = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/rag/providers/NativelyEmbeddingProvider.js')).href);
const KEYS = ['NATIVELY_E2E', 'NATIVELY_E2E_LOCAL_TEST_TOKEN', 'NATIVELY_API_URL'];
afterEach(() => { for (const k of KEYS) delete process.env[k]; });

describe('gate', () => {
  test('inert without NATIVELY_E2E=1, and without a token', () => {
    process.env.NATIVELY_E2E_LOCAL_TEST_TOKEN = 'tok-12345678';
    assert.deepEqual(e2eLocalTestHeader(), {});
    process.env.NATIVELY_E2E = '1'; delete process.env.NATIVELY_E2E_LOCAL_TEST_TOKEN;
    assert.deepEqual(e2eLocalTestHeader(), {});
  });
  test('both set → the header', () => {
    process.env.NATIVELY_E2E = '1'; process.env.NATIVELY_E2E_LOCAL_TEST_TOKEN = 'tok-12345678';
    assert.deepEqual(e2eLocalTestHeader(), { 'x-natively-local-test': 'tok-12345678' });
  });
  test('only for the natively API — never OpenRouter, Jina or Voyage', () => {
    process.env.NATIVELY_E2E = '1'; process.env.NATIVELY_E2E_LOCAL_TEST_TOKEN = 'tok-12345678'; process.env.NATIVELY_API_URL = 'http://127.0.0.1:8791';
    assert.deepEqual(e2eLocalTestHeaderFor('http://127.0.0.1:8791/v1'), { 'x-natively-local-test': 'tok-12345678' });
    for (const u of ['https://openrouter.ai/api/v1', 'https://api.jina.ai/v1', 'https://api.voyageai.com/v1', 'https://api.natively.software/v1']) assert.deepEqual(e2eLocalTestHeaderFor(u), {}, u);
    // ORIGIN equality, not a prefix (review finding): each of these STARTS WITH the base URL.
    for (const u of ['http://127.0.0.1:8791.evil.com/v1', 'http://127.0.0.1:87910/v1', 'http://127.0.0.1:8791@evil.com/v1', 'not a url']) assert.deepEqual(e2eLocalTestHeaderFor(u), {}, u);
  });
});

describe('NativelyEmbeddingProvider sends it on /v1/embed', () => {
  const capture = async () => {
    let seen = null; const orig = globalThis.fetch;
    globalThis.fetch = async (url, init) => { seen = { url: String(url), headers: init.headers }; return new Response(JSON.stringify({ embedding: new Array(2048).fill(0.01), model: 'voyage-4' }), { status: 200, headers: { 'content-type': 'application/json' } }); };
    try { const p = new NativelyEmbeddingProvider('natively_sk_' + '1'.repeat(40)); await p.embed('hello').catch(() => null); } finally { globalThis.fetch = orig; }
    return seen;
  };
  test('gate on + local base URL → header present, to the local server', async () => {
    process.env.NATIVELY_E2E = '1'; process.env.NATIVELY_E2E_LOCAL_TEST_TOKEN = 'tok-12345678'; process.env.NATIVELY_API_URL = 'http://127.0.0.1:8791';
    const seen = await capture();
    assert.ok(seen.url.startsWith('http://127.0.0.1:8791/v1/embed'), seen.url);
    assert.equal(seen.headers['x-natively-local-test'], 'tok-12345678');
  });
  test('gate off → no header (a shipped app never sends it)', async () => {
    const seen = await capture();
    assert.equal(seen.headers['x-natively-local-test'], undefined);
  });
});
