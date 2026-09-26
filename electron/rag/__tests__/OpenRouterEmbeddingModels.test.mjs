// electron/rag/__tests__/OpenRouterEmbeddingModels.test.mjs
//
// Discovering OpenRouter's embedding models.
//
//   GET {base}/models?output_modalities=embeddings
//     -> {data: [{id, name, context_length, architecture:{output_modalities},
//                 pricing:{prompt}}]}
//
// The filter is applied SERVER-SIDE and needs no key (verified live 2026-08-31:
// 34 models). That matters twice: capability comes from OpenRouter rather than a
// name guess, and the catalogue can be populated before the user has added a key,
// so they can see what they would be buying.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/openrouterEmbeddingModels.js');
const { listOpenRouterEmbeddingModels, probeOpenRouterEmbeddingDimensions } = await import(pathToFileURL(modPath).href);

let server, base, lastUrl = null, lastAuth = null, lastBody = null;

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      lastUrl = req.url; lastAuth = req.headers.authorization ?? null;
      try { lastBody = body ? JSON.parse(body) : null; } catch { lastBody = null; }
      const json = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url.startsWith('/api/v1/models')) {
        return json(200, { data: [
          { id: 'voyageai/voyage-4-lite', name: 'VoyageAI: voyage-4-lite', context_length: 32000,
            architecture: { output_modalities: ['embeddings'] }, pricing: { prompt: '0.00000002' } },
          { id: 'nvidia/nemotron-3-embed-1b:free', name: 'NVIDIA: Nemotron Embed (free)', context_length: 32768,
            architecture: { output_modalities: ['embeddings'] }, pricing: { prompt: '0' } },
          // A chat model must never appear even if the server slips one in.
          { id: 'openai/gpt-5.4', name: 'GPT-5.4', architecture: { output_modalities: ['text'] }, pricing: { prompt: '0.000001' } },
        ] });
      }
      if (req.url === '/api/v1/embeddings') {
        const parsed = JSON.parse(body || '{}');
        const widths = { 'voyageai/voyage-4-lite': 1024, 'nvidia/nemotron-3-embed-1b:free': 2048 };
        const w = widths[parsed.model];
        if (!w) return json(400, { error: 'not an embedding model' });
        return json(200, { data: [{ index: 0, embedding: Array.from({ length: w }, () => 0.01) }] });
      }
      json(404, {});
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
after(async () => { await new Promise(r => server.close(r)); });

describe('listing', () => {
  test('asks OpenRouter to filter by output modality', async () => {
    await listOpenRouterEmbeddingModels({ baseUrl: base });
    assert.match(lastUrl, /output_modalities=embeddings/);
  });

  test('returns only embedding models', async () => {
    const ids = (await listOpenRouterEmbeddingModels({ baseUrl: base })).map(m => m.id);
    assert.deepEqual(ids.sort(), ['nvidia/nemotron-3-embed-1b:free', 'voyageai/voyage-4-lite']);
  });

  test('re-filters locally too, so a chat model can never slip through', async () => {
    // Defence in depth: the query param is the contract, but a wrong or ignored
    // filter would otherwise put a chat model in an embedding picker.
    const ids = (await listOpenRouterEmbeddingModels({ baseUrl: base })).map(m => m.id);
    assert.ok(!ids.includes('openai/gpt-5.4'));
  });

  test('works with NO key — the catalogue is public', async () => {
    lastAuth = null;
    const models = await listOpenRouterEmbeddingModels({ baseUrl: base });
    assert.ok(models.length > 0);
    assert.equal(lastAuth, null, 'must not require auth to browse');
  });

  test('sends the key when there is one, for per-account visibility', async () => {
    await listOpenRouterEmbeddingModels({ baseUrl: base, apiKey: 'sk-or-x' });
    assert.equal(lastAuth, 'Bearer sk-or-x');
  });

  test('keeps the full namespaced id, variant suffix included', async () => {
    const ids = (await listOpenRouterEmbeddingModels({ baseUrl: base })).map(m => m.id);
    assert.ok(ids.includes('nvidia/nemotron-3-embed-1b:free'));
  });

  test('carries price per million tokens, so cost is visible before choosing', async () => {
    const models = await listOpenRouterEmbeddingModels({ baseUrl: base });
    const voyage = models.find(m => m.id === 'voyageai/voyage-4-lite');
    // 0.00000002 $/token -> $0.02 per 1M.
    assert.equal(voyage.pricePerMillion, 0.02);
    assert.equal(models.find(m => m.id.endsWith(':free')).pricePerMillion, 0);
  });

  test('width is UNKNOWN until measured — the listing carries none', async () => {
    const models = await listOpenRouterEmbeddingModels({ baseUrl: base });
    for (const m of models) {
      assert.equal(m.dimensions, 0);
      assert.equal(m.dimensionsVerified, false);
    }
  });

  test('an unreachable OpenRouter yields an empty list, not a throw', async () => {
    assert.deepEqual(await listOpenRouterEmbeddingModels({ baseUrl: 'http://127.0.0.1:1/api/v1' }), []);
  });
});

describe('dimension probe', () => {
  test('measures the real width through the embeddings endpoint', async () => {
    assert.equal(await probeOpenRouterEmbeddingDimensions('voyageai/voyage-4-lite', 'k', base), 1024);
    assert.equal(await probeOpenRouterEmbeddingDimensions('nvidia/nemotron-3-embed-1b:free', 'k', base), 2048);
  });

  test('a non-embedding model returns null rather than a guessed width', async () => {
    assert.equal(await probeOpenRouterEmbeddingDimensions('openai/gpt-5.4', 'k', base), null);
  });

  test('no key returns null rather than an unauthenticated call', async () => {
    assert.equal(await probeOpenRouterEmbeddingDimensions('voyageai/voyage-4-lite', '', base), null);
  });
});

describe('selectable widths are DERIVED, never invented', () => {
  test('voyageai/* gets Voyage\'s documented widths', async () => {
    const models = await listOpenRouterEmbeddingModels({ baseUrl: base });
    const v = models.find(m => m.id === 'voyageai/voyage-4-lite');
    assert.deepEqual(v.supportedDimensions, [256, 512, 1024, 2048]);
  });

  test('an unrecognised model gets NO width choice', async () => {
    // OpenRouter's listing carries no dimension data. Offering options for a
    // model whose docs we have not read would be inventing a capability, and the
    // request would just be ignored or rejected upstream.
    const models = await listOpenRouterEmbeddingModels({ baseUrl: base });
    const n = models.find(m => m.id === 'nvidia/nemotron-3-embed-1b:free');
    assert.equal(n.supportedDimensions, undefined);
  });
});

describe('the probe can request a width', () => {
  test('a requested width reaches the request body', async () => {
    // Whether the upstream model honours it is the model's business; the
    // RETURNED length is still the truth, which is why set-config compares them.
    lastBody = null;
    await probeOpenRouterEmbeddingDimensions('voyageai/voyage-4-lite', 'k', base, 512);
    assert.equal(lastBody?.dimensions, 512);
  });

  test('no width requested means no dimensions field', async () => {
    lastBody = null;
    await probeOpenRouterEmbeddingDimensions('voyageai/voyage-4-lite', 'k', base);
    assert.equal('dimensions' in (lastBody || {}), false);
  });
});
