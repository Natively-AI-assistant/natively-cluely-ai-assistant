// Pro or an unexpired free trial: the one gate for Profile Intelligence and the
// features sold with it. Lives outside ipcHandlers so code that is not an IPC
// handler (the meeting notes reading "About you") asks the same question.
// No platform branches: LicenseManager and CredentialsManager hide their
// macOS / Windows storage differences behind these calls.

/**
 * Returns true if the user has an active premium license OR an unexpired free trial.
 * Used to gate profile intelligence features (resume upload, JD upload, company
 * research, Cue Cards, "About you").
 */
export function isProOrTrialActive(): boolean {
  // 1. Full premium license (Dodo / Gumroad / Natively API subscription)
  try {
    const { LicenseManager } = require('../../premium/electron/services/LicenseManager');
    if (LicenseManager.getInstance().isPremium()) return true;
  } catch {
    /* premium module not available */
  }

  // 2. Active free trial (token present, not ended, not past its expiry by
  //    the trial clock, which winding the computer's clock back does not move)
  try {
    return !trialTimeIsUp();
  } catch {
    return false;
  }
}

let trialClock: import('./trialClock').TrialClock | null = null;

function credentials(): any {
  const { CredentialsManager } = require('./CredentialsManager');
  return CredentialsManager.getInstance();
}

/** The trial clock (services/trialClock.ts), kept in the credential store. */
export function getTrialClock(): import('./trialClock').TrialClock {
  if (trialClock) return trialClock;
  const { createTrialClock } = require('./trialClock') as typeof import('./trialClock');
  trialClock = createTrialClock({
    startedAt: () => credentials().getTrialStartedAt?.(),
    load: () => credentials().getTrialClockMs?.(),
    save: (ms) => credentials().setTrialClockMs?.(ms),
  });
  return trialClock;
}

/**
 * Is the free trial over (or absent)? The one answer for every place that asks
 * whether the trial still runs: ended by the server, or past its expiry by the
 * trial clock. Marks it ended the first time it is found over, so the answer
 * cannot flip back when the computer's clock is wound back later. Any failure
 * reads as over.
 */
export function trialTimeIsUp(): boolean {
  try {
    const cm = credentials();
    const token = cm.getTrialToken();
    const expiresAt = cm.getTrialExpiresAt();
    const endedAt = typeof cm.getTrialEndedAt === 'function' ? cm.getTrialEndedAt() : undefined;
    if (!token || !expiresAt) return true;
    if (endedAt) return true;
    const { trialIsOver } = require('./trialClock') as typeof import('./trialClock');
    const over = trialIsOver({ token, expiresAt, endedAt }, getTrialClock().now());
    if (over && typeof cm.markTrialEnded === 'function') cm.markTrialEnded();
    return over;
  } catch {
    return true;
  }
}

/** For tests: forget the trial clock (a new CredentialsManager stand-in). */
export function resetTrialClockForTests(): void {
  trialClock = null;
}

/**
 * "About you" as the meeting notes read it: one line, at most 600 characters,
 * and only for Pro or trial. A free user's saved text stays in settings (it
 * comes back when they upgrade) but no summary reads it.
 */
export function bioForNotes(raw: unknown, allowed: boolean): string {
  if (!allowed || typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, 600);
}

/**
 * "About you" for live answers (every mode, what-to-answer and typed chat):
 * the same text and the same Pro or trial gate as the meeting notes. Empty when
 * unset or without access. The caller hands it to the V3 bridge, which drops it
 * when the "Profile and history" provider scope is off.
 */
export function userBioForAnswers(): string {
  try {
    const { SettingsManager } = require('./SettingsManager');
    return bioForNotes(SettingsManager.getInstance().get('userBio'), isProOrTrialActive());
  } catch {
    return '';
  }
}

/**
 * The startup licence re-check (license:check-premium-async). Asks the server
 * through `isPremiumAsync`; when that revokes a licence the local file still
 * held (a lapsed subscription, a refund) and no trial is running, `onLost`
 * stands the Pro features down for this session. Resolves to what
 * `isPremiumAsync` said; any failure reads as no licence, and `onLost` is never
 * called for a user who had no licence to begin with. `onRestored` runs when a
 * licence held as revoked is valid again (Dodo re-enables a key once a held
 * payment clears).
 */
export async function recheckLicence(
  license: { isPremium(): boolean; isPremiumAsync(): Promise<boolean> },
  deps: { stillAllowed(): boolean; onLost(): void; onRestored?(): void },
): Promise<boolean> {
  let wasPremium = false;
  try { wasPremium = license.isPremium() === true; } catch { wasPremium = false; }
  let active = false;
  try { active = (await license.isPremiumAsync()) === true; } catch { return false; }
  if (wasPremium && !active) {
    let allowed = false;
    try { allowed = deps.stillAllowed() === true; } catch { allowed = false; }
    if (!allowed) {
      try { deps.onLost(); } catch { /* standing down is best effort */ }
    }
  }
  if (!wasPremium && active) {
    try { deps.onRestored?.(); } catch { /* telling the windows is best effort */ }
  }
  return active;
}
