import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { LLMHelper } = require(path.resolve(__dirname, '../../../../dist-electron/electron/LLMHelper.js'));

function policyHelper(overrides = {}) {
  const helper = Object.create(LLMHelper.prototype);
  Object.assign(helper, {
    _client: null,
    _openaiClient: null,
    _claudeClient: null,
    useOllama: false,
    customProvider: null,
    activeCurlProvider: null,
    nativelyKey: null,
    getDisabledProviderFamilies: () => [],
    isCodexAvailable: () => false,
    observedAnswerLatency: () => null,
    ...overrides,
  });
  return helper;
}

test('LLMHelper sizes the judge total for the slowest reachable non-Gemini fallback', () => {
  assert.deepEqual(policyHelper({ _client: {} }).getAutoAnswerJudgePolicy(),
    { route: 'gemini_fast', deadlineMs: 2500 });
  assert.deepEqual(policyHelper({ _client: {}, _openaiClient: {} }).getAutoAnswerJudgePolicy(),
    { route: 'default_provider', deadlineMs: 8000 },
    'fast Gemini keeps a 2.5s sub-budget while OpenAI gets a viable total fallback budget');
  assert.deepEqual(policyHelper({ customProvider: { id: 'custom' } }).getAutoAnswerJudgePolicy(),
    { route: 'user_endpoint', deadlineMs: 15000 });
  assert.deepEqual(policyHelper({ nativelyKey: 'test-key' }).getAutoAnswerJudgePolicy(),
    { route: 'server_cascade', deadlineMs: 13000 });
  assert.deepEqual(policyHelper({ useOllama: true }).getAutoAnswerJudgePolicy(),
    { route: 'local', deadlineMs: 30000 });

  assert.deepEqual(policyHelper({
    _openaiClient: {},
    customProvider: { id: 'custom' },
  }).getAutoAnswerJudgePolicy(),
    { route: 'user_endpoint', deadlineMs: 15000 },
    'a failing 8s OpenAI rung must not abort a healthy custom fallback before its 15s budget');

  assert.deepEqual(policyHelper({
    _claudeClient: {},
    nativelyKey: 'test-key',
  }).getAutoAnswerJudgePolicy(),
    { route: 'server_cascade', deadlineMs: 13000 },
    'a direct provider must leave enough time for the later server cascade');

  assert.deepEqual(policyHelper({
    _openaiClient: {},
    customProvider: { id: 'custom' },
    useOllama: true,
  }).getAutoAnswerJudgePolicy(),
    { route: 'local', deadlineMs: 30000 },
    'the shared controller must cover the longest reachable local fallback');
});

test('a stalled fast Gemini judge yields to the non-Gemini ladder without retrying Gemini there', async () => {
  let fallbackOptions;
  const helper = policyHelper({
    _client: {
      models: {
        generateContent: ({ config }) => new Promise((_resolve, reject) => {
          config.abortSignal.addEventListener('abort', () => reject(config.abortSignal.reason), { once: true });
        }),
      },
    },
    rateLimiters: { gemini: { acquire: async () => {} } },
  });
  helper.generateContentStructured = async (_message, opts) => {
    fallbackOptions = opts;
    return '{"is_ask":true}';
  };

  const result = await helper.generateJudgeVerdict('judge this', { deadlineMs: 10 });
  assert.equal(result, '{"is_ask":true}');
  assert.equal(fallbackOptions.skipGemini, true,
    'the already-timed-out Gemini stage must not be repeated ahead of the hosted fallback');
});

test('the controller AbortSignal stops the judge instead of entering its fallback ladder', async () => {
  let fallbackCalled = false;
  const helper = policyHelper({
    _client: {
      models: {
        generateContent: ({ config }) => new Promise((_resolve, reject) => {
          config.abortSignal.addEventListener('abort', () => reject(config.abortSignal.reason), { once: true });
        }),
      },
    },
    rateLimiters: { gemini: { acquire: async () => {} } },
  });
  helper.generateContentStructured = async () => { fallbackCalled = true; return '{}'; };
  const controller = new AbortController();
  const call = helper.generateJudgeVerdict('judge this', { signal: controller.signal, deadlineMs: 8000 });
  controller.abort(new Error('test deadline'));

  await assert.rejects(call, /test deadline/);
  assert.equal(fallbackCalled, false);
});
