// electron/llm/routing/flag.ts
//
// The interaction router ships OFF.
//
// The campaign brief is explicit: PR 6 must not change production behaviour,
// and it ships flagged off. The model is chosen and measured, but a measurement
// on a generated corpus is not the same thing as evidence from live traffic,
// and the axis this router owns decides whether the assistant speaks at all. A
// regression there is not a degraded answer, it is the assistant talking over
// someone or sitting silent when addressed.
//
// The resolution order matches Context Intelligence V3's, deliberately, so
// there is one thing to learn rather than two:
//
//   1. NATIVELY_INTERACTION_ROUTER      env var, wins over everything
//   2. the persisted user setting        null clears back to the default
//   3. DEFAULT_ENABLED                   one constant, every environment

export const INTERACTION_ROUTER_ENV_KEY = 'NATIVELY_INTERACTION_ROUTER';

/**
 * OFF. Do not flip this without live evidence.
 *
 * When it flips, the router owns needs_response and dialogue_act only. Every
 * other axis stays with Context Intelligence V3, which is what AXIS_OWNER in
 * IntentFrame.ts encodes and what assembleIntentFrame enforces.
 */
export const DEFAULT_ENABLED = false;

/** Truthy env values, matching the V3 flag's reading exactly. */
function readEnv(): boolean | null {
  const raw = process.env[INTERACTION_ROUTER_ENV_KEY];
  if (raw == null || raw === '') return null;
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  return null;
}

/**
 * Is the router enabled?
 *
 * `persisted` is the stored user setting, or null when the user has expressed
 * no preference. Passed in rather than read here so the decision is testable
 * without a store.
 */
export function isInteractionRouterEnabled(persisted: boolean | null = null): boolean {
  const env = readEnv();
  if (env !== null) return env;
  if (persisted !== null) return persisted;
  return DEFAULT_ENABLED;
}
