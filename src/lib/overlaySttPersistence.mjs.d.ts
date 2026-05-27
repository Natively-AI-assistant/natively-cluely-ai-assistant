export function shouldSuppressRollingTranscript(params: { isProcessing: boolean }): boolean;

export function shouldShowRollingTranscriptBar(params: {
  suppressRollingTranscript: boolean;
  showTranscript: boolean;
  rollingTranscript: string;
  interviewerSttStatus: string;
  userSttStatus: string;
}): boolean;
