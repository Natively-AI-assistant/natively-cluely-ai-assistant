import type { SessionTracker } from '../../SessionTracker';
import type { AssistantResponse } from '../../llm/TemporalContextBuilder';
import {
  buildTemporalContext,
  prepareTranscriptForWhatToAnswer,
} from '../../llm';

export interface InterviewContextBundle {
  spine: string;
  recencyTranscript: string;
  currentTurn: string | null;
  priorCopilotResponses: string[];
  activeProblemStatement: string | null;
  acceptedRequirements: string[];
}

export interface BuildInterviewContextOptions {
  recencySeconds?: number;
  maxTurns?: number;
}

/**
 * Unified interview context for all live intelligence paths (WTA, chat, Restate, Lookup).
 */
export function buildInterviewContext(
  session: SessionTracker,
  options: BuildInterviewContextOptions = {},
): InterviewContextBundle {
  const recencySeconds = options.recencySeconds ?? 180;
  const maxTurns = options.maxTurns ?? 12;
  const problemSetAt = session.getCodingQuestionSetAt?.() ?? null;
  const effectiveMaxTurns = problemSetAt ? Math.max(maxTurns, 24) : maxTurns;

  const spine = session.getFullSessionContext();
  const contextItems = session.getContextWithInterim(recencySeconds);
  const transcriptTurns = contextItems.map((item) => ({
    role: item.role,
    text: item.text,
    timestamp: item.timestamp,
  }));

  const recencyTranscript = prepareTranscriptForWhatToAnswer(
    transcriptTurns,
    effectiveMaxTurns,
    { problemSetAt },
  );
  const temporal = buildTemporalContext(
    contextItems,
    session.getAssistantResponseHistory() as AssistantResponse[],
    recencySeconds,
  );

  const active = session.getActiveProblem?.() ?? null;
  const coding = session.getDetectedCodingQuestion();

  const acceptedRequirements = active?.constraints?.length
    ? [...active.constraints]
    : [];

  return {
    spine: spine.trim(),
    recencyTranscript: recencyTranscript.trim(),
    currentTurn: session.getLastInterviewerTurn(),
    priorCopilotResponses: temporal.previousResponses,
    activeProblemStatement: active?.statement?.trim() || coding.question?.trim() || null,
    acceptedRequirements,
  };
}

/**
 * Format bundle for gemini-chat-stream and legacy string context parameters.
 */
export function formatInterviewContextForChat(bundle: InterviewContextBundle): string {
  const parts: string[] = [];

  if (bundle.spine) {
    parts.push(`<session_spine>\n${bundle.spine}\n</session_spine>`);
  }
  if (bundle.activeProblemStatement) {
    parts.push(
      `<active_problem>\n${bundle.activeProblemStatement}\n</active_problem>`,
    );
  }
  if (bundle.acceptedRequirements.length > 0) {
    parts.push(
      `<accepted_constraints>\n${bundle.acceptedRequirements.map((r) => `- ${r}`).join('\n')}\n</accepted_constraints>`,
    );
  }
  if (bundle.currentTurn) {
    parts.push(`<current_turn>\n[INTERVIEWER]: ${bundle.currentTurn}\n</current_turn>`);
  }
  if (bundle.recencyTranscript) {
    parts.push(`<transcript>\n${bundle.recencyTranscript}\n</transcript>`);
  }
  if (bundle.priorCopilotResponses.length > 0) {
    parts.push(
      `[RECENT ASSISTANT RESPONSES]\n${bundle.priorCopilotResponses.map((r) => `- ${r}`).join('\n')}`,
    );
  }

  return parts.filter(Boolean).join('\n\n');
}
