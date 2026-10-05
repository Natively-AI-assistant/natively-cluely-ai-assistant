export type DirectAssistWhatToSaySource = 'typed' | 'stt' | 'screenshot';

export interface DirectAssistWhatToSayPayload {
  source: DirectAssistWhatToSaySource;
  currentRequest: string;
  transcript?: string;
}

export function buildDirectWhatToSayPayload(input: {
  interviewerRequest?: string;
  dynamicPromptInstruction?: string;
  hasScreenshots: boolean;
}): DirectAssistWhatToSayPayload;
