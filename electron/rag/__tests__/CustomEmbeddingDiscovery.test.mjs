// electron/rag/__tests__/CustomEmbeddingDiscovery.test.mjs
//
// Discovering which models a user-hosted OpenAI-compatible server can embed.
//
// LM Studio exposes a NATIVE GET /api/v1/models carrying type: 'llm' | 'embedding'
// — real capability data, so it is preferred. Plain OpenAI-compatible servers
// (llama.cpp, vLLM, TEI) only offer GET /v1/models, which has no type at all, so
// there every model is listed and the DIMENSION PROBE is the real gate: a model
// that cannot embed fails it and is rejected.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/customEmbeddingModels.js');
const { listCustomEmbeddingModels, probeCustomEmbeddingDimensions } = await import(pathToFileURL(modPath).href);

let server, origin, mode = 'lmstudio';

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

      if (req.url === '/api/v1/models') {
        if (mode !== 'lmstudio') return json(404, {});
        return json(200, { models: [
          { id: 'qwen3-8b', type: 'llm', architecture: 'qwen3' },
          { id: 'text-embedding-nomic-v2', type: 'embedding' },
          { id: 'bge-m3', type: 'embedding' },
        ] });
      }
      if (req.url === '/v1/models') {
        return json(200, { data: [{ id: 'qwen3-8b' }, { id: 'text-embedding-nomic-v2' }, { id: 'bge-m3' }] });
      }
      if (req.url === '/v1/embeddings') {
        const parsed = JSON.parse(body || '{}');
        const widths = { 'text-embedding-nomic-v2': 768, 'bge-m3': 1024 };
        const w = widths[parsed.model];
        if (!w) return json(400, { error: 'model does not support embeddings' });
        return json(200, { data: [{ index: 0, embedding: Array.from({ length: w }, () => 0.01) }] });
      }
      json(404, {});
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => { await new Promise(r => server.close(r)); });

describe('LM Studio (typed catalogue)', () => {
  test('returns only models the server reports as embedding models', async () => {
    mode = 'lmstudio';
    const found = (await listCustomEmbeddingModels(`${origin}/v1`)).map(m => m.id);
    assert.deepEqual(found.sort(), ['bge-m3', 'text-embedding-nomic-v2']);
  });

  test('excludes an LLM even though its name gives no hint', async () => {
    mode = 'lmstudio';
    const found = (await listCustomEmbeddingModels(`${origin}/v1`)).map(m => m.id);
    assert.ok(!found.includes('qwen3-8b'));
  });

  test('marks the list as capability-filtered so the UI can say so', async () => {
    mode = 'lmstudio';
    const models = await listCustomEmbeddingModels(`${origin}/v1`);
    assert.equal(models[0].capabilityKnown, true);
  });
});

describe('plain OpenAI-compatible server', () => {
  test('falls back to /v1/models and lists everything', async () => {
    // llama.cpp / vLLM report no type. Hiding models on a name guess would hide
    // working embedders; the dimension probe is the real gate.
    mode = 'openai-only';
    const found = (await listCustomEmbeddingModels(`${origin}/v1`)).map(m => m.id);
    assert.deepEqual(found.sort(), ['bge-m3', 'qwen3-8b', 'text-embedding-nomic-v2']);
  });

  test('flags that capability is unknown, so nothing is claimed that was not checked', async () => {
    mode = 'openai-only';
    const models = await listCustomEmbeddingModels(`${origin}/v1`);
    assert.equal(models[0].capabilityKnown, false);
  });
});

describe('reachability', () => {
  test('an unreachable endpoint yields an empty list rather than throwing', async () => {
    assert.deepEqual(await listCustomEmbeddingModels('http://127.0.0.1:1/v1'), []);
  });

  test('a blank endpoint yields an empty list', async () => {
    assert.deepEqual(await listCustomEmbeddingModels(''), []);
  });
});

describe('dimension probe', () => {
  test('measures the real width through the same endpoint embeddings use', async () => {
    assert.equal(await probeCustomEmbeddingDimensions(`${origin}/v1`, 'bge-m3'), 1024);
    assert.equal(await probeCustomEmbeddingDimensions(`${origin}/v1`, 'text-embedding-nomic-v2'), 768);
  });

  test('a non-embedding model returns null instead of a guessed width', async () => {
    assert.equal(await probeCustomEmbeddingDimensions(`${origin}/v1`, 'qwen3-8b'), null);
  });

  test('an unreachable endpoint returns null rather than throwing', async () => {
    assert.equal(await probeCustomEmbeddingDimensions('http://127.0.0.1:1/v1', 'x'), null);
  });

  test('a bare host is normalized before probing', async () => {
    // The user pastes what LM Studio's UI shows; it must still work.
    assert.equal(await probeCustomEmbeddingDimensions(origin, 'bge-m3'), 1024);
  });
});
