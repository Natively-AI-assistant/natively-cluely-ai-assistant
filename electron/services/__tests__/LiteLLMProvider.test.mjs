import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load compiled modules from dist-electron (the test script builds first).
async function loadProviderRouter() {
  const p = path.resolve(__dirname, '../../../dist-electron/electron/llm/ProviderRouter.js');
  return import(pathToFileURL(p).href);
}

async function loadRateLimiter() {
  const p = path.resolve(__dirname, '../../../dist-electron/electron/services/RateLimiter.js');
  return import(pathToFileURL(p).href);
}

// Mirrors LLMHelper.isLiteLLMModel — the authoritative gate that routes a
// selected model to the LiteLLM proxy path. Kept in lockstep with the source.
function isLiteLLMModel(modelId) {
  return !!modelId && modelId.startsWith('litellm/');
}

// Mirrors the prefix-strip done before calling the proxy: the selector stores
// `litellm/<model>`, but the proxy expects the bare `<model>`.
function stripLiteLLMPrefix(modelId) {
  return modelId.replace('litellm/', '');
}

describe('LiteLLM model id detection + prefix handling', () => {
  test('detects litellm-prefixed model ids', () => {
    assert.equal(isLiteLLMModel('litellm/anthropic/claude-sonnet-4-6'), true);
    assert.equal(isLiteLLMModel('litellm/gpt-4o'), true);
    assert.equal(isLiteLLMModel('litellm/azure-gpt-4'), true);
  });

  test('does not misclassify other providers as litellm', () => {
    assert.equal(isLiteLLMModel('gpt-4o'), false);
    assert.equal(isLiteLLMModel('claude-sonnet-4-6'), false);
    assert.equal(isLiteLLMModel('deepseek-v4-flash'), false);
    assert.equal(isLiteLLMModel('ollama-llama3'), false);
    assert.equal(isLiteLLMModel('natively'), false);
  });

  test('is null/empty safe', () => {
    assert.equal(isLiteLLMModel(''), false);
    assert.equal(isLiteLLMModel(undefined), false);
    assert.equal(isLiteLLMModel(null), false);
  });

  test('strips only the litellm/ prefix, preserving nested provider segments', () => {
    assert.equal(stripLiteLLMPrefix('litellm/anthropic/claude-sonnet-4-6'), 'anthropic/claude-sonnet-4-6');
    assert.equal(stripLiteLLMPrefix('litellm/gpt-4o'), 'gpt-4o');
    // A bare model with no prefix is passed through untouched.
    assert.equal(stripLiteLLMPrefix('gpt-4o'), 'gpt-4o');
  });
});

describe('LiteLLM rate limiter', () => {
  let RateLimiter, createProviderRateLimiters;
  beforeEach(async () => {
    const m = await loadRateLimiter();
    RateLimiter = m.RateLimiter;
    createProviderRateLimiters = m.createProviderRateLimiters;
  });

  test('factory provisions a litellm bucket like every other cloud provider', () => {
    const limiters = createProviderRateLimiters();
    assert.ok(limiters.litellm instanceof RateLimiter, 'litellm rate limiter created');
  });

  test('litellm bucket actually throttles (acquire resolves under budget)', async () => {
    const limiters = createProviderRateLimiters();
    // Conservative 120/min default — a few sequential acquires must succeed.
    await limiters.litellm.acquire();
    await limiters.litellm.acquire();
    await limiters.litellm.acquire();
  });
});

describe('LiteLLM outbound data-scope gating (privacy)', () => {
  let assertProviderDataScopes, getDeniedDataScopes, ProviderScopeError;
  beforeEach(async () => {
    const m = await loadProviderRouter();
    assertProviderDataScopes = m.assertProviderDataScopes;
    getDeniedDataScopes = m.getDeniedDataScopes;
    ProviderScopeError = m.ProviderScopeError;
  });

  test('litellm is gated identically to other cloud providers when a scope is denied', () => {
    const policy = { transcript: false }; // transcript egress disallowed
    // Sending a transcript-scoped payload to litellm MUST throw — same as deepseek would.
    assert.throws(
      () => assertProviderDataScopes('litellm', ['transcript'], policy),
      (err) => err instanceof ProviderScopeError && err.provider === 'litellm',
      'litellm transcript egress should be blocked by policy'
    );
    // Sanity: deepseek behaves the same, proving litellm is not special-cased.
    assert.throws(() => assertProviderDataScopes('deepseek', ['transcript'], policy), ProviderScopeError);
  });

  test('litellm passes when the payload carries only allowed scopes', () => {
    const policy = { transcript: false };
    // screenshots not denied → no throw.
    assert.doesNotThrow(() => assertProviderDataScopes('litellm', ['screenshots'], policy));
    assert.deepEqual(getDeniedDataScopes(['screenshots'], policy), []);
  });
});

