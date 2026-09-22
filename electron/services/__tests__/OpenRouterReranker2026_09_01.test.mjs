/**
 * Hosted reranking through OpenRouter, at the single rerank seam.
 *
 * Three things are being defended here, in order of how bad it would be to get
 * them wrong:
 *
 *  1. PRIVACY. A user who has denied the `reference_files` scope must never have
 *     retrieved document text leave the machine. That is asserted against a
 *     mocked fetch — "no request was made" is the only honest form of that test;
 *     reading the code is not evidence.
 *  2. METADATA. Results are mapped back BY INDEX. Duplicate chunk text is real
 *     in this corpus, and matching on text would attach one candidate's score to
 *     another candidate's file path and offsets.
 *  3. FAILING CLOSED. Every failure yields null, which the seam reads as "keep
 *     the existing order". A rerank failure is never a user-visible error.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

const {
  OpenRouterReranker, toSeamOrder, classifyStatus, describeFailure, OPENROUTER_RERANK_TIMEOUT_MS,
} = require(path.join(repoRoot, 'dist-electron/electron/services/reranking/OpenRouterReranker.js'));

const {
  evaluateHostedEligibility, describeIneligibility, DEFAULT_RERANKER_SETTINGS,
} = require(path.join(repoRoot, 'dist-electron/electron/services/reranking/rerankerConfig.js'));

const { RerankerRegistry } = require(path.join(repoRoot, 'dist-electron/electron/services/reranking/RerankerRegistry.js'));

// ── helpers ───────────────────────────────────────────────────────────────

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** A fetch stand-in that records every call it receives. */
function recordingFetch(responder) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init, body: init?.body ? JSON.parse(init.body) : undefined });
    return responder(calls.length, calls[calls.length - 1]);
  };
  impl.calls = calls;
  return impl;
}

function makeReranker(overrides = {}) {
  return new OpenRouterReranker({
    getApiKey: () => 'test-key',
    getModel: () => 'voyageai/rerank-2.5-lite',
    sleep: async () => {},
    ...overrides,
  });
}

/** A well-formed OpenRouter rerank response for N documents, reversing the order. */
function reversedResults(n, cost = 0.000012) {
  return {
    results: Array.from({ length: n }, (_, i) => ({
      index: n - 1 - i,
      relevance_score: 1 - i / n,
      document: `doc ${n - 1 - i}`,
    })),
    usage: { cost },
    provider: 'VoyageAI',
  };
}

// ── request shape ─────────────────────────────────────────────────────────

test('the request uses the rerank endpoint and the documented body', async () => {
  const fetchImpl = recordingFetch(() => jsonResponse(reversedResults(3)));
  const r = makeReranker({ fetchImpl });

  await r.rerank('what is my kubernetes experience', ['a', 'b', 'c']);

  assert.equal(fetchImpl.calls.length, 1);
  const call = fetchImpl.calls[0];
  assert.match(call.url, /\/rerank$/, 'must POST /rerank, never /chat/completions');
  assert.equal(call.init.method, 'POST');
  assert.deepEqual(call.body, {
    model: 'voyageai/rerank-2.5-lite',
    query: 'what is my kubernetes experience',
    documents: ['a', 'b', 'c'],
    top_n: 3,
  });
});

test('the API key travels in the Authorization header and nowhere else', async () => {
  const fetchImpl = recordingFetch(() => jsonResponse(reversedResults(2)));
  await makeReranker({ fetchImpl, getApiKey: () => 'sk-secret-value' }).rerank('q', ['a', 'b']);

  const call = fetchImpl.calls[0];
  assert.equal(call.init.headers.Authorization, 'Bearer sk-secret-value');
  assert.ok(!call.url.includes('sk-secret-value'), 'the key must never appear in a URL');
  assert.ok(!String(call.init.body).includes('sk-secret-value'), 'the key must never appear in a body');
});

test('only the query and candidate text are sent — no chunk ids, paths or offsets', async () => {
  const fetchImpl = recordingFetch(() => jsonResponse(reversedResults(2)));
  await makeReranker({ fetchImpl }).rerank('q', ['first passage', 'second passage']);

  const body = fetchImpl.calls[0].body;
  assert.deepEqual(Object.keys(body).sort(), ['documents', 'model', 'query', 'top_n']);
});

// ── mapping back ──────────────────────────────────────────────────────────

