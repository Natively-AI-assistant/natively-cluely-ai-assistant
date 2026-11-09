// src/components/overlay/audioWarningSlots.mjs
//
// Which audio warning the overlay's one audio banner shows (2026-11-09).
//
// The banner had a single slot that every `audio-capture-failed` overwrote, so
// an advisory ("your mic is in Bluetooth call mode") could replace "Microphone
// Blocked", and a recovery or ✕ on one channel took the other channel's
// problem with it. Now every warning that arrives is HELD until something says
// it no longer holds (its ✕, its channel's recovery, a rebuilt capture, the
// meeting's end):
//
//  - the banner shows the most serious held warning: a blocked permission or a
//    capture that gave up (3) > a channel main is still retrying (2) > advice
//    (1); the latest on a tie;
//  - a milder warning is held, not thrown away. Main says most of them once
//    (its detectors latch), so one dropped here was never said again: "your
//    mic is blocked" arriving under "the provider could not start" was lost
//    for the meeting. It shows once the one above it goes;
//  - the same warning again (channel, kind, title, text) replaces its earlier
//    copy, so a repeat refreshes rather than stacks;
//  - an advisory is shown once per meeting: the same one again, after a ✕ or a
//    recovery, stays quiet until the meeting ends (resetAudioWarnings).
//
// Pure (no React): NativelyInterface keeps the state and draws `shownAudioWarning`.
// The same on macOS and Windows.

/** @typedef {{ kind: string, message: string, channel?: 'mic' | 'system', titleKey?: string, terminal?: boolean, stuck?: boolean, permission?: boolean, clearsOnRecovery?: boolean }} AudioWarning */
/** @typedef {{ held: ReadonlyArray<AudioWarning & { at: number }>, seq: number, advisories: string[] }} AudioWarningState */

/** @type {AudioWarningState} */
export const EMPTY_AUDIO_WARNINGS = Object.freeze({ held: Object.freeze([]), seq: 0, advisories: Object.freeze([]) });

/** A blocked permission, whichever way main reported it. */
export function isPermissionWarning(w) {
  return !!w && (w.kind === 'screen-recording-permission' || !!w.permission);
}

/** 3 permission or terminal, 2 stuck (main still retrying), 1 advisory, 0 none. */
export function audioWarningSeverity(w) {
  if (!w) return 0;
  if (isPermissionWarning(w) || w.terminal) return 3;
  if (w.stuck) return 2;
  return 1;
}

/**
 * Real audio is back on the channel (main: `recovered`): what said it was not
 * heard is no longer true. Not advice, not what audio does not fix.
 */
export function clearedByRecovery(w) {
  return w.kind === 'audio-capture-failure' && !!(w.terminal || w.stuck) && w.clearsOnRecovery !== false;
}

/**
 * The system capture was rebuilt on a working device: a capture that gave up
 * is gone with the old one. A blocked permission is not fixed by a rebuild.
 */
export function clearedByRebuild(w) {
  return w.kind === 'audio-capture-failure' && !!w.terminal && !isPermissionWarning(w);
}

const channelOf = (w) => (w.channel === 'mic' ? 'mic' : 'system');
const identity = (w) => `${channelOf(w)}:${w.kind}:${w.titleKey ?? ''}:${w.message}`;

/**
 * A warning main sent. Returns the same state object when nothing changes.
 * @param {AudioWarningState} state
 * @param {AudioWarning} w
 * @returns {AudioWarningState}
 */
export function offerAudioWarning(state, w) {
  if (!w) return state;
  const key = identity(w);
  let advisories = state.advisories;
  if (audioWarningSeverity(w) === 1) {
    if (advisories.includes(key)) return state;
    advisories = [...advisories, key];
  }
  const seq = state.seq + 1;
  const held = [...state.held.filter((h) => identity(h) !== key), { ...w, at: seq }];
  return { held, seq, advisories };
}

/**
 * The warning the banner shows: the most serious, the latest on a tie.
 * @param {AudioWarningState} state
 * @returns {(AudioWarning & { at: number }) | null}
 */
export function shownAudioWarning(state) {
  let best = null;
  for (const w of state.held) {
    if (!best) { best = w; continue; }
    const a = audioWarningSeverity(w);
    const b = audioWarningSeverity(best);
    if (a > b || (a === b && w.at > best.at)) best = w;
  }
  return best;
}

/** Every warning held for a channel, most important first (for tests and logs). */
export function heldAudioWarnings(state, channel) {
  return shownOrder(state.held.filter((w) => channelOf(w) === channel));
}

function shownOrder(list) {
  return [...list].sort((x, y) => audioWarningSeverity(y) - audioWarningSeverity(x) || y.at - x.at);
}

/**
 * Drops a channel's warnings that `matches` says no longer hold (a recovery,
 * a rebuilt capture). Same state object when nothing is dropped.
 * @param {AudioWarningState} state
 * @param {'mic' | 'system'} channel
 * @param {(w: AudioWarning) => boolean} [matches]
 */
export function clearAudioWarning(state, channel, matches = () => true) {
  const held = state.held.filter((w) => !(channelOf(w) === channel && matches(w)));
  return held.length === state.held.length ? state : { ...state, held };
}

/** The ✕ on the banner: the warning it shows goes; the next held one, if any, shows. */
export function dismissShownAudioWarning(state) {
  const shown = shownAudioWarning(state);
  if (!shown) return state;
  return { ...state, held: state.held.filter((w) => w !== shown) };
}

/** The meeting ended: nothing carries into the next one. */
export function resetAudioWarnings() {
  return EMPTY_AUDIO_WARNINGS;
}
