import {
  buildTemporalContext,
  prepareTranscriptForWhatToAnswer,
} from '../llm';

export interface PreparedContextItem {
  role: string;
  text: string;
  timestamp: number;
}

export interface PreparedContextSession {
  getContextWithInterim(lastSeconds: number): PreparedContextItem[];
  getAssistantResponseHistory(): string[];
}

/**
 * Build transcript context aligned with What-to-Answer: cleaned turns,
 * interim interviewer speech, and recent assistant responses.
 */
export function buildPreparedTranscriptContext(
  session: PreparedContextSession,
  lastSeconds: number = 180,
): string {
  const contextItems = session.getContextWithInterim(lastSeconds);
  if (contextItems.length === 0) return '';

  const transcriptTurns = contextItems.map((item) => ({
    role: item.role,
    text: item.text,
    timestamp: item.timestamp,
  }));

  const preparedTranscript = prepareTranscriptForWhatToAnswer(transcriptTurns, 12);
  const temporalContext = buildTemporalContext(
    contextItems,
    session.getAssistantResponseHistory(),
    lastSeconds,
  );

  const parts: string[] = [preparedTranscript];
  if (temporalContext.hasRecentResponses && temporalContext.previousResponses.length > 0) {
    parts.push(
      '[RECENT ASSISTANT RESPONSES]\n' +
        temporalContext.previousResponses.map((r) => `- ${r}`).join('\n'),
    );
  }
  return parts.filter(Boolean).join('\n\n');
}
