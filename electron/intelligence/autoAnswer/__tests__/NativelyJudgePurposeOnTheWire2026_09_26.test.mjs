// The Natively judge rung must put `purpose: 'decision'` on the WIRE.
//
// FastModelJudgeRung2026_09_23 checks that generateJudgeVerdict passes the
// purpose to generateWithNatively — with generateWithNatively stubbed out, so
// it could never see that the real method dropped the field. Live 2026-09-26:
// the server, never told, routed every Natively verdict to deepseek-flash
// (1.3-2.2 s) instead of flash-lite (1.0-1.5 s); the 1.8 s rung timed out and
// the answer only fired through the trailing-'?' fallback. These tests run the
// REAL generateWithNatively against a captured fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { LLMHelper } = require(path.resolve(__dirname, '../../../../dist-electron/electron/LLMHelper.js'));

function nativelyHelper(over = {}) {
  const h = Object.create(LLMHelper.prototype);
  Object.assign(h, {
    nativelyKey: 'nat_test_key',
    isLocalOnlyMode: false,
    groqFastTextMode: false,
    aiResponseLanguage: null,
    currentModelId: 'natively',
    getDisabledProviderFamilies: () => [],
    assertOutboundScopes: () => {},
    rateLimiters: {},
    ...over,
  });
  return h;
}

async function captureBody(run) {
  const realFetch = globalThis.fetch;
  let sent = null;
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ content: '{"is_ask":true}' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try { await run(); } finally { globalThis.fetch = realFetch; }
  return sent;
}

test("the judge's Natively rung sends purpose:'decision' in the request body", async () => {
  const h = nativelyHelper();
  h.callFastModel = async () => null;
  const body = await captureBody(() => h.generateJudgeVerdict('judge prompt'));
  assert.ok(body, 'the Natively rung must have made a request');
  assert.equal(body.purpose, 'decision', 'the server only pins flash-lite when it is told');
});

test('a decision never carries fast_mode, even with Fast Response on', async () => {
  // Fast Response ON sets fast_mode on every Natively call; the decision tier
  // is its own route and must not be re-routed by it.
  const h = nativelyHelper({ groqFastTextMode: true });
  const body = await captureBody(() => h.generateWithNatively('judge prompt', undefined, undefined, { purpose: 'decision', timeoutMs: 1800 }));
  assert.equal(body.purpose, 'decision');
  assert.equal(body.fast_mode, undefined);
});

test('an ordinary Natively call still sends no purpose', async () => {
  const h = nativelyHelper({ groqFastTextMode: true });
  const body = await captureBody(() => h.generateWithNatively('hello'));
  assert.equal(body.purpose, undefined);
  assert.equal(body.fast_mode, true, 'Fast Response keeps working for normal calls');
});
