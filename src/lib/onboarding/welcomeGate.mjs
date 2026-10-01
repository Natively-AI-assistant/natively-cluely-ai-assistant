// src/lib/onboarding/welcomeGate.mjs
//
// Whether the first-launch welcome screen should show. Pure, so the decision is
// testable without Electron.
//
// The welcome is for a FIRST boot only. `seenStartup` is the main-process flag
// the old first-run welcome wrote, and it is set again when this one is
// dismissed. An install that has already been through onboarding — the
// permissions card was shown, or the orchestrator completed any stage — is not
// a first boot either, even if it predates this screen and never wrote
// `seenStartup`.
//
// A missing flag store (null: no bridge, or the IPC failed) falls back to the
// localStorage mirrors alone rather than guessing.

export const WELCOME_SEEN_KEY = 'natively_seen_welcome_v1';
export const LEGACY_PERMS_SHOWN_KEY = 'natively_perms_shown_v1';
// persistence.mjs's state key. It survives the legacy sweep that removes
// natively_perms_shown_v1 (persistence.mjs, maybeSweepLegacyKeys), so it is the
// one local record that an old install already finished a stage.
export const ONBOARDING_STATE_KEY = 'natively_onboarding_state_v1';

/**
 * @param {string | null | undefined} raw  localStorage[ONBOARDING_STATE_KEY]
 * @returns {boolean} whether the orchestrator has ever completed a stage
 */
export function hasOnboardingHistory(raw) {
  if (!raw) return false;
  try {
    const completed = JSON.parse(raw)?.completed;
    // '_'-prefixed entries are the orchestrator's own bookkeeping
    // (_turnCountAtQuietStart), not a finished stage.
    return !!completed && typeof completed === 'object'
      && Object.keys(completed).some(id => !id.startsWith('_'));
  } catch {
    return false;
  }
}

/**
 * @param {{ seenStartup?: boolean, permsShown?: boolean } | null | undefined} flags
 * @param {{ welcomeSeen?: boolean, permsShown?: boolean, onboarded?: boolean }} local
 * @returns {boolean}
 */
export function shouldShowWelcome(flags, local) {
  if (local.welcomeSeen || local.permsShown || local.onboarded) return false;
  if (!flags) return true;
  return !flags.seenStartup && !flags.permsShown;
}
