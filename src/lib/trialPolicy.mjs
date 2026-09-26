// src/lib/trialPolicy.mjs
//
// What to do with an EXPIRED free-trial token (toaster policy Phase 0,
// docs/superpowers/specs/2026-09-26-toaster-policy-design.md §5, §9).
//
// The token deliberately survives expiry: it is how the next launch knows to
// show the "Trial ended" card to someone who quit before seeing it. But it
// also survived a PURCHASE. A user who let the trial run out and then bought
// a licence, saved a real Natively key or saved their own AI key kept the dead
// token, so every launch wiped their résumé/JD data and opened a card that
// cannot be closed and whose only exit ("Use my own API keys") deactivates the
// licence they just paid for.
//
// Pure and platform-free, so every branch is testable; applied in one place in
// the main process (settleExpiredTrial in ipcHandlers.ts).

/** Credential fields that give the app an AI (LLM) route of the user's own. */
const AI_KEY_FIELDS = [
  'geminiApiKey',
  'groqApiKey',
  'openaiApiKey',
  'claudeApiKey',
  'deepseekApiKey',
  'nvidiaNimApiKey',
  'openrouterApiKey',
  'fluxionApiKey',
  'ninerouterApiKey',
  'litellmBaseURL',
];

/**
 * True when the stored credentials include an AI route of the user's own.
 * Speech-to-text keys do not count (they cannot answer anything), and neither
 * does the Natively key, which the caller checks separately.
 *
 * @param {Record<string, unknown> | null | undefined} creds CredentialsManager.getAllCredentials()
 * @returns {boolean}
 */
export function hasOwnAiKey(creds) {
  if (!creds) return false;
  for (const field of AI_KEY_FIELDS) {
    const v = creds[field];
    if (typeof v === 'string' && v.trim().length > 0) return true;
  }
  const custom = creds.customProviders;
  const curl = creds.curlProviders;
  return (Array.isArray(custom) && custom.length > 0) || (Array.isArray(curl) && curl.length > 0);
}

/**
 * Decide what an expired trial token means right now.
 *
 * - A licence, a real Natively key or an own AI key supersedes the trial:
 *   clear the token and never show the "Trial ended" card.
 * - The profile-data wipe removes Pro-only data from someone who is not
 *   licensed for Pro, so it never runs for a licensed user, and runs once per
 *   trial (the caller records which trial was wiped).
 * - A trial with time left is never touched.
 *
 * @param {{ hasToken: boolean, expired: boolean, licensed: boolean,
 *           hasRealNativelyKey: boolean, hasOwnAiKey: boolean,
 *           wipedForThisTrial: boolean } | null | undefined} s
 * @returns {{ showEndedCard: boolean, wipe: boolean, clearToken: boolean }}
 */
export function resolveExpiredTrial(s) {
  if (!s || !s.hasToken || !s.expired) return { showEndedCard: false, wipe: false, clearToken: false };
  const clearToken = !!(s.licensed || s.hasRealNativelyKey || s.hasOwnAiKey);
  return { showEndedCard: !clearToken, wipe: !s.licensed && !s.wipedForThisTrial, clearToken };
}
