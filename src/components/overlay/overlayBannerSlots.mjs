// src/components/overlay/overlayBannerSlots.mjs
//
// At most two banners at once in the meeting overlay (2026-11-09).
//
// The overlay has about a dozen independent banner folds, each 50-80 px, and
// nothing stopped them stacking: a bad minute could put five above the answer
// and push it off the screen mid-call. Now the overlay asks which banners want
// to show and draws only the first OVERLAY_BANNER_CAP of them by priority. The
// rest stay held, not dropped: their state is untouched, so each comes back by
// itself when a slot frees. (One that expires on its own clock while held,
// the page-capture notice after 20 s, the "trial started" note after 12 s,
// goes unseen: it described a moment that has passed.)
//
// Priority, most important first. Auto-stop leads: it ends the meeting in a
// minute unless the user acts, and a dead mic (an error banner) is exactly
// when silence makes it fire. Then errors that mean nothing is being heard or
// transcribed; notices about something the user just did come before passive
// advice, which comes last.
//
//   auto-stop          the meeting stops in a minute unless something is said
//   audio-error        a blocked permission, or a capture that gave up
//   stt-error          transcription stopped, or the pack that paid for it ended
//   stt-not-configured nothing transcribes: no provider
//   audio-stuck        a channel is silent while main keeps retrying
//   stt-warning        reconnecting, on a backup provider, or falling behind
//   ambient-mic        Ambient AI Chat: this meeting is not heard on purpose
//   trial              the free trial started / is ending / ended / could not start
//   last-time          what last time's notes left open
//   capture-fallback   the page capture the user just asked for fell back
//   refusal-retry      the screenshot answer was retried without the border
//   stealth-permission stealth typing cannot start (Accessibility / keyboard hook)
//   hotkey-conflict    the stealth typing hotkey is taken
//   audio-advisory     audio advice, e.g. a Bluetooth mic in call mode
//
// Pure. The same on macOS and Windows (the platform-specific banners are
// gated by the caller before they get here).

export const OVERLAY_BANNER_CAP = 2;

export const OVERLAY_BANNER_PRIORITY = Object.freeze([
  'auto-stop',
  'audio-error',
  'stt-error',
  'stt-not-configured',
  'audio-stuck',
  'stt-warning',
  'ambient-mic',
  'trial',
  'last-time',
  'capture-fallback',
  'refusal-retry',
  'stealth-permission',
  'hotkey-conflict',
  'audio-advisory',
]);

/**
 * The banners to draw, from the ones that want to show.
 * @param {Partial<Record<string, boolean>>} wanted  banner id -> wants to show
 * @param {number} [cap]
 * @returns {Set<string>}
 */
export function pickOverlayBanners(wanted, cap = OVERLAY_BANNER_CAP) {
  const shown = new Set();
  for (const id of OVERLAY_BANNER_PRIORITY) {
    if (shown.size >= cap) break;
    if (wanted[id]) shown.add(id);
  }
  return shown;
}

/**
 * The banner id for the audio warning the overlay holds, by how serious it is
 * (audioWarningSlots.mjs severity: 3 error, 2 stuck, 1 advisory).
 * @param {0 | 1 | 2 | 3} severity
 */
export function audioBannerId(severity) {
  return severity >= 3 ? 'audio-error' : severity === 2 ? 'audio-stuck' : 'audio-advisory';
}
