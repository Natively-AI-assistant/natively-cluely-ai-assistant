export function finalizeStreamingByIntentMessages<T extends { id: string; role: string; text: string; intent?: string; isStreaming?: boolean }>(
  prev: T[],
  intent: string,
  text: string,
  idFactory?: () => string,
  streamingMsgId?: string | null,
): T[];

export function prepareIntelligenceStreamPlaceholderMessages<T extends { id: string; role: string; text: string; intent?: string; isStreaming?: boolean }>(
  prev: T[],
  intent: string,
  placeholderId: string,
): T[];

export function applyWhatToAnswerNullFeedbackMessages<T extends { id: string; role: string; text: string; intent?: string; isStreaming?: boolean }>(
  prev: T[],
  feedback: string,
  idFactory?: () => string,
): T[];
