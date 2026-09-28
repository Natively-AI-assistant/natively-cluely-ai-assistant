// src/lib/onboarding/welcomeGate.mjs
//
// Whether the first-launch welcome screen should show. Pure, so the decision is
// testable without Electron.
//
// The welcome is for a FIRST boot only. `seenStartup` is the main-process flag
// the old first-run welcome wrote, and it is set again when this one is
// dismissed. An install that has already been through onboarding — the
// permissions card was shown — is not a first boot either, even if it predates
// this screen and never wrote `seenStartup`.
//
// A missing flag store (null: no bridge, or the IPC failed) falls back to the
// localStorage mirrors alone rather than guessing.

export const WELCOME_SEEN_KEY = 'natively_seen_welcome_v1';
export const LEGACY_PERMS_SHOWN_KEY = 'natively_perms_shown_v1';

/**
 * @param {{ seenStartup?: boolean, permsShown?: boolean } | null | undefined} flags
 * @param {{ welcomeSeen?: boolean, permsShown?: boolean }} local
 * @returns {boolean}
 */
export function shouldShowWelcome(flags, local) {
  if (local.welcomeSeen || local.permsShown) return false;
  if (!flags) return true;
  return !flags.seenStartup && !flags.permsShown;
}
