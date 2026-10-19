/**
 * Model-id encoding for OpenAI-compatible endpoints, shared by the main
 * process (LLMHelper routing, IPC handlers) and the renderer (model pickers,
 * settings editor).
 *
 * Authored as .mjs + .d.mts (same pattern as electron/audio/
 * audioDeviceSelection.mjs) so BOTH sides import the real implementation:
 * OpenAICompatProvider.ts imports the 'openai' SDK, and pulling model-id
 * parsing from there would bundle the whole SDK into the renderer.
 *
 * Wire format: `compat:<instanceId>/<model>` — the prefix survives routing
 * switches, the instanceId picks the configured endpoint, and everything
 * after the FIRST slash is the model name verbatim, so provider-prefixed
 * names (OpenRouter's `openai/gpt-4o`, LiteLLM-style `anthropic/claude-…`)
 * pass through unharmed.
 */

export const OPENAI_COMPAT_PREFIX = 'compat:';

/** Build the routed model id for one endpoint + model. */
export function compatModelId(instanceId, model) {
  return `${OPENAI_COMPAT_PREFIX}${instanceId}/${model}`;
}

/**
 * Split a routed model id back into { instanceId, model }, or null when it is
 * not a compat id or either half is empty. Splits at the FIRST slash only.
 */
export function parseCompatModelId(modelId) {
  if (typeof modelId !== 'string' || !modelId.startsWith(OPENAI_COMPAT_PREFIX)) return null;
  const rest = modelId.slice(OPENAI_COMPAT_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1) return null;
  return { instanceId: rest.slice(0, slash), model: rest.slice(slash + 1) };
}
