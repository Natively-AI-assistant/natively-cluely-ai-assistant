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
  /\b(action items?|next steps?|takeaways?|recap|catch me up|summari[sz]e)\b/i,
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
  return /^(?:and|also|then|what about|how about)\b/i.test(text)
    || /\b(?:that|this|it|those|them)\b/i.test(text)
    || /\bwhat should i (?:say|answer|do|respond)\b/i.test(text);
}

export function shouldAutoAttachManualTranscriptContext(
  message: string,
  answerPlan: TranscriptContextPlan,
): boolean {
  if (isRefinementFollowUp(message)) {
    return false;
  }

  const isShortFollowUp = isBareFollowUp(message) || isShortTopicShiftFollowUp(message);

  if (!answerPlan.requiredContextLayers.includes('live_transcript') && !isShortFollowUp) {
    return false;
  }

  if (TRANSCRIPT_BOUND_ANSWER_TYPES.has(answerPlan.answerType)) {
    return true;
  }

  if (isShortFollowUp) {
    return true;
  }

  if (isTranscriptBoundManualQuestion(message)) {
    return true;
  }

  return false;
}
