// electron/llm/__tests__/GroqModelLadder2026_08_23.test.mjs
//
// Natively's Groq default (`qwen/qwen3.6-27b`) is PREVIEW tier, and Groq's docs
// say preview models can be discontinued without notice. That is exactly how the
// previous pins died — llama-3.3-70b-versatile (2026-08-16) and llama-4-scout
// (2026-07-17) — and while they were dead every Groq call 404'd, which the UI
// reported as a broken API key.
//
// The ladder makes a retirement survivable: try the preview model, and on a
// model-gone error ONLY, retry once on a PRODUCTION-tier id that carries Groq's
// deprecation-notice guarantee.
//
// The load-bearing rule is the negative one. Laddering on an auth failure or a
// rate limit would fire a second doomed request AND report the wrong remedy
// ("model retired" when the key is simply invalid). A 403 whose body quotes a
// model name is an auth problem, not a retirement — that ordering is why this
// delegates to classifyVisionError instead of pattern-matching afresh.
//
// Platform note: pure constants and string matching — one suite covers macOS and
// Windows identically.
//
// Run: npm run build:electron, then node --test on this file.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const load = (rel) => import(pathToFileURL(path.resolve(__dirname, rel)).href);

const {
  GROQ_PRIMARY_MODEL,
  GROQ_PRODUCTION_FALLBACK_MODEL,
  GROQ_TEXT_MODEL_LADDER,
  groqFallbackFor,
  isGroqModelGone,
} = await load('../../../dist-electron/electron/llm/groqModels.js');

const { isRetiredModelId } = await load('../../../dist-electron/electron/services/ModelVersionManager.js');

describe('the ladder ends somewhere durable', () => {
  test('the primary is the preview-tier multimodal model', () => {
    assert.equal(GROQ_PRIMARY_MODEL, 'qwen/qwen3.6-27b');
    assert.equal(GROQ_TEXT_MODEL_LADDER[0], GROQ_PRIMARY_MODEL);
  });

  test('THE POINT: the last rung is a PRODUCTION-tier model, not another preview one', () => {
    const last = GROQ_TEXT_MODEL_LADDER[GROQ_TEXT_MODEL_LADDER.length - 1];
    assert.equal(last, GROQ_PRODUCTION_FALLBACK_MODEL);
    assert.equal(last, 'openai/gpt-oss-120b');
    assert.notEqual(last, GROQ_PRIMARY_MODEL, 'a ladder whose fallback is the primary is not a ladder');
  });

  test('no rung is a model Groq has already switched off', () => {
    for (const id of GROQ_TEXT_MODEL_LADDER) {
      assert.equal(isRetiredModelId(id), false, `${id} is on the retired list`);
    }
  });
});

describe('groqFallbackFor walks the ladder exactly once per rung', () => {
  test('the primary falls back to the production model', () => {
    assert.equal(groqFallbackFor(GROQ_PRIMARY_MODEL), GROQ_PRODUCTION_FALLBACK_MODEL);
  });

  test('the last rung has nowhere to go — the caller must surface the error', () => {
    assert.equal(groqFallbackFor(GROQ_PRODUCTION_FALLBACK_MODEL), null);
  });

  test('a model the USER picked is never silently rerouted', () => {
    assert.equal(groqFallbackFor('openai/gpt-oss-20b'), null);
    assert.equal(groqFallbackFor('llama-3.3-70b-versatile'), null);
  });
});

describe('isGroqModelGone: only a retirement advances the ladder', () => {
  const axiosErr = (status, data) => ({ response: { status, data }, message: `Request failed with status code ${status}` });
  const sdkErr = (status, message) => ({ status, message });

  test('404 with Groq\'s own body is model-gone (axios shape)', () => {
    assert.equal(
      isGroqModelGone(axiosErr(404, { error: { message: 'The model `qwen/qwen3.6-27b` does not exist or you do not have access to it' } })),
      true,
    );
  });

  test('404 is model-gone (SDK shape)', () => {
    assert.equal(isGroqModelGone(sdkErr(404, 'model_not_found')), true);
  });

  test('a decommissioned notice is model-gone even without a 404', () => {
    assert.equal(isGroqModelGone(sdkErr(400, 'The model has been decommissioned')), true);
  });

  test('THE FAILURE MODE: a bad key must NOT ladder', () => {
    assert.equal(isGroqModelGone(axiosErr(401, { error: { message: 'Invalid API Key' } })), false);
  });

  test('a 403 whose body quotes a model name is auth, not a retirement', () => {
    assert.equal(
      isGroqModelGone(axiosErr(403, { error: { message: 'You do not have access, invalid_api_key for model qwen/qwen3.6-27b' } })),
      false,
    );
  });

  test('a rate limit must NOT ladder — the model is fine, the account is throttled', () => {
    assert.equal(isGroqModelGone(axiosErr(429, { error: { message: 'Rate limit reached' } })), false);
  });

  test('a timeout must NOT ladder', () => {
    assert.equal(isGroqModelGone({ message: 'timeout of 15000ms exceeded' }), false);
  });

  test('a 500 must NOT ladder — a transient upstream fault is not a retirement', () => {
    assert.equal(isGroqModelGone(axiosErr(500, { error: { message: 'Internal Server Error' } })), false);
  });
});
