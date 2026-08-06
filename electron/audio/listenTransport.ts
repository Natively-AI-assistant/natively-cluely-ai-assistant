/**
 * Listen transport policy (InterviewMan parity / ADR 0014).
 *
 * Pure state machine: meeting start / pause / resume / end → whether capture
 * should run. No Electron imports — unit-tested from node:test via dist-electron.
 *
 * Glossary: listen-transport-arming, interviewman-control-map
 */

export type ListenTransportState = 'idle' | 'armed' | 'paused' | 'unready';

export type ListenTransportReason =
  | 'idle'
  | 'armed'
  | 'paused'
  | 'ambient'
  | 'stt_unready'
  | 'ended';

export interface ListenTransportSnapshot {
  state: ListenTransportState;
  /** When true, mic + system-audio STT pipelines should be running. */
  captureShouldRun: boolean;
  reason: ListenTransportReason;
}

export interface MeetingStartTransportInput {
  ambientChatEnabled: boolean;
  /** False when STT provider is `none` or otherwise not ready to transcribe. */
  sttReady: boolean;
}

function snapshot(
  state: ListenTransportState,
  reason: ListenTransportReason,
  captureShouldRun: boolean,
): ListenTransportSnapshot {
  return { state, reason, captureShouldRun };
}

function forState(state: ListenTransportState): ListenTransportSnapshot {
  switch (state) {
    case 'armed':
      return snapshot('armed', 'armed', true);
    case 'paused':
      return snapshot('paused', 'paused', false);
    case 'unready':
      return snapshot('unready', 'stt_unready', false);
    case 'idle':
    default:
      return snapshot('idle', 'idle', false);
  }
}

/** Meeting start → initial transport (auto-arm when ready; Ambient / unready exceptions). */
export function listenTransportOnMeetingStart(
  input: MeetingStartTransportInput,
): ListenTransportSnapshot {
  if (input.ambientChatEnabled) {
    return snapshot('idle', 'ambient', false);
  }
  if (!input.sttReady) {
    return snapshot('unready', 'stt_unready', false);
  }
  return snapshot('armed', 'armed', true);
}

/** Red-square pause: stop capture without ending the meeting. */
export function listenTransportPause(current: ListenTransportState): ListenTransportSnapshot {
  if (current === 'armed') {
    return snapshot('paused', 'paused', false);
  }
  return forState(current);
}

/** Red-square resume (or re-arm from unready once STT becomes ready). */
export function listenTransportResume(
  current: ListenTransportState,
  sttReady: boolean,
): ListenTransportSnapshot {
  if (current === 'paused') {
    if (!sttReady) return snapshot('unready', 'stt_unready', false);
    return snapshot('armed', 'armed', true);
  }
  if (current === 'unready') {
    if (!sttReady) return snapshot('unready', 'stt_unready', false);
    return snapshot('armed', 'armed', true);
  }
  return forState(current);
}

/** Triangle / end-meeting: transport returns to idle. */
export function listenTransportOnMeetingEnd(): ListenTransportSnapshot {
  return snapshot('idle', 'ended', false);
}

/** Red-square toggle between armed ↔ paused (also arms from unready when ready). */
export function listenTransportToggle(
  current: ListenTransportState,
  sttReady: boolean,
): ListenTransportSnapshot {
  if (current === 'armed') return listenTransportPause(current);
  if (current === 'paused' || current === 'unready') {
    return listenTransportResume(current, sttReady);
  }
  return forState(current);
}
