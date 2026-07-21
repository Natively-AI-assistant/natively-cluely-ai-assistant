// electron/llm/__tests__/OpenAiReasoningEffort.test.mjs
//
// Regression test for the reasoning_effort 400 bug.
//
// OpenAI's `reasoning_effort` valid set differs per model family, and `minimal`
// was removed after the original gpt-5 line. The code used to hardcode
// `reasoning_effort: 'minimal'` for every gpt-5.x / o-series model, so the
// DEFAULT OpenAI model (gpt-5.4) — and gpt-5.5, o1/o3/o4 — were rejected with a
// 400 ("invalid value for reasoning_effort"). getOpenAiReasoningEffort returns the
// lowest VALID effort per family (or null to omit the param). This test pins the
// per-family mapping so the regression can't return.
//
// Supported sets (OpenAI docs, 2026-06):
//   gpt-5 / -mini / -nano (original)   minimal, low, medium, high
//   gpt-5.1 / 5.2 / 5.4 / 5.5          none, low, medium, high (+xhigh on some)
//   gpt-5-codex / 5.x-codex            low, medium, high
//   gpt-5-pro                          high only
//   o1 / o3 / o4 (+ -mini/-pro)        low, medium, high
//   gpt-4* / gpt-3.5 / non-OpenAI      param not supported

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { getOpenAiReasoningEffort } from '../../../dist-electron/electron/llm/index.js';

// The valid effort set per model, used to assert our pick is actually accepted.
const VALID = {
  'gpt-5': ['minimal', 'low', 'medium', 'high'],
  'gpt-5-mini': ['minimal', 'low', 'medium', 'high'],
  'gpt-5-nano': ['minimal', 'low', 'medium', 'high'],
  'gpt-5-2025-08-07': ['minimal', 'low', 'medium', 'high'],
  'gpt-5.1': ['none', 'low', 'medium', 'high'],
  'gpt-5.2': ['none', 'low', 'medium', 'high', 'xhigh'],
  'gpt-5.4': ['none', 'low', 'medium', 'high', 'xhigh'],
  'gpt-5.5': ['none', 'low', 'medium', 'high', 'xhigh'],
  'gpt-5-codex': ['low', 'medium', 'high'],
  'gpt-5.1-codex': ['low', 'medium', 'high'],
  'gpt-5.2-codex': ['low', 'medium', 'high', 'xhigh'],
  'gpt-5-pro': ['high'],
  'o1': ['low', 'medium', 'high'],
  'o1-mini': ['low', 'medium', 'high'],
  'o3': ['low', 'medium', 'high'],
  'o3-mini': ['low', 'medium', 'high'],
  'o4-mini': ['low', 'medium', 'high'],
};

describe('getOpenAiReasoningEffort — picks a VALID effort per family', () => {
  for (const [model, valid] of Object.entries(VALID)) {
    test(`${model} → an accepted value (never the removed 'minimal' on 5.1+)`, () => {
      const effort = getOpenAiReasoningEffort(model);
      assert.notEqual(effort, null, `${model} is a reasoning model; should set an effort`);
      assert.ok(
        valid.includes(effort),
        `${model} got reasoning_effort='${effort}', not in valid set [${valid.join(', ')}] → OpenAI 400`
      );
    });
  }

  test("default model gpt-5.4 uses 'low', not the invalid 'minimal'", () => {
    assert.equal(getOpenAiReasoningEffort('gpt-5.4'), 'low');
  });

  test("gpt-5.1 / 5.2 / 5.5 use 'low'", () => {
    assert.equal(getOpenAiReasoningEffort('gpt-5.1'), 'low');
    assert.equal(getOpenAiReasoningEffort('gpt-5.2'), 'low');
    assert.equal(getOpenAiReasoningEffort('gpt-5.5'), 'low');
  });

  test("original gpt-5 line keeps 'minimal' (the only family that supports it)", () => {
    assert.equal(getOpenAiReasoningEffort('gpt-5'), 'minimal');
    assert.equal(getOpenAiReasoningEffort('gpt-5-mini'), 'minimal');
    assert.equal(getOpenAiReasoningEffort('gpt-5-nano'), 'minimal');
  });

  test('o-series picks low (minimal/none unsupported)', () => {
    for (const m of ['o1', 'o3', 'o3-mini', 'o4-mini']) {
      assert.equal(getOpenAiReasoningEffort(m), 'low');
    }
  });

  test('gpt-5-pro picks high (only accepted value)', () => {
    assert.equal(getOpenAiReasoningEffort('gpt-5-pro'), 'high');
  });

  test('non-reasoning and non-OpenAI models return null (param omitted)', () => {
    for (const m of ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo', 'gpt-4', 'claude-sonnet-4-6', 'some-custom-proxy', '']) {
      assert.equal(getOpenAiReasoningEffort(m), null);
    }
  });

  test('is case-insensitive', () => {
    assert.equal(getOpenAiReasoningEffort('GPT-5.4'), 'low');
    assert.equal(getOpenAiReasoningEffort('O3-MINI'), 'low');
  });
});
