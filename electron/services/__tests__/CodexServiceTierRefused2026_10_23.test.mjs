// electron/services/__tests__/CodexServiceTierRefused2026_10_23.test.mjs
//
// A Codex service tier the model refuses must not cost the answer.
//
// BACKGROUND (user log, 2026-10-14, v2.9.2)
// Service tier "fast" with gpt-6-sol: every request came back
// "Unsupported service_tier: fast". The answer was left empty, LLMHelper
// rotated three times with backoff on an error no retry could fix, and Auto
// Answer showed nothing until the user changed models.
//
// THE FIX UNDER TEST
// CodexCliService sends the same request again without `service_tier` when the
// backend refuses it (as a 4xx or as a stream error event), and leaves the tier
// out of later requests for that model in the same run.
//
// Run via: npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/CodexServiceTierRefused2026_10_23.test.mjs

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Hermetic: never pick up the developer's real `codex login`.
process.env.CODEX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-codex-home-'));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: {
    app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};

const { CodexCliService, isUnsupportedServiceTierMessage } = require(
  path.join(__dirname, '../../../dist-electron/electron/services/CodexCliService.js'),
);

// Signed in through the shared CredentialsManager slot (see
// CodexVisionPayload2026_08_05.test.mjs for why this seam and not the OAuth
// singleton).
const CRED_SLOT = '__nativelyCredentialsManagerV1__';
globalThis[CRED_SLOT] = {
  getCodexOAuthTokens: () => ({
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    accountId: 'acct_test',
    expiresAt: Date.now() + 3_600_000,
  }),
  getDisabledProviders: () => [],
};

const SSE_OK = [
  'event: response.output_text.delta',
  'data: {"type":"response.output_text.delta","delta":"ok"}',
  '',
  'event: response.completed',
  'data: {"type":"response.completed"}',
  '',
  '',
].join('\n');

const SSE_TIER_FAILED = [
  'event: response.failed',
  'data: {"type":"response.failed","response":{"error":{"message":"Unsupported service_tier: fast"}}}',
  '',
  '',
].join('\n');

const sse = (text) => new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
const jsonError = (status, message) => new Response(JSON.stringify({ error: { message } }), {
  status,
  headers: { 'content-type': 'application/json' },
});

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** Stub fetch with a queue of responses; returns every request body sent. */
function stubFetch(responses) {
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    const next = responses.shift();
    assert.ok(next, `unexpected extra request #${bodies.length}`);
    return next();
  };
  return bodies;
}

async function collect(options) {
  let out = '';
  for await (const chunk of CodexCliService.stream('', { timeoutMs: 30_000, prompt: 'hi', ...options })) out += chunk;
  return out;
}

describe('isUnsupportedServiceTierMessage', () => {
  test('matches the refusal from the user log and its usual variants', () => {
    assert.equal(isUnsupportedServiceTierMessage('Unsupported service_tier: fast'), true);
    assert.equal(isUnsupportedServiceTierMessage("Invalid value for 'service_tier': 'flex'"), true);
    assert.equal(isUnsupportedServiceTierMessage('service tier not available for this model'), true);
  });

  test('does not match other refusals', () => {
    assert.equal(isUnsupportedServiceTierMessage("The 'gpt-x' model is not supported when using Codex with a ChatGPT account."), false);
    assert.equal(isUnsupportedServiceTierMessage('Unsupported value: reasoning.effort'), false);
    assert.equal(isUnsupportedServiceTierMessage('service_tier: fast'), false);
  });
});

describe('Codex service tier refused', () => {
  test('a 400 refusal is answered by the same request without the tier, and the tier stays off for that model', async () => {
    const bodies = stubFetch([
      () => jsonError(400, 'Unsupported service_tier: fast'),
      () => sse(SSE_OK),
      () => sse(SSE_OK),
    ]);
    assert.equal(await collect({ model: 'tier-test-a', serviceTier: 'fast' }), 'ok');
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].service_tier, 'fast');
    assert.equal('service_tier' in bodies[1], false, 'the retry must drop the refused tier');
    assert.equal(bodies[1].input[0].content[0].text, 'hi', 'and otherwise be the same request');

    // Next call: no failed round trip first.
    assert.equal(await collect({ model: 'tier-test-a', serviceTier: 'fast' }), 'ok');
    assert.equal(bodies.length, 3);
    assert.equal('service_tier' in bodies[2], false);
  });

  test('the refusal arriving as a stream error event is retried the same way', async () => {
    const bodies = stubFetch([
      () => sse(SSE_TIER_FAILED),
      () => sse(SSE_OK),
    ]);
    assert.equal(await collect({ model: 'tier-test-b', serviceTier: 'fast' }), 'ok');
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].service_tier, 'fast');
    assert.equal('service_tier' in bodies[1], false);
  });

  test('another model, or another tier on the same model, still sends its tier', async () => {
    const bodies = stubFetch([
      () => jsonError(400, 'Unsupported service_tier: fast'),
      () => sse(SSE_OK),
      () => sse(SSE_OK),
      () => sse(SSE_OK),
    ]);
    await collect({ model: 'tier-test-c', serviceTier: 'fast' });
    await collect({ model: 'tier-test-d', serviceTier: 'fast' });
    await collect({ model: 'tier-test-c', serviceTier: 'flex' });
    assert.equal(bodies[2].service_tier, 'fast', 'a different model keeps the tier');
    assert.equal(bodies[3].service_tier, 'flex', 'a different tier on the refusing model is still tried');
  });

  test('the retry happens once: a second refusal surfaces', async () => {
    const bodies = stubFetch([
      () => jsonError(400, 'Unsupported service_tier: fast'),
      () => jsonError(400, 'Unsupported service_tier: default'),
    ]);
    await assert.rejects(collect({ model: 'tier-test-e', serviceTier: 'fast' }), /Unsupported service_tier: default/);
    assert.equal(bodies.length, 2);
  });

  test('a request sent without a tier is not retried on a tier-shaped error', async () => {
    const bodies = stubFetch([() => jsonError(400, 'Unsupported service_tier: fast')]);
    await assert.rejects(collect({ model: 'tier-test-f' }), /Unsupported service_tier/);
    assert.equal(bodies.length, 1);
  });

  test('other 400s are still thrown without a retry', async () => {
    const bodies = stubFetch([() => jsonError(400, "The 'tier-test-g' model is not supported when using Codex with a ChatGPT account.")]);
    await assert.rejects(collect({ model: 'tier-test-g', serviceTier: 'fast' }), /not supported when using Codex/);
    assert.equal(bodies.length, 1);
  });
});
