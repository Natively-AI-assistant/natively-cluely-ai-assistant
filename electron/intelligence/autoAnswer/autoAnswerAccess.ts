/**
 * Who may run Auto Answer, and on what terms (Evin, 2026-11-13).
 *
 * Auto Answer is a Natively Pro feature. A free user can still use it by
 * agreeing to share the transcripts of meetings where it runs, so the Auto
 * Answer decider can be trained on real meetings instead of synthetic ones.
 * Pro and trial users need not share; for them sharing is a separate opt-in.
 *
 *   Pro or trial                  → allowed; uploads only if they opted in
 *   free + current consent        → allowed; uploads on
 *   free, no (or outdated) consent → refused with AUTO_ANSWER_ACCESS_REQUIRED
 *
 * Consent is versioned: when the consent text changes in a way that matters,
 * TRAINING_CONSENT_VERSION goes up and every earlier consent stops counting,
 * so a user is never held to terms they did not see.
 *
 * Pure: no electron, no settings store. Callers pass the licence state and the
 * stored consent; the same function answers the IPC gate, the runtime check
 * the engine makes before every answer, and the upload decision at meeting end.
 * No platform branches: the licence/trial stores behind isProOrTrialActive
 * already hide the macOS Keychain / Windows DPAPI differences.
 */

export const TRAINING_CONSENT_VERSION = 1;

export const AUTO_ANSWER_ACCESS_REQUIRED = 'auto_answer_access_required' as const;

export interface TrainingConsent {
  /** TRAINING_CONSENT_VERSION the user agreed to. */
  version: number;
  /** ISO time of agreement. */
  grantedAt: string;
}

export type AutoAnswerAccess =
  | { allowed: true; basis: 'pro'; uploads: boolean }
  | { allowed: true; basis: 'sharing'; uploads: true }
  | { allowed: false; basis: 'none'; uploads: false; error: typeof AUTO_ANSWER_ACCESS_REQUIRED };

/** A stored value counts only if it is well formed and of the current version. */
export function isConsentCurrent(consent: unknown): consent is TrainingConsent {
  if (!consent || typeof consent !== 'object') return false;
  const c = consent as Partial<TrainingConsent>;
  return c.version === TRAINING_CONSENT_VERSION
    && typeof c.grantedAt === 'string'
    && !Number.isNaN(Date.parse(c.grantedAt));
}

export function autoAnswerAccess(input: { proOrTrial: boolean; consent: unknown }): AutoAnswerAccess {
  const consented = isConsentCurrent(input.consent);
  if (input.proOrTrial) return { allowed: true, basis: 'pro', uploads: consented };
  if (consented) return { allowed: true, basis: 'sharing', uploads: true };
  return { allowed: false, basis: 'none', uploads: false, error: AUTO_ANSWER_ACCESS_REQUIRED };
}

export function newTrainingConsent(now: Date = new Date()): TrainingConsent {
  return { version: TRAINING_CONSENT_VERSION, grantedAt: now.toISOString() };
}

/**
 * Remove contact details and long digit runs before a transcript leaves the
 * device. Deliberately narrow: names and ordinary words stay (the decider
 * learns from who is addressed), but things that identify or reach a person
 * — email addresses, phone numbers, card/account-like digit runs, URLs with
 * query strings — are replaced by a placeholder. Not a promise of anonymity;
 * the consent text says so.
 */
export function scrubTranscriptText(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\bhttps?:\/\/\S+/gi, '[link]')
    // phone numbers: optional +, then 8+ digits allowing spaces, dots, dashes, brackets
    .replace(/(?:\+?\d[\d\s().-]{6,}\d)/g, (m) => (m.replace(/\D/g, '').length >= 8 ? '[number]' : m))
    // any remaining run of 6+ digits (codes, account numbers)
    .replace(/\d{6,}/g, '[number]');
}
