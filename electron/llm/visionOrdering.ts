// electron/llm/visionOrdering.ts
//
// The one ordering rule for screenshot rungs (design:
// docs/plans/2026-10-01-vision-capability-design.md, section 3). Pure, so the
// streaming chain (LLMHelper) and, from phase 5b, the screen-reading chain
// (VisionProviderRegistry) order their rungs the same way.
//
//   1. The user's own selection leads its own turn. A CLOUD selection stops
//      leading while its circuit breaker is open: a selected model that keeps
//      failing must not cost its full first-token budget on every screenshot;
//      it rejoins its pool and is tried in the cooling group, as any other
//      broken rung is. A LOCAL selection always leads: "the cloud follows only
//      if it fails" — someone who picked a local model must not have a
//      recovered Ollama skipped for a cooldown while a cloud reads the screen.
//   2. Cloud rungs, fastest healthy first (orderByHealth).
//   3. Local rungs.
//   Local-only mode: local rungs only.

import { orderByHealth, type HealthEntry } from './streamFallbackEngine';

export function orderVisionCandidates<T extends { id: string; priority: number; isLocal?: boolean }>(args: {
  /** The rungs for the user's own selection, in the order they should lead. Each is also in `cloud` or `local`. */
  selected: readonly T[];
  cloud: readonly T[];
  local: readonly T[];
  localOnly: boolean;
  health: Map<string, HealthEntry>;
  now: number;
}): T[] {
  const { selected, cloud, local, localOnly, health, now } = args;
  if (localOnly) return orderByHealth([...local], health, now);
  const cooling = (p: T) => (health.get(p.id)?.openUntil ?? 0) > now;
  // The rung's own flag, not which list it is in: with local-only mode off a
  // HOSTED custom endpoint is seated among the local rungs with isLocal:false,
  // and it is a cloud selection like any other.
  const lead = selected.filter((p) => p.isLocal === true || !cooling(p));
  const leading = new Set(lead.map((p) => p.id));
  const backCloud = cloud.filter((p) => !leading.has(p.id));
  const backLocal = local.filter((p) => !leading.has(p.id));
  const ordered = [...lead, ...orderByHealth(backCloud, health, now), ...backLocal];
  // Never fail closed: orderByHealth keeps a cooling cloud rung, and local
  // rungs are kept as they are, so everything seated is still tried.
  return ordered;
}

/**
 * A breaker never outlives the selection it was about.
 *
 * A rung's id is the same for every model it can carry (`openrouter`,
 * `openai_selected`, `custom`, …), so without this a retired or text-only
 * model's demotion — up to a day in the chat path — carried over to the next
 * model the user picked. A rung that last ran for a DIFFERENT selection starts
 * clean; one never seen before keeps its breaker (a fixed vendor rung that
 * failed as a fallback is about the key, not about the pick).
 *
 * Shared by both screenshot paths: `ledFor` and `health` belong to the caller.
 */
export function forgetBreakersOfOtherSelections(
  ledFor: Map<string, string>,
  health: { delete(id: string): unknown },
  rungIds: readonly string[],
  selectionKey: string,
): void {
  for (const id of rungIds) {
    const last = ledFor.get(id);
    if (last !== undefined && last !== selectionKey) health.delete(id);
    ledFor.set(id, selectionKey);
  }
}
