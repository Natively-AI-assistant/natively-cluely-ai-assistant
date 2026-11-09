// src/components/overlay/sttBannerKeys.mjs
//
// What a closed transcription banner hides (2026-11-09 review).
//
// The banner's ✕ holds for the meeting by key. Keyed only 'stopped', a closed
// "your microphone is no longer transcribed" also hid the interviewer channel
// failing later ("nothing is being transcribed"), and a second outage twenty
// minutes after the first had recovered. Now:
//
//  - a stop or a reconnect is keyed by the channels it is about, so a
//    different outage is a different banner;
//  - once both channels are healthy again (connected, or listening for audio)
//    the closed outages are forgotten: the next one is new news.
//
// Pure. The same on macOS and Windows.

/** @typedef {'connected' | 'reconnecting' | 'failed' | 'awaiting-audio' | 'preparing'} SttChannelStatus */

const channels = (user, interviewer, state) =>
  [user === state ? 'mic' : null, interviewer === state ? 'system' : null].filter(Boolean).join('+');

/** @param {SttChannelStatus} user @param {SttChannelStatus} interviewer */
export function sttStoppedKey(user, interviewer) {
  return `stopped:${channels(user, interviewer, 'failed')}`;
}

/** @param {SttChannelStatus} user @param {SttChannelStatus} interviewer */
export function sttReconnectingKey(user, interviewer) {
  return `reconnecting:${channels(user, interviewer, 'reconnecting')}`;
}

const healthy = (s) => s === 'connected' || s === 'awaiting-audio';
const isOutageKey = (k) => k.startsWith('stopped') || k.startsWith('reconnecting');

/**
 * The closed banners once the channels say where they are now: the outage
 * keys go when both are healthy. The same array when nothing changes.
 * @param {readonly string[]} dismissed
 * @param {SttChannelStatus} user
 * @param {SttChannelStatus} interviewer
 * @returns {readonly string[]}
 */
export function forgetSettledSttOutages(dismissed, user, interviewer) {
  if (!healthy(user) || !healthy(interviewer)) return dismissed;
  const next = dismissed.filter((k) => !isOutageKey(k));
  return next.length === dismissed.length ? dismissed : next;
}
