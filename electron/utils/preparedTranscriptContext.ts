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

  // `as any` here bridges the structural-but-nominally-distinct turn/context
  // shapes: the llm helpers (prepareTranscriptForWhatToAnswer / buildTemporalContext)
  // declare their own RollingTranscript-derived turn types, and the items above
  // (role/text/timestamp + PreparedContextItem) are field-compatible at runtime
  // but not assignable nominally. The casts are safe given that field alignment.
  const preparedTranscript = prepareTranscriptForWhatToAnswer(transcriptTurns as any, 12);
  const temporalContext = buildTemporalContext(
    contextItems as any,
    session.getAssistantResponseHistory() as any,
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
