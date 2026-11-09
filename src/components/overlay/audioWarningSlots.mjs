// src/components/overlay/audioWarningSlots.mjs
//
// Which audio warning the overlay's one audio banner shows (2026-11-09).
//
// The banner had a single slot that every `audio-capture-failed` overwrote, so
// an advisory ("your mic is in Bluetooth call mode") could replace "Microphone
// Blocked", and a recovery or ✕ on one channel took the other channel's
// problem with it. Now:
//
//  - one slot per channel (mic, system), so a warning about one channel never
//    erases the other's;
//  - within a channel a milder warning never replaces a more serious one that
//    is still in effect: permission or terminal (3) > stuck (2) > advisory (1).
//    One of the same severity replaces it (it is the newer news);
//  - the banner shows the most serious across both channels, the latest on a
//    tie; the other stays held (not lost) and shows once the first clears;
//  - an advisory is shown once per meeting: the same one again, after a ✕ or a
//    recovery, stays quiet until the meeting ends (resetAudioWarnings).
//
// Pure (no React): NativelyInterface keeps the state and draws `shownAudioWarning`.
// The same on macOS and Windows.

/** @typedef {{ kind: string, message: string, channel?: 'mic' | 'system', titleKey?: string, terminal?: boolean, stuck?: boolean, clearsOnRecovery?: boolean }} AudioWarning */
/** @typedef {{ slots: { mic?: AudioWarning & { at: number }, system?: AudioWarning & { at: number } }, seq: number, advisories: string[] }} AudioWarningState */

/** @type {AudioWarningState} */
export const EMPTY_AUDIO_WARNINGS = Object.freeze({ slots: Object.freeze({}), seq: 0, advisories: Object.freeze([]) });

/** 3 permission or terminal, 2 stuck (main still retrying), 1 advisory, 0 none. */
export function audioWarningSeverity(w) {
  if (!w) return 0;
  if (w.kind === 'screen-recording-permission' || w.terminal) return 3;
  if (w.stuck) return 2;
  return 1;
}

const channelOf = (w) => (w.channel === 'mic' ? 'mic' : 'system');
const advisoryKey = (w) => `${channelOf(w)}:${w.titleKey ?? ''}:${w.message}`;

/**
 * A warning main sent. Returns the same state object when nothing changes.
 * @param {AudioWarningState} state
 * @param {AudioWarning} w
 * @returns {AudioWarningState}
 */
export function offerAudioWarning(state, w) {
  if (!w) return state;
  const ch = channelOf(w);
  const current = state.slots[ch];
  const severity = audioWarningSeverity(w);
  if (current && audioWarningSeverity(current) > severity) return state;
  let advisories = state.advisories;
  if (severity === 1) {
    const key = advisoryKey(w);
    if (advisories.includes(key)) return state;
    advisories = [...advisories, key];
  }
  const seq = state.seq + 1;
  return { slots: { ...state.slots, [ch]: { ...w, at: seq } }, seq, advisories };
}

/**
 * The warning the banner shows: the most serious, the latest on a tie.
 * @param {AudioWarningState} state
 * @returns {(AudioWarning & { at: number }) | null}
 */
export function shownAudioWarning(state) {
  let best = null;
  for (const w of [state.slots.mic, state.slots.system]) {
    if (!w) continue;
    if (!best) { best = w; continue; }
    const a = audioWarningSeverity(w);
    const b = audioWarningSeverity(best);
    if (a > b || (a === b && w.at > best.at)) best = w;
  }
  return best;
}

/**
 * Drops a channel's warning when `matches` says it no longer holds (a
 * recovery, a rebuilt capture). Same state object when nothing is dropped.
 * @param {AudioWarningState} state
 * @param {'mic' | 'system'} channel
 * @param {(w: AudioWarning) => boolean} [matches]
 */
export function clearAudioWarning(state, channel, matches = () => true) {
  const current = state.slots[channel];
  if (!current || !matches(current)) return state;
  const slots = { ...state.slots };
  delete slots[channel];
  return { ...state, slots };
}

/** The ✕ on the banner: the warning it shows goes; the other channel's, if any, shows next. */
export function dismissShownAudioWarning(state) {
  const shown = shownAudioWarning(state);
  return shown ? clearAudioWarning(state, channelOf(shown)) : state;
}

/** The meeting ended: nothing carries into the next one. */
export function resetAudioWarnings() {
  return EMPTY_AUDIO_WARNINGS;
}
