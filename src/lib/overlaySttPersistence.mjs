/**
 * Pure helpers for overlay STT + chat persistence (unit-tested).
 *
 * Interviewer STT updates the rolling transcript bar only — never the messages array.
 * Rolling transcript visibility must not be suppressed just because chat history exists.
 */

/**
 * Whether to hide the rolling transcript bar.
 * Only suppress during active LLM work so partial STT can still update state.
 */
export function shouldSuppressRollingTranscript({ isProcessing }) {
  return Boolean(isProcessing);
}

/**
 * Whether the rolling transcript bar should render (status indicators or text).
 */
export function shouldShowRollingTranscriptBar({
  suppressRollingTranscript,
  showTranscript,
  rollingTranscript,
  interviewerSttStatus,
  userSttStatus,
}) {
  if (suppressRollingTranscript) return false;
  return (
    (showTranscript && Boolean(rollingTranscript)) ||
    interviewerSttStatus !== 'connected' ||
    userSttStatus !== 'connected'
  );
}

/**
 * Apply an interviewer-channel STT transcript event.
 * Returns updated overlay slice; `messages` is always returned unchanged.
 */
export function applyInterviewerSttTranscript(state, transcript, mergeFns) {
  const { mergeRollingTranscriptPartial, mergeRollingTranscriptFinal } = mergeFns;
  const messages = state.messages;

  if (transcript.speaker !== 'interviewer') {
    return state;
  }

  if (!transcript.final) {
    const rollingTranscript = mergeRollingTranscriptPartial(
      state.rollingTranscript,
      transcript.text,
    );
    return {
      ...state,
      messages,
      rollingTranscript,
      isInterviewerSpeaking: true,
    };
  }

  const afterPartial = state.pendingPartialText
    ? mergeRollingTranscriptPartial(state.rollingTranscript, state.pendingPartialText)
    : state.rollingTranscript;
  const rollingTranscript = mergeRollingTranscriptFinal(afterPartial, transcript.text);

  return {
    ...state,
    messages,
    rollingTranscript,
    isInterviewerSpeaking: false,
    pendingPartialText: null,
  };
}
