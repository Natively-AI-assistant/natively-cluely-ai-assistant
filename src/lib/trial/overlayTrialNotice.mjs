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
 *   dismissed?: { started?: boolean, ending?: boolean, ended?: boolean },   closed by the user in this meeting
 *   allowanceLow?: boolean,           main says the AI allowance is in its last quarter
 *   endedBy?: null | 'clock' | 'allowance',     what ended it, when main said so
 * }} s
 * @returns {{ banner: null | 'started' | 'ending' | 'ended' | 'failed',
 *             chip: null | { minutesLeft: number, tone: 'ok' | 'warning' },
 *             minutesLeft: number | null,   minutes left while the trial is live
 *             reason: null | 'clock' | 'allowance',  for ending and ended: why
 *             closed?: 'ending' | 'ended' }}  the banner that would show, closed by the user
 */
export function overlayTrialNotice(s) {
  const dismissed = s.dismissed ?? {};
  const expiresAt = typeof s.expiresAt === 'number' ? s.expiresAt : null;

  if (expiresAt !== null && expiresAt > s.now) {
    // The expiry is the server's and the clock is this machine's. One that runs
    // behind would show more time than a trial has ("started: 31 minutes").
    const cap = typeof s.durationMs === 'number' && s.durationMs > 0 ? s.durationMs : Infinity;
    const left = Math.min(expiresAt - s.now, cap);
    const byClock = left <= TRIAL_ENDING_MS;
    // Its AI allowance is nearly used (2026-11-03): about two answers left,
    // however many minutes are. The same warning as the clock's.
    const byAllowance = s.allowanceLow === true;
    const ending = byClock || byAllowance;
    const minutesLeft = Math.max(1, Math.ceil(left / 60_000));
    const chip = { minutesLeft, tone: ending ? 'warning' : 'ok' };
    // The warning has a close (2026-11-09; until then it had none and sat up
    // to five minutes over a live call). Closed, the amber countdown still
    // says it, and the end is a new banner that shows by itself.
    if (ending) {
      const reason = byClock ? 'clock' : 'allowance';
      return dismissed.ending
        ? { banner: null, chip, minutesLeft, reason, closed: 'ending' }
        : { banner: 'ending', chip, minutesLeft, reason };
    }
    const announced = typeof s.announcedAt === 'number'
      && s.now - s.announcedAt < TRIAL_STARTED_BANNER_MS && !dismissed.started;
    // The started banner says the minutes itself, so the countdown waits for
    // it to fold: the two side by side would say the same thing twice.
    return announced ? { banner: 'started', chip: null, minutesLeft, reason: null } : { banner: null, chip, minutesLeft, reason: null };
  }

  // Run out. Said only in the meeting it ran out in. It has a close
  // (2026-11-09): it used to stay for the rest of the meeting. Closed, it is
  // reported as `closed`, so the overlay still knows the trial explains why
  // nothing transcribes (and does not put "Transcription Not Configured" up
  // in its place).
  if (expiresAt !== null && s.liveThisMeeting) {
    const reason = s.endedBy === 'allowance' ? 'allowance' : 'clock';
    return dismissed.ended
      ? { banner: null, chip: null, minutesLeft: null, reason, closed: 'ended' }
      : { banner: 'ended', chip: null, minutesLeft: null, reason };
  }

  // Could not start. No close here either: nothing transcribes or answers,
  // and with this banner gone the overlay would say "Transcription Not
  // Configured" and send the user to Settings › Audio instead.
  if (s.startFailed) return { banner: 'failed', chip: null, minutesLeft: null, reason: null };
  return { banner: null, chip: null, minutesLeft: null, reason: null };
}