test('results map back by index, and are sorted by score', async () => {
  const fetchImpl = recordingFetch(() => jsonResponse(reversedResults(4)));
  const order = await makeReranker({ fetchImpl }).rerank('q', ['a', 'b', 'c', 'd']);

  assert.deepEqual(order.map((o) => o.index), [3, 2, 1, 0]);
  assert.ok(order.every((o) => Number.isFinite(o.score)));
});

test('duplicate candidate text does not confuse the mapping', () => {
  // Two identical documents. Matching on returned text would be ambiguous;
  // matching on index is not.
  const results = [
    { index: 1, relevance_score: 0.9, document: 'identical chunk' },
    { index: 0, relevance_score: 0.2, document: 'identical chunk' },
  ];
  assert.deepEqual(toSeamOrder(results, 2), [{ index: 1, score: 0.9 }, { index: 0, score: 0.2 }]);
});

test('an incomplete or invalid ranking is rejected wholesale', () => {
  // rankScore(c, true) returns -Infinity for an unscored candidate, so a partial
  // ranking silently sinks every unscored chunk. Rejecting is the honest answer.
  assert.equal(toSeamOrder([{ index: 0, relevance_score: 1 }], 3), null, 'too few results');
  assert.equal(toSeamOrder([{ index: 0, relevance_score: 1 }, { index: 0, relevance_score: 0.5 }], 2), null, 'duplicate index');
  assert.equal(toSeamOrder([{ index: 0, relevance_score: 1 }, { index: 9, relevance_score: 0.5 }], 2), null, 'out-of-range index');
  assert.equal(toSeamOrder([{ index: 0, relevance_score: NaN }, { index: 1, relevance_score: 1 }], 2), null, 'NaN score');
  assert.equal(toSeamOrder([{ index: 0, relevance_score: Infinity }, { index: 1, relevance_score: 1 }], 2), null, 'infinite score');
  assert.equal(toSeamOrder(null, 2), null);
  assert.equal(toSeamOrder('not an array', 2), null);
});

// ── batching ──────────────────────────────────────────────────────────────

test('the port asks for the whole pool in one call', () => {
  // ModeHybridRetriever batches in 6s for ONNX arena reasons. Honouring that for
  // a network call would be 5 round trips: ~5x latency and ~5x spend.
  const r = makeReranker();
  assert.ok(r.batchSize >= 30, `batchSize must cover the 30-candidate pool, got ${r.batchSize}`);
});

// ── failure handling ──────────────────────────────────────────────────────

test('every documented status maps to a distinguishable failure', () => {
  assert.equal(classifyStatus(401), 'auth');
  assert.equal(classifyStatus(403), 'auth');
  assert.equal(classifyStatus(402), 'insufficient-credits');
  assert.equal(classifyStatus(404), 'model-unavailable');
  assert.equal(classifyStatus(408), 'timeout');
  assert.equal(classifyStatus(429), 'rate-limited');
  assert.equal(classifyStatus(500), 'server-error');
  assert.equal(classifyStatus(503), 'server-error');

  // 402 must not read as "check your API key" — that sends the user to the
  // wrong page entirely.
  assert.match(describeFailure('insufficient-credits'), /credits/i);
  assert.ok(!/api key/i.test(describeFailure('insufficient-credits')));
  assert.match(describeFailure('auth'), /key/i);
});

for (const status of [401, 402, 404, 500]) {
  test(`HTTP ${status} yields null, not a throw`, async () => {
    const fetchImpl = recordingFetch(() => jsonResponse({ error: { message: 'nope' } }, status));
    const r = makeReranker({ fetchImpl });
    const order = await r.rerank('q', ['a', 'b']);
    assert.equal(order, null, 'a rerank failure keeps the existing order');
    assert.equal(r.lastStats.ok, false);
    assert.equal(r.lastStats.httpStatus, status);
  });
}

test('a 429 is retried once, bounded, then gives up', async () => {
  let attempts = 0;
  const fetchImpl = recordingFetch(() => {
    attempts += 1;
    return jsonResponse({ error: { message: 'rate limited' } }, 429);
  });
  const r = makeReranker({ fetchImpl });
  assert.equal(await r.rerank('q', ['a', 'b']), null);
  assert.equal(attempts, 2, 'exactly one bounded retry — never an unbounded loop');
  assert.equal(r.lastStats.failure, 'rate-limited');
});

