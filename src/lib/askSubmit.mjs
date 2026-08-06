/**
 * Ask/submit policy (InterviewMan control map / ADR 0014).
 *
 * Spoken or typed words → an AI turn. Never arms, pauses, or resumes listen
 * transport — that is red-square only (`toggleListenTransport`).
 *
 * Glossary: interviewman-control-map, Ask/submit
 */

/** Effects that belong to listen transport — forbidden on the Ask/submit path. */
export const LISTEN_TRANSPORT_EFFECTS = Object.freeze([
  'toggleListenTransport',
  'listenTransportPause',
  'listenTransportResume',
  'listen-transport:toggle',
]);

/**
 * @param {{ isVoiceCaptureArmed: boolean, hasQuestionOrAttachments: boolean }} input
 * @returns {{ action: 'arm_voice_capture' | 'submit' | 'empty_speech_error', effects: readonly string[] }}
 */
export function planAskSubmitAction({ isVoiceCaptureArmed, hasQuestionOrAttachments }) {
  if (!isVoiceCaptureArmed) {
    return {
      action: 'arm_voice_capture',
      effects: Object.freeze(['startManualVoiceCapture']),
    };
  }
  if (!hasQuestionOrAttachments) {
    return {
      action: 'empty_speech_error',
      effects: Object.freeze(['showEmptySpeechError']),
    };
  }
  return {
    action: 'submit',
    effects: Object.freeze(['finalizeMicSTT', 'streamChatOrRag']),
  };
}

/** True when any planned effect would arm/disarm listen transport. */
export function askSubmitTouchesListenTransport(effects) {
  const forbidden = new Set(LISTEN_TRANSPORT_EFFECTS);
  return (effects ?? []).some((effect) => forbidden.has(effect));
}
