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
  // Dev override: simulate active pro/ultra subscription in development.
  try {
    const { isDevPremiumOverrideEnabled } = require('./devPremiumOverride');
    if (isDevPremiumOverrideEnabled()) return true;
  } catch { /* devPremiumOverride unavailable */ }

  // 1. Full premium license (Dodo / Gumroad / Natively API subscription)
  try {
    const { LicenseManager } = require('../../premium/electron/services/LicenseManager');
    if (LicenseManager.getInstance().isPremium()) return true;
  } catch {
    /* premium module not available */
  }

  // 2. Active free trial (token present and not expired)
  try {
    const { CredentialsManager } = require('./CredentialsManager');
    const cm = CredentialsManager.getInstance();
    const token = cm.getTrialToken();
    if (!token) return false;
    const expiresAt = cm.getTrialExpiresAt();
    if (!expiresAt) return false;
    return new Date(expiresAt).getTime() > Date.now();
  } catch {
    return false;
  }
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
