// electron/llm/__tests__/OpenAiNoSamplingParams.test.mjs
//
// Regression guard for the OpenAI `temperature` 400 bug (users reported OpenAI
// failing even with a correct API key).
//
// OpenAI reasoning models — the gpt-5 family (incl. the DEFAULT model gpt-5.4)
// and the o-series (o1/o3/o4) — accept ONLY the default temperature (1) and
// reject custom temperature/seed/top_p/penalties with a 400:
//   "Unsupported value: 'temperature' does not support 0.2 with this model.
//    Only the default (1) value is supported."
// (OpenAI docs, verified 2026-06 via developers.openai.com — reasoning models
// are steered by reasoning_effort, not sampling params.)
//
// The streaming path used to send `temperature: 0.2, seed: 7` to every OpenAI
// model, so the default gpt-5.4 400'd on the first prompt. The product decision
// is to use the API default temperature for ALL OpenAI models (don't send
// temperature/seed at all). This test captures the EXACT request body sent to
// openaiClient.chat.completions.create at all three OpenAI call sites and asserts
// no sampling param is present — so a future edit that copies the Groq/DeepSeek
// (temperature+seed) block onto the OpenAI call fails HERE in CI instead of in
// production. See the OPENAI_NO_SAMPLING_PARAMS markers in LLMHelper.ts.
//
// Note: imports the compiled class from dist-electron (run `npm run build:electron`
// first, as the other __tests__ do). `private` is TS-only and erased in the
// emitted JS, so we can call the methods directly. We build the instance via
// Object.create(prototype) rather than `new LLMHelper(...)`: the real constructor
// pulls in ModelVersionManager → Electron's `app.getPath`, which is absent under
// the plain `node --test` runner this suite uses. The three OpenAI methods only
// touch openaiClient, isLocalOnlyMode, rateLimiters, and a few pure prototype
// helpers (assertOutboundScopes/scopesForPayload/getOpenAiPromptCacheKey), so a
// minimal hand-built instance exercises the exact request body they emit.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/LLMHelper.js');
const { LLMHelper } = await import(pathToFileURL(modPath).href);

// Params a reasoning model rejects with a 400 — none may appear on an OpenAI body.
const FORBIDDEN_SAMPLING_PARAMS = [
  'temperature',
  'seed',
  'top_p',
  'presence_penalty',
  'frequency_penalty',
  'logprobs',
  'top_logprobs',
];

// A stub OpenAI client that records every chat.completions.create body and
// returns a shape valid for both streaming and non-streaming callers.
function makeCapturingOpenAiClient(captured) {
  return {
    chat: {
      completions: {
        create: async (body) => {
          captured.push(body);
          if (body.stream) {
            return (async function* () { /* empty stream */ })();
          }
          return { choices: [{ message: { content: '' } }] };
        },
      },
    },
  };
}

async function drain(asyncGen) {
  for await (const _ of asyncGen) { /* consume */ }
}

// Build a minimal LLMHelper with the prototype methods but without running the
// Electron-dependent constructor. Only the fields the OpenAI paths read are set.
function makeHelperWithStub(captured) {
  const helper = Object.create(LLMHelper.prototype);
  helper.isLocalOnlyMode = false;
  // openai rate limiter: acquire() must resolve immediately and not need real timers.
  helper.rateLimiters = { openai: { acquire: async () => {} } };
  helper.openaiClient = makeCapturingOpenAiClient(captured);
  return helper;
}

describe('OpenAI requests omit ALL sampling params (default temperature for all models)', () => {
  test('streamWithOpenai / streamWithOpenaiMultimodal / generateWithOpenai send no temperature/seed/top_p', async () => {
    const captured = [];
    const helper = makeHelperWithStub(captured);

    // Drive all three OpenAI call sites with the DEFAULT reasoning model id.
    await drain(helper.streamWithOpenai('hi', 'sys', 'gpt-5.4'));
    await drain(helper.streamWithOpenaiMultimodal('hi', [], 'sys', 'gpt-5.4'));
    await helper.generateWithOpenai('hi', 'sys', undefined, 'gpt-5.4');

    assert.equal(captured.length, 3, 'all three OpenAI call sites were exercised');

    for (const body of captured) {
      assert.equal(body.model, 'gpt-5.4', 'request used the model under test');
      for (const key of FORBIDDEN_SAMPLING_PARAMS) {
        assert.ok(
          !(key in body),
          `OpenAI request must NOT send '${key}' — reasoning models 400 on non-default sampling. ` +
          `Body keys: [${Object.keys(body).join(', ')}]`,
        );
      }
      // The legitimate params we DO expect must still be there.
      assert.ok('max_completion_tokens' in body, 'output cap must still be sent');
      assert.ok('messages' in body, 'messages must still be sent');
    }
  });

  test('same holds for o-series and original gpt-5 reasoning models', async () => {
    for (const model of ['o3', 'o1-mini', 'gpt-5', 'gpt-5.5']) {
      const captured = [];
      const helper = makeHelperWithStub(captured);

      await drain(helper.streamWithOpenai('hi', 'sys', model));

      assert.equal(captured.length, 1);
      for (const key of FORBIDDEN_SAMPLING_PARAMS) {
        assert.ok(!(key in captured[0]), `${model}: must not send '${key}'`);
      }
    }
  });
});
