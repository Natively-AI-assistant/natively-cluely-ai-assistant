/**
 * Overlay live-transcript projection rules (always-on-live-transcript).
 *
 * While listen transport is armed, interviewer + user-mic STT project to the
 * rolling bar without requiring Answers/Ask (`isManualRecording`). Ask still
 * owns voice-input capture separately via `captureForAsk`.
 *
 * Glossary: always-on-live-transcript, listen-transport-arming
 */

/**
 * @param {{ listenArmed: boolean, isManualRecording: boolean }} input
 * @returns {boolean}
 */
export function shouldKeepUserMicChunk({ listenArmed, isManualRecording }) {
  return listenArmed === true || isManualRecording === true;
}

/**
 * @param {{
 *   speaker: string,
 *   listenArmed: boolean,
 *   isManualRecording: boolean,
 * }} input
 * @returns {{ projectToRolling: boolean, captureForAsk: boolean }}
 */
export function projectLiveTranscriptChunk({
  speaker,
  listenArmed,
  isManualRecording,
}) {
  if (speaker === 'interviewer') {
    return { projectToRolling: true, captureForAsk: false };
  }

  if (speaker === 'user') {
    return {
      projectToRolling: listenArmed === true,
      captureForAsk: isManualRecording === true,
    };
  }

  return { projectToRolling: false, captureForAsk: false };
}
