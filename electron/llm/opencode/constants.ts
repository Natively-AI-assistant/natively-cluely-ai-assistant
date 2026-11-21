/**
 * OpenCode Console inference — fixed endpoints.
 *
 * One key fronts FOUR wire protocols, and each model is served by exactly one
 * of them (see `types.ts` / `catalog.ts`). These are the only URLs the provider
 * needs, and they are literal strings rather than filesystem paths, so the
 * module is platform-neutral by construction.
 *
 * Source: https://opencode.ai/docs/console/api/inference (read 2026-11-19).
 */

/** Selector id — the string an operator switches the provider off with. */
export const OPENCODE_PROVIDER_ID = 'opencode';

/** Natively's routing prefix. NEVER optional: OpenCode's ids are the vendors'
 *  own (`claude-sonnet-5-5`, `gpt-6.1-sol`, `gemini-3.8-flash`), so an
 *  unprefixed id is claimed by — and billed to — the user's own vendor key. */
export const OPENCODE_ROUTING_PREFIX = 'opencode/';

export const OPENCODE_INFERENCE_BASE = 'https://opencode.ai/inference';

/** OpenAI SDK base. Serves BOTH chat.completions and responses. */
export const OPENCODE_OPENAI_BASE = `${OPENCODE_INFERENCE_BASE}/openai/v1`;

/** Anthropic SDK base. The SDK appends `/v1/messages` itself, so this must NOT
 *  include `/v1` — doing so produces `/v1/v1/messages` and a 404 that reads
 *  like a bad key. */
export const OPENCODE_ANTHROPIC_BASE = `${OPENCODE_INFERENCE_BASE}/anthropic`;

/** Google base, used by the raw-fetch Gemini adapter. */
export const OPENCODE_GOOGLE_BASE = `${OPENCODE_INFERENCE_BASE}/google`;

/** Model catalogue endpoints. Both are public reads; with a key the first is
 *  scoped to the workspace's own models. */
export const OPENCODE_MODELS_URL = `${OPENCODE_INFERENCE_BASE}/v1/models`;
export const OPENCODE_GO_MODELS_URL = `${OPENCODE_INFERENCE_BASE}/go/v1/models`;

/** Deliberately unroutable id for Test Connection. */
export const OPENCODE_PROBE_MODEL = '__natively_connection_probe__';

/** The app's shared output ceiling (MAX_OUTPUT_TOKENS in LLMHelper). Held here
 *  so these pure modules never have to import the 15k-line helper. */
export const OPENCODE_MAX_OUTPUT_TOKENS = 65_536;

/** The Messages API REQUIRES `max_tokens`, so a model that rejects the cap is
 *  retried with this conservative ceiling instead of with none. */
export const OPENCODE_MESSAGES_FALLBACK_TOKENS = 4_096;

/** The Console, where keys are created and the balance is shown. */
export const OPENCODE_CONSOLE_URL = 'https://opencode.ai/console';
