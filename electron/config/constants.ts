/**
 * Sentinel value stored in `nativelyApiKey` while a free trial is active.
 *
 * The trial token (`natively_trial_…`) is *not* a valid API key, but the
 * downstream code (LLMHelper, NativelyProSTT, ipcHandlers) needs to treat
 * "trial mode" identically to "key mode" for routing/auto-promotion. We store
 * this sentinel in CredentialsManager so the existing `if (nativelyApiKey)`
 * branches all light up, then swap the auth header to `x-trial-token` at the
 * actual network boundary.
 *
 * Any place that reads `nativelyApiKey` and forwards it to the network MUST
 * compare against TRIAL_SENTINEL_KEY (not the literal '__trial__') so a single
 * rename here updates every call site.
 */
export const TRIAL_SENTINEL_KEY = '__trial__' as const;

// Single source of truth for DOM capture character budget.
// If changing, also update the sibling constant in src/constants/domCapture.ts to prevent drift.
export const DOM_CONTEXT_MAX_CHARS = 25000;

