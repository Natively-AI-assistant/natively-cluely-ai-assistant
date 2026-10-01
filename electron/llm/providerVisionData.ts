// electron/llm/providerVisionData.ts
//
// Turning what a provider publishes into "does this model read images" answers
// (design: docs/plans/2026-10-01-vision-capability-design.md, phase 2). Pure.

/**
 * OpenRouter's GET /api/v1/models → wire id → reads images.
 *
 * `architecture.input_modalities` lists what a model accepts (`["text","image",
 * "file"]`). Verified 2026-10-01 against the live catalogue (296 of 464 list
 * `image`). Trusted both ways: OpenRouter refuses an image sent to a model it
 * lists as text-only. A model with no modalities array is left out — unknown,
 * not "no". `:batch` ids are dropped, as fetchOpenRouterModels drops them: they
 * duplicate the base id and are never selectable.
 */
export function parseOpenRouterVision(json: unknown): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const data = (json as { data?: unknown } | null | undefined)?.data;
  if (!Array.isArray(data)) return out;
  for (const m of data) {
    const id = (m as { id?: unknown } | null)?.id;
    const modalities = (m as { architecture?: { input_modalities?: unknown } } | null)?.architecture?.input_modalities;
    if (typeof id !== 'string' || !id || id.endsWith(':batch') || !Array.isArray(modalities)) continue;
    out.set(id, modalities.includes('image'));
  }
  return out;
}
