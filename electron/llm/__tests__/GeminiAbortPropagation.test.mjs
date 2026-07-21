// electron/llm/__tests__/GeminiAbortPropagation.test.mjs
//
// MEDIUM (audit finding #4) — Gemini streaming abort was observe-only: the code
// checked abortSignal at the generator boundary but never passed it into the
// @google/genai SDK, so a cancelled stream kept generating/billing upstream until
// it finished on its own. The fix threads config.abortSignal into
// client.models.generateContentStream and treats an abort-induced SDK rejection as
// a clean stop.
//
// This drives the REAL compiled LLMHelper.streamWithGeminiModel with a fake
// GoogleGenAI client that (a) records the config it receives and (b) can simulate
// an abort-rejecting iterator. Run under the Electron ABI:
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test <file>

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const llmPath = path.resolve(__dirname, '../../../dist-electron/electron/LLMHelper.js');
const { LLMHelper } = await import(pathToFileURL(llmPath).href);

// The full LLMHelper ctor constructs a ModelVersionManager that needs Electron's
// app.getPath (absent under ELECTRON_RUN_AS_NODE). We only exercise the private
// generator streamWithGeminiModel, so invoke it on a MINIMAL `this` that supplies
// exactly the fields it reads — the real compiled method body runs unchanged.
function makeCtx(streamFactory) {
  const captured = { configs: [] };
  const ctx = {
    isLocalOnlyMode: false,
    client: {
      models: {
        generateContentStream: async ({ config }) => {
          captured.configs.push(config);
          return streamFactory(config);
        },
      },
    },
    assertOutboundScopes: () => {},
    rateLimiters: { gemini: { acquire: async () => {} } },
    // No system instruction is passed by the tests → cache path is never hit, but
    // provide a benign stub for safety.
    geminiPromptCache: {
      getCachedOrWarmInBackground: () => null,
      invalidate: () => {},
    },
    processImage: async () => ({ mimeType: 'image/png', data: '' }),
  };
  const stream = LLMHelper.prototype.streamWithGeminiModel;
  return { run: (...args) => stream.apply(ctx, args), captured };
}

function chunk(text) {
  return { text: () => text };
}

describe('Gemini abort propagation (audit finding #4)', () => {
  test('the caller AbortSignal is passed into the SDK config', async () => {
    const controller = new AbortController();
    async function* normalStream() { yield chunk('hello'); yield chunk(' world'); }
    const { run, captured } = makeCtx(() => normalStream());

    const out = [];
    // No system instruction → no prompt-cache round trip.
    for await (const t of run('hi', 'gemini-3.1-flash-lite', undefined, undefined, controller.signal, 0)) {
      out.push(t);
    }

    assert.equal(captured.configs.length, 1, 'generateContentStream called once');
    assert.equal(captured.configs[0].abortSignal, controller.signal,
      'caller AbortSignal must be threaded into config.abortSignal');
    assert.deepEqual(out, ['hello', ' world']);
  });

  test('no signal → no abortSignal key (backward compatible)', async () => {
    async function* normalStream() { yield chunk('x'); }
    const { run, captured } = makeCtx(() => normalStream());
    for await (const _ of run('hi', 'gemini-3.1-flash-lite', undefined, undefined, undefined, 0)) { /* drain */ }
    assert.ok(!('abortSignal' in captured.configs[0]), 'no abortSignal key when caller passed none');
  });

  test('an abort-rejecting iterator is swallowed as a clean stop (no throw)', async () => {
    const controller = new AbortController();
    // A stream that yields one token, then rejects with an AbortError on the next pull.
    async function* abortingStream() {
      yield chunk('partial');
      controller.abort();
      const e = new Error('The operation was aborted');
      e.name = 'AbortError';
      throw e;
    }
    const { run } = makeCtx(() => abortingStream());

    const out = [];
    await assert.doesNotReject(async () => {
      for await (const t of run('hi', 'gemini-3.1-flash-lite', undefined, undefined, controller.signal, 0)) {
        out.push(t);
      }
    });
    assert.deepEqual(out, ['partial'], 'tokens before the abort are still delivered');
  });

  test('a NON-abort SDK error still propagates', async () => {
    async function* erroringStream() {
      yield chunk('partial');
      throw new Error('genuine provider 500');
    }
    const { run } = makeCtx(() => erroringStream());
    await assert.rejects(async () => {
      for await (const _ of run('hi', 'gemini-3.1-flash-lite', undefined, undefined, undefined, 0)) { /* drain */ }
    }, /genuine provider 500/);
  });
});

describe('Gemini abort source guard', () => {
  test('compiled LLMHelper threads abortSignal into the stream config', () => {
    const src = fs.readFileSync(llmPath, 'utf8');
    assert.match(src, /abortSignal\s*\?\s*\{\s*abortSignal\s*\}\s*:/,
      'buildConfig must spread { abortSignal } when a signal is present');
  });
});
