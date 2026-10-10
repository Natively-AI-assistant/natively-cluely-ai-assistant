// src/lib/trial/overlayTrialNotice.mjs
//
// What the meeting overlay says about the free trial (2026-10-09): a banner
// when it starts by itself, a small countdown for the rest of it, a warning
// near the end, and a banner when it has run out or could not start.
//
// Pure: the overlay's hook (src/components/overlay/useOverlayTrial.ts) feeds it
// the clock and what it has heard from main, and draws what comes back.

/** The warning banner and the amber countdown start this long before the end. */
export const TRIAL_ENDING_MS = 5 * 60_000;
/** How long the "Free trial started" banner stays before it folds into the countdown. */
export const TRIAL_STARTED_BANNER_MS = 12_000;

/**
 * @param {{
 *   now: number,
 *   expiresAt?: number | null,        when the trial ends (ms), if this install holds one
 *   announcedAt?: number | null,      when this overlay heard the trial start, if it did
 *   liveThisMeeting?: boolean,        the trial was running at some point in this meeting
 *   startFailed?: null | 'unreachable' | 'rate_limited' | 'paused',
 *   durationMs?: number | null,       how long a trial lasts, when known: caps the time shown
 *   dismissed?: { started?: boolean },          only the started banner can be closed
 * }} s
 * @returns {{ banner: null | 'started' | 'ending' | 'ended' | 'failed',
 *             chip: null | { minutesLeft: number, tone: 'ok' | 'warning' },
 *             minutesLeft: number | null }}  minutes left while the trial is live
 */
export function overlayTrialNotice(s) {
  const dismissed = s.dismissed ?? {};
  const expiresAt = typeof s.expiresAt === 'number' ? s.expiresAt : null;

  if (expiresAt !== null && expiresAt > s.now) {
    // The expiry is the server's and the clock is this machine's. One that runs
    // behind would show more time than a trial has ("started: 31 minutes").
    const cap = typeof s.durationMs === 'number' && s.durationMs > 0 ? s.durationMs : Infinity;
    const left = Math.min(expiresAt - s.now, cap);
    const ending = left <= TRIAL_ENDING_MS;
    const minutesLeft = Math.max(1, Math.ceil(left / 60_000));
    const chip = { minutesLeft, tone: ending ? 'warning' : 'ok' };
    // The warning has no close (owner's decision, 2026-10-10): it stays, with
    // the amber countdown, for the last five minutes.
    if (ending) return { banner: 'ending', chip, minutesLeft };
    const announced = typeof s.announcedAt === 'number'
      && s.now - s.announcedAt < TRIAL_STARTED_BANNER_MS && !dismissed.started;
    // The started banner says the minutes itself, so the countdown waits for
    // it to fold: the two side by side would say the same thing twice.
    return announced ? { banner: 'started', chip: null, minutesLeft } : { banner: null, chip, minutesLeft };
  }

  // Run out. Said only in the meeting it ran out in: nothing works until the
  // user picks a plan or their own keys, so this one has no close.
  if (expiresAt !== null && s.liveThisMeeting) return { banner: 'ended', chip: null, minutesLeft: null };

  // Could not start. No close here either: nothing transcribes or answers,
  // and with this banner gone the overlay would say "Transcription Not
  // Configured" and send the user to Settings › Audio instead.
  if (s.startFailed) return { banner: 'failed', chip: null, minutesLeft: null };
  return { banner: null, chip: null, minutesLeft: null };
}
