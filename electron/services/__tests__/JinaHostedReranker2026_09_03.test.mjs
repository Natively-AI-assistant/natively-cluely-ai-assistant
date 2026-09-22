/**
 * Jina AI as a hosted reranker provider.
 *
 * This exists for one model. jina-reranker-v3.5 CANNOT run locally: its GGUF
 * declares per-layer sliding-window attention that the bundled llama.cpp reads
 * and then discards (it reports n_swa = 0, so 17 of 28 layers would run with
 * the wrong mask), and no ONNX or OpenVINO build of v3.5 exists — the Hub's
 * base_model index lists exactly ONE derivative of jinaai/jina-reranker-v3.5,
 * the official GGUF. Jina's own API is the only way to actually use it.
 *
 * Schema below is from Jina's published OpenAPI spec, not guessed:
 *   POST https://api.jina.ai/v1/rerank
 *   RerankerV3Request { query, model: 'jina-reranker-v3'|'jina-reranker-v3.5',
 *                       documents, top_n?, return_documents?, max_doc_length? }
 *   RerankingResponse { model, object:'list', usage:{total_tokens},
 *                       results:[{ index, relevance_score, document?, embedding? }] }
 *
 * That is the same shape OpenRouter uses, which is why one client serves both.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

const { OpenRouterReranker } = require(path.join(repoRoot, 'dist-electron/electron/services/reranking/OpenRouterReranker.js'));
const { HOSTED_RERANK_PROVIDERS, hostedRerankProvider, defaultHostedModel } =
  require(path.join(repoRoot, 'dist-electron/electron/rag/hostedRerankProviders.js'));
const { evaluateHostedEligibility } = require(path.join(repoRoot, 'dist-electron/electron/services/reranking/rerankerConfig.js'));

function recordingFetch(body, status = 200) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init, body: init?.body ? JSON.parse(init.body) : undefined });
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
  };
  impl.calls = calls;
  return impl;
}

/** A real-shaped RerankingResponse for n documents, best-last on purpose. */
const jinaResponse = (n) => ({
  model: 'jina-reranker-v3.5',
  object: 'list',
  usage: { total_tokens: 412 },
  results: Array.from({ length: n }, (_, i) => ({
    index: n - 1 - i,
    relevance_score: 1 - i / n,
    document: `doc ${n - 1 - i}`,
  })),
});

describe('the provider table', () => {
  test('Jina is registered with its real endpoint', () => {
    const jina = hostedRerankProvider('jina');
    assert.ok(jina);
    assert.equal(jina.baseUrl, 'https://api.jina.ai/v1');
    assert.equal(jina.staticCatalogue, true, 'Jina publishes a fixed enum, there is nothing to discover');
  });

  test('v3.5 is offered and is the recommendation', () => {
    const jina = HOSTED_RERANK_PROVIDERS.jina;
    const ids = jina.models.map(m => m.id);
    assert.ok(ids.includes('jina-reranker-v3.5'), 'the model this provider exists for');
    assert.equal(defaultHostedModel('jina'), 'jina-reranker-v3.5');
    // Only ids Jina's OpenAPI spec actually accepts.
    for (const id of ids) assert.match(id, /^jina-(reranker|colbert)-/);
  });

  test('OpenRouter keeps live discovery rather than a frozen list', () => {
    assert.equal(HOSTED_RERANK_PROVIDERS.openrouter.staticCatalogue, false);
    assert.equal(HOSTED_RERANK_PROVIDERS.openrouter.models.length, 0);
  });

  test('an unknown provider id is refused rather than defaulted', () => {
    assert.equal(hostedRerankProvider('cohere'), null);
    assert.equal(hostedRerankProvider(undefined), null);
  });
});

describe('the request Jina actually documents', () => {
  test('it posts to api.jina.ai with the RerankerV3Request fields', async () => {
    const fetchImpl = recordingFetch(jinaResponse(3));
    const r = new OpenRouterReranker({
      baseUrl: 'https://api.jina.ai/v1',
      providerId: 'jina',
      getApiKey: () => 'jina_test_key',
      getModel: () => 'jina-reranker-v3.5',
      fetchImpl,
      sleep: async () => {},
    });
    await r.rerank('what is my kubernetes experience', ['a', 'b', 'c']);

    const call = fetchImpl.calls[0];
    assert.equal(call.url, 'https://api.jina.ai/v1/rerank');
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.headers.Authorization, 'Bearer jina_test_key');
    assert.deepEqual(call.body, {
      model: 'jina-reranker-v3.5',
      query: 'what is my kubernetes experience',
      documents: ['a', 'b', 'c'],
      top_n: 3,
    });
  });

  test('the key never reaches the URL or the body', async () => {
    const fetchImpl = recordingFetch(jinaResponse(2));
    await new OpenRouterReranker({
      baseUrl: 'https://api.jina.ai/v1', providerId: 'jina',
      getApiKey: () => 'jina_secret', getModel: () => 'jina-reranker-v3.5',
      fetchImpl, sleep: async () => {},
    }).rerank('q', ['a', 'b']);
    const call = fetchImpl.calls[0];
    assert.ok(!call.url.includes('jina_secret'));
    assert.ok(!String(call.init.body).includes('jina_secret'));
  });

  test('results map back by index, so a listwise reply stays aligned', async () => {
    const fetchImpl = recordingFetch(jinaResponse(4));
    const order = await new OpenRouterReranker({
      baseUrl: 'https://api.jina.ai/v1', providerId: 'jina',
      getApiKey: () => 'k', getModel: () => 'jina-reranker-v3.5',
      fetchImpl, sleep: async () => {},
    }).rerank('q', ['a', 'b', 'c', 'd']);
    assert.deepEqual(order.map(o => o.index), [3, 2, 1, 0]);
  });

  test('a Jina response carries total_tokens, not cost — and that is not faked', async () => {
    const stats = [];
    await new OpenRouterReranker({
      baseUrl: 'https://api.jina.ai/v1', providerId: 'jina',
      getApiKey: () => 'k', getModel: () => 'jina-reranker-v3.5',
      fetchImpl: recordingFetch(jinaResponse(2)), sleep: async () => {},
      onStats: s => stats.push(s),
    }).rerank('q', ['a', 'b']);
    assert.equal(stats[0].ok, true);
    // Jina bills by tokens and reports no per-call cost. Inventing one would be
    // a number the user could not reconcile with their bill.
    assert.equal(stats[0].costUsd, undefined);
  });
});

describe('eligibility treats Jina like any other hosted provider', () => {
  const base = { hasApiKey: true, model: 'jina-reranker-v3.5', localOnly: false, referenceFilesScopeAllowed: true };

  test('a configured Jina setup is eligible', () => {
    assert.equal(evaluateHostedEligibility({ ...base, provider: 'jina' }).eligible, true);
  });

  test('the privacy gate applies identically', () => {
    assert.equal(
      evaluateHostedEligibility({ ...base, provider: 'jina', referenceFilesScopeAllowed: false }).reason,
      'reference-files-scope-denied',
    );
    assert.equal(evaluateHostedEligibility({ ...base, provider: 'jina', localOnly: true }).reason, 'local-only-mode');
  });

  test('no key or no model is refused before any request', () => {
    assert.equal(evaluateHostedEligibility({ ...base, provider: 'jina', hasApiKey: false }).reason, 'no-api-key');
    assert.equal(evaluateHostedEligibility({ ...base, provider: 'jina', model: undefined }).reason, 'no-model');
  });

  test('local is still the default and is not hosted', () => {
    assert.equal(evaluateHostedEligibility({ ...base, provider: 'local' }).reason, 'provider-not-selected');
  });
});
