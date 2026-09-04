// electron/rag/__tests__/EmbeddingModelFetch.test.mjs
//
// Live discovery of a cloud provider's embedding models, mirroring what the AI
// Providers card does for chat models — same endpoints, inverted filters.
//
//   OpenAI  GET /v1/models            -> {data:[{id}]}; no capability field, so
//                                        embedders are identified by id prefix.
//   Gemini  GET /v1beta/models?key=   -> {models:[{name, displayName,
//                                        supportedGenerationMethods}]}. The
//                                        chat fetch in electron/utils/modelFetcher.ts
//                                        already reads that field for
//                                        'generateContent'; embedders are the
//                                        models offering 'embedContent'.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/embeddingModelFetch.js');
const { fetchEmbeddingModels } = await import(pathToFileURL(modPath).href);

let server, origin, lastAuth = null, lastUrl = null;

before(async () => {
  server = createServer((req, res) => {
    lastAuth = req.headers.authorization ?? null;
    lastUrl = req.url;
    const json = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url.startsWith('/v1/models')) {
      return json(200, { data: [
        { id: 'gpt-5.1' },
        { id: 'text-embedding-3-small' },
        { id: 'text-embedding-3-large' },
        { id: 'text-embedding-ada-002' },
        { id: 'whisper-1' },
      ] });
    }
    if (req.url.startsWith('/v1beta/models')) {
      return json(200, { models: [
        { name: 'models/gemini-3.7-flash', displayName: 'Gemini 3.7 Flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-embedding-2', displayName: 'Gemini Embedding 2', supportedGenerationMethods: ['embedContent', 'batchEmbedContents'] },
        { name: 'models/gemini-embedding-001', displayName: 'Gemini Embedding 001', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/aqa', displayName: 'AQA', supportedGenerationMethods: ['generateAnswer'] },
      ] });
    }
    json(404, {});
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(r => server.close(r)); });

describe('OpenAI', () => {
  test('returns only embedding models, not chat or audio', async () => {
    const ids = (await fetchEmbeddingModels('openai', 'sk-test', { baseUrl: origin })).map(m => m.id);
    assert.deepEqual(ids.sort(), ['text-embedding-3-large', 'text-embedding-3-small', 'text-embedding-ada-002']);
  });

  test('authenticates with a bearer token', async () => {
    await fetchEmbeddingModels('openai', 'sk-test', { baseUrl: origin });
    assert.equal(lastAuth, 'Bearer sk-test');
  });

  test('carries the documented default width and selectable widths', async () => {
    const models = await fetchEmbeddingModels('openai', 'sk-test', { baseUrl: origin });
    const large = models.find(m => m.id === 'text-embedding-3-large');
    assert.equal(large.dimensions, 3072);
    assert.deepEqual(large.supportedDimensions, [256, 1024, 3072]);
    // ada-002 rejects the dimensions parameter, so it must offer no choice.
    assert.equal(models.find(m => m.id === 'text-embedding-ada-002').supportedDimensions, undefined);
  });

  test('an unknown embedder still appears, with no invented width', async () => {
    // A newly released text-embedding-* the app has never heard of must not be
    // hidden; the width is simply unknown until it is measured.
    const models = await fetchEmbeddingModels('openai', 'sk-test', {
      baseUrl: origin,
      _testExtra: [{ id: 'text-embedding-4-mega' }],
    });
    const m = models.find(x => x.id === 'text-embedding-4-mega');
    assert.ok(m, 'a new embedder must still be listed');
    assert.equal(m.dimensionsVerified, false);
  });
});

describe('Gemini', () => {
  test("filters on the API's own capability field, not on the name", async () => {
    const ids = (await fetchEmbeddingModels('gemini', 'k', { baseUrl: origin })).map(m => m.id);
    assert.deepEqual(ids.sort(), ['gemini-embedding-001', 'gemini-embedding-2']);
  });

  test('excludes chat and answer models even though they are listed', async () => {
    const ids = (await fetchEmbeddingModels('gemini', 'k', { baseUrl: origin })).map(m => m.id);
    assert.ok(!ids.includes('gemini-3.7-flash'));
    assert.ok(!ids.includes('aqa'));
  });

  test('strips the models/ prefix so ids match what embedContent takes', async () => {
    const models = await fetchEmbeddingModels('gemini', 'k', { baseUrl: origin });
    for (const m of models) assert.ok(!m.id.startsWith('models/'), m.id);
  });

  test('the key goes in the query string, as that API requires', async () => {
    await fetchEmbeddingModels('gemini', 'secret-key', { baseUrl: origin });
    assert.match(lastUrl, /key=secret-key/);
  });
});

describe('failure', () => {
  test('no key yields an empty list rather than an unauthenticated call', async () => {
    lastUrl = null;
    assert.deepEqual(await fetchEmbeddingModels('openai', '', { baseUrl: origin }), []);
    assert.equal(lastUrl, null, 'must not call the API without a key');
  });

  test('an unreachable provider yields an empty list rather than throwing', async () => {
    assert.deepEqual(await fetchEmbeddingModels('openai', 'sk', { baseUrl: 'http://127.0.0.1:1' }), []);
  });

  test('a provider with no discovery API yields an empty list', async () => {
    // Natively pins its model server-side; Ollama and custom have their own
    // discovery paths.
    assert.deepEqual(await fetchEmbeddingModels('natively', 'k', { baseUrl: origin }), []);
  });
});
