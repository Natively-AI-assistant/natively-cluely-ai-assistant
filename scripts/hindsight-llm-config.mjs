// scripts/hindsight-llm-config.mjs
//
// Builds the litellm.Router config JSON that Hindsight consumes via
// HINDSIGHT_API_LLM_LITELLMROUTER_CONFIG. This is Natively's LLM provider chain +
// automatic retry/fallback for Hindsight's memory operations (fact extraction on
// retain, synthesis on reflect) — so a memory op always gets an answer even when the
// primary model/provider fails.
//
// HOW IT WORKS (no Python/adapter code — pure config):
//   Hindsight (config.py) parses this JSON and forwards it VERBATIM to
//   litellm.Router(**config). litellm.Router natively rotates through `model_list` on
//   failure (`fallbacks`) and retries transient errors (`num_retries`). litellm reads
//   each provider's key from the standard env var (GEMINI_API_KEY, OPENAI_API_KEY, …),
//   so a model entry is only useful when its key is present — we gate inclusion on that.
//
// PRIORITY (Natively-API is intentionally DEFERRED — see docs/HINDSIGHT_LOCAL_SETUP.md):
//   Gemini → OpenAI → Claude → DeepSeek → Groq → Ollama
//   Within Gemini: 3.5-flash → 3.1-flash-lite → 3.1-pro-preview.
//
// Model names MIRROR electron/services/ModelVersionManager.ts:88-100 so Hindsight stays
// in lockstep with the app's chosen models. Each is env-overridable.
//
// Usage:
//   node scripts/hindsight-llm-config.mjs            # prints the router JSON for current env
//   import { buildHindsightRouterConfig } from './hindsight-llm-config.mjs'

const MODEL_NAME = 'hindsight-llm'; // the single logical model the chain resolves; litellm rotates entries

/**
 * Ordered provider→model table. Each provider lists its models best-first (per-provider
 * fallback). `key` is the env var litellm needs for that provider; an entry is only
 * emitted when that key is present (or, for ollama, when explicitly enabled).
 * Model strings are env-overridable so a name correction needs no code change.
 */
function providerTable(env) {
  const ov = (name, dflt) => (env[name] && String(env[name]).trim()) || dflt;
  return [
    {
      provider: 'gemini', key: 'GEMINI_API_KEY',
      models: [
        ov('HINDSIGHT_LLM_GEMINI_PRIMARY', 'gemini/gemini-3.5-flash'),
        ov('HINDSIGHT_LLM_GEMINI_LITE', 'gemini/gemini-3.1-flash-lite'),
        ov('HINDSIGHT_LLM_GEMINI_PRO', 'gemini/gemini-3.1-pro-preview'),
      ],
    },
    {
      // OpenAI-compatible: real OpenAI OR a LiteLLM gateway (any base URL passed via
      // OPENAI_API_BASE / LITELLM_BASE_URL). The shell launcher forwards OPENAI_API_BASE
      // (and also LITELLM_BASE_URL as a fallback); litellm reads OPENAI_API_BASE and
      // routes calls to the gateway instead of api.openai.com. Without this entry the
      // LiteLLM gateway user gets retain/reflect calls silently routed to api.openai.com
      // — the most surprising failure mode for a user who set up a gateway to AVOID
      // talking to OpenAI.
      provider: 'openai', key: 'OPENAI_API_KEY',
      models: [ov('HINDSIGHT_LLM_OPENAI', 'openai/gpt-5.4')],
      // OPENAI_API_BASE is the litellm-canonical env var. LITELLM_BASE_URL is a
      // convenience alias some users set in their own shell — we honor it as a
      // fallback so the UI-documented `export LITELLM_BASE_URL=...` actually works.
      apiBase: ov('OPENAI_API_BASE', '') || ov('LITELLM_BASE_URL', '') || undefined,
    },
    {
      provider: 'anthropic', key: 'ANTHROPIC_API_KEY',
      models: [ov('HINDSIGHT_LLM_CLAUDE', 'anthropic/claude-sonnet-4-6')],
    },
    {
      provider: 'deepseek', key: 'DEEPSEEK_API_KEY',
      models: [ov('HINDSIGHT_LLM_DEEPSEEK', 'deepseek/deepseek-v4-flash')],
    },
    {
      provider: 'groq', key: 'GROQ_API_KEY',
      models: [ov('HINDSIGHT_LLM_GROQ', 'groq/meta-llama/llama-4-scout-17b-16e-instruct')],
    },
    {
      // Ollama needs no API key — include when explicitly enabled (local fallback of last resort).
      provider: 'ollama', key: null, enabledBy: 'HINDSIGHT_LLM_ENABLE_OLLAMA',
      models: [ov('HINDSIGHT_LLM_OLLAMA', 'ollama/gemma3:12b')],
      apiBase: ov('HINDSIGHT_LLM_OLLAMA_BASE', 'http://localhost:11434'),
    },
  ];
}

/**
 * Build the litellm.Router config from env. Returns null when NO provider is available
 * (caller should keep the single-model default). Pure — no IO.
 */
export function buildHindsightRouterConfig(env = process.env) {
  const model_list = [];
  for (const p of providerTable(env)) {
    const available = p.key ? Boolean(env[p.key] && String(env[p.key]).trim()) : Boolean(env[p.enabledBy]);
    if (!available) continue;
    for (const model of p.models) {
      if (!model) continue;
      const litellm_params = { model };
      if (p.apiBase) litellm_params.api_base = p.apiBase;
      model_list.push({ model_name: MODEL_NAME, litellm_params });
    }
  }
  if (model_list.length === 0) return null;

  const numRetries = Number(env.HINDSIGHT_LLM_NUM_RETRIES) || 3;
  const timeout = Number(env.HINDSIGHT_LLM_TIMEOUT) || 30;
  return {
    model_list,
    // litellm rotates to the NEXT model_list entry sharing this name on failure.
    fallbacks: [{ [MODEL_NAME]: [MODEL_NAME] }],
    // Also fall through on context-window-exceeded (a small fallback model can punt up).
    context_window_fallbacks: [{ [MODEL_NAME]: [MODEL_NAME] }],
    num_retries: numRetries,
    routing_strategy: 'simple-shuffle',
    timeout,
  };
}

// CLI: print the JSON for the current environment (used by the dev-server launcher).
const isMain = (() => {
  try { return import.meta.url === `file://${process.argv[1]}`; } catch { return false; }
})();
if (isMain) {
  const cfg = buildHindsightRouterConfig(process.env);
  if (!cfg) {
    process.stderr.write('[hindsight-llm-config] no provider keys present — emitting empty (single-model default applies)\n');
    process.stdout.write('');
  } else {
    process.stdout.write(JSON.stringify(cfg));
  }
}
