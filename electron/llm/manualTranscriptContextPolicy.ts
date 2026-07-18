import type { AnswerPlan } from './AnswerPlanner';
import { isBareFollowUp, isRefinementFollowUp } from './FollowUpResolver';

type TranscriptContextPlan = Pick<AnswerPlan, 'answerType' | 'requiredContextLayers'>;

const TRANSCRIPT_BOUND_ANSWER_TYPES = new Set<AnswerPlan['answerType']>([
  'general_meeting_answer',
  'lecture_answer',
]);

const TRANSCRIPT_REFERENCE_PATTERNS = [
  /\b(?:in|during|from|based on|according to) (?:the |this |that |our )?(meeting|call|conversation|discussion|transcript|lecture|class)\b/i,
  /\b(?:meeting|call|conversation|discussion|transcript|lecture|class) (?:said|asked|discussed|decided|mentioned|covered|agreed|concluded)\b/i,
  /\b(?:action items?|next steps?|takeaways?) (?:from|in|of) (?:the |this |that |our )?(?:meeting|call|conversation|discussion|transcript|lecture|class)\b/i,
  /\b(?:recap|catch me up (?:on|about)) (?:the |this |that |our )?(?:meeting|call|conversation|discussion|transcript|lecture|class)\b/i,
  /\bsummari[sz]e (?:it|this|that|the (?:meeting|call|conversation|discussion|transcript|lecture|class)|our (?:meeting|call|conversation|discussion|lecture|class))\b/i,
  /\bwhat did (we|they|the (?:interviewer|client|customer|participant|speaker|professor))\b/i,
  /\bwhat (?:was|were|is|are) (?:the )?(?:interviewer|client|customer|participant|speaker|professor)\b/i,
  /\b(?:we|they|the (?:interviewer|client|customer|participant|speaker|professor)) (?:said|asked|discussed|decided|mentioned|covered|agreed|concluded|meant|raised)\b/i,
];

export function isTranscriptBoundManualQuestion(message: string): boolean {
  const text = message.trim();
  return text.length > 0 && TRANSCRIPT_REFERENCE_PATTERNS.some((pattern) => pattern.test(text));
}

function isShortTopicShiftFollowUp(message: string): boolean {
  const text = message.trim();
  const words = text.replace(/[?.!,]/g, '').split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 8) return false;
  // Topic-shift fragments are deliberately narrower than "contains a pronoun".
  // Standalone questions such as "Is it safe to use eval?" must never inherit
  // an unrelated rolling transcript merely because they contain "it" or "this".
  const topicShift = /^(?:what|how) about\s+\S+/i.test(text);
  const shortAddend = /^(?:and|also|then)\s+(?!(?:how|why|when|where|who|which|what|can|could|should|would|do|does|did|is|are|was|were|will|has|have|had)\b)\S+/i.test(text);
  const responsePrompt = /^what should i (?:say|answer|do|respond)(?:\s+(?:to|about)\s+(?:that|this|it|them))?[?.!]*$/i.test(text);
  const demonstrativeFollowUp = /^(?:(?:can|could|would) you (?:explain|expand on|elaborate on) (?:that|this|it)|tell me more about (?:that|this|it)|what (?:does|did) (?:that|this|it) mean|how does (?:that|this|it) work)[?.!]*$/i.test(text);
  return topicShift || shortAddend || responsePrompt || demonstrativeFollowUp;
}

/**
 * Return only the latest assistant suggestion from a rolling SessionTracker
 * snapshot. Refinement prompts need the answer they are editing, but must not
 * regain the unrelated meeting/interviewer transcript that this policy blocks.
 */
export function extractLatestPriorAssistantTurn(snapshot: string): string | undefined {
  let latest: string[] | undefined;
  let current: string[] | undefined;

  for (const line of snapshot.split('\n')) {
    const assistant = line.match(/^\[ASSISTANT \(PREVIOUS SUGGESTION\)\]:\s?(.*)$/);
    if (assistant) {
      current = [assistant[1]];
      latest = current;
      continue;
    }
    if (/^\[(?:ME|INTERVIEWER)\]:/.test(line)) {
      current = undefined;
      continue;
    }
    if (current) current.push(line);
  }

  const answer = latest?.join('\n').trim();
  return answer || undefined;
}

export function shouldAutoAttachManualTranscriptContext(
  message: string,
  answerPlan: TranscriptContextPlan,
): boolean {
  const isTranscriptBound = isTranscriptBoundManualQuestion(message);

  if (isRefinementFollowUp(message) && !isTranscriptBound) {
    return false;
  }

  const isShortFollowUp = isBareFollowUp(message) || isShortTopicShiftFollowUp(message);
  const requiresLiveTranscript = answerPlan.requiredContextLayers.includes('live_transcript');

  if (!requiresLiveTranscript && !isShortFollowUp && !isTranscriptBound) {
    return false;
  }

  // The planner intentionally classifies generic recap vocabulary broadly.
  // Its answer type alone cannot prove that the user meant the live transcript.
  if (TRANSCRIPT_BOUND_ANSWER_TYPES.has(answerPlan.answerType) && isTranscriptBound) {
    return true;
  }

  // requiredContextLayers is deliberately not a standalone allow signal for
  // manual chat. Technical answer types include live_transcript for live
  // interview continuity, but standalone typed questions like "what is BFS?"
  // must stay isolated unless they are explicit transcript references or
  // short live follow-ups.
  if (isShortFollowUp) {
    return true;
  }

  if (isTranscriptBound) {
    return true;
  }

  return false;
}
