// electron/rag/__tests__/EmbeddingDimensions.test.mjs
//
// Output width is user-selectable where the provider documents it, and it is
// part of the EMBEDDING SPACE — so a width change is a re-index, exactly like a
// model change.
//
// Documented support (fetched 2026-08-29):
//   gemini-embedding-2 / -001  outputDimensionality 768 / 1536 / 3072
//                              (001 accepts 128-3072); omitting it returns 3072.
//   text-embedding-3-small     `dimensions` param, default 1536
//   text-embedding-3-large     `dimensions` param, default 3072
//   text-embedding-ada-002     FIXED 1536 — no `dimensions` param at all.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const load = p => import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/rag', p)).href);
const { OpenAIEmbeddingProvider } = await load('providers/OpenAIEmbeddingProvider.js');
const { GeminiEmbeddingProvider } = await load('providers/GeminiEmbeddingProvider.js');
const { NativelyEmbeddingProvider } = await load('providers/NativelyEmbeddingProvider.js');
const { buildEmbeddingCatalog } = await load('embeddingCatalog.js');

describe('defaults', () => {
  test('Gemini defaults to 3072 — the model\'s own default, not a truncation', () => {
    const p = new GeminiEmbeddingProvider(['k']);
    assert.equal(p.dimensions, 3072);
    assert.equal(p.space, 'gemini:gemini-embedding-2:3072');
  });

  test('Natively-managed defaults to 3072, matching what the server now requests', () => {
    const p = new NativelyEmbeddingProvider('nk', {});
    assert.equal(p.dimensions, 3072);
    assert.equal(p.space, 'natively:gemini-embedding-2:3072');
  });

  test('the catalogue advertises the same defaults the providers use', () => {
    const cat = buildEmbeddingCatalog({ hasGeminiKey: true, hasOpenaiKey: true, hasNativelyKey: true });
    const gem = cat.find(p => p.id === 'gemini').models.find(m => m.id === 'gemini-embedding-2');
    assert.equal(gem.dimensions, 3072);
    const nat = cat.find(p => p.id === 'natively').models[0];
    assert.equal(nat.dimensions, 3072);
  });
});

describe('selectable widths', () => {
  test('Gemini offers the three documented widths', () => {
    const cat = buildEmbeddingCatalog({ hasGeminiKey: true, hasOpenaiKey: true, hasNativelyKey: true });
    const gem = cat.find(p => p.id === 'gemini').models.find(m => m.id === 'gemini-embedding-2');
    assert.deepEqual(gem.supportedDimensions, [768, 1536, 3072]);
  });

  test('ada-002 offers NO width choice — it is fixed at 1536', () => {
    const cat = buildEmbeddingCatalog({ hasGeminiKey: true, hasOpenaiKey: true, hasNativelyKey: true });
    const ada = cat.find(p => p.id === 'openai').models.find(m => m.id === 'text-embedding-ada-002');
    assert.equal(ada.supportedDimensions, undefined);
    assert.equal(ada.dimensions, 1536);
  });

  test('a model\'s default width is one of its own supported widths', () => {
    for (const p of buildEmbeddingCatalog({ hasGeminiKey: true, hasOpenaiKey: true, hasNativelyKey: true })) {
      for (const m of p.models) {
        if (!m.supportedDimensions) continue;
        assert.ok(m.supportedDimensions.includes(m.dimensions),
          `${p.id}/${m.id} defaults to ${m.dimensions}, which is not in ${m.supportedDimensions}`);
      }
    }
  });

  test('every offered width has a vec table or can get one', () => {
    // KNOWN_DIMS is [768, 1536, 3072] and storeEmbedding lazily provisions any
    // novel width, so this is about not offering something absurd.
    for (const p of buildEmbeddingCatalog({ hasGeminiKey: true, hasOpenaiKey: true, hasNativelyKey: true })) {
      for (const m of p.models) {
        for (const d of m.supportedDimensions ?? [m.dimensions]) {
          assert.ok(Number.isInteger(d) && d > 0 && d <= 4096, `${m.id}: implausible width ${d}`);
        }
      }
    }
  });
});

describe('the width reaches the wire', () => {
  let server, origin, requests = [];

  before(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        const parsed = body ? JSON.parse(body) : {};
        requests.push({ url: req.url, body: parsed });
        const n = parsed.dimensions || 1536;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ index: 0, embedding: Array.from({ length: n }, () => 0.01) }] }));
      });
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    origin = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { await new Promise(r => server.close(r)); });

  test('OpenAI sends the `dimensions` parameter for a 3-series model', async () => {
    requests = [];
    const p = new OpenAIEmbeddingProvider('sk-test', 'text-embedding-3-large', 1024, `${origin}/v1`);
    const v = await p.embed('hello');
    assert.equal(requests[0].body.dimensions, 1024);
    assert.equal(v.length, 1024);
  });

  test('OpenAI does NOT send `dimensions` for ada-002, which rejects it', async () => {
    requests = [];
    const p = new OpenAIEmbeddingProvider('sk-test', 'text-embedding-ada-002', 1536, `${origin}/v1`);
    await p.embed('hello');
    assert.equal('dimensions' in requests[0].body, false);
  });

  test('the OpenAI space carries the chosen width', () => {
    const a = new OpenAIEmbeddingProvider('k', 'text-embedding-3-large', 3072);
    const b = new OpenAIEmbeddingProvider('k', 'text-embedding-3-large', 1024);
    assert.equal(a.space, 'openai:text-embedding-3-large:3072');
    assert.notEqual(a.space, b.space, 'a width change must be a different space');
  });

  test('the Gemini space carries the chosen width', () => {
    const a = new GeminiEmbeddingProvider(['k'], 'gemini-embedding-2', 768);
    const b = new GeminiEmbeddingProvider(['k'], 'gemini-embedding-2', 3072);
    assert.notEqual(a.space, b.space);
  });
});
