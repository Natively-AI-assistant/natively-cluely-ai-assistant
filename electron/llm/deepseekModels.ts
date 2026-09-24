// electron/llm/deepseekModels.ts
//
// The single place that names which DeepSeek model Natively talks to, and which
// model ids belong to DeepSeek's own API (api.deepseek.com).
//
// DeepSeek renamed its Flash model on 2026-09-10 (api-docs.deepseek.com/updates):
// DeepSeek-V4.1-Flash is served as `deepseek-flash`, and the V4 Flash ids
// (`deepseek-v4-flash`, `deepseek-v4-flash-vision-exp`) were retired — still
// accepted, but only "temporarily routed" to V4.1-Flash. `deepseek-v4-pro`
// continues. Live `GET /models` on 2026-09-25 listed exactly `deepseek-flash`
// and `deepseek-v4-pro`, and a chat call on `deepseek-v4-flash` (or the long
// discontinued `deepseek-chat`) came back `"model":"deepseek-flash"`.
//
// Both current models: 1M context, 384K max output, thinking ON by default
// (`thinking: {type: 'disabled'}` turns it off), effort low/high/max
// (api-docs.deepseek.com/quick_start/pricing, /guides/thinking_mode).
// deepseek-flash also accepts images; Natively still routes DeepSeek as
// text-only, which is a routing decision, not a model limit.
//
// Platform note: pure constants and string matching, identical on macOS and
// Windows.

/** Fast, cheap, what routing uses when nothing more specific is chosen. */
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-flash';

/** The larger model; text-only on DeepSeek's side as well. */
export const DEEPSEEK_PRO_MODEL = 'deepseek-v4-pro';

/**
 * Retired ids DeepSeek still accepts, and the id they are served as today.
 * A persisted pick (default model, preferred model, a mode LLM) can still hold
 * one of these; sending the successor instead means the day DeepSeek stops
 * aliasing them is not the day those users start getting errors. The user
 * never chose "a model that 404s", so this follows DeepSeek's own migration
 * note rather than rerouting a deliberate pick.
 */
const DEEPSEEK_RETIRED_SUCCESSORS: Readonly<Record<string, string>> = {
    'deepseek-v4-flash': DEEPSEEK_DEFAULT_MODEL,            // retired 2026-09-10
    'deepseek-v4-flash-vision-exp': DEEPSEEK_DEFAULT_MODEL, // retired 2026-09-10
};

/** The id to put on the wire for `modelId`: its successor if retired, else itself. */
export function deepseekWireModel(modelId: string): string {
    return DEEPSEEK_RETIRED_SUCCESSORS[modelId.toLowerCase()] ?? modelId;
}

/**
 * Is `modelId` a model on DeepSeek's own API?
 *
 * THE one predicate. It existed as five hand-synced regexes — `/^deepseek-v\d/`
 * in LLMHelper, modelCapabilities and modelFetcher, `/^deepseek-v/i` twice in
 * ipcHandlers — and none of them matched `deepseek-flash`, so the current model
 * was filtered out of Refresh and could not have routed if picked.
 *
 * Deliberately NOT matched:
 *   - Ollama's local `deepseek-coder` / `deepseek-r1` families (routed by the
 *     `ollama-` prefix, never by this).
 *   - `deepseek-chat` / `deepseek-reasoner`, discontinued 2026-07-24.
 *   - Any gateway-prefixed id (`fluxion/`, `openrouter/`, `litellm/`,
 *     `ninerouter/`): those bill the gateway's key, not the DeepSeek key.
 */
export function isDeepseekModelId(modelId: string | null | undefined): boolean {
    return /^deepseek-(?:v\d|flash(?:$|-))/i.test(modelId || '');
}
