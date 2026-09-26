// electron/rag/__tests__/OllamaDimsDiscoveryResolve.test.mjs
//
// resolve() must MEASURE a configured Ollama model's width when the cached value
// is missing. buildCandidates() correctly refuses to guess a width, but on its
// own that would mean a user who picks qwen3-embedding:8b gets no Ollama
// provider at all until something else happens to measure it.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/EmbeddingProviderResolver.js');
const { EmbeddingProviderResolver } = await import(pathToFileURL(modPath).href);

const WIDTHS = { 'qwen3-embedding:8b': 4096, 'nomic-embed-text': 768 };
let server, baseUrl, embedCalls = 0;

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.url === '/api/tags') {
        return json(200, { models: Object.keys(WIDTHS).map(name => ({ name })) });
      }
      if (req.url === '/api/embeddings') {
        embedCalls++;
        const w = WIDTHS[JSON.parse(body || '{}').model];
        if (!w) return json(400, { error: 'unsupported' });
        return json(200, { embedding: Array.from({ length: w }, () => 0.01) });
      }
      return json(404, {});
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => { await new Promise(r => server.close(r)); });

describe('resolve() dimension discovery', () => {
  test('a configured model with no cached width is measured, not skipped', async () => {
    const provider = await EmbeddingProviderResolver.resolve({
      ollamaUrl: baseUrl,
      ollamaEmbeddingModel: 'qwen3-embedding:8b',
    });
    assert.equal(provider.name, 'ollama');
    assert.equal(provider.dimensions, 4096, 'the width must be measured from a real embed call');
    assert.equal(provider.space, 'ollama:qwen3-embedding:8b:4096');
  });

  test('a cached width is trusted and costs no probe', async () => {
    const before = embedCalls;
    const provider = await EmbeddingProviderResolver.resolve({
      ollamaUrl: baseUrl,
      ollamaEmbeddingModel: 'qwen3-embedding:8b',
      ollamaEmbeddingDims: 4096,
    });
    assert.equal(provider.space, 'ollama:qwen3-embedding:8b:4096');
    // One probe is the availability check; a second would be a redundant
    // dimension probe on every launch for a width we already know.
    assert.ok(embedCalls - before <= 1, `expected at most one call, saw ${embedCalls - before}`);
  });

  test('an unmeasurable model leaves the width unset rather than inventing one', async () => {
    // Asserted on withMeasuredOllamaDims rather than resolve(): the terminal
    // branch of resolve() constructs LocalEmbeddingProvider, which needs the
    // Electron `app` object and cannot be built under the test runner. The
    // property that matters is observable here — no width is invented — and the
    // consequence (no Ollama candidate is offered) is covered by
    // OllamaEmbeddingDims.test.mjs.
    const out = await EmbeddingProviderResolver.withMeasuredOllamaDims({
      ollamaUrl: baseUrl,
      ollamaEmbeddingModel: 'not-an-embedder',
    });
    assert.equal(out.ollamaEmbeddingDims, undefined, 'an unmeasurable model must not receive a guessed width');

    const candidates = EmbeddingProviderResolver.buildCandidates(out).map(p => p.name);
    assert.ok(!candidates.includes('ollama'), 'and therefore must yield no Ollama candidate');
  });

  test('no configured model still resolves the historical default', async () => {
    const provider = await EmbeddingProviderResolver.resolve({ ollamaUrl: baseUrl });
    assert.equal(provider.space, 'ollama:nomic-embed-text:768');
  });
});
