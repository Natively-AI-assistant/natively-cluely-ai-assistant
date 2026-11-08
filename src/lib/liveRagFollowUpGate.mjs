/**
 * Gate for the legacy voice-path JIT RAG pre-flight (issue #552).
 *
 * Typed chat already removed its RAG pre-flight: V3 carries conversation
 * history plus live-meeting evidence. The Answer Now / voice path still uses
 * `ragQueryLive`, which answers from transcript chunks alone and never sees
 * prior chat turns — so a follow-up like "do via stack" or "explain that more"
 * loses its referent whenever RAG succeeds.
 *
 * When prior chat exists and the spoken turn looks like a follow-up, skip
 * live RAG and let the speaking prompt carry `conversationContext` instead.
 */

// Demonstratives that name a NEW subject ("this week", "that meeting") are
// not references to the prior answer — strip them before the deictic check
// (same idea as FollowUpResolver's NEW_SUBJECT_DEMONSTRATIVE_RE).
const NEW_SUBJECT_DEMONSTRATIVE_RE =
  /\b(?:this|that|these|those)\s+(?:week|month|quarter|year|morning|afternoon|meeting|call|conversation|discussion|session|transcript|interview|lecture|class|chat|thread|document|doc|file|deck|slide|page|screen|email|agenda)\b/gi;

const DEICTIC_OR_REFINEMENT_RE =
  /\b(it|this|that|these|those|above|previous|prior|earlier|again|more detail|elaborate|expand|explain(?:\s+that|\s+more|\s+further)?|why|how so|what about|and\s+then|you said|as mentioned|same|via|instead|shorter|longer|simpler)\b/i;

/**
 * @param {string} question Spoken / typed follow-up candidate
 * @param {{ hasPriorChat: boolean }} opts
 * @returns {boolean} true → skip `ragQueryLive` and answer with conversation context
 */
export function shouldSkipLiveRagForChatFollowUp(question, { hasPriorChat }) {
  if (!hasPriorChat) return false;
  const trimmed = typeof question === 'string' ? question.trim() : '';
  if (!trimmed) return false;

  const words = trimmed.split(/\s+/).filter(Boolean);
  // Very short turns with prior chat are almost always referential
  // ("do via stack", "explain more", "and then?") and are the worst
  // embedding queries — they match random transcript chunks.
  if (words.length <= 5) return true;

  const forDeixis = trimmed.replace(NEW_SUBJECT_DEMONSTRATIVE_RE, ' ');
  if (words.length <= 12 && DEICTIC_OR_REFINEMENT_RE.test(forDeixis)) return true;

  return false;
}
