// An OpenAI key with no credits answers 429 `insufficient_quota` on every
// call. The startup resolver treated every 429 as a blip and probed three
// times (two backoffs, three identical log blocks) before moving on. Out of
// credits is final for the launch; an ordinary rate limit still retries.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const dist = (p) => pathToFileURL(path.resolve(root, 'dist-electron/electron/rag', p)).href;

const { EmbeddingProviderResolver } = await import(dist('EmbeddingProviderResolver.js'));
const { OpenAIEmbeddingProvider, isOpenAiQuotaExhaustedBody } = await import(dist('providers/OpenAIEmbeddingProvider.js'));

// The body the user's account returned, verbatim in shape.
const NO_CREDITS_BODY = JSON.stringify({
  error: {
    message: 'You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing.',
    type: 'insufficient_quota',
    param: null,
    code: 'insufficient_quota',
  },
});
const RATE_LIMIT_BODY = JSON.stringify({
  error: { message: 'Rate limit reached for requests per min. Please try again in 20s.', type: 'requests', code: 'rate_limit_exceeded' },
});

describe('telling out-of-credits from a rate limit', () => {
  test('insufficient_quota is recognised by code, type or message', () => {
    assert.equal(isOpenAiQuotaExhaustedBody(NO_CREDITS_BODY), true);
    assert.equal(isOpenAiQuotaExhaustedBody(JSON.stringify({ error: { type: 'insufficient_quota' } })), true);
    assert.equal(isOpenAiQuotaExhaustedBody('You exceeded your current quota, please check your plan and billing details.'), true);
  });

  test('a rate limit, an empty body and unrelated JSON are not', () => {
    assert.equal(isOpenAiQuotaExhaustedBody(RATE_LIMIT_BODY), false);
    assert.equal(isOpenAiQuotaExhaustedBody(''), false);
    assert.equal(isOpenAiQuotaExhaustedBody('{"error":{"message":"server error"}}'), false);
  });

  test('the provider records why its probe failed without throwing', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(NO_CREDITS_BODY, { status: 429, statusText: 'Too Many Requests' });
    const realWarn = console.warn;
    console.warn = () => {};
    try {
      const provider = new OpenAIEmbeddingProvider('sk-test');
      assert.equal(await provider.isAvailable(), false);
      assert.equal(provider.lastProbeError?.quotaExhausted, true);

      globalThis.fetch = async () => new Response(RATE_LIMIT_BODY, { status: 429, statusText: 'Too Many Requests' });
      assert.equal(await provider.isAvailable(), false);
      assert.equal(provider.lastProbeError?.quotaExhausted, false);
    } finally {
      globalThis.fetch = realFetch;
      console.warn = realWarn;
    }
  });
});

describe('the startup probe', () => {
  const fakeProvider = (lastProbeError) => {
    const p = { name: 'openai', dimensions: 1536, calls: 0, lastProbeError, async isAvailable() { p.calls++; return false; } };
    return p;
  };
  const quiet = async (fn) => {
    const log = console.log, warn = console.warn;
    console.log = () => {}; console.warn = () => {};
    try { return await fn(); } finally { console.log = log; console.warn = warn; }
  };

  test('out of credits is asked once at startup', async () => {
    const provider = fakeProvider({ quotaExhausted: true });
    const outcome = await quiet(() => EmbeddingProviderResolver.probeAvailable(provider));
    assert.equal(provider.calls, 1);
    // 'transient', not 'permanent': only a transient outcome keeps a PINNED
    // provider on the background re-probe that restores it once credits are
    // added (code review, 2026-10-04).
    assert.equal(outcome, 'transient');
  });

  test('a pinned provider that is out of credits is still handed back for re-probing', async () => {
    const src = (await import('node:fs')).readFileSync(path.resolve(root, 'electron/rag/EmbeddingProviderResolver.ts'), 'utf8');
    assert.match(src, /if \(outcome === 'transient' && chosenProvider && provider\.name === chosenProvider/);
    const quota = src.slice(src.indexOf('lastProbeError?.quotaExhausted'));
    assert.match(quota.slice(0, 260), /return 'transient';/);
  });

  test('an ordinary rate limit still gets the full retry budget', async () => {
    const provider = fakeProvider({ quotaExhausted: false });
    const outcome = await quiet(() => EmbeddingProviderResolver.probeAvailable(provider));
    assert.equal(outcome, 'transient');
    assert.equal(provider.calls, 3);
  });
});
