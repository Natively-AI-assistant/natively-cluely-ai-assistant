/**
 * Discovery of OpenRouter's rerank-capable models.
 *
 * Shape confirmed live on 2026-09-01:
 *   GET /models?output_modalities=rerank  ->  { data: [ { id, name, context_length,
 *        architecture: { input_modalities, output_modalities }, pricing } ] }
 * The filter is applied server-side and needs no key; that run returned 7 models.
 *
 * The one thing this file must NOT do is publish a price. Every rerank model
 * comes back with pricing {prompt:"0", completion:"0"} — including the paid
 * VoyageAI ones — so rendering it would show "free" for a model that bills.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

const { listOpenRouterRerankModels, defaultRerankModel } =
  require(path.join(repoRoot, 'dist-electron/electron/rag/openrouterRerankModels.js'));

/** The real 2026-09-01 payload, trimmed to the fields this code reads. */
const LIVE_SHAPE = {
  data: [
    { id: 'qwen/qwen3-reranker-8b', name: 'Qwen: Qwen3 Reranker 8B', context_length: 40960,
      architecture: { input_modalities: ['text'], output_modalities: ['rerank'] }, pricing: { prompt: '0', completion: '0' } },
    { id: 'voyageai/rerank-2.5-lite', name: 'VoyageAI by MongoDB: rerank-2.5-lite', context_length: 32000,
      architecture: { input_modalities: ['text'], output_modalities: ['rerank'] }, pricing: { prompt: '0', completion: '0' } },
    { id: 'voyageai/rerank-2.5', name: 'VoyageAI by MongoDB: rerank-2.5', context_length: 32000,
      architecture: { input_modalities: ['text'], output_modalities: ['rerank'] }, pricing: { prompt: '0', completion: '0' } },
    { id: 'nvidia/llama-nemotron-rerank-vl-1b-v2:free', name: 'NVIDIA: Nemotron Rerank VL 1B V2', context_length: 10240,
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['rerank'] }, pricing: { prompt: '0', completion: '0' } },
    { id: 'cohere/rerank-4-pro', name: 'Cohere: Rerank 4 Pro', context_length: 32768,
      architecture: { input_modalities: ['text'], output_modalities: ['rerank'] }, pricing: { prompt: '0', completion: '0' } },
    { id: 'cohere/rerank-4-fast', name: 'Cohere: Rerank 4 Fast', context_length: 32768,
      architecture: { input_modalities: ['text'], output_modalities: ['rerank'] }, pricing: { prompt: '0', completion: '0' } },
    { id: 'cohere/rerank-v3.5', name: 'Cohere: Rerank v3.5', context_length: 4096,
      architecture: { input_modalities: ['text'], output_modalities: ['rerank'] }, pricing: { prompt: '0', completion: '0' } },
    // A chat model, to prove the client does not trust the query param alone.
    { id: 'openai/gpt-5.4', name: 'GPT-5.4', context_length: 400000,
      architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '0.000001' } },
  ],
};

function stubFetch(body, status = 200) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  impl.calls = calls;
  return impl;
}

test('discovery uses the server-side rerank filter and needs no key', async () => {
  const fetchImpl = stubFetch(LIVE_SHAPE);
  const models = await listOpenRouterRerankModels({ fetchImpl });
  assert.match(fetchImpl.calls[0], /output_modalities=rerank/);
  assert.ok(models.length > 0);
});

test('non-rerank models are excluded even if the filter is ignored', async () => {
  const models = await listOpenRouterRerankModels({ fetchImpl: stubFetch(LIVE_SHAPE) });
  assert.ok(!models.some((m) => m.id === 'openai/gpt-5.4'),
    'a chat model in a rerank picker fails only at answer time — filter it here');
  assert.equal(models.length, 7, 'the 2026-09-01 catalogue is 7 rerank models');
});

test('no price is published, because OpenRouter does not publish one', async () => {
  const models = await listOpenRouterRerankModels({ fetchImpl: stubFetch(LIVE_SHAPE) });
  const voyage = models.find((m) => m.id === 'voyageai/rerank-2.5');
  // pricing.prompt is "0" for this PAID model. Surfacing it would read as free.
  assert.ok(!('pricePerMillion' in voyage), 'must not carry a price field');
  assert.ok(!/\$/.test(voyage.note ?? ''), `note must not claim a price, got ${voyage.note}`);
  assert.ok(!/free/i.test(voyage.note ?? ''), 'a paid model must never be labelled free');
});

test('only OpenRouter\'s own :free marker labels a model free', async () => {
  const models = await listOpenRouterRerankModels({ fetchImpl: stubFetch(LIVE_SHAPE) });
  assert.equal(models.filter((m) => m.free).length, 1);
  assert.equal(models.find((m) => m.free).id, 'nvidia/llama-nemotron-rerank-vl-1b-v2:free');
});

test('multimodal is read from input_modalities, not from the name', async () => {
  const models = await listOpenRouterRerankModels({ fetchImpl: stubFetch(LIVE_SHAPE) });
  const multimodal = models.filter((m) => m.multimodal);
  assert.deepEqual(multimodal.map((m) => m.id), ['nvidia/llama-nemotron-rerank-vl-1b-v2:free']);
  assert.equal(multimodal[0].group, 'multimodal');
});

test('the recommendation is the measured one, not the popular one', async () => {
  const models = await listOpenRouterRerankModels({ fetchImpl: stubFetch(LIVE_SHAPE) });
  const recommended = models.filter((m) => m.group === 'recommended');
  assert.equal(recommended.length, 1, 'exactly one recommendation');
  // 0.864 MRR at 868ms p95 on the 2026-08-31 run — high quality inside the
  // 1200ms live-path budget, and the cheaper of the two that clear it.
  assert.equal(recommended[0].id, 'voyageai/rerank-2.5-lite');
});

test('an unreachable OpenRouter is an empty catalogue, never a throw', async () => {
  assert.deepEqual(await listOpenRouterRerankModels({ fetchImpl: async () => { throw new Error('offline'); } }), []);
  assert.deepEqual(await listOpenRouterRerankModels({ fetchImpl: stubFetch({}, 500) }), []);
  assert.deepEqual(await listOpenRouterRerankModels({ fetchImpl: stubFetch({ data: 'nonsense' }) }), []);
});

test('no default model is invented when the catalogue is empty', () => {
  // The original brief recommended qwen/qwen3-reranker-0.6b and -4b. Neither
  // exists on OpenRouter (verified 2026-09-01). A hard-coded default is exactly
  // how that ships as a 404 on the answer path.
  assert.equal(defaultRerankModel([]), null);
});

test('the default comes from the live catalogue', async () => {
  const models = await listOpenRouterRerankModels({ fetchImpl: stubFetch(LIVE_SHAPE) });
  assert.equal(defaultRerankModel(models), 'voyageai/rerank-2.5-lite');
});
