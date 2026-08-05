// electron/llm/sdIntention.ts
// SD route LLM parallel (ADR 0005): sync SD-intention heuristic + merge helpers.
// Live SLM may later inject the same SdIntentionResult shape into planAnswer.

export const SD_INTENTION_PROMOTE_THRESHOLD = 0.75;

export interface SdIntentionResult {
  /** True when the utterance is judged a system-design ask. */
  sdIntention: boolean;
  confidence: number;
}

/** Tier A.2 openers regex often misses — promote path (sd-eval-corpus-v1). */
const SD_INTENTION_PROMOTE_PATTERNS: RegExp[] = [
  /\b(draw|sketch|whiteboard)\b[\s\S]{0,80}\b(architecture|system|design|hld)\b/i,
  /\b(architecture|system|design|hld)\b[\s\S]{0,80}\b(draw|sketch|whiteboard)\b/i,
  /\bwalk(?:\s+\w+){0,3}\s+through\b[\s\S]{0,60}\b(high[- ]?level\s+design|hld|architecture)\b/i,
  /\b(talk|take)\s+me\s+through\b[\s\S]{0,60}\b(architecture|high[- ]?level\s+design|hld)\b/i,
  /\barchitecture\s+review\b/i,
  /\breview\s+(this|the)\s+architecture\b/i,
  /\bwhat\s+would\s+you\s+change\b[\s\S]{0,40}\b(design|architecture)\b/i,
  /\blet'?s\s+(move\s+to\s+|do\s+)?(a\s+)?system\s+design\b/i,
  // Require an SD-ish noun after "let's design" — avoid "let's design your career".
  /\blet'?s\s+design\s+(a\s+|an\s+|the\s+)?(scalable\s+|distributed\s+)?(system|service|platform|architecture|notification|rate\s*limiter|url\s*shortener|chat|cache|queue)\b/i,
];

/**
 * Sync SD-intention classifier (heuristic stand-in for parallel LLM).
 * Fail closed: unknown phrasing → not SD / low confidence.
 */
export function classifySdIntention(question: string | null | undefined): SdIntentionResult {
  const text = String(question || '').trim();
  if (!text) return { sdIntention: false, confidence: 0 };
  for (const re of SD_INTENTION_PROMOTE_PATTERNS) {
    if (re.test(text)) {
      return { sdIntention: true, confidence: 0.9 };
    }
  }
  return { sdIntention: false, confidence: 0.2 };
}

/** Types sticky promote must never override (sd-route-sticky-exclusions). */
export function isSdStickyExcludedType(answerType: string): boolean {
  return (
    answerType === 'negotiation_answer'
    || answerType === 'identity_answer'
    || answerType === 'general_meeting_answer'
  );
}

/**
 * Types SD-intention promote must never override (nego/identity).
 * general_meeting stays eligible so clarifier/whiteboard promotes can fire.
 */
export function isSdIntentionPromoteExcludedType(answerType: string): boolean {
  return answerType === 'negotiation_answer' || answerType === 'identity_answer';
}

export function shouldPromoteSdIntention(
  intention: SdIntentionResult | null | undefined,
  threshold: number = SD_INTENTION_PROMOTE_THRESHOLD,
): boolean {
  if (!intention) return false;
  return intention.sdIntention === true && intention.confidence >= threshold;
}
