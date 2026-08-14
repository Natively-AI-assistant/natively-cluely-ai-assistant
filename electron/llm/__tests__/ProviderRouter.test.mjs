import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routerPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/ProviderRouter.js');

async function loadRouter() {
  return import(pathToFileURL(routerPath).href);
}

async function route(options) {
  const { routeLLMProviders } = await loadRouter();
  return routeLLMProviders(options);
}

test('routeLLMProviders returns deterministic text fallback order with availability', async () => {
  const attempts = await route({
    capability: 'chat',
    multimodal: false,
    availability: {
      hasNatively: true,
      hasGroq: true,
      hasCodex: true,
      hasGemini: true,
      hasOpenAI: true,
      hasClaude: true,
      hasDeepseek: true,
    },
    models: {
      groq: 'groq-text',
      codex: 'codex-model',
      geminiFlash: 'gemini-flash',
      geminiPro: 'gemini-pro',
      openai: 'openai-text',
      claude: 'claude-text',
      deepseek: 'deepseek-v4-flash',
    },
  });

  assert.deepEqual(attempts.map(attempt => attempt.provider), [
    'natively',
    'groq',
    'codex',
    'gemini_flash',
    'gemini_pro',
    'openai',
    'claude',
    'deepseek',
  ]);
  assert.equal(attempts.every(attempt => attempt.status === 'available'), true);
  assert.deepEqual(attempts.map(attempt => attempt.provider), attempts.map(attempt => attempt.provider));
});

test('routeLLMProviders omits DeepSeek from multimodal fallback (text-only provider)', async () => {
  const attempts = await route({
    capability: 'chat',
    multimodal: true,
    availability: {
      hasNatively: true,
      hasGroq: true,
      hasCodex: true,
      hasGemini: true,
      hasOpenAI: true,
      hasClaude: true,
      hasDeepseek: true,
    },
  });

  assert.equal(attempts.find(a => a.provider === 'deepseek'), undefined,
    'DeepSeek must not appear in the multimodal/vision fallback chain');
});

test('routeLLMProviders marks DeepSeek missing_api_key when key absent', async () => {
  const attempts = await route({
    capability: 'chat',
    multimodal: false,
    availability: { hasDeepseek: false },
  });

  const deepseek = attempts.find(a => a.provider === 'deepseek');
  assert.ok(deepseek, 'DeepSeek must appear in text-only attempts list');
  assert.equal(deepseek.status, 'unavailable');
  assert.equal(deepseek.unavailableReason, 'missing_api_key');
});

test('routeLLMProviders returns multimodal fallback order', async () => {
  const attempts = await route({
    capability: 'chat',
    multimodal: true,
    availability: {
      hasNatively: true,
      hasGroq: true,
      hasCodex: true,
      hasGemini: true,
      hasOpenAI: true,
      hasClaude: true,
    },
  });

  assert.deepEqual(attempts.map(attempt => attempt.provider), [
    'natively',
    'codex',
    'openai',
    'gemini_flash',
    'claude',
    'gemini_pro',
    'groq',
  ]);
});

test('routeLLMProviders marks missing providers unavailable with reasons', async () => {
  const attempts = await route({
    capability: 'chat',
    multimodal: false,
    availability: {
      hasNatively: false,
      hasGroq: false,
      hasCodex: false,
      hasGemini: false,
      hasOpenAI: false,
      hasClaude: false,
    },
  });

  // 7 prior providers + deepseek
  assert.equal(attempts.length, 8);
  assert.equal(attempts.every(attempt => attempt.status === 'unavailable'), true);
  assert.equal(attempts.find(attempt => attempt.provider === 'codex').unavailableReason, 'missing_config');
  assert.equal(attempts.find(attempt => attempt.provider === 'openai').unavailableReason, 'missing_api_key');
  assert.equal(attempts.find(attempt => attempt.provider === 'deepseek').unavailableReason, 'missing_api_key');
});

test('routeLLMProviders reports disabled Groq distinctly from missing key', async () => {
  const attempts = await route({
    capability: 'chat',
    availability: {
      hasGroq: true,
      groqDisabled: true,
    },
  });

  const groq = attempts.find(attempt => attempt.provider === 'groq');
  assert.equal(groq.status, 'unavailable');
  assert.equal(groq.unavailableReason, 'disabled');
});

test('routeLLMProviders marks unsupported capabilities without dropping attempts', async () => {
  const attempts = await route({
    capability: 'structured',
    availability: {
      hasNatively: true,
      hasGemini: true,
      hasOpenAI: true,
      hasClaude: true,
    },
  });

  assert.equal(attempts.find(attempt => attempt.provider === 'natively').unavailableReason, 'unsupported_capability');
  assert.equal(attempts.find(attempt => attempt.provider === 'gemini_flash').unavailableReason, 'unsupported_capability');
  assert.equal(attempts.find(attempt => attempt.provider === 'gemini_pro').status, 'available');
  assert.equal(attempts.find(attempt => attempt.provider === 'openai').status, 'available');
});

test('routeLLMProviders does not mutate input objects', async () => {
  const availability = { hasNatively: true, hasGroq: false };
  const models = { groq: 'groq-text' };
  const before = JSON.stringify({ availability, models });

  await route({ capability: 'chat', availability, models });

  assert.equal(JSON.stringify({ availability, models }), before);
});

test('ProviderRouter opens circuit after repeated provider failures and routes around it', async () => {
  const { ProviderRouter } = await loadRouter();
  const router = new ProviderRouter({ threshold: 2, resetTimeout: 60000, halfOpenMaxCalls: 1 });

  router.recordFailure('groq');
  router.recordFailure('groq');

  assert.equal(router.getProviderHealth().groq, 'down');
  const choice = router.selectProvider({ preferLowLatency: true });
  assert.equal(choice.provider, 'gemini');
  assert.match(choice.reason, /low-latency/);
});

test('ProviderRouter half-open retry is limited for rate-limit recovery', async () => {
  const { ProviderRouter } = await loadRouter();
  const router = new ProviderRouter({ threshold: 1, resetTimeout: 10, halfOpenMaxCalls: 1 });
  const breaker = router.getCircuitBreaker('openai');

  router.recordFailure('openai');
  breaker.lastFailure = Date.now() - 20;

  assert.equal(breaker.canExecute(), true);
  assert.equal(breaker.state, 'half-open');
  router.recordFailure('openai');
  assert.equal(breaker.state, 'open');
  assert.equal(breaker.canExecute(), false);
});

test('ProviderRouter honors local-only privacy before cloud routing preferences', async () => {
  const { ProviderRouter } = await loadRouter();
  const router = new ProviderRouter();

  const choice = router.selectProvider({ privacySetting: 'local-only', needsVision: true, preferLowLatency: true });

  assert.equal(choice.provider, 'ollama');
  assert.equal(choice.model, 'local');
  assert.match(choice.reason, /local-only/);
});
