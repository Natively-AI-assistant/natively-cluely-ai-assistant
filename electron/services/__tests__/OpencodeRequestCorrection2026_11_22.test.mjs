/**
 * The OpenCode adapters correct ONE parameter per attempt when a model rejects
 * it (the reasoning setting, then the output cap), and explain anything else
 * exactly once.
 *
 * Pinned because the first version never fired the cap correction: each SDK
 * error was turned into a friendly sentence BEFORE it was classified, and the
 * friendly sentence no longer said `max_tokens`. A 400 for the output cap then
 * made one request and told the user "the retry uses the model's own ceiling" —
 * a retry that never happened. These cases count the requests, so a
 * classification that stops matching fails here instead of in a live meeting.
 *
 * Run: node --test electron/services/__tests__/OpencodeRequestCorrection2026_11_22.test.mjs
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);

// CredentialsManager (imported transitively) reads app.getPath at module scope.
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: {
    app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};

const { LLMHelper } = require(dist('LLMHelper.js'));
const {
  OPENCODE_OPENAI_BASE,
  OPENCODE_ANTHROPIC_BASE,
  OPENCODE_GOOGLE_BASE,
  OPENCODE_MESSAGES_FALLBACK_TOKENS,
} = require(dist('llm/opencode/constants.js'));
const { opencodeRejectsOutputCap, opencodeRejectsReasoning } = require(dist('llm/opencode/errors.js'));

const BASES = {
  'chat-completions': OPENCODE_OPENAI_BASE,
  responses: OPENCODE_OPENAI_BASE,
  messages: OPENCODE_ANTHROPIC_BASE,
  'generate-content': OPENCODE_GOOGLE_BASE,
};

/** An openai-node / anthropic-sdk APIError: a numeric status and the provider's text. */
const apiError = (status, message) =>
  Object.assign(new Error(`${status} ${message}`), { status, error: { message } });

function okStream(family) {
  if (family === 'responses') {
    return (async function* () { yield { type: 'response.output_text.delta', delta: 'ok' }; })();
  }
  if (family === 'messages') {
    return (async function* () { yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }; })();
  }
  return (async function* () { yield { choices: [{ delta: { content: 'ok' } }] }; })();
}

/**
 * A bare helper whose SDK clients reject the FIRST request with `firstError`
 * (or a function of the request) and stream "ok" afterwards.
 */
function harness({ family, model, meta = {}, firstError, onCreate }) {
  const h = Object.create(LLMHelper.prototype);
  h.isLocalOnlyMode = false;
  h.currentModelId = `opencode/${model}`;
  h.opencodeApiKey = 'oc_sk_test';
  h.assertOutboundScopes = () => {};
  h.rateLimiters = { opencode: { acquire: async () => {} } };
  h.textHealth = new Map();
  h.visionHealth = new Map();
  h.recordOpencodeUsage = () => {};
  h.isProviderDisabled = () => false;
  h.opencodeModelMeta = { [model]: { api: family, baseUrl: BASES[family], vision: false, ...meta } };

  const requests = [];
  const create = async (request) => {
    requests.push(request);
    onCreate?.(request, requests.length);
    if (requests.length === 1 && firstError) throw firstError;
    return okStream(family);
  };
  const openai = { chat: { completions: { create } }, responses: { create } };
  openai.withOptions = () => openai;
  const anthropic = { messages: { create } };
  anthropic.withOptions = () => anthropic;
  h._opencodeOpenAIClient = openai;
  h._opencodeAnthropicClient = anthropic;
  return { h, requests };
}

async function drain(gen) {
  let text = '';
  for await (const chunk of gen) text += chunk;
  return text;
}

