// src/lib/cards/cardInputs.mjs
//
// What the card scheduler knows about the user, mapped from the launcher's IPC
// reads (toaster policy Phase 2). App.tsx fetches the sources and pushes the
// resulting patch into the orchestrator's user state whenever one of them can
// have changed (credentials, licence, trial, profile, extension). A missing
// source leaves its fields out of the patch: nothing is guessed.

/** get-stored-credentials flags that mean an AI route of the user's own. */
const OWN_AI_FLAGS = [
  'hasGeminiKey', 'hasGroqKey', 'hasOpenaiKey', 'hasClaudeKey', 'hasDeepseekKey',
  'hasNvidiaNimKey', 'hasOpenrouterKey', 'hasFluxionKey', 'hasAgentRouterKey', 'hasNinerouterKey', 'hasLitellmBaseURL',
];

function tierOf(plan) {
  const p = String(plan ?? '').toLowerCase();
  return p === 'pro' || p === 'max' || p === 'ultra' ? p : 'other';
}

/**
 * The paying user's tier. The plan the Natively API reports with the usage is
 * the fresh one: the stored licence plan is never rewritten after an upgrade.
 */
function planTierOf(licence, usage) {
  if (!licence?.isPremium) return 'free';
  if (usage?.ok && typeof usage.plan === 'string' && usage.plan) return tierOf(usage.plan);
  return tierOf(licence.plan);
}

/** The fullest METERED Natively meter this cycle, 0–100 (unmetered meters never count). */
export function quotaPercent(usage) {
  const q = usage?.ok ? usage.quota : undefined;
  if (!q) return 0;
  const meters = [q.ai, q.voice, q.research, q.knowledge?.embedding, q.knowledge?.reranker];
  let max = 0;
  for (const m of meters) {
    if (!m || typeof m.used !== 'number' || typeof m.limit !== 'number' || m.limit <= 0) continue;
    max = Math.max(max, Math.round((m.used / m.limit) * 100));
  }
  return max;
}

/** When the current Natively quota cycle ends (ms), or undefined. */
export function quotaCycleEnd(usage) {
  const t = Date.parse(usage?.quota?.resets_at ?? '');
  return Number.isFinite(t) ? t : undefined;
}

/**
 * @param {{ creds?: object, licence?: object, profile?: object, trialLocal?: object,
 *           extension?: object, usage?: object }} sources
 * @returns {Partial<import('../onboarding/orchestrator').UserState>}
 */
export function cardInputsFromSources({ creds, licence, profile, trialLocal, extension, usage } = {}) {
  const patch = {};
  if (creds) {
    patch.hasNativelyKey = !!creds.hasNativelyKey;
    // Main answers with the Trial ended rule (trialPolicy.hasOwnAiKey), which
    // also counts custom and cURL providers; the flags are the fallback.
    patch.hasOwnAiKey = typeof creds.hasOwnAiKey === 'boolean'
      ? creds.hasOwnAiKey
      : OWN_AI_FLAGS.some((f) => !!creds[f]);
  }
  if (licence) {
    patch.isPremium = !!licence.isPremium;
    patch.planTier = planTierOf(licence, usage);
  }
  if (profile) {
    patch.hasProfile = !!profile.hasProfile;
    patch.hasJD = !!(profile.jdFactsReady || profile.jd_structured_extraction_complete);
  }
  if (trialLocal) {
    patch.trialClaimed = !!(trialLocal.trialClaimed || trialLocal.hasToken);
    patch.hasTrialToken = !!trialLocal.hasToken && !trialLocal.expired;
  }
  if (extension) {
    patch.extensionConnected = !!extension.extensionConnected;
  }
  if (usage) {
    patch.nativelyQuotaPct = quotaPercent(usage);
    patch.nativelyQuotaResetsAt = quotaCycleEnd(usage) ?? null;
  }
  return patch;
}
