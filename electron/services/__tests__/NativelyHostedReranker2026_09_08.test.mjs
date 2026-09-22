/**
 * Natively as a hosted reranker provider — the managed rerank-2.5-lite served by
 * natively-api's POST /v1/rerank.
 *
 * WHY THIS FILE EXISTS
 *
 * Every other hosted provider here is bring-your-own-key. This one is not: it
 * runs on the Natively API key the user already has and bills against their
 * plan's Knowledge allowance. That difference touches four separate branches
 * (descriptor lookup, key reader, model reader, eligibility) and ANY one of them
 * returning null makes the provider silently ineligible — which presents as
 * "reranking just doesn't happen", with no error and nothing in a log. That is
 * the same non-symptom the local-only gate produces, so it is not something a
 * user would ever report accurately.
 *
 * It is a table entry rather than a second client because natively-api speaks
 * the same Cohere-shaped contract as OpenRouter and Jina:
 *   POST {base}/rerank { model, query, documents, top_n }
 *     -> { results: [{ index, relevance_score }], model, tokens }
 * and getKey() on the server already accepts `Authorization: Bearer <key>`,
 * which is exactly what the shared client sends.
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
const { evaluateHostedEligibility, readHostedModel, describeIneligibility } =
  require(path.join(repoRoot, 'dist-electron/electron/services/reranking/rerankerConfig.js'));

describe('the Natively descriptor', () => {
  test('is registered and resolvable by id', () => {
    // hostedRerankProvider() is an explicit allow-list. A provider missing from
    // it returns null, buildHostedRerankPort() bails, and no rerank happens.
    const p = hostedRerankProvider('natively');
    assert.ok(p, 'natively must resolve');
    assert.equal(p.id, 'natively');
    assert.equal(HOSTED_RERANK_PROVIDERS.natively, p);
  });

  test('points at the Natively API, not a third party', () => {
    const p = hostedRerankProvider('natively');
    assert.match(p.baseUrl, /\/v1$/);
    assert.match(p.baseUrl, /natively|127\.0\.0\.1|localhost/);
  });

  test('offers exactly the one model the server serves', () => {
    const p = hostedRerankProvider('natively');
    assert.deepEqual(p.models.map(m => m.id), ['rerank-2.5-lite']);
    assert.equal(p.staticCatalogue, true);
    assert.equal(defaultHostedModel('natively'), 'rerank-2.5-lite');
  });

  test('an unknown id is still rejected', () => {
    assert.equal(hostedRerankProvider('nativelyy'), null);
    assert.equal(hostedRerankProvider(undefined), null);
  });
});

describe('model resolution', () => {
  test('an unset model falls back to the managed one, not to ineligibility', () => {
    // With one model served and nothing for the user to pick, an unset setting
    // must mean "the managed one". Returning undefined would report 'no-model'
    // on a provider the user had just selected.
    assert.equal(readHostedModel({ provider: 'natively' }), 'rerank-2.5-lite');
    assert.equal(readHostedModel({ provider: 'natively', nativelyModel: 'rerank-2.5-lite' }), 'rerank-2.5-lite');
  });

  test('it does not read the OpenRouter or Jina model fields', () => {
    // Falling through to openrouterModel is what the old two-branch ternary did.
    const m = readHostedModel({ provider: 'natively', openrouterModel: 'x/y', jinaModel: 'jina-reranker-v3' });
    assert.equal(m, 'rerank-2.5-lite');
  });
});

describe('eligibility', () => {
  const base = { hasApiKey: true, model: 'rerank-2.5-lite', localOnly: false, referenceFilesScopeAllowed: true };

  test('natively is an eligible hosted provider', () => {
    // The gate used to be `provider !== 'openrouter' && provider !== 'jina'`.
    // Without natively added, every managed rerank was refused as
    // 'provider-not-selected'.
    assert.deepEqual(evaluateHostedEligibility({ ...base, provider: 'natively' }), { eligible: true });
  });

  test('being the managed tier is NOT an exemption from the privacy scope', () => {
    // Rerank candidates are reference-file content. A user who said that text
    // does not leave this machine meant Natively too.
    assert.deepEqual(
      evaluateHostedEligibility({ ...base, provider: 'natively', referenceFilesScopeAllowed: false }),
      { eligible: false, reason: 'reference-files-scope-denied' },
    );
    assert.deepEqual(
      evaluateHostedEligibility({ ...base, provider: 'natively', localOnly: true }),
      { eligible: false, reason: 'local-only-mode' },
    );
  });

  test('no Natively key means no managed rerank', () => {
    assert.deepEqual(
      evaluateHostedEligibility({ ...base, provider: 'natively', hasApiKey: false }),
      { eligible: false, reason: 'no-api-key' },
    );
  });

  test('the ineligibility copy does not name OpenRouter at a Natively user', () => {
    // These messages are reached for all three providers. Naming OpenRouter
    // sends someone to fix a credential they never configured.
    assert.doesNotMatch(describeIneligibility('no-api-key'), /OpenRouter/);
    assert.doesNotMatch(describeIneligibility('no-model'), /OpenRouter/);
  });
});

describe('the wire, through the shared client', () => {
  function recordingFetch(body) {
    const calls = [];
    const impl = async (url, init) => {
      calls.push({ url: String(url), init, body: init?.body ? JSON.parse(init.body) : undefined });
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    };
    return { calls, impl };
  }

  test('sends the contract natively-api /v1/rerank actually implements', async () => {
    const { calls, impl } = recordingFetch({
      model: 'rerank-2.5-lite',
      tokens: 47,
      results: [{ index: 1, relevance_score: 0.79 }, { index: 0, relevance_score: 0.43 }],
    });
    const descriptor = hostedRerankProvider('natively');
    const r = new OpenRouterReranker({
      baseUrl: descriptor.baseUrl,
      providerId: descriptor.id,
      getApiKey: () => 'natively_sk_test',
      getModel: () => defaultHostedModel('natively'),
      fetchImpl: impl,
    });
    const order = await r.rerank('why', ['b', 'a']);

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/v1\/rerank$/);
    // Bearer, not x-natively-key: the shared client sends only Authorization,
    // and the server's getKey() strips the `Bearer ` prefix. That is why this
    // needed no second client — and why a TRIAL cannot use it, since a trial
    // authenticates with a paired x-trial-token header instead.
    assert.equal(calls[0].init.headers.Authorization, 'Bearer natively_sk_test');
    assert.equal(calls[0].body.model, 'rerank-2.5-lite');
    assert.equal(calls[0].body.query, 'why');
    assert.deepEqual(calls[0].body.documents, ['b', 'a']);

    // Mapped back by INDEX, never by returned text.
    assert.deepEqual(order.map(o => o.index), [1, 0]);
  });
});
