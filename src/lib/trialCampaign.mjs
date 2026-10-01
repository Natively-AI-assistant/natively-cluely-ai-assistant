// src/lib/trialCampaign.mjs
//
// The one-time "everyone may try Natively again" reset (release 2026-09-29).
//
// WHY A CLIENT STEP EXISTS. The server keys a trial on the device (`free_trials.hwid`)
// and re-issues the SAME expired trial for a device that already used one. Archiving
// those rows (done 2026-09-29) gives every device a fresh trial, but the app itself
// remembers "already claimed" in four places and hides the offer for good:
//   1. credentials `trialClaimed` (never cleared by design) + an expired trial token
//   2. renderer localStorage `natively_trial_claimed`
//   3. the card ledger's `trial_promo` entry (retired) - main process
//   4. the onboarding orchestrator's persisted `completed.trial_promo` - renderer
// Until all four are cleared a past user never sees Start Trial again.
//
// EVERYTHING HERE IS PURE. Storage, the credential store, the ledger and the
// settings store are injected, so the platform difference (Keychain on macOS,
// DPAPI on Windows) sits behind `resetClaim()` and none of this reads process.platform.
//
// WHO. Only a user with no licence, no real Natively key and no AI key of their own
// (BYOK). Everyone else keeps their state untouched.
//
// ONE-TIME. Each half is guarded by a marker keyed on TRIAL_CAMPAIGN and written
// LAST, only after every step persisted. A step that could not write (a degraded
// credential store, an unreadable ledger) leaves no marker, so the next launch
// retries. Bump TRIAL_CAMPAIGN to run a future campaign.

/** Bump to re-open the trial for everyone again. */
export const TRIAL_CAMPAIGN = '2026-09-29';

/**
 * When the server-side archive first ran (UTC ms). A trial STARTED at or after this
 * belongs to the new campaign and is never reset, so a device that already took its
 * second trial is not offered a third.
 *
 * INVARIANT: this must never be LATER than the moment the server rows were archived,
 * or a device that started in the gap is offered Start Trial and the server answers
 * `already_used` + expired. Keep it fixed. The final server pass therefore archives
 * only rows with `started_at < ` this instant that are not yet prefixed (the trials
 * that were still running when the first pass ran), so client and server agree by
 * construction and nothing is bumped at release.
 */
export const TRIAL_CAMPAIGN_SERVER_RESET_AT = Date.parse('2026-09-29T10:25:31Z');

export const RENDERER_TRIAL_KEYS = Object.freeze({
  marker: 'natively_trial_campaign',
  claimed: 'natively_trial_claimed',
  legacyPromoTs: 'natively_trial_promo_ts',
  onboardingState: 'natively_onboarding_state_v1',
});

/** The onboarding stage id of the free-trial promo card. */
export const TRIAL_PROMO_ID = 'trial_promo';

/**
 * Renderer half. Removes the "claimed" flag, the legacy promo timestamp and the
 * orchestrator's record that the promo already ran, then writes the marker.
 *
 * Idempotent and safe at any moment: a trial that is genuinely active sets the
 * claimed flag again as soon as Settings reads its status, and every offer is
 * gated on having no key / licence / trial, so re-opening it for a user who has
 * one changes nothing they can see.
 *
 * @param {{ getItem(k: string): string | null, setItem(k: string, v: string): void, removeItem(k: string): void }} storage
 * @param {string} [campaign]
 * @returns {boolean} true when it ran now; false when already done or storage failed
 */
