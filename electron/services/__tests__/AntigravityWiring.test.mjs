import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { LLMHelper } = require(path.join(root, 'dist-electron/electron/LLMHelper.js'));
const { prepareDirectAssistPrompt } = require(path.join(root, 'dist-electron/electron/direct-assist/requestBuilder.js'));
const { normalizeDirectAssistError } = require(path.join(root, 'dist-electron/electron/direct-assist/errors.js'));
const collect = async (stream) => { let text = ''; for await (const chunk of stream) text += chunk; return text; };

function helper(policy = {}) {
  const h = Object.create(LLMHelper.prototype);
  h.currentModelId = 'antigravity:gemini-3.6-flash-low';
  h.isLocalOnlyMode = false;
  h.useOllama = false;
  h.isProviderDisabled = () => false;
  h.getProviderScopePolicy = () => policy;
  h.assertOutboundImagesAllowed = () => {};
  h.processImage = async () => ({ mimeType: 'image/png', data: 'prepared-image' });
  return h;
}

test('Antigravity model selection stays distinct from API-key Gemini and accepts Direct Assist', () => {
  const h = helper();
  assert.deepEqual(h.getDirectAssistSelection(), { provider: 'antigravity', model: h.currentModelId });
  assert.equal(h.getCurrentProvider(), 'antigravity');
  const prompt = prepareDirectAssistPrompt({
    requestId: 'antigravity-check', source: 'typed', selection: h.getDirectAssistSelection(),
    currentRequest: 'Explain queues', imagePaths: [],
  });
  assert.match(prompt.userPrompt, /Explain queues/);
  assert.equal(h.directSelectionSupportsImages(h.getDirectAssistSelection(), null, null), true);
});

test('streaming preserves model, prompt, prepared images, budget and cancellation', async () => {
  const previous = globalThis.__nativelyAntigravityServiceV1__;
  const calls = [];
  globalThis.__nativelyAntigravityServiceV1__ = {
    async *stream(input) { calls.push(input); yield 'answer'; yield ' text'; },
  };
  try {
    const h = helper();
    const signal = new AbortController().signal;
    assert.equal(await collect(h.streamWithAntigravity('question', 'system', ['screen.png'], signal)), 'answer text');
    assert.equal(calls[0].model, 'gemini-3.6-flash-low');
    assert.equal(calls[0].userPrompt, 'question');
    assert.equal(calls[0].systemPrompt, 'system');
    assert.deepEqual(calls[0].images, [{ mimeType: 'image/png', data: 'prepared-image' }]);
    assert.equal(calls[0].signal, signal);
    assert.ok(calls[0].maxOutputTokens > 192, 'Natively must retain its own answer budget');
  } finally { globalThis.__nativelyAntigravityServiceV1__ = previous; }
});

test('disabled provider, local-only and denied scopes prevent outbound calls', async () => {
  const previous = globalThis.__nativelyAntigravityServiceV1__;
  let calls = 0;
  globalThis.__nativelyAntigravityServiceV1__ = { async *stream() { calls++; yield 'unexpected'; } };
  try {
    const disabled = helper();
    disabled.isProviderDisabled = (provider) => provider === 'antigravity';
    await assert.rejects(collect(disabled.streamWithAntigravity('question')), /disabled/i);
    const local = helper();
    local.isLocalOnlyMode = true;
    await assert.rejects(collect(local.streamWithAntigravity('question')), /local-only/i);
    await assert.rejects(collect(helper({ screenshots: false }).streamWithAntigravity('question', '', ['screen.png'])), /scope/i);
    await assert.rejects(collect(helper({ transcript: false }).streamWithAntigravity('question')), /scope/i);
    assert.equal(calls, 0);
  } finally { globalThis.__nativelyAntigravityServiceV1__ = previous; }
});

test('Direct Assist dispatch uses the selected Antigravity model exactly once', async () => {
  const h = helper();
  const calls = [];
  h.streamWithAntigravity = async function* (...args) { calls.push(args); yield 'direct answer'; };
  const selection = h.getDirectAssistSelection();
  const result = await collect(h.streamDirectAssist({
    requestId: 'direct-check', selection, systemPrompt: 'system', userPrompt: 'question', imagePaths: [],
  }));
  assert.equal(result, 'direct answer');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][4], selection.model);
});

test('switching to local or custom models clears Antigravity selection and capabilities', () => {
  const h = helper();
  h.useOllama = true;
  h.ollamaModel = 'local-model';
  assert.equal(h.getCurrentProvider(), 'ollama');
  assert.equal(h.getDirectAssistSelection().provider, 'ollama');
  assert.equal(h.getCurrentModelDisplayName(), 'local-model');
  h.useOllama = false;
  h.customProvider = { id: 'custom-model', name: 'Custom model', model: 'custom-model' };
  assert.equal(h.getCurrentProvider(), 'custom');
  assert.equal(h.getDirectAssistSelection().provider, 'custom');
  assert.equal(h.getCurrentModelDisplayName(), 'Custom model');
});

test('Direct Assist can answer a typed question when meeting transcript sharing is disabled', async () => {
  const previous = globalThis.__nativelyAntigravityServiceV1__;
  globalThis.__nativelyAntigravityServiceV1__ = { async *stream() { yield 'answer'; } };
  try {
    const h = helper({ transcript: false });
    assert.equal(await collect(h.streamDirectAssist({ requestId: 'private-check', selection: h.getDirectAssistSelection(),
      userPrompt: 'CURRENT REQUEST:\nExplain queues', systemPrompt: 'Answer the question', imagePaths: [] })), 'answer');
  } finally { globalThis.__nativelyAntigravityServiceV1__ = previous; }
});

test('Direct Assist auth errors give a safe recovery action without upstream text', () => {
  for (const code of ['auth_required', 'auth_revoked']) {
    const error = normalizeDirectAssistError({ name: 'AntigravityError', code, message: 'secret token' });
    assert.equal(error.code, 'AUTH_FAILED');
    assert.match(error.message, /Sign in.*Antigravity/);
    assert.doesNotMatch(error.message, /secret/);
  }
  assert.equal(normalizeDirectAssistError({ name: 'AntigravityError', code: 'cancelled' }).code, 'CANCELLED');
});
