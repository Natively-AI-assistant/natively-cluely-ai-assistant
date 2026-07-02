// electron/rag/__tests__/GeminiKeyRotation.test.mjs
//
// Unit tests for the multi-key rotation + per-key 429 cooldown in
// GeminiEmbeddingProvider. Uses a stubbed global.fetch so no real network calls
// are made — this is plumbing/logic verification, not a live embedding test.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const provPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/providers/GeminiEmbeddingProvider.js');
const { GeminiEmbeddingProvider } = await import(pathToFileURL(provPath).href);

const DIMS = 768;
function fakeVector() { return Array.from({ length: DIMS }, () => 0.01); }

let realFetch;
beforeEach(() => { realFetch = global.fetch; });
afterEach(() => { global.fetch = realFetch; });

// Build a fetch stub that inspects the x-goog-api-key header and returns per-key
// behavior. `behavior` maps key → 'ok' | '429' | (call-count-aware fn).
function stubFetch(behavior, log) {
  return async (url, init) => {
    const key = init.headers['x-goog-api-key'];
    if (log) log.push(key);
    const b = typeof behavior[key] === 'function' ? behavior[key]() : behavior[key];
    if (b === '429') {
      return { ok: false, status: 429, statusText: 'Too Many Requests', text: async () => 'RESOURCE_EXHAUSTED' };
    }
    // single embedContent shape
    return { ok: true, status: 200, statusText: 'OK', json: async () => ({ embedding: { values: fakeVector() } }) };
  };
}

describe('GeminiEmbeddingProvider — key rotation', () => {
  test('single string key still works (backward compatible)', async () => {
    global.fetch = stubFetch({ k1: 'ok' });
    const p = new GeminiEmbeddingProvider('k1', 'gemini-embedding-2', DIMS);
    const v = await p.embed('hello');
    assert.equal(v.length, DIMS);
  });

  test('array of keys is accepted and de-duped', async () => {
    const log = [];
    global.fetch = stubFetch({ k1: 'ok', k2: 'ok' }, log);
    const p = new GeminiEmbeddingProvider(['k1', 'k1', 'k2', ''], 'gemini-embedding-2', DIMS);
    await p.embed('a');
    await p.embed('b');
    // round-robin: first call k1, second k2 (dedup dropped the duplicate k1 + blank)
    assert.deepEqual([...new Set(log)].sort(), ['k1', 'k2']);
  });

  test('429 on one key rotates to the next healthy key within the same call', async () => {
    const log = [];
    global.fetch = stubFetch({ k1: '429', k2: 'ok' }, log);
    const p = new GeminiEmbeddingProvider(['k1', 'k2'], 'gemini-embedding-2', DIMS);
    const v = await p.embed('x');
    assert.equal(v.length, DIMS, 'succeeds via the healthy key');
    assert.ok(log.includes('k1') && log.includes('k2'), 'tried the 429 key then rotated to the healthy one');
  });

  test('a rate-limited key is skipped (cooling) on subsequent calls', async () => {
    const log = [];
    global.fetch = stubFetch({ k1: '429', k2: 'ok' }, log);
    const p = new GeminiEmbeddingProvider(['k1', 'k2'], 'gemini-embedding-2', DIMS);
    await p.embed('first');   // k1 429 → cools → k2 ok
    log.length = 0;
    await p.embed('second');  // k1 is cooling → should go straight to k2
    assert.ok(!log.includes('k1'), 'cooling key k1 is skipped');
    assert.ok(log.includes('k2'), 'healthy key k2 used');
  });

  test('all keys 429 → throws (within bounded wait) rather than hanging', async () => {
    // Short cooldown/wait via env so the test is fast.
    process.env.NATIVELY_GEMINI_EMBED_COOLDOWN_MS = '50';
    process.env.NATIVELY_GEMINI_EMBED_MAX_WAIT_MS = '0'; // don't wait — fail fast
    // Re-import with fresh module state so the new env is read at module load.
    const mod = await import(pathToFileURL(provPath).href + `?t=${Date.now()}`);
    const P = mod.GeminiEmbeddingProvider;
    global.fetch = stubFetch({ k1: '429', k2: '429' });
    const p = new P(['k1', 'k2'], 'gemini-embedding-2', DIMS);
    await assert.rejects(() => p.embed('x'), /429|rate-limited/i);
    delete process.env.NATIVELY_GEMINI_EMBED_COOLDOWN_MS;
    delete process.env.NATIVELY_GEMINI_EMBED_MAX_WAIT_MS;
  });

  test('embedBatch rotates keys on a 429 sub-batch before serial fallback', async () => {
    const log = [];
    // batchEmbedContents returns the right shape; k1 429s, k2 succeeds.
    global.fetch = async (url, init) => {
      const key = init.headers['x-goog-api-key'];
      log.push(key);
      if (key === 'k1') return { ok: false, status: 429, statusText: 'Too Many Requests', text: async () => 'RESOURCE_EXHAUSTED' };
      const body = JSON.parse(init.body);
      const n = body.requests ? body.requests.length : 1;
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ embeddings: Array.from({ length: n }, () => ({ values: fakeVector() })) }) };
    };
    const p = new GeminiEmbeddingProvider(['k1', 'k2'], 'gemini-embedding-2', DIMS);
    const out = await p.embedBatch(['a', 'b', 'c']);
    assert.equal(out.length, 3);
    assert.ok(out.every((v) => v.length === DIMS));
    assert.ok(log.includes('k2'), 'rotated to healthy key for the batch');
  });
});