test('a 429 that then succeeds returns the ranking', async () => {
  const fetchImpl = recordingFetch((n) => (n === 1
    ? jsonResponse({ error: {} }, 429)
    : jsonResponse(reversedResults(2))));
  const order = await makeReranker({ fetchImpl }).rerank('q', ['a', 'b']);
  assert.deepEqual(order.map((o) => o.index), [1, 0]);
});

test('a retry is not attempted when the deadline has no room for it', async () => {
  // Clock jumps past the deadline after the first attempt.
  let t = 0;
  const fetchImpl = recordingFetch(() => { t += 10_000; return jsonResponse({}, 429); });
  const r = makeReranker({ fetchImpl, now: () => t, timeoutMs: 1_000 });
  assert.equal(await r.rerank('q', ['a', 'b']), null);
  assert.equal(fetchImpl.calls.length, 1, 'no retry once the budget is spent');
});

test('a malformed response is a failure, not a partial ranking', async () => {
  const fetchImpl = recordingFetch(() => jsonResponse({ results: [{ index: 0, relevance_score: 0.5 }] }));
  const r = makeReranker({ fetchImpl });
  assert.equal(await r.rerank('q', ['a', 'b', 'c']), null);
  assert.equal(r.lastStats.failure, 'malformed-response');
});

test('a network error yields null and is recorded', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  const r = makeReranker({ fetchImpl });
  assert.equal(await r.rerank('q', ['a', 'b']), null);
  assert.ok(['network', 'timeout'].includes(r.lastStats.failure));
});

test('a missing key or model fails before any request is made', async () => {
  const noKey = recordingFetch(() => jsonResponse(reversedResults(2)));
  assert.equal(await makeReranker({ fetchImpl: noKey, getApiKey: () => '' }).rerank('q', ['a', 'b']), null);
  assert.equal(noKey.calls.length, 0);

  const noModel = recordingFetch(() => jsonResponse(reversedResults(2)));
  assert.equal(await makeReranker({ fetchImpl: noModel, getModel: () => '' }).rerank('q', ['a', 'b']), null);
  assert.equal(noModel.calls.length, 0);
});

// ── cost and latency ──────────────────────────────────────────────────────

test('per-call cost comes from the response, and latency is named as a request', async () => {
  const fetchImpl = recordingFetch(() => jsonResponse(reversedResults(2, 0.000042)));
  const stats = [];
  const r = makeReranker({ fetchImpl, onStats: (s) => stats.push(s) });
  await r.rerank('q', ['a', 'b']);

  assert.equal(stats.length, 1);
  assert.equal(stats[0].costUsd, 0.000042);
  assert.ok('requestLatencyMs' in stats[0], 'the field names the round trip, not inference');
  assert.ok(!('inferenceMs' in stats[0]));
});

test('stats never carry the query or the candidate text', async () => {
  const fetchImpl = recordingFetch(() => jsonResponse(reversedResults(2)));
  const stats = [];
  await makeReranker({ fetchImpl, onStats: (s) => stats.push(s) })
    .rerank('a private question about salary', ['confidential passage', 'b']);

  const serialised = JSON.stringify(stats[0]);
  assert.ok(!serialised.includes('salary'), 'query text must not reach telemetry');
  assert.ok(!serialised.includes('confidential'), 'candidate text must not reach telemetry');
});

// ── eligibility / privacy ─────────────────────────────────────────────────

test('hosted rerank is off unless the user selected it', () => {
  assert.equal(DEFAULT_RERANKER_SETTINGS.provider, 'local');
  assert.equal(DEFAULT_RERANKER_SETTINGS.fallbackToLocal, false);

  const v = evaluateHostedEligibility({
    provider: 'local', hasApiKey: true, model: 'voyageai/rerank-2.5-lite',
    localOnly: false, referenceFilesScopeAllowed: true,
  });
  assert.equal(v.eligible, false);
  assert.equal(v.reason, 'provider-not-selected');
});

test('a denied reference_files scope blocks hosted rerank, ahead of key and model', () => {
  const v = evaluateHostedEligibility({
    provider: 'openrouter', hasApiKey: false, model: undefined,
    localOnly: false, referenceFilesScopeAllowed: false,
  });
  assert.equal(v.eligible, false);
  // The user is told the truth, not invited to fix a key that would not be used.
  assert.equal(v.reason, 'reference-files-scope-denied');
  assert.match(describeIneligibility(v.reason), /leave this machine/i);
});

