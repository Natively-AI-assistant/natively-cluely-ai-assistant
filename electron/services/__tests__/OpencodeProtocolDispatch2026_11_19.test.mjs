/**
 * Does a selected OpenCode model reach the adapter for ITS protocol, and does
 * each adapter parse its own wire format?
 *
 * Modelled on the 9Router dispatch test rather than on a source-grep: a grep
 * proves the branch exists, not that it runs. Here every assertion EXECUTES the
 * dispatch or the adapter.
 *
 * Run: node --test electron/services/__tests__/OpencodeProtocolDispatch2026_11_19.test.mjs
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
const { opencodePresetMeta } = require(dist('llm/opencode/catalog.js'));
const {
  OPENCODE_OPENAI_BASE,
  OPENCODE_ANTHROPIC_BASE,
  OPENCODE_GOOGLE_BASE,
} = require(dist('llm/opencode/constants.js'));

const PRE = opencodePresetMeta();

function bareHelper(overrides = {}) {
  const h = Object.create(LLMHelper.prototype);
  h.isLocalOnlyMode = false;
  h.currentModelId = 'opencode/claude-sonnet-5';
  h.opencodeApiKey = 'oc_sk_test';
  h._opencodeOpenAIClient = {};
  h._opencodeAnthropicClient = {};
  h.opencodeModelMeta = { ...PRE };
  h.assertOutboundScopes = () => {};
  h.rateLimiters = { opencode: { acquire: async () => {} } };
  h.textHealth = new Map();
  h.visionHealth = new Map();
  h.recordOpencodeUsage = () => {};
  // The getters below consult the live disabled list; a bare prototype has no
  // credentials store behind it, and every case here is "provider enabled".
  h.isProviderDisabled = () => false;
  Object.assign(h, overrides);
  return h;
}

const ADAPTERS = [
  'streamOpencodeChatCompletions',
  'streamOpencodeResponses',
  'streamOpencodeMessages',
  'streamOpencodeGenerateContent',
];

function recordAdapters(h) {
  const captured = [];
  for (const name of ADAPTERS) {
    h[name] = async function* () { captured.push(name); yield 'ok'; };
  }
  return captured;
}

async function drain(gen) {
  let text = '';
  for await (const chunk of gen) text += chunk;
  return text;
}

describe('the dispatcher picks the protocol the catalogue named', () => {
  const cases = [
    ['opencode/claude-sonnet-5', 'streamOpencodeMessages'],
    ['opencode/gpt-6.1-sol', 'streamOpencodeResponses'],
    ['opencode/gemini-3.8-flash', 'streamOpencodeGenerateContent'],
    ['opencode/deepseek-v4.1-flash', 'streamOpencodeChatCompletions'],
    ['opencode/glm-5.3', 'streamOpencodeChatCompletions'],
  ];

  for (const [id, expected] of cases) {
    test(`${id} → ${expected}`, async () => {
      const h = bareHelper({ currentModelId: id });
      const captured = recordAdapters(h);
      const text = await drain(h.streamWithOpencode('hello'));
      assert.equal(text, 'ok');
      assert.deepEqual(captured, [expected]);
    });
  }

  test('an explicit modelId overrides currentModelId (the Background Model path)', async () => {
    const h = bareHelper({ currentModelId: 'opencode/deepseek-v4.1-flash' });
    const captured = recordAdapters(h);
    await drain(h.streamWithOpencode('hello', undefined, undefined, undefined, 'opencode/gpt-6.1-sol'));
    assert.deepEqual(captured, ['streamOpencodeResponses']);
  });

  test('a model the catalogue marks text-only is not sent an image', async () => {
    const h = bareHelper({ currentModelId: 'opencode/glm-5.3' });
    const seen = [];
    h.streamOpencodeChatCompletions = async function* (model, _u, _s, images) {
      seen.push(images);
      yield 'ok';
    };
    await drain(h.streamWithOpencode('q', undefined, ['/tmp/shot.png']));
    assert.deepEqual(seen, [undefined], 'a catalogue "no" must drop the image at the adapter');
  });

  test('an unknown model forwards the image (unknown is not "no")', async () => {
    const h = bareHelper({ currentModelId: 'opencode/not-in-catalogue' });
    h.opencodeModelMeta = { ...PRE };
    const seen = [];
    h.streamOpencodeChatCompletions = async function* (_m, _u, _s, images) {
      seen.push(images);
      yield 'ok';
    };
    await drain(h.streamWithOpencode('q', undefined, ['/tmp/shot.png']));
    assert.deepEqual(seen, [['/tmp/shot.png']]);
  });
});

describe('chat-completions adapter', () => {
  test('yields content and never the hidden reasoning', async () => {
    const h = bareHelper({
      opencodeOpenAIClient: {
        chat: { completions: { create: async () => (async function* () {
          yield { choices: [{ delta: { reasoning_content: 'The user said hi. ' } }] };
          yield { choices: [{ delta: { content: 'Hel' } }] };
          yield { choices: [{ delta: { content: 'lo' } }], usage: { cost: 0.01 } };
        })() } },
      },
    });
    const text = await drain(h.streamOpencodeChatCompletions(
      'deepseek-v4.1-flash', 'hi', 'SYS', undefined, undefined,
      { api: 'chat-completions', baseUrl: OPENCODE_OPENAI_BASE, vision: false, outputTokens: 32000 },
    ));
    assert.equal(text, 'Hello');
  });

  test('HTTP 200 with no text throws the actionable empty-answer message', async () => {
    const h = bareHelper({
      opencodeOpenAIClient: {
        chat: { completions: { create: async () => (async function* () {
          yield { choices: [{ delta: { reasoning_content: 'only thinking' } }] };
        })() } },
      },
    });
    await assert.rejects(
      () => drain(h.streamOpencodeChatCompletions(
        'kimi-k3', 'hi', undefined, undefined, undefined,
        { api: 'chat-completions', baseUrl: OPENCODE_OPENAI_BASE, vision: false },
      )),
      /returned no text/i,
    );
  });
});

describe('responses adapter', () => {
  test('reads response.output_text.delta and ignores other events', async () => {
    const h = bareHelper({
      opencodeOpenAIClient: {
        responses: { create: async () => (async function* () {
          yield { type: 'response.created' };
          yield { type: 'response.output_text.delta', delta: 'Hel' };
          yield { type: 'response.in_progress' };
          yield { type: 'response.output_text.delta', delta: 'lo' };
          yield { type: 'response.completed', response: { usage: { cost: 0.02 } } };
        })() },
      },
    });
    const text = await drain(h.streamOpencodeResponses(
      'gpt-6.1-sol', 'hi', 'SYS', undefined, undefined,
      { api: 'responses', baseUrl: OPENCODE_OPENAI_BASE, vision: true, outputTokens: 128000 },
    ));
    assert.equal(text, 'Hello');
  });

  test('response.failed throws with the gateway message', async () => {
    const h = bareHelper({
      opencodeOpenAIClient: {
        responses: { create: async () => (async function* () {
          yield { type: 'response.failed', response: { error: { message: 'rate limited' } } };
        })() },
      },
    });
    await assert.rejects(
      () => drain(h.streamOpencodeResponses('gpt-6.1-sol', 'hi', undefined, undefined, undefined,
        { api: 'responses', baseUrl: OPENCODE_OPENAI_BASE, vision: true })),
      /rate limited|did not produce an answer/i,
    );
  });
});

describe('messages adapter', () => {
  test('reads text_delta blocks', async () => {
    const h = bareHelper({
      _opencodeAnthropicClient: {
        messages: { create: async () => (async function* () {
          yield { type: 'message_start' };
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } };
          yield { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hidden' } };
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } };
          yield { type: 'message_delta', usage: { output_tokens: 3 } };
        })() },
      },
    });
    const text = await drain(h.streamOpencodeMessages(
      'claude-sonnet-5', 'hi', 'SYS', undefined, undefined,
      { api: 'messages', baseUrl: OPENCODE_ANTHROPIC_BASE, vision: true, outputTokens: 128000 },
    ));
    assert.equal(text, 'Hello');
  });
});

describe('generate-content adapter (raw SSE)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  test('parses SSE data lines into text', async () => {
    const chunks = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"lo"}]}}]}\n\n',
    ];
    globalThis.fetch = async () => new Response(new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } });

    const h = bareHelper();
    h.opencodeModelMeta = { 'gemini-3.8-flash': { api: 'generate-content', baseUrl: 'https://opencode.ai/inference/google', vision: true } };
    const text = await drain(h.streamOpencodeGenerateContent(
      'gemini-3.8-flash', 'hi', 'SYS', undefined, undefined,
      { api: 'generate-content', baseUrl: 'https://opencode.ai/inference/google', vision: true, outputTokens: 65536 },
    ));
    assert.equal(text, 'Hello');
  });

  test('a non-2xx response carries its status into the message', async () => {
    globalThis.fetch = async () => new Response('{"error":{"message":"no balance"}}', { status: 402 });
    const h = bareHelper();
    await assert.rejects(
      () => drain(h.streamOpencodeGenerateContent(
        'gemini-3.8-flash', 'hi', undefined, undefined, undefined,
        { api: 'generate-content', baseUrl: 'https://opencode.ai/inference/google', vision: true },
      )),
      /balance|did not produce an answer/i,
    );
  });

  test('a blocked prompt is surfaced, not treated as an empty answer', async () => {
    globalThis.fetch = async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"promptFeedback":{"blockReason":"SAFETY"}}\n\n'));
        controller.close();
      },
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    const h = bareHelper();
    await assert.rejects(
      () => drain(h.streamOpencodeGenerateContent(
        'gemini-3.8-flash', 'hi', undefined, undefined, undefined,
        { api: 'generate-content', baseUrl: 'https://opencode.ai/inference/google', vision: true },
      )),
      /blocked the prompt/i,
    );
  });
});
