// The What-To-Answer catch must name a provider failure instead of asking the
// user to repeat the question (2026-09-07).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { providerFailureUserMessage } = require(path.resolve(process.cwd(), 'dist-electron/electron/llm/providerErrorClassifier.js'));
const { isClarificationStall } = require(path.resolve(process.cwd(), 'dist-electron/electron/llm/providerErrorClassifier.js'));

describe('providerFailureUserMessage', () => {
  test('auth, rate-limit and outage errors get an actionable line', () => {
    for (const err of [
      Object.assign(new Error('Invalid API key'), { status: 401 }),
      Object.assign(new Error('permission denied'), { status: 403 }),
      Object.assign(new Error('RESOURCE_EXHAUSTED: quota'), { status: 429 }),
      Object.assign(new Error('overloaded'), { status: 529 }),
      new Error('getaddrinfo ENOTFOUND api.example.com'),
    ]) {
      const m = providerFailureUserMessage(err);
      assert.ok(m, `${err.message} → null`);
      assert.equal(isClarificationStall(m), false, m);
      assert.doesNotMatch(m, /repeat/i);
    }
  });
  test('a non-provider error keeps the graceful retry (null)', () => {
    assert.equal(providerFailureUserMessage(new Error('Cannot read properties of undefined')), null);
    assert.equal(providerFailureUserMessage(undefined), null);
  });
});