describe('the output cap is corrected, on every protocol', () => {
  test('chat-completions: a 400 naming max_tokens retries once WITHOUT max_tokens', async () => {
    const { h, requests } = harness({
      family: 'chat-completions', model: 'glm-5.3',
      firstError: apiError(400, 'max_tokens: 65536 is greater than the maximum allowed (8192) for this model'),
    });
    assert.equal(await drain(h.streamWithOpencode('hi', 'sys', undefined, undefined, 'opencode/glm-5.3')), 'ok');
    assert.equal(requests.length, 2);
    assert.equal(requests[0].max_tokens, 65536);
    assert.equal('max_tokens' in requests[1], false);
  });

  test('chat-completions: a 422 is a rejection too', async () => {
    const { h, requests } = harness({
      family: 'chat-completions', model: 'glm-5.3',
      firstError: apiError(422, 'max_tokens must be <= 8192'),
    });
    assert.equal(await drain(h.streamWithOpencode('hi', 'sys', undefined, undefined, 'opencode/glm-5.3')), 'ok');
    assert.equal(requests.length, 2);
  });

  test('responses: a 400 naming max_output_tokens retries without it', async () => {
    const { h, requests } = harness({
      family: 'responses', model: 'gpt-6.1-sol',
      firstError: apiError(400, 'max_output_tokens exceeds the model limit of 32768'),
    });
    assert.equal(await drain(h.streamWithOpencode('hi', 'sys', undefined, undefined, 'opencode/gpt-6.1-sol')), 'ok');
    assert.equal(requests.length, 2);
    assert.equal('max_output_tokens' in requests[1], false);
  });

  test('messages: max_tokens is REQUIRED, so the retry lowers it instead of dropping it', async () => {
    const { h, requests } = harness({
      family: 'messages', model: 'qwen3.8-flash',
      firstError: apiError(400, 'max_tokens: 8192 > 4096, which is the maximum allowed'),
    });
    assert.equal(await drain(h.streamWithOpencode('hi', 'sys', undefined, undefined, 'opencode/qwen3.8-flash')), 'ok');
    assert.equal(requests.length, 2);
    assert.equal(requests[0].max_tokens, 8192);
    assert.equal(requests[1].max_tokens, OPENCODE_MESSAGES_FALLBACK_TOKENS);
  });

  test('messages: no pointless retry when the cap is already at the floor', async () => {
    const { h, requests } = harness({
      family: 'messages', model: 'qwen3.8-flash', meta: { outputTokens: 2048 },
      firstError: apiError(400, 'max_tokens: 2048 is too large'),
    });
    await assert.rejects(drain(h.streamWithOpencode('hi', 'sys', undefined, undefined, 'opencode/qwen3.8-flash')));
    assert.equal(requests.length, 1);
  });

  describe('generate-content (raw fetch)', () => {
    const realFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = realFetch; });

    test('a 400 naming maxOutputTokens retries without generationConfig', async () => {
      const bodies = [];
      globalThis.fetch = async (_url, init) => {
        bodies.push(JSON.parse(init.body));
        if (bodies.length === 1) {
          return new Response(JSON.stringify({ error: { code: 400, message: 'Invalid value for maxOutputTokens: must be <= 32768' } }), { status: 400 });
        }
        return new Response('data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n', { status: 200 });
      };
      const { h } = harness({ family: 'generate-content', model: 'gemini-3.8-flash' });
      assert.equal(await drain(h.streamWithOpencode('hi', 'sys', undefined, undefined, 'opencode/gemini-3.8-flash')), 'ok');
      assert.equal(bodies.length, 2);
      assert.ok(bodies[0].generationConfig, 'the first attempt carries the cap');
      assert.equal('generationConfig' in bodies[1], false);
    });
  });
});

describe('the reasoning setting is corrected', () => {
  test('a 400 naming reasoning_effort retries once without it', async () => {
    const { h, requests } = harness({
      family: 'chat-completions', model: 'glm-5.3', meta: { reasoning: true, reasoningEffort: ['low', 'high'] },
      firstError: apiError(400, 'Unsupported parameter: reasoning_effort'),
    });
    assert.equal(await drain(h.streamWithOpencode('hi', 'sys', undefined, undefined, 'opencode/glm-5.3')), 'ok');
    assert.equal(requests.length, 2);
    assert.equal(requests[0].reasoning_effort, 'low');
    assert.equal('reasoning_effort' in requests[1], false);
  });
});

