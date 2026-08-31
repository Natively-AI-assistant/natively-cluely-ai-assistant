const DEFAULT_SCREENSHOT_REQUEST =
  'Analyze the attached screenshot and answer the interviewer question provided with it.';

/**
 * Build the text/provenance portion of a Direct Assist What-to-Say request.
 *
 * The triggering interviewer speech is the authoritative request whenever it
 * exists and no screenshot is attached. A dynamic action describes how to
 * shape the answer; it must never replace that speech or relabel it as typed.
 * Screenshot turns retain the existing privacy split: speech stays in the
 * transcript field while a generic or dynamic typed instruction is the current
 * request.
 */
export function buildDirectWhatToSayPayload({
  interviewerRequest,
  dynamicPromptInstruction,
  hasScreenshots,
}) {
  const speech = typeof interviewerRequest === 'string' ? interviewerRequest.trim() : '';
  const instruction = typeof dynamicPromptInstruction === 'string'
    && dynamicPromptInstruction.trim().length > 0
    ? dynamicPromptInstruction
    : '';

  if (hasScreenshots) {
    return {
      source: 'screenshot',
      currentRequest: instruction || DEFAULT_SCREENSHOT_REQUEST,
      transcript: speech || undefined,
    };
  }

  if (speech) {
    return {
      source: 'stt',
      currentRequest: instruction
        ? `${speech}\n\nANSWER/OUTPUT INSTRUCTION:\n${instruction}`
        : speech,
      transcript: undefined,
    };
  }

  return {
    source: 'typed',
    currentRequest: instruction || 'What should I say?',
    transcript: undefined,
  };
}