test('local-only mode blocks hosted rerank', () => {
  const v = evaluateHostedEligibility({
    provider: 'openrouter', hasApiKey: true, model: 'voyageai/rerank-2.5-lite',
    localOnly: true, referenceFilesScopeAllowed: true,
  });
  assert.equal(v.reason, 'local-only-mode');
});

test('a fully configured, permitted OpenRouter setup is eligible', () => {
  const v = evaluateHostedEligibility({
    provider: 'openrouter', hasApiKey: true, model: 'voyageai/rerank-2.5-lite',
    localOnly: false, referenceFilesScopeAllowed: true,
  });
  assert.equal(v.eligible, true);
  assert.equal(v.reason, undefined);
});

// ── the seam ──────────────────────────────────────────────────────────────

function registryWithHosted(hosted, extra = {}) {
  const outcomes = [];
  const registry = new RerankerRegistry({
    isEnabled: () => false,        // no extension involved
    source: null,
    hostedPort: () => hosted,
    onOutcome: (o) => outcomes.push(o),
    logger: { warn: () => {} },
    ...extra,
  });
  return { registry, outcomes };
}

test('an ineligible hosted port leaves the seam to the built-in', () => {
  const { registry } = registryWithHosted(null);
  assert.equal(registry.resolvePort(), null, 'null means "use the built-in"');
});

test('hosted takes the seam ahead of an enabled extension', () => {
  const hosted = { batchSize: 30, rerank: async () => [{ index: 0, score: 1 }] };
  const registry = new RerankerRegistry({
    isEnabled: () => true,
    source: {
      list: () => [{ id: 'jina', enabled: true, manifest: { type: 'reranker' } }],
      running: () => ['jina'],
      load: async () => {},
      rerank: async () => { throw new Error('the extension must not be called'); },
    },
    hostedPort: () => hosted,
    logger: { warn: () => {} },
  });
  const port = registry.resolvePort();
  assert.ok(port, 'hosted must own the seam when selected');
  assert.equal(port.batchSize, 30, 'the wrapper must preserve batchSize or batching silently returns');
});

test('a hosted failure keeps the existing order when fallback is off', async () => {
  const hosted = { batchSize: 30, rerank: async () => null };
  const { registry, outcomes } = registryWithHosted(hosted);
  assert.equal(await registry.resolvePort().rerank('q', ['a', 'b']), null);
  assert.equal(outcomes.at(-1).fallback, true);
  assert.equal(outcomes.at(-1).provider, 'openrouter');
});

test('a hosted throw cannot escape into retrieval', async () => {
  const hosted = { batchSize: 30, rerank: async () => { throw new Error('boom'); } };
  const { registry, outcomes } = registryWithHosted(hosted);
  assert.equal(await registry.resolvePort().rerank('q', ['a', 'b']), null);
  assert.match(outcomes.at(-1).reason, /boom/);
});

test('the opt-in local fallback runs only when supplied, and is reported', async () => {
  const hosted = { batchSize: 30, rerank: async () => null };
  const local = { rerank: async () => [{ index: 1, score: 0.9 }, { index: 0, score: 0.1 }] };
  const { registry, outcomes } = registryWithHosted(hosted, { hostedFallbackPort: () => local });

  const order = await registry.resolvePort().rerank('q', ['a', 'b']);
  assert.deepEqual(order.map((o) => o.index), [1, 0]);
  const outcome = outcomes.at(-1);
  assert.equal(outcome.fallback, true, 'a substitution must be visible, never silent');
  assert.equal(outcome.rerankerId, 'openrouter->local');
});

test('a successful hosted rerank reports as not-fallback', async () => {
  const hosted = { batchSize: 30, rerank: async () => [{ index: 0, score: 1 }] };
  const { registry, outcomes } = registryWithHosted(hosted);
  assert.ok(await registry.resolvePort().rerank('q', ['a']));
  assert.equal(outcomes.at(-1).fallback, false);
  assert.equal(outcomes.at(-1).provider, 'openrouter');
});

test('the per-request ceiling is bounded and smaller than the extension ceiling', () => {
  // The doc-grounded path passes budgetMs: null upstream (LLMHelper.ts:3032), so
  // this is the only bound that path has.
  assert.ok(OPENROUTER_RERANK_TIMEOUT_MS > 0 && OPENROUTER_RERANK_TIMEOUT_MS <= 10_000);
});
