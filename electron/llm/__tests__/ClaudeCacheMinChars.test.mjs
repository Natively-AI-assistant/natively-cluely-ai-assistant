// electron/llm/__tests__/ClaudeCacheMinChars.test.mjs
//
// Regression test for the prompt-cache minimum-size gate in
// LLMHelper.getClaudeCacheMinChars.
//
// The threshold returned here decides whether a Claude request is large enough
// for Anthropic to engage prompt caching. Below it, caching is silently skipped
// (cache_creation_input_tokens stays 0 and full input price is paid every turn),
// so an undersized floor for a live model quietly defeats caching.
//
// The first branch used to enumerate Opus point releases by exact prefix
// (claude-opus-4-7 / 4-6 / 4-5). claude-opus-4-8 was not listed, so it fell
// through to the generic claude- branch and got 1,024 tokens instead of the
// 4,096 every Opus 4.5+ model requires. The fix matches on the claude-opus-4-
// family prefix (mirroring getClaudeMaxOutput) while keeping the Opus 4.0/4.1
// carve-out at 1,024. This test pins the per-model floors so the regression
// can't silently return when the next Opus point release ships.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/ClaudeCacheMinChars.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LLMHelper } = require('../../../dist-electron/electron/LLMHelper.js');

// getClaudeCacheMinChars is a pure private method (reads only its modelId arg).
// Construct a prototype-only instance and invoke it the same way the existing
// LLMHelper unit tests reach private methods (see
// NegotiationStickinessAndCircuitBreaker.test.mjs), so we exercise the real
// shipped logic rather than a re-implementation.
const minChars = (modelId) =>
  LLMHelper.prototype.getClaudeCacheMinChars.call(Object.create(LLMHelper.prototype), modelId);

const K = 4; // chars per token used by the helper

describe('getClaudeCacheMinChars per-model prompt-cache floor', () => {
  test('claude-opus-4-8 requires the 4,096-token (16,384-char) floor', () => {
    assert.equal(minChars('claude-opus-4-8'), 4096 * K);
    assert.equal(minChars('claude-opus-4-8'), 16384);
  });

  test('every Opus 4.5+ point release gets the 16,384-char floor', () => {
    for (const id of ['claude-opus-4-5', 'claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8']) {
      assert.equal(minChars(id), 4096 * K, `${id} must require 4,096 tokens`);
    }
  });

  test('Haiku 4.5 keeps the 4,096-token floor', () => {
    assert.equal(minChars('claude-haiku-4-5'), 4096 * K);
  });

  test('Opus 4.0 / 4.1 stay at the 1,024-token floor (predate the bump)', () => {
    assert.equal(minChars('claude-opus-4-0'), 1024 * K);
    assert.equal(minChars('claude-opus-4-1'), 1024 * K);
    // Dated snapshot ids must still hit the carve-out.
    assert.equal(minChars('claude-opus-4-1-20250805'), 1024 * K);
    assert.equal(minChars('claude-opus-4-0-20250514'), 1024 * K);
  });

  test('a hypothetical claude-opus-4-10 is not captured by the 4.1 carve-out', () => {
    // The 4.0/4.1 guard anchors on a terminal version digit, so a future
    // two-digit point release still gets the 4,096-token Opus floor.
    assert.equal(minChars('claude-opus-4-10'), 4096 * K);
    assert.equal(minChars('claude-opus-4-11'), 4096 * K);
  });

  test('Sonnet 4.6 uses the 2,048-token floor', () => {
    assert.equal(minChars('claude-sonnet-4-6'), 2048 * K);
  });

  test('Haiku 3.5 uses the 2,048-token floor', () => {
    assert.equal(minChars('claude-3-5-haiku-20241022'), 2048 * K);
    assert.equal(minChars('claude-haiku-3-5'), 2048 * K);
  });

  test('other Claude models fall back to the 1,024-token floor', () => {
    assert.equal(minChars('claude-sonnet-4-5'), 1024 * K);
  });

  test('unknown non-Claude model gets the conservative 4,096-token floor', () => {
    assert.equal(minChars('some-unknown-model'), 4096 * K);
  });

  test('model id matching is case-insensitive', () => {
    assert.equal(minChars('CLAUDE-OPUS-4-8'), 4096 * K);
  });
});
