// electron/services/__tests__/VoyageReranker2026_09_22.test.mjs
//
// Voyage AI as a hosted reranker. Voyage is NOT Cohere-shaped: it takes
// `top_k` (not `top_n`) and returns rows in `data` (not `results`). A table
// entry alone would typecheck and pass every source grep while every call read
// as malformed and retrieval silently kept the unreranked order — so these
// tests drive the REAL client over a stubbed fetch and assert on the wire.
//
// Run via: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test <file>

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron', p)).href;

const { OpenRouterReranker } = await import(dist('services/reranking/OpenRouterReranker.js'));
const { hostedRerankProvider, defaultHostedModel, HOSTED_RERANK_PROVIDERS } = await import(dist('rag/hostedRerankProviders.js'));
const { evaluateHostedEligibility, readHostedModel } = await import(dist('services/reranking/rerankerConfig.js'));

/** A fetch that records the request and answers with `payload`. */
function stubFetch(payload) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl };
}

const passages = ['cats sleep a lot', 'the quarterly report', 'dogs bark'];

describe('Voyage reranker wire format', () => {
  test('the descriptor exists, points at Voyage, and carries top_k/data', () => {
    const v = hostedRerankProvider('voyage');
    assert.ok(v, 'hostedRerankProvider must know voyage');
    assert.equal(v.baseUrl, 'https://api.voyageai.com/v1');
    assert.deepEqual(v.wire, { topField: 'top_k', resultsField: 'data' });
    assert.equal(defaultHostedModel('voyage'), 'rerank-2.5');
    assert.deepEqual(v.models.map((m) => m.id), ['rerank-2.5', 'rerank-2.5-lite']);
  });

  test('a Voyage call sends top_k (not top_n) to /rerank and reads the order from data', async () => {
    // Voyage's documented response: rows sorted by relevance, in `data`.
    const { calls, fetchImpl } = stubFetch({
      object: 'list',
      data: [
        { index: 2, relevance_score: 0.91 },
        { index: 0, relevance_score: 0.40 },
        { index: 1, relevance_score: 0.02 },
      ],
      model: 'rerank-2.5',
      usage: { total_tokens: 12 },
    });
    const v = hostedRerankProvider('voyage');
    const reranker = new OpenRouterReranker({
      baseUrl: v.baseUrl, providerId: 'voyage', wire: v.wire,
      getApiKey: () => 'pa-test', getModel: () => 'rerank-2.5', fetchImpl,
    });
    const { order } = await reranker.rerankOrThrow('which animal barks', passages);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.voyageai.com/v1/rerank');
    assert.equal(calls[0].body.top_k, passages.length);
    assert.equal('top_n' in calls[0].body, false, 'Voyage takes top_k; top_n is not part of its API');
    assert.equal(calls[0].body.model, 'rerank-2.5');
    assert.deepEqual(calls[0].body.documents, passages);
    assert.equal(calls[0].headers.Authorization, 'Bearer pa-test');
    assert.deepEqual(order.map((o) => o.index), [2, 0, 1], 'the order must come from `data`, not fall back');
  });

  test('without the wire override the same Voyage payload is malformed (proves the test is not vacuous)', async () => {
    const { fetchImpl } = stubFetch({ object: 'list', data: [{ index: 0, relevance_score: 1 }, { index: 1, relevance_score: 0.5 }, { index: 2, relevance_score: 0.1 }] });
    const reranker = new OpenRouterReranker({
      baseUrl: 'https://api.voyageai.com/v1', providerId: 'voyage',
      getApiKey: () => 'pa-test', getModel: () => 'rerank-2.5', fetchImpl,
    });
    await assert.rejects(reranker.rerankOrThrow('q', passages));
  });

  test('Cohere-shaped providers are unchanged: top_n in, results out', async () => {
    const { calls, fetchImpl } = stubFetch({
      results: [{ index: 1, relevance_score: 0.9 }, { index: 0, relevance_score: 0.5 }, { index: 2, relevance_score: 0.1 }],
    });
    const j = HOSTED_RERANK_PROVIDERS.jina;
    const reranker = new OpenRouterReranker({
      baseUrl: j.baseUrl, providerId: 'jina', wire: j.wire,
      getApiKey: () => 'jina_test', getModel: () => 'jina-reranker-v3.5', fetchImpl,
    });
    const { order } = await reranker.rerankOrThrow('q', passages);
    assert.equal(calls[0].body.top_n, passages.length);
    assert.equal('top_k' in calls[0].body, false);
    assert.deepEqual(order.map((o) => o.index), [1, 0, 2]);
  });
});

describe('Voyage in the reranker config', () => {
  test('eligible like any hosted provider, and blocked by the same privacy gates', () => {
    const base = { provider: 'voyage', hasApiKey: true, model: 'rerank-2.5', localOnly: false, referenceFilesScopeAllowed: true };
    assert.deepEqual(evaluateHostedEligibility(base), { eligible: true });
    assert.equal(evaluateHostedEligibility({ ...base, localOnly: true }).reason, 'local-only-mode');
    assert.equal(evaluateHostedEligibility({ ...base, referenceFilesScopeAllowed: false }).reason, 'reference-files-scope-denied');
    assert.equal(evaluateHostedEligibility({ ...base, hasApiKey: false }).reason, 'no-api-key');
  });

  test('an unset Voyage model means the recommended one, not no-model', () => {
    assert.equal(readHostedModel({ provider: 'voyage' }), 'rerank-2.5');
    assert.equal(readHostedModel({ provider: 'voyage', voyageModel: 'rerank-2.5-lite' }), 'rerank-2.5-lite');
  });
});
