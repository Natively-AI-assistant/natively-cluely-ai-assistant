// electron/llm/codeVerification/verificationEnabled.ts
//
// Single kill-switch for verified code execution. Currently TEMPORARILY DISABLED
// across the app: the orchestrator and ipcHandlers already early-return when
// this returns false, so flipping the default to OFF shuts the whole pipeline
// (extract → execute → judge → one-shot correction) cleanly without breaking
// any other functionality. No redeploy needed.
//
// Re-enable at runtime (without changing code) by either:
//   - env   NATIVELY_CODE_VERIFY = 'on' | 'true' | '1'   → enabled
//   - settings  codeVerificationEnabled === true         → enabled
// Reads defensively (never throws); any uncertainty resolves to OFF, EXCEPT an
// explicit env/settings "on" which always wins.

let cachedEnv: boolean | null = null;

const envEnabled = (): boolean => {
  if (cachedEnv !== null) return cachedEnv;
  let on = false;
  try {
    const v = (process.env.NATIVELY_CODE_VERIFY || '').trim().toLowerCase();
    on = v === 'on' || v === 'true' || v === '1' || v === 'enabled';
  } catch { on = false; }
  cachedEnv = on;
  return on;
};

/**
 * True when verified code execution should run. Currently defaults to OFF
 * (temporary disable). An explicit env or settings "on" re-enables it at
 * runtime (no redeploy). Pure-ish + safe to call on the hot path (settings read
 * is a cheap cached SettingsManager get).
 */
export const isCodeVerificationEnabled = (): boolean => {
  if (envEnabled()) return true;
  try {
    const { SettingsManager } = require('../../services/SettingsManager');
    const v = SettingsManager.getInstance().get('codeVerificationEnabled');
    if (v === true) return true; // explicit opt-in only; undefined → default OFF
  } catch { /* settings unavailable → fall through to default OFF */ }
  return false;
};
