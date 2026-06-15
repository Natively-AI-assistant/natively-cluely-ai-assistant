// Unit tests for the Hindsight litellm.Router config builder.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildHindsightRouterConfig } from './hindsight-llm-config.mjs';

const models = (cfg) => cfg.model_list.map((m) => m.litellm_params.model);

describe('buildHindsightRouterConfig', () => {
  test('all provider keys present → full ordered chain (Gemini→OpenAI→Claude→DeepSeek→Groq→Ollama)', () => {
    const cfg = buildHindsightRouterConfig({
      GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a',
      DEEPSEEK_API_KEY: 'd', GROQ_API_KEY: 'q', HINDSIGHT_LLM_ENABLE_OLLAMA: '1',
    });
    const m = models(cfg);
    // Gemini's three models lead, in priority order.
    assert.deepEqual(m.slice(0, 3), [
      'gemini/gemini-3.5-flash', 'gemini/gemini-3.1-flash-lite', 'gemini/gemini-3.1-pro-preview',
    ]);
    // Provider order after Gemini.
    const firstOf = (re) => m.findIndex((x) => re.test(x));
    assert.ok(firstOf(/^gemini\//) < firstOf(/^openai\//), 'gemini before openai');
    assert.ok(firstOf(/^openai\//) < firstOf(/^anthropic\//), 'openai before claude');
    assert.ok(firstOf(/^anthropic\//) < firstOf(/^deepseek\//), 'claude before deepseek');
    assert.ok(firstOf(/^deepseek\//) < firstOf(/^groq\//), 'deepseek before groq');
    assert.ok(firstOf(/^groq\//) < firstOf(/^ollama\//), 'groq before ollama');
  });

  test('only GEMINI_API_KEY → Gemini-only chain (never empty)', () => {
    const cfg = buildHindsightRouterConfig({ GEMINI_API_KEY: 'g' });
    const m = models(cfg);
    assert.equal(m.length, 3);
    assert.ok(m.every((x) => x.startsWith('gemini/')));
  });

  test('per-provider model fallback present: gemini flash → flash-lite → pro', () => {
    const cfg = buildHindsightRouterConfig({ GEMINI_API_KEY: 'g' });
    const m = models(cfg);
    assert.ok(m[0].includes('flash') && !m[0].includes('lite'), 'primary = flash');
    assert.ok(m[1].includes('flash-lite'), 'second = flash-lite');
    assert.ok(m[2].includes('pro'), 'third = pro');
  });

  test('a missing provider key omits that provider', () => {
    const cfg = buildHindsightRouterConfig({ GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q' });
    const m = models(cfg);
    assert.ok(!m.some((x) => x.startsWith('openai/')), 'no openai without key');
    assert.ok(!m.some((x) => x.startsWith('anthropic/')), 'no claude without key');
    assert.ok(m.some((x) => x.startsWith('groq/')), 'groq present (key set)');
  });

  test('Ollama only included when explicitly enabled (no key gate)', () => {
    const off = buildHindsightRouterConfig({ GEMINI_API_KEY: 'g' });
    assert.ok(!models(off).some((x) => x.startsWith('ollama/')), 'ollama off by default');
    const on = buildHindsightRouterConfig({ GEMINI_API_KEY: 'g', HINDSIGHT_LLM_ENABLE_OLLAMA: '1' });
    const oll = on.model_list.find((e) => e.litellm_params.model.startsWith('ollama/'));
    assert.ok(oll, 'ollama on when enabled');
    assert.equal(oll.litellm_params.api_base, 'http://localhost:11434', 'ollama carries api_base');
  });

  test('retry + fallbacks + routing present and well-formed', () => {
    const cfg = buildHindsightRouterConfig({ GEMINI_API_KEY: 'g' });
    assert.equal(cfg.num_retries, 3);
    assert.equal(cfg.routing_strategy, 'simple-shuffle');
    assert.ok(Array.isArray(cfg.fallbacks) && cfg.fallbacks.length >= 1, 'fallbacks present');
    assert.ok(Array.isArray(cfg.context_window_fallbacks), 'context-window fallbacks present');
    assert.equal(typeof cfg.timeout, 'number');
    // The whole thing must be JSON-serializable (it goes into an env var verbatim).
    assert.doesNotThrow(() => JSON.stringify(cfg));
  });

  test('NO provider available → null (caller keeps single-model default)', () => {
    assert.equal(buildHindsightRouterConfig({}), null);
  });

  test('model strings are env-overridable', () => {
    const cfg = buildHindsightRouterConfig({ GEMINI_API_KEY: 'g', HINDSIGHT_LLM_GEMINI_PRIMARY: 'gemini/custom-x' });
    assert.equal(models(cfg)[0], 'gemini/custom-x');
  });

  test('num_retries / timeout overridable via env', () => {
    const cfg = buildHindsightRouterConfig({ GEMINI_API_KEY: 'g', HINDSIGHT_LLM_NUM_RETRIES: '5', HINDSIGHT_LLM_TIMEOUT: '60' });
    assert.equal(cfg.num_retries, 5);
    assert.equal(cfg.timeout, 60);
  });
});
