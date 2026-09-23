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

test('an answering fast model logs a stable, greppable marker', async () => {
  // The spec asked for a `judgeRoute` telemetry value, but that field belongs to
  // PR 583's judge-telemetry work, which this branch deliberately excludes.
  // Threading a route back to the controller would change the judgeCandidate host
  // signature across SimpleAutoAnswer, main.ts and every stub — out of proportion
  // to this feature. A stable log marker keeps it diagnosable from a user debug
  // log, which is how this area actually gets debugged.
  const lines = [];
  const realLog = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    const h = helper({
      fastModelId: 'gpt-5.5',
      _openaiClient: { chat: { completions: { create: async () => ({ choices: [{ message: { content: 'ok' } }] }) } } },
    });
    assert.equal(await call(h), 'ok');
  } finally {
    console.log = realLog;
  }
  assert.ok(lines.some((l) => l.includes('[LLMHelper] fast-model answered') && l.includes('gpt-5.5')),
    `expected a fast-model marker naming the model; got: ${JSON.stringify(lines)}`);
});

// --- fix pass (review finding 1, CRITICAL): gateway ids must never reach the OpenAI client ---
// isOpenAiModel() self-excludes Groq and Fluxion but NOT OpenRouter, LiteLLM,
// NVIDIA NIM or 9Router, and its last clause is `includes("openai")`. Without a
// guard the judge prompt — which carries recent meeting turns — is POSTed to
// api.openai.com on the user's own OpenAI key for a model OpenAI will reject.
for (const id of [
  'openrouter/openai/gpt-5.6-terra',
  'nvidia_nim/openai/gpt-oss-20b',
  'litellm/openai/gpt-4o-mini',
  'litellm/azure-openai-gpt4',
]) {
  test(`gateway id ${id} never reaches the OpenAI client`, async () => {
    let sentTo = null;
    const h = helper({
      fastModelId: id,
      _openaiClient: { chat: { completions: { create: async (req) => { sentTo = req.model; return { choices: [{ message: { content: 'leaked' } }] }; } } } },
    });
    assert.equal(await call(h), null, 'must fall through, not answer via the wrong provider');
    assert.equal(sentTo, null, `the judge prompt must not be sent to OpenAI for ${id}`);
  });
}

// --- fix pass (review finding 5): an undispatchable pick must be diagnosable ---
test('a set-but-undispatchable fast model logs a marker instead of failing silently', async () => {
  const lines = [];
  const realLog = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    assert.equal(await call(helper({ fastModelId: 'litellm/azure-openai-gpt4' })), null);
  } finally {
    console.log = realLog;
  }
  assert.ok(lines.some((l) => l.includes('[LLMHelper] fast-model not dispatchable')),
    `a silent no-op is indistinguishable from "unset"; got: ${JSON.stringify(lines)}`);
});

// --- fix pass (review finding 4): a signal-less caller still gets a deadline ---
test('with no caller signal the fast rung still bounds itself', async () => {
  let opts = null;
  const h = helper({
    fastModelId: 'gpt-5.5',
    _openaiClient: { chat: { completions: { create: async (_r, o) => { opts = o; return { choices: [{ message: { content: 'ok' } }] }; } } } },
  });
  assert.equal(await call(h), 'ok');
  assert.ok(opts?.signal, 'an uncancellable request can outlive the judge by minutes');
});
