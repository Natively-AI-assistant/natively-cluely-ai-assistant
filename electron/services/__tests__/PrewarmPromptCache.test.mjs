// electron/services/__tests__/PrewarmPromptCache.test.mjs
// Verifies the prewarm guard/routing logic in LLMHelper.prewarmPromptCache:
//   - dedupes per (model|prompt) so repeat activations are free
//   - skips when cloud disabled and not Ollama
//   - routes to exactly one provider warmer based on the active model
//   - never throws (best-effort) even if the warmer rejects
// Replicates the decision logic; does NOT make real API calls.
// Run: node --test electron/services/__tests__/PrewarmPromptCache.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Mirrors the routing in LLMHelper.prewarmPromptCache. Returns the provider that
// would be warmed (or 'skip'), and records dedupe state. Pure — no network.
function makePrewarmer({ isLocalOnlyMode = false, useOllama = false, model = 'gemini-3.1-flash', clients = {}, warmImpl, ollamaKeepAlive = '30m' } = {}) {
  const prewarmedKeys = new Set();
  // Mirrors LLMHelper.ollamaKeepAlive: "30m" by default, set to -1 (pinned) once a
  // warm succeeds, reset to "30m" by releaseOllamaPin on switch-away.
  const state = { ollamaKeepAlive };
  // These mirror the real predicates in LLMHelper (isGeminiModel/isClaudeModel/
  // isOpenAiModel/isGroqModel) exactly, so fixtures classify the same way prod does.
  const isGemini = m => m.toLowerCase().startsWith('gemini');
  const isClaude = m => m.toLowerCase().startsWith('claude') || m.toLowerCase().includes('claude-');
  const isOpenAi = m => { const x = m.toLowerCase(); return x.startsWith('gpt-') || x.startsWith('o1') || x.startsWith('o3') || x.startsWith('o4') || x.startsWith('chatgpt'); };
  const isGroq = m => m.includes('llama') || m.includes('groq') || m.includes('mixtral') || m.includes('gemma');

  return {
    prewarmedKeys,
    state,
    async prewarm() {
      if (isLocalOnlyMode && !useOllama) return 'skip:local-only';
      const staticPrompt = 'HARD_SYSTEM_PROMPT_BODY_static_prefix';
      const activeModel = useOllama ? 'ollama-model' : model;
      const key = `${activeModel}|${createHash('sha1').update(staticPrompt).digest('hex')}`;
      // Dedup EXCEPT for an Ollama model that is no longer pinned (switched away and
      // back): re-warm + re-pin so the model is resident again. Mirrors LLMHelper.
      const ollamaNeedsRepin = useOllama && state.ollamaKeepAlive !== -1;
      if (prewarmedKeys.has(key) && !ollamaNeedsRepin) return 'skip:deduped';
      prewarmedKeys.add(key);

      const run = async (provider) => {
        try {
          if (warmImpl) await warmImpl(provider);
          if (provider === 'ollama') state.ollamaKeepAlive = -1; // pin on successful warm
          return provider;
        } catch {
          return provider; // best-effort — errors swallowed, provider still "attempted"
        }
      };

      if (!useOllama && isGemini(model) && clients.gemini) return run('gemini');
      if (!useOllama && isClaude(model) && clients.claude) return run('claude');
      if (!useOllama && isOpenAi(model) && clients.openai) return run('openai');
      if (!useOllama && isGroq(model) && clients.groq) return run('groq');
      if (useOllama) return run('ollama');
      return 'skip:server-side';
    },
  };
}

describe('prewarm: provider routing', () => {
  test('routes to Gemini explicit cache for a Gemini model', async () => {
    const p = makePrewarmer({ model: 'gemini-3.1-flash', clients: { gemini: true } });
    assert.strictEqual(await p.prewarm(), 'gemini');
  });

  test('routes to Claude for a Claude model', async () => {
    const p = makePrewarmer({ model: 'claude-opus-4-8', clients: { claude: true } });
    assert.strictEqual(await p.prewarm(), 'claude');
  });

  test('routes to OpenAI for a GPT model', async () => {
    const p = makePrewarmer({ model: 'gpt-4.1', clients: { openai: true } });
    assert.strictEqual(await p.prewarm(), 'openai');
  });

  test('routes to Groq for a llama model', async () => {
    const p = makePrewarmer({ model: 'llama-3.3-70b', clients: { groq: true } });
    assert.strictEqual(await p.prewarm(), 'groq');
  });

  test('routes to Ollama when useOllama is set (ignores cloud model id)', async () => {
    const p = makePrewarmer({ useOllama: true, model: 'gemini-3.1-flash', clients: { gemini: true } });
    assert.strictEqual(await p.prewarm(), 'ollama');
  });

  test('skips server-side providers (Natively/custom) with no client-side cache', async () => {
    const p = makePrewarmer({ model: 'natively', clients: {} });
    assert.strictEqual(await p.prewarm(), 'skip:server-side');
  });
});

describe('prewarm: guards', () => {
  test('skips entirely in local-only mode when not Ollama', async () => {
    const p = makePrewarmer({ isLocalOnlyMode: true, useOllama: false, model: 'claude-opus-4-8', clients: { claude: true } });
    assert.strictEqual(await p.prewarm(), 'skip:local-only');
  });

  test('local-only + Ollama still warms Ollama', async () => {
    const p = makePrewarmer({ isLocalOnlyMode: true, useOllama: true, clients: {} });
    assert.strictEqual(await p.prewarm(), 'ollama');
  });

  test('dedupes — second call for same model/prompt is a no-op', async () => {
    const p = makePrewarmer({ model: 'claude-opus-4-8', clients: { claude: true } });
    assert.strictEqual(await p.prewarm(), 'claude');
    assert.strictEqual(await p.prewarm(), 'skip:deduped');
    assert.strictEqual(p.prewarmedKeys.size, 1);
  });

  test('Ollama re-warms (not deduped) when the model is no longer pinned', async () => {
    // First warm pins the model (keep_alive -1). A second back-to-back call is a
    // normal dedup no-op. But after a switch-away resets keep_alive to "30m"
    // (simulated), a later prewarm MUST re-warm so the model is resident + pinned
    // again — otherwise the first question pays the cold-load tax.
    const p = makePrewarmer({ useOllama: true, clients: {} });
    assert.strictEqual(await p.prewarm(), 'ollama');
    assert.strictEqual(p.state.ollamaKeepAlive, -1, 'pinned after first warm');
    assert.strictEqual(await p.prewarm(), 'skip:deduped', 'still pinned → dedup');
    // Simulate releaseOllamaPin on switch-away:
    p.state.ollamaKeepAlive = '30m';
    assert.strictEqual(await p.prewarm(), 'ollama', 'unpinned → re-warm, not deduped');
    assert.strictEqual(p.state.ollamaKeepAlive, -1, 're-pinned after re-warm');
  });

  test('best-effort — a throwing warmer does not reject', async () => {
    const p = makePrewarmer({
      model: 'claude-opus-4-8',
      clients: { claude: true },
      warmImpl: async () => { throw new Error('network down'); },
    });
    // Must resolve, not throw
    assert.strictEqual(await p.prewarm(), 'claude');
  });

  test('missing client → falls through to server-side skip', async () => {
    // Claude model but no claude client configured
    const p = makePrewarmer({ model: 'claude-opus-4-8', clients: {} });
    assert.strictEqual(await p.prewarm(), 'skip:server-side');
  });
});
