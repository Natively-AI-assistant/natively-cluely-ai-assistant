import { prepareTranscriptForWhatToAnswer } from '../llm';

export interface PreparedContextItem {
  role: string;
  text: string;
  timestamp: number;
}

export interface PreparedContextSession {
  getContextWithInterim(lastSeconds: number): PreparedContextItem[];
}

/**
 * Build human-only transcript context aligned with What-to-Answer. Previous
 * assistant replies are supplied separately by the AnswerPlan-gated channel.
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

  // `as any` bridges structurally-compatible transcript turn types declared by
  // the LLM helpers and SessionTracker.
  return prepareTranscriptForWhatToAnswer(transcriptTurns as any, 12);
}
