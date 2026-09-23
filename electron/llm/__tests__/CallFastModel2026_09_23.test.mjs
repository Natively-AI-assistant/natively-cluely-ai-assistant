// The callFastModel seam: one non-streaming call on the user's chosen fast model.
//
// The contract that matters is the RETURN SHAPE, not the happy path. Every
// "not available" case must resolve null so the caller falls through to its own
// ladder untouched; only an abort may throw, because the judge's deadline and
// supersede have to propagate rather than look like a missing setting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { LLMHelper } = require(path.resolve(__dirname, '../../../dist-electron/electron/LLMHelper.js'));

function helper(over = {}) {
  const { fastModelId = null, ...rest } = over;
  const h = Object.create(LLMHelper.prototype);
  Object.assign(h, {
    _client: null, _openaiClient: null, _claudeClient: null, _groqClient: null, _deepseekClient: null,
    isLocalOnlyMode: false,
    getDisabledProviderFamilies: () => [],
    assertOutboundScopes: () => {},
    rateLimiters: { openai: { acquire: async () => {} }, gemini: { acquire: async () => {} } },
    ...rest,
  });
  // `fastModelId` is a GETTER on the prototype — it reads CredentialsManager per
  // call so a Settings change lands without a restart. Assigning through a
  // getter-only accessor throws in strict mode, so shadow it with an own property.
  Object.defineProperty(h, 'fastModelId', { value: fastModelId, configurable: true });
  return h;
}
const call = (h, opts = {}) => h.callFastModel('judge this', opts);

test('returns null when no fast model is configured', async () => {
  assert.equal(await call(helper({ fastModelId: null })), null);
});

test('returns null for an unrecognised or retired model id — never throws', async () => {
  assert.equal(await call(helper({ fastModelId: 'some-model-that-was-retired' })), null);
});

test('returns null when the picked family is disabled', async () => {
  const h = helper({
    fastModelId: 'gpt-5.5',
    _openaiClient: { chat: { completions: { create: async () => { throw new Error('must not be called'); } } } },
    getDisabledProviderFamilies: () => ['openai'],
  });
  assert.equal(await call(h), null);
});

test('returns null in local-only mode and makes no outbound request', async () => {
  let called = false;
  const h = helper({
    fastModelId: 'gpt-5.5', isLocalOnlyMode: true,
    _openaiClient: { chat: { completions: { create: async () => { called = true; return {}; } } } },
  });
  assert.equal(await call(h), null);
  assert.equal(called, false);
});

test('an empty response is a failure, not an empty verdict', async () => {
  const h = helper({
    fastModelId: 'gpt-5.5',
    _openaiClient: { chat: { completions: { create: async () => ({ choices: [{ message: { content: '   ' } }] }) } } },
  });
  assert.equal(await call(h), null);
});

test('a provider failure returns null so the caller falls through', async () => {
  const h = helper({
    fastModelId: 'gpt-5.5',
    _openaiClient: { chat: { completions: { create: async () => { throw new Error('503'); } } } },
  });
  assert.equal(await call(h), null);
});

test('abort propagates instead of falling through', async () => {
  const controller = new AbortController();
  const h = helper({
    fastModelId: 'gpt-5.5',
    _openaiClient: { chat: { completions: { create: () => new Promise((_r, rej) => {
      // Check `aborted` BEFORE subscribing: abort() can land before this stub is
      // reached, and a listener registered after the fact never fires — the
      // promise would hang forever instead of failing the assertion.
      const sig = controller.signal;
      if (sig.aborted) { rej(sig.reason); return; }
      sig.addEventListener('abort', () => rej(sig.reason), { once: true });
    }) } } },
  });
  const p = call(h, { signal: controller.signal });
  controller.abort(new Error('superseded'));
  await assert.rejects(p, /superseded/);
});

test('a good response comes back, scopes asserted and limiter acquired first', async () => {
  const order = [];
  const h = helper({
    fastModelId: 'gpt-5.5',
    assertOutboundScopes: () => order.push('scopes'),
    rateLimiters: { openai: { acquire: async () => { order.push('limiter'); } } },
    _openaiClient: { chat: { completions: { create: async () => {
      order.push('request');
      return { choices: [{ message: { content: '{"is_ask":true}' } }] };
    } } } },
  });
  assert.equal(await call(h), '{"is_ask":true}');
  assert.deepEqual(order, ['scopes', 'limiter', 'request']);
});
