// electron/llm/runtimeKillSwitch.ts
//
// Shared reader for DEFAULT-ON kill-switch flags (code-review R2, 2026-08-14):
// three flag readers had grown the identical shape — off-token env check, then
// SettingsManager === false opt-out, default true. Two of them (the
// deliberately UNCACHED ones) now delegate here:
//   - isSemanticAdmissionGateEnabled        (semanticAdmissionGate.ts)
//   - isProfileGroundingV2JdFitCoverageEnabled (profileGroundingV2.ts)
// The third — profileGroundingV2's MAIN flag — intentionally CACHES its env
// read (module-load semantics with a test-only reset helper) and stays
// separate; do not fold it in without preserving that contract.
//
// UNCACHED by design: these sit on per-question paths where the read is a
// string compare, and caching is what makes env-flip tests race (see the
// profileGroundingV2 P2 gotcha notes).

const OFF_TOKENS = new Set(['off', 'false', '0', 'disabled']);

/**
 * True unless explicitly disabled:
 *   - env  <envVar> = 'off' | 'false' | '0' | 'disabled' → false
 *   - settings  <settingKey> === false                   → false
 * Any other state — unset env, unknown token, settings unavailable — is ON.
 */
export const isKillSwitchFlagEnabled = (envVar: string, settingKey: string): boolean => {
  try {
    const v = (process.env[envVar] || '').trim().toLowerCase();
    if (OFF_TOKENS.has(v)) return false;
  } catch { /* fall through to settings */ }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SettingsManager } = require('../services/SettingsManager');
    if (SettingsManager.getInstance().get(settingKey) === false) return false;
  } catch { /* settings unavailable → default ON */ }
  return true;
};
