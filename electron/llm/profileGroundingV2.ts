// electron/llm/profileGroundingV2.ts
//
// Feature flag for the Profile Grounding V2 rewrite (RC-1/2/4/5/10): replace the
// two-router + 0.55-cosine RAG path for resume/JD facts with DETERMINISTIC
// full-structured-profile injection — the whole typed resume + JD rendered into
// an authorized grounding block that is ALWAYS present (gated by answer type so
// coding/technical/sales/lecture get NO profile), so retrieval can never gate
// grounding or leave a void the model fills with "I don't have access".
//
// DEFAULT ON (kill-switch model, mirroring verificationEnabled.ts). Validated by
// 263 Mode/Profile tests in both flag states + 35 spec §11 cases + the
// ProfileOutputValidator. Disableable at runtime WITHOUT a redeploy if the live
// path ever misbehaves:
//   - env  PROFILE_GROUNDING_V2 = 'off' | 'false' | '0' | 'disabled'  → disabled
//   - settings  profileGroundingV2 === false                          → disabled
// Reads defensively (never throws). Any uncertainty resolves to the default ON,
// EXCEPT an explicit env/settings "off" which always wins.
//
// NOTE: the live-API / real-UI eval (intelligence-eval-real-api/, -real-ui/) is
// the production-proof gate but could not run during development (the project's
// Gemini key was billing-blocked). Run those once a working key is available;
// if anything regresses, set PROFILE_GROUNDING_V2=off to revert instantly.

let cachedEnv: boolean | null = null;

const envDisabled = (): boolean => {
  if (cachedEnv !== null) return cachedEnv;
  let off = false;
  try {
    const v = (process.env.PROFILE_GROUNDING_V2 || '').trim().toLowerCase();
    off = v === 'off' || v === 'false' || v === '0' || v === 'disabled';
  } catch { off = false; }
  cachedEnv = off;
  return off;
};

/**
 * True when Profile Grounding V2 (full-profile injection) should run. Default
 * ON; an explicit env or settings "off" disables it at runtime (no redeploy).
 * Safe to call on the hot path (settings read is a cheap cached get).
 */
export const isProfileGroundingV2Enabled = (): boolean => {
  if (envDisabled()) return false;
  try {
    // From electron/llm/ → ../services/SettingsManager
    const { SettingsManager } = require('../services/SettingsManager');
    const v = SettingsManager.getInstance().get('profileGroundingV2');
    if (v === false) return false; // explicit opt-out only; undefined → default ON
  } catch { /* settings unavailable → fall through to default ON */ }
  return true;
};

/** Test-only: reset the cached env read (env can't change mid-process otherwise). */
export const __resetProfileGroundingV2Cache = (): void => { cachedEnv = null; };