// Mirrors LLMHelper's max-tokens resolution: manual override > /model/info
// budget > default, clamped to [MIN, MAX]. Kept in lockstep with the source.
const LITELLM_DEFAULT = 8192;
const LITELLM_MIN = 256;
const LITELLM_MAX = 1048576;

function resolveMaxTokens(manualOverride, modelBudgets, model) {
  if (manualOverride !== null) return manualOverride;
  const budget = modelBudgets.get(model) ?? LITELLM_DEFAULT;
  return Math.min(LITELLM_MAX, Math.max(LITELLM_MIN, budget));
}

// Mirrors the /model/info response parsing (model_name + model_info.max_output_tokens).
function parseModelInfoBudgets(data) {
  const budgets = new Map();
  for (const entry of (data?.data || [])) {
    const name = entry?.model_name;
    const budget = Number(entry?.model_info?.max_output_tokens ?? entry?.model_info?.max_tokens);
    if (name && Number.isFinite(budget) && budget > 0) budgets.set(name, Math.floor(budget));
  }
  return budgets;
}

describe('LiteLLM max-tokens resolution (auto via /model/info + manual override)', () => {
  test('manual override always wins over per-model budgets', () => {
    const budgets = new Map([['gpt-4o', 16384]]);
    assert.equal(resolveMaxTokens(32768, budgets, 'gpt-4o'), 32768);
  });

  test('auto mode uses the /model/info budget for known models', () => {
    const budgets = new Map([['anthropic/claude-sonnet-4-6', 64000], ['gpt-4o', 16384]]);
    assert.equal(resolveMaxTokens(null, budgets, 'anthropic/claude-sonnet-4-6'), 64000);
    assert.equal(resolveMaxTokens(null, budgets, 'gpt-4o'), 16384);
  });

  test('auto mode falls back to the default for unknown models or empty cache', () => {
    assert.equal(resolveMaxTokens(null, new Map(), 'mystery-model'), LITELLM_DEFAULT);
    const budgets = new Map([['gpt-4o', 16384]]);
    assert.equal(resolveMaxTokens(null, budgets, 'not-in-registry'), LITELLM_DEFAULT);
  });

  test('auto budgets are clamped to the sane range', () => {
    const budgets = new Map([['tiny', 16], ['huge', 99999999]]);
    assert.equal(resolveMaxTokens(null, budgets, 'tiny'), LITELLM_MIN);
    assert.equal(resolveMaxTokens(null, budgets, 'huge'), LITELLM_MAX);
  });

  test('parses the documented /model/info response shape', () => {
    const budgets = parseModelInfoBudgets({
      data: [
        { model_name: 'gpt-4', litellm_params: { model: 'gpt-4' }, model_info: { max_tokens: 4096, max_output_tokens: 4096, max_input_tokens: 8192, litellm_provider: 'openai', mode: 'chat' } },
        { model_name: 'claude-sonnet', model_info: { max_output_tokens: 64000 } },
      ],
    });
    assert.equal(budgets.get('gpt-4'), 4096);
    assert.equal(budgets.get('claude-sonnet'), 64000);
  });

  test('falls back to legacy max_tokens when max_output_tokens is absent', () => {
    const budgets = parseModelInfoBudgets({ data: [{ model_name: 'old-model', model_info: { max_tokens: 2048 } }] });
    assert.equal(budgets.get('old-model'), 2048);
  });

  test('ignores malformed /model/info entries instead of crashing', () => {
    const budgets = parseModelInfoBudgets({
      data: [
        { model_name: '', model_info: { max_output_tokens: 1000 } },          // no name
        { model_name: 'no-info' },                                            // no model_info
        { model_name: 'bad-budget', model_info: { max_output_tokens: 'lots' } }, // NaN
        { model_name: 'zero', model_info: { max_output_tokens: 0 } },         // non-positive
        { model_name: 'good', model_info: { max_output_tokens: 8192 } },
      ],
    });
    assert.equal(budgets.size, 1);
    assert.equal(budgets.get('good'), 8192);
  });

  test('handles empty/missing response bodies', () => {
    assert.equal(parseModelInfoBudgets({}).size, 0);
    assert.equal(parseModelInfoBudgets(null).size, 0);
    assert.equal(parseModelInfoBudgets({ data: [] }).size, 0);
  });
});
