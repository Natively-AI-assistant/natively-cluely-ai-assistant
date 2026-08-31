// electron/rag/__tests__/OllamaEmbeddingModels.test.mjs
//
// Discovering which local Ollama models can embed, and at what dimensionality.
//
// WHY DIMENSIONS MUST BE MEASURED, NOT DECLARED:
// OllamaEmbeddingProvider hard-coded `dimensions = 768` (nomic-embed-text) while
// accepting any model name. Selecting qwen3-embedding:8b (4096d) would therefore
// stamp an embedding_space key claiming 768 dimensions over 4096-dimensional
// vectors — a silently uncomparable index, which is the exact failure
// embeddingSpace.ts exists to prevent.
//
// model_info['<arch>.embedding_length'] is the model's HIDDEN SIZE and is only
// usually the output width (pooling/projection/Matryoshka truncation can差). The
// authoritative number is the length of a vector returned by the SAME request the
// provider will really make, so the probe uses that exact call path.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/ollamaEmbeddingModels.js');
const { listOllamaEmbeddingModels, probeOllamaEmbeddingDimensions } = await import(pathToFileURL(modPath).href);

// Capability + width fixtures for the stub.
const MODELS = {
  'qwen3-embedding:8b':  { capabilities: ['embedding'], arch: 'qwen3',  hidden: 4096, real: 4096 },
  'nomic-embed-text':    { capabilities: ['embedding'], arch: 'nomic',  hidden: 768,  real: 768 },
  'all-minilm:latest':   { capabilities: ['embedding'], arch: 'bert',   hidden: 384,  real: 384 },
  'qwen3:30b':           { capabilities: ['completion', 'tools'], arch: 'qwen3', hidden: 5120, real: 0 },
  'llava:latest':        { capabilities: ['completion', 'vision'], arch: 'llama', hidden: 4096, real: 0 },
  // Older Ollama builds omit `capabilities` entirely.
  'legacy-embedder':     { arch: 'bert', hidden: 512, real: 512 },
  // Hidden size deliberately DIFFERENT from the real output width.
  'projected-embedder':  { capabilities: ['embedding'], arch: 'bert', hidden: 1024, real: 256 },
};

let server, baseUrl, tagsPayload;

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.url === '/api/tags') return json(200, tagsPayload);
      const parsed = JSON.parse(body || '{}');
      if (req.url === '/api/show') {
        const m = MODELS[parsed.model];
        if (!m) return json(404, { error: 'not found' });
        const info = { 'general.architecture': m.arch, [`${m.arch}.embedding_length`]: m.hidden };
        return json(200, { model_info: info, ...(m.capabilities ? { capabilities: m.capabilities } : {}) });
      }
      if (req.url === '/api/embeddings') {
        const m = MODELS[parsed.model];
        if (!m || !m.real) return json(400, { error: 'does not support embeddings' });
        return json(200, { embedding: Array.from({ length: m.real }, () => 0.01) });
      }
      return json(404, { error: 'unknown route' });
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  tagsPayload = { models: Object.keys(MODELS).map(name => ({ name })) };
});

after(async () => { await new Promise(r => server.close(r)); });

describe('listOllamaEmbeddingModels', () => {
  test('returns only models whose capabilities include embedding', async () => {
    const found = (await listOllamaEmbeddingModels(baseUrl)).map(m => m.name);
    assert.ok(found.includes('qwen3-embedding:8b'));
    assert.ok(found.includes('nomic-embed-text'));
    assert.ok(found.includes('all-minilm:latest'));
  });

  test('excludes generation and vision models rather than guessing from the name', async () => {
    // The user's requirement: use the capability data the API exposes, not a
    // name heuristic. 'qwen3:30b' and 'qwen3-embedding:8b' share a name prefix.
    const found = (await listOllamaEmbeddingModels(baseUrl)).map(m => m.name);
    assert.ok(!found.includes('qwen3:30b'));
    assert.ok(!found.includes('llava:latest'));
  });

  test('a model with no capabilities field is still offered, not silently dropped', async () => {
    // Older Ollama builds omit `capabilities`. Dropping those would hide a
    // perfectly good embedder on any slightly older daemon.
    const found = (await listOllamaEmbeddingModels(baseUrl)).map(m => m.name);
    assert.ok(found.includes('legacy-embedder'), 'a capability-less model must remain selectable');
  });

  test('reports the declared width as a HINT, flagged as unverified', async () => {
    const qwen = (await listOllamaEmbeddingModels(baseUrl)).find(m => m.name === 'qwen3-embedding:8b');
    assert.equal(qwen.dimensionsHint, 4096);
    assert.equal(qwen.dimensionsVerified, false, 'a declared width must never be presented as measured');
  });

  test('an unreachable daemon yields an empty list rather than throwing', async () => {
    assert.deepEqual(await listOllamaEmbeddingModels('http://127.0.0.1:1'), []);
  });
});

describe('probeOllamaEmbeddingDimensions', () => {
  test('measures the real vector width for a large embedding model', async () => {
    assert.equal(await probeOllamaEmbeddingDimensions(baseUrl, 'qwen3-embedding:8b'), 4096);
  });

  test('measures 768 for nomic-embed-text, matching the historical default', async () => {
    assert.equal(await probeOllamaEmbeddingDimensions(baseUrl, 'nomic-embed-text'), 768);
  });

  test('the MEASURED width wins over the declared hidden size', async () => {
    // projected-embedder declares 1024 but really returns 256. Trusting the
    // declaration would stamp a 1024-d space over 256-d vectors.
    const listed = (await listOllamaEmbeddingModels(baseUrl)).find(m => m.name === 'projected-embedder');
    assert.equal(listed.dimensionsHint, 1024, 'the hint reflects what the model declares');
    assert.equal(await probeOllamaEmbeddingDimensions(baseUrl, 'projected-embedder'), 256, 'the probe reflects reality');
  });

  test('a non-embedding model returns null instead of a bogus width', async () => {
    assert.equal(await probeOllamaEmbeddingDimensions(baseUrl, 'qwen3:30b'), null);
  });

  test('an unreachable daemon returns null rather than throwing', async () => {
    assert.equal(await probeOllamaEmbeddingDimensions('http://127.0.0.1:1', 'nomic-embed-text'), null);
  });
});
