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

/**
 * Phase 0.5 of the semantic-retrieval repair (2026-08-13, audit
 * reports/cosine-similarity-relevance-audit-2026-08-13.md): extend V2's
 * "grounding covers this answer type" set with the fit family
 * (`jd_fit_answer` + `resume_jd_fit_answer`, both required-layers
 * [resume, jd]), skipping the redundant vector retrieval for JD-fit turns.
 *
 * Why jd_fit qualifies: getRelevantNodes is called with
 * sourceTypes [RESUME, JD], so the ONLY things it can return are (a) the
 * structured resume/JD fact nodes — the same data buildGroundingBlock already
 * injects on every jd_fit turn (profileGroundingPlan grants jd_fit both
 * resume AND JD) — and (b) STAR-story nodes. The dossier and salary blocks
 * are assembled by separate code paths and never flow through the node
 * scorer. Cost of the skip: STAR-story nodes no longer appear in jd_fit
 * prompts (they remain in behavioral prompts, their primary consumer).
 *
 * Why negotiation does NOT qualify (measured 2026-08-13, do not add it):
 * applyFullProfileGrounding is intent-gated with
 * `intent !== IntentType.NEGOTIATION`, so negotiation turns never receive
 * the grounding block — skipping retrieval there would drop resume facts
 * from the prompt with no replacement.
 *
 * DEFAULT ON (kill-switch model, matching this file's main flag) since
 * 2026-08-14: gated on the live E2E (scripts/e2e-semantic-repair-deepseek.js
 * S5 — retrieval skipped, DeepSeek answered the fit question correctly from
 * the grounding block alone) plus the corpus measurement showing the fit
 * family's retrieval pool duplicates the grounding block. Disableable at
 * runtime WITHOUT a redeploy:
 *   - env  PROFILE_GROUNDING_V2_JDFIT_COVERAGE = 'off' | 'false' | '0' | 'disabled' → disabled
 *   - settings  profileGroundingV2JdFitCoverage === false                           → disabled
 * Note the containing check already requires isProfileGroundingV2Enabled() —
 * killing V2 kills this with it.
 * Deliberately uncached (read per call): it sits on a per-question path, the
 * read is a string compare, and caching is what makes env-flag tests race
 * (see the P2 gotcha notes in this file's history).
 */
export const isProfileGroundingV2JdFitCoverageEnabled = (): boolean => {
  try {
    const v = (process.env.PROFILE_GROUNDING_V2_JDFIT_COVERAGE || '').trim().toLowerCase();
    if (v === 'off' || v === 'false' || v === '0' || v === 'disabled') return false;
  } catch { /* fall through to settings */ }
  try {
    const { SettingsManager } = require('../services/SettingsManager');
    if (SettingsManager.getInstance().get('profileGroundingV2JdFitCoverage') === false) return false;
  } catch { /* settings unavailable → default ON */ }
  return true;
};
