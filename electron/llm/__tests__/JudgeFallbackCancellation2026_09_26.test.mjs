// The judge's last rung — the structured ladder — must stop when the judge is cancelled.
//
// Review finding on PR #597 (Greptile, 2026-09-22): every explicit judge rung forwards the
// controller's AbortSignal, but the final fallback into generateContentStructured did not
// take one. A user whose only providers are Codex CLI / Ollama / custom / cURL reaches that
// fallback on every judge call, and in the PR's telemetry 41 of 83 judge calls were
// superseded while running. Each of those kept walking the ladder: up to three rotations with
// 1 s and 2 s backoffs, spending quota and rate-limit capacity on a verdict the controller had
// already thrown away. The in-flight provider call is not interrupted (only the Natively rung
// takes the signal); what stops is every call AFTER the abort.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { LLMHelper } = require('../../../dist-electron/electron/LLMHelper.js');

function bareHelper() {
  const h = Object.create(LLMHelper.prototype);
  Object.assign(h, {
    rateLimitCircuit: new Map(), isLocalOnlyMode: false, client: null, openaiClient: null, claudeClient: null,
    currentModelId: 'gemini-test', useOllama: false, customProvider: null, activeCurlProvider: null, nativelyKey: null,
    _client: null, _openaiClient: null, _claudeClient: null, _groqClient: null, _deepseekClient: null,
    getDisabledProviderFamilies: () => [],
    rateLimiters: { openai: { acquire: async () => {} }, claude: { acquire: async () => {} }, gemini: { acquire: async () => {} } },
  });
  h.assertOutboundScopes = () => {}; h.isCodexAvailable = () => false; h.isProviderDisabled = () => false;
  h.delay = async () => {}; h.getOpenAiPromptCacheKey = () => undefined;
  return h;
}

/** A custom-provider rung, so the ladder has exactly one place to go. */
function withCustomRung(h, execute) {
  h.customProvider = { name: 'stub', curlCommand: '', responsePath: '' };
  h.executeCustomProvider = execute;
  return h;
}

test('the judge hands its signal to the structured-ladder fallback', async () => {
  const controller = new AbortController();
  const h = bareHelper();
  h.callFastModel = async () => null;
  let seen;
  h.generateContentStructured = async (_message, opts) => { seen = opts; return '{"is_ask":false}'; };
  assert.equal(await h.generateJudgeVerdict('prompt', { signal: controller.signal }), '{"is_ask":false}');
  assert.equal(seen?.signal, controller.signal, 'the fallback must carry the judge controller\'s signal');
});

test('an abort during a ladder call stops the ladder: no retry, no second rotation', async () => {
  const controller = new AbortController();
  let calls = 0;
  const h = withCustomRung(bareHelper(), async () => {
    calls++;
    controller.abort();   // superseded while this rung was running
    throw new Error('upstream 503');
  });
  await assert.rejects(h.generateContentStructured('x', { signal: controller.signal }), { name: 'AbortError' });
  // Before: the failure fell through to rotation 2 and 3 — three calls and two backoffs
  // for a verdict nobody would read, ending in "All reasoning models failed".
  assert.equal(calls, 1, `the ladder ran ${calls} provider calls after the abort`);
});

test('a result that lands after the abort is dropped, not returned', async () => {
  const controller = new AbortController();
  const h = withCustomRung(bareHelper(), async () => { controller.abort(); return '{"late":true}'; });
  await assert.rejects(h.generateContentStructured('x', { signal: controller.signal }), { name: 'AbortError' });
});

test('an already-cancelled call never reaches a provider', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const h = withCustomRung(bareHelper(), async () => { calls++; return '{}'; });
  await assert.rejects(h.generateContentStructured('x', { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('the Natively rung and the preferFast pick receive the signal', async () => {
  const controller = new AbortController();
  const h = bareHelper();
  h.nativelyKey = 'k';
  let nativelyOpts;
  h.generateWithNatively = async (_m, _s, _i, opts) => { nativelyOpts = opts; return '{"ok":true}'; };
  let fastOpts;
  h.callFastModel = async (_m, opts) => { fastOpts = opts; return null; };
  assert.equal(await h.generateContentStructured('x', { preferFast: true, signal: controller.signal }), '{"ok":true}');
  assert.equal(fastOpts?.signal, controller.signal, 'preferFast pick');
  assert.equal(nativelyOpts?.signal, controller.signal, 'Natively rung');
  assert.equal(nativelyOpts?.purpose, 'extraction', 'the server-side extraction routing is unchanged');
});

test('without a signal the ladder behaves exactly as before', async () => {
  let calls = 0;
  const h = withCustomRung(bareHelper(), async () => { calls++; if (calls < 3) throw new Error('flaky'); return '{"third":true}'; });
  assert.equal(await h.generateContentStructured('x'), '{"third":true}');
  assert.equal(calls, 3, 'all three rotations still run for a caller that cannot cancel');
});