describe('what is NOT corrected', () => {
  test('a model NAMED "thinking" does not turn an unrelated 400 into a reasoning retry', async () => {
    const { h, requests } = harness({
      family: 'chat-completions', model: 'kimi-k3-thinking', meta: { reasoning: true, reasoningEffort: ['low'] },
      firstError: apiError(400, 'kimi-k3-thinking: messages[0].content is invalid'),
    });
    await assert.rejects(
      drain(h.streamWithOpencode('hi', 'sys', undefined, undefined, 'opencode/kimi-k3-thinking')),
      (e) => e.provider === 'opencode' && e.status === 400 && /did not produce an answer/.test(e.message),
    );
    assert.equal(requests.length, 1);
  });

  test('a cancelled turn is not retried and ends quietly', async () => {
    const controller = new AbortController();
    const { h, requests } = harness({
      family: 'chat-completions', model: 'glm-5.3',
      onCreate: () => {
        controller.abort();
        throw Object.assign(new Error('Request was aborted.'), { name: 'AbortError' });
      },
    });
    assert.equal(await drain(h.streamWithOpencode('hi', 'sys', undefined, controller.signal, 'opencode/glm-5.3')), '');
    assert.equal(requests.length, 1);
  });

  test('an uncorrectable failure is explained once, keeping status, provider and the raw cause', async () => {
    const raw = apiError(401, 'invalid api key');
    const { h } = harness({ family: 'chat-completions', model: 'glm-5.3', firstError: raw });
    await assert.rejects(
      drain(h.streamWithOpencode('hi', 'sys', undefined, undefined, 'opencode/glm-5.3')),
      (e) => e.status === 401 && e.provider === 'opencode' && e.cause === raw && /rejected the API key/.test(e.message),
    );
  });
});

describe('the classifiers read the provider, never the model name', () => {
  test('output-cap wording, across the protocols', () => {
    assert.equal(opencodeRejectsOutputCap(apiError(400, 'max_tokens too large'), 'm'), true);
    assert.equal(opencodeRejectsOutputCap(apiError(400, 'max_output_tokens too large'), 'm'), true);
    assert.equal(opencodeRejectsOutputCap(apiError(400, 'Invalid maxOutputTokens'), 'm'), true);
    assert.equal(opencodeRejectsOutputCap(apiError(422, 'maximum tokens exceeded'), 'm'), true);
    assert.equal(opencodeRejectsOutputCap(apiError(500, 'max_tokens too large'), 'm'), false, '5xx is not a rejection');
    assert.equal(opencodeRejectsOutputCap(apiError(400, 'messages is required'), 'm'), false);
  });

  test('a SHORT model id removes only itself, never letters inside other words', () => {
    // The first version split on the raw id, so model `m` deleted every "m"
    // and "max_tokens" stopped matching.
    assert.equal(opencodeRejectsOutputCap(apiError(400, 'max_tokens too large for m'), 'm'), true);
    assert.equal(opencodeRejectsReasoning(apiError(400, 'effort not supported'), 'e'), true);
  });

  test('reasoning wording, with the model id removed first', () => {
    assert.equal(opencodeRejectsReasoning(apiError(400, 'unsupported: reasoning_effort'), 'glm-5.3'), true);
    assert.equal(opencodeRejectsReasoning(apiError(400, 'kimi-k3-thinking: bad content'), 'kimi-k3-thinking'), false);
    assert.equal(opencodeRejectsReasoning(apiError(400, 'kimi-k3-thinking does not support reasoning'), 'opencode/kimi-k3-thinking'), true);
  });
});
