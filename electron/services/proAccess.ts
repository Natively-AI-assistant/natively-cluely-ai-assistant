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
  // 1. Full premium license (Dodo / Gumroad / Natively API subscription). A
  //    Pro pack's licence counts only while the AI and speech-to-text both run
  //    on Natively API (packs/packProRule.ts).
  if (isLicencePremium()) return true;

  // 2. Active free trial (token present, not ended, not past its expiry by
  //    the trial clock, which winding the computer's clock back does not move)
  try {
    return !trialTimeIsUp();
  } catch {
    return false;
  }
}

/**
 * The AI model answering right now. The overlay's model picker (set-model)
 * changes only this session's model, not the saved default, so the live one is
 * what counts; ipcHandlers registers it. Before that, the saved default.
 */
let liveAiModel: (() => string | null | undefined) | null = null;
let liveFastFamily: (() => string | null | undefined) | null = null;
export function setLiveAiModelReader(
  read: (() => string | null | undefined) | null,
  fastFamily: (() => string | null | undefined) | null = null,
): void {
  liveAiModel = read;
  liveFastFamily = fastFamily;
}
function currentFastFamily(): string | null {
  if (!liveFastFamily) return null;
  try { return liveFastFamily() ?? null; } catch { return null; }
}

/**
 * The stored licence's provider and plan, kept 10 s. getLicenseDetails reads
 * and decrypts the licence file (Keychain on macOS, DPAPI on Windows), and
 * isProOrTrialActive runs on every answer. Stale for a few seconds at worst,
 * and the pack rule only ever takes Pro away, so a just-bought pack can show
 * Pro on its own keys for that long, never the reverse.
 */
const LICENCE_FACTS_MS = 10_000;
let licenceFacts: { at: number; provider?: string; plan?: string; isPremium: boolean } | null = null;
function readLicenceFacts(): { provider?: string; plan?: string; isPremium: boolean } {
  const now = Date.now();
  if (licenceFacts && now - licenceFacts.at < LICENCE_FACTS_MS && now >= licenceFacts.at) return licenceFacts;
  const { LicenseManager } = require('../../premium/electron/services/LicenseManager');
  const d = LicenseManager.getInstance().getLicenseDetails();
  licenceFacts = { at: now, provider: d?.provider, plan: d?.plan, isPremium: Boolean(d?.isPremium) };
  return licenceFacts;
}
/** Activation, deactivation, a re-check: read the licence afresh next time. */
export function forgetLicenceFacts(): void {
  licenceFacts = null;
}
function currentAiModel(cm: any): string | null | undefined {
  if (liveAiModel) {
    try {
      const id = liveAiModel();
      if (typeof id === 'string' && id) return id;
    } catch { /* fall back to the saved default */ }
  }
  return cm.getDefaultModel();
}

/** Should the Pro pack meeting clock count this minute? (packs/packProRule.ts) */
export function packHoursCountNow(): boolean {
  try {
    const { packHoursCount } = require('./packs/packProRule') as typeof import('./packs/packProRule');
    const cm = credentials();
    return packHoursCount(currentAiModel(cm), cm.getSttProvider(), currentFastFamily());
  } catch {
    // Unknown state: count, as before the rule. Hours are what a pack sells.
    return true;
  }
}

/**
 * Which provider stops a Pro pack's Pro right now, or null when nothing does
 * (both on Natively API, or the licence is not a pack). Any failure reads as
 * null: the rule never takes Pro from a licence it cannot read.
 */
export function currentPackProBlock(): import('./packs/packProRule').PackProBlock {
  try {
    const details = readLicenceFacts();
    if (!details.isPremium) return null;
    const { packProBlock, isPackLicence } = require('./packs/packProRule') as typeof import('./packs/packProRule');
    // Only a pack licence is ever blocked: anything else stops here, with no
    // settings read.
    if (!isPackLicence(details.provider, details.plan)) return null;
    const cm = credentials();
    return packProBlock({
      licenceProvider: details.provider,
      licencePlan: details.plan,
      defaultModel: currentAiModel(cm),
      fastFamily: currentFastFamily(),
      sttProvider: cm.getSttProvider(),
    });
  } catch {
    return null;
  }
}

/** Is the stored licence a Pro pack's? Any failure reads as no. */
export function licenceIsPack(): boolean {
  try {
    const d = readLicenceFacts();
    const { isPackLicence } = require('./packs/packProRule') as typeof import('./packs/packProRule');
    return d.isPremium && isPackLicence(d.provider, d.plan);
  } catch {
    return false;
  }
}

/**
 * The stored licence, with the Pro pack rule applied. What every window is
 * told as `isPremium`. LicenseManager.isPremium() stays the raw answer for the
 * licence-keeping code (re-checks, the reconciler, deactivation).
 */
export function isLicencePremium(): boolean {
  try {
    const { LicenseManager } = require('../../premium/electron/services/LicenseManager');
    if (!LicenseManager.getInstance().isPremium()) return false;
  } catch {
    return false; // premium module not available
  }
  return currentPackProBlock() === null;
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
  deps: { stillAllowed(): boolean; onLost(): void | Promise<void>; onRestored?(): void },
): Promise<boolean> {
  let wasPremium = false;
  try { wasPremium = license.isPremium() === true; } catch { wasPremium = false; }
  let active = false;
  try { active = (await license.isPremiumAsync()) === true; } catch { return false; }
  if (wasPremium && !active) {
    let allowed = false;
    try { allowed = deps.stillAllowed() === true; } catch { allowed = false; }
    if (!allowed) {
      // Awaited: onLost may first let a pack in use take Pro over (ipcHandlers.ts).
      try { await deps.onLost(); } catch { /* standing down is best effort */ }
    }
  }
  if (!wasPremium && active) {
    try { deps.onRestored?.(); } catch { /* telling the windows is best effort */ }
  }
  return active;
}
