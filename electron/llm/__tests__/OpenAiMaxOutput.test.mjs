// electron/llm/__tests__/OpenAiMaxOutput.test.mjs
//
// Regression test for issue #298 — "400 max_tokens is too large".
//
// All three OpenAI call sites in LLMHelper (streamWithOpenai,
// streamWithOpenaiMultimodal, generateWithOpenai) used to send the global
// MAX_OUTPUT_TOKENS = 65536 as max_completion_tokens for any non-Claude model.
// OpenAI rejects a max above the model's documented output cap with a 400
// ("This model supports at most 16384 completion tokens, whereas you provided
// 65536."), so a user on gpt-4o hit the error on the very first "Hi" prompt.
//
// The fix routes the requested budget through getOpenAiMaxOutput(model, requested),
// which clamps to each model's real ceiling. This test pins those ceilings so the
// regression can't silently return.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { getOpenAiMaxOutput } from '../../../dist-electron/electron/llm/index.js';

// The global default the call sites pass in (LLMHelper MAX_OUTPUT_TOKENS).
const REQUESTED = 65536;

// Documented OpenAI Chat Completions output (completion) token ceilings, 2026-06.
const MODEL_CAPS = [
  ['gpt-4o', 16384],
  ['gpt-4o-2024-08-06', 16384],
  ['gpt-4o-mini', 16384],
  ['gpt-4.1', 32768],
  ['gpt-4.1-mini', 32768],
  ['gpt-4-turbo', 4096],
  ['gpt-4-1106-preview', 4096],
  ['gpt-4-vision-preview', 4096],
  ['gpt-4', 8192],
  ['gpt-3.5-turbo', 4096],
];

describe('getOpenAiMaxOutput (issue #298)', () => {
  for (const [model, cap] of MODEL_CAPS) {
    test(`${model} never exceeds its ${cap}-token output cap`, () => {
      const sent = getOpenAiMaxOutput(model, REQUESTED);
      assert.ok(
        sent <= cap,
        `${model} would send max_completion_tokens=${sent}, exceeding cap ${cap} → OpenAI 400`
      );
      // Should hand back the full model cap, not something smaller, so we don't
      // needlessly truncate long answers.
      assert.equal(sent, Math.min(REQUESTED, cap));
    });
  }

  test('gpt-5.x and o-series keep the full requested budget at the current default', () => {
    // REQUESTED (65536) is below both families' caps, so it passes through.
    for (const model of ['gpt-5.4', 'gpt-5.5', 'gpt-5', 'o1-mini', 'o3-mini', 'o4-mini']) {
      assert.equal(
        getOpenAiMaxOutput(model, REQUESTED),
        REQUESTED,
        `${model} should not be capped below the requested ${REQUESTED}`
      );
    }
  });

  test('gpt-5.x caps at 128000, o-series at 100000 if a larger budget is requested', () => {
    // Guards against a future MAX_OUTPUT_TOKENS bump silently re-introducing the 400.
    const HUGE = 200000;
    for (const model of ['gpt-5', 'gpt-5.1', 'gpt-5.2', 'gpt-5.4', 'gpt-5.5', 'gpt-5-mini']) {
      assert.equal(getOpenAiMaxOutput(model, HUGE), 128000, `${model} must cap at 128000`);
    }
    for (const model of ['o1', 'o1-mini', 'o3', 'o3-mini', 'o4-mini']) {
      assert.equal(getOpenAiMaxOutput(model, HUGE), 100000, `${model} must cap at 100000`);
    }
  });

  test('never returns more than the requested budget', () => {
    // A small request must never be inflated by the cap.
    for (const [model] of MODEL_CAPS) {
      assert.equal(getOpenAiMaxOutput(model, 512), 512);
    }
    assert.equal(getOpenAiMaxOutput('gpt-5.4', 512), 512);
  });

  test('unknown OpenAI-compatible id falls back to a safe 16384', () => {
    assert.equal(getOpenAiMaxOutput('some-custom-openai-proxy', REQUESTED), 16384);
  });

  test('is case-insensitive on the model id', () => {
    assert.equal(getOpenAiMaxOutput('GPT-4O', REQUESTED), 16384);
  });
});