export function resetRendererTrialClaim(storage, campaign = TRIAL_CAMPAIGN) {
  const K = RENDERER_TRIAL_KEYS;
  try {
    if (storage.getItem(K.marker) === campaign) return false;

    storage.removeItem(K.claimed);
    storage.removeItem(K.legacyPromoTs);

    const raw = storage.getItem(K.onboardingState);
    if (raw) {
      let state = null;
      try { state = JSON.parse(raw); } catch { state = null; }
      if (state && typeof state === 'object') {
        let changed = false;
        if (state.completed && typeof state.completed === 'object' && TRIAL_PROMO_ID in state.completed) {
          const { [TRIAL_PROMO_ID]: _gone, ...rest } = state.completed;
          state = { ...state, completed: rest };
          changed = true;
        }
        if (Array.isArray(state.skipped) && state.skipped.includes(TRIAL_PROMO_ID)) {
          state = { ...state, skipped: state.skipped.filter((id) => id !== TRIAL_PROMO_ID) };
          changed = true;
        }
        if (changed) storage.setItem(K.onboardingState, JSON.stringify(state));
      }
    }

    storage.setItem(K.marker, campaign);
    return true;
  } catch {
    return false;
  }
}

/** Renderer read of "has this device claimed a trial" (runs the reset first). */
export function isTrialClaimedLocally(storage) {
  resetRendererTrialClaim(storage);
  try { return storage.getItem(RENDERER_TRIAL_KEYS.claimed) === 'true'; } catch { return false; }
}

/** Renderer write: this device has a trial on record. */
export function markTrialClaimedLocally(storage) {
  resetRendererTrialClaim(storage);
  try { storage.setItem(RENDERER_TRIAL_KEYS.claimed, 'true'); } catch { /* best effort */ }
}

/**
 * Main-process half. Decides and orders the steps; the caller supplies the effects.
 *
 * @typedef {object} MainResetDeps
 * @property {string} [campaign]
 * @property {number} [cutoffMs]
 * @property {number} now
 * @property {() => string | undefined} getMarker
 * @property {(v: string) => void} setMarker
 * @property {{ hasToken: boolean, expiresAtMs: number, startedAtMs: number }} trial  NaN = unknown
 * @property {boolean} eligible  no licence, no real Natively key and no AI key of their own
 *   (the same three tests resolveExpiredTrial uses). Anyone else is left exactly as they are.
 * @property {boolean} sentinelActive  the stored Natively key is the trial sentinel
 * @property {() => Promise<unknown>} endExpiredRuntime  stand the trial's routing down
 * @property {() => { persisted: boolean }} resetClaim  clear token, expiry, start and claimed
 * @property {() => boolean} reopenPromo  un-retire the trial promo in the card ledger
 *
 * @param {MainResetDeps} d
 * @returns {Promise<{ status: 'already' | 'ineligible' | 'live' | 'newer-trial' | 'degraded' | 'ledger-unreadable' | 'reset' }>}
 */
export async function runTrialCampaignReset(d) {
  const campaign = d.campaign ?? TRIAL_CAMPAIGN;
  const cutoffMs = d.cutoffMs ?? TRIAL_CAMPAIGN_SERVER_RESET_AT;

  if (d.getMarker() === campaign) return { status: 'already' };

  // Only someone with no key, no licence and no BYOK is re-offered the trial. No marker:
  // a user who later drops their keys is then a no-key user and gets it on a later launch
  // (a trial started after the cutoff is still recognised and never repeated).
  if (!d.eligible) return { status: 'ineligible' };

  if (d.trial.hasToken) {
    // A trial with time left is never touched. An expiry we cannot read is treated
    // as live: better to retry next launch than to end someone's trial on a guess.
    if (!Number.isFinite(d.trial.expiresAtMs) || d.trial.expiresAtMs > d.now) return { status: 'live' };

    // Already inside the new campaign: they had their second trial. Done, no reset.
    if (Number.isFinite(d.trial.startedAtMs) && d.trial.startedAtMs >= cutoffMs) {
      d.setMarker(campaign);
      return { status: 'newer-trial' };
    }

    // Clearing the token while the sentinel key and the `natively` model default
    // survive would leave every request routed to a trial the server refuses.
    if (d.sentinelActive) await d.endExpiredRuntime();
  }

  if (!d.resetClaim().persisted) return { status: 'degraded' };
  if (!d.reopenPromo()) return { status: 'ledger-unreadable' };

  d.setMarker(campaign);
  return { status: 'reset' };
}
