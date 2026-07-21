export function applyInterviewerSttTranscript(
  state: Record<string, unknown>,
  transcript: { speaker: string; final: boolean; text: string },
  mergeFns: {
    mergeRollingTranscriptPartial: (current: string, next: string) => string;
    mergeRollingTranscriptFinal: (current: string, next: string) => string;
  },
): Record<string, unknown>;
