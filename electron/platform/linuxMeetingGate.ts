import type { DisplaySessionInfo } from './linuxSessionGate';

/** Mirrors main.ts meeting-start system-audio gate for unsupported Linux sessions. */
export function shouldBlockLinuxSystemAudioAtMeetingStart(
  linuxCaptureDisabled: boolean,
  session: DisplaySessionInfo,
): boolean {
  return linuxCaptureDisabled || !session.isSupported;
}

/** Mirrors main.ts startup path when user continues with limited features. */
export function shouldDisableLinuxCaptureOnLimitedContinue(
  session: DisplaySessionInfo,
): boolean {
  return !session.isSupported;
}
