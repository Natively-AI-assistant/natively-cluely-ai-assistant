// electron/context-intelligence/question/question-resolver.ts
//
// Resolve ONE question from messy live input (§12.1).
//
// WHY THIS IS SEPARATE FROM CLASSIFICATION
// The transcript-driven surfaces (assist, clarify, brainstorm) do not receive a
// question at all — they receive a rolling window of speech. Before any of the
// decision layer applies, something must decide WHAT was asked. Doing that
// inside the classifier would mean re-deriving it per surface, which is how the
// codebase ended up with several surfaces each interpreting the turn differently.
//
// Real input carries: partial STT, repeated fragments, speaker overlap, filler,
// abandoned half-questions, background speech, and the assistant's OWN previous
// output echoed back.
//
// PRIORITY (§12.2), and it is not negotiable:
//   1. explicit manual question
//   2. user-selected transcript segment
//   3. the latest stable interviewer question
//   4. a follow-up resolved against conversation state
//
// Manual input wins outright. A transcript extractor that can override what the
// user literally typed is a bug, not a feature.

export type QuestionSource = 'manual' | 'selection' | 'transcript' | 'follow-up' | 'none';

export interface TranscriptTurn {
  role: 'user' | 'interviewer' | 'assistant';
  text: string;
  timestamp: number;
}

export interface ResolveInput {
  manualQuestion?: string;
  selectedText?: string;
  transcript?: TranscriptTurn[];
  /** Window considered "current". Older turns are context, not the question. */
  windowMs?: number;
  now?: number;
}

export interface ResolvedQuestion {
  originalInput: string;
  resolvedQuestion: string;
  source: QuestionSource;
  confidence: number;
  isFollowUp: boolean;
  activeEntities: string[];
  requiresClarification: boolean;
  clarificationReason?: string;
}

const FILLER = /\b(um+|uh+|er+|ah+|like|you know|i mean|sort of|kind of|basically|actually|so yeah|right)\b/gi;

/** Collapse the repeated fragments STT produces mid-utterance:
 *  "why did you why did you choose" -> "why did you choose". */
function dedupeStutter(text: string): string {
  let out = text;
  for (let n = 4; n >= 2; n--) {
    const re = new RegExp(`\\b((?:\\w+\\s+){${n - 1}}\\w+)\\s+\\1\\b`, 'gi');
    let prev: string;
    do { prev = out; out = out.replace(re, '$1'); } while (out !== prev);
  }
  return out.replace(/\b(\w+)(\s+\1\b)+/gi, '$1');
}

export function cleanUtterance(text: string): string {
  return dedupeStutter(String(text))
    .replace(FILLER, ' ')
    // Removing a filler word strips the word but leaves its punctuation behind:
    // "so um, like, why…" becomes "so ,, why…". Collapse the orphans, or the
    // question reaches the model visibly mangled.
    .replace(/\s+([,.?!])/g, '$1')
    .replace(/([,;:])(\s*[,;:])+/g, '$1')
    .replace(/^[\s,;:]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const QUESTION_CUE = /\b(what|how|why|where|when|which|who|can you|could you|would you|do you|did you|have you|tell me|explain|describe|walk me through|talk me through|give me)\b/i;

export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return t.endsWith('?') || QUESTION_CUE.test(t);
}

/** An abandoned question trails off without ever asking anything. */
function isAbandoned(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/[-—]$|\.\.\.$/.test(t)) return true;
  return t.split(/\s+/).filter(Boolean).length < 3 && !t.endsWith('?');
}

const PRONOUN_ONLY = /^(why|how|and|but|really|ok(ay)?|go on|what about (it|that|this))\b[\s?.!]*$/i;

function entitiesOf(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b([A-Z][A-Za-z0-9]{2,})\b/g)) out.add(m[1]);
  return [...out].slice(0, 8);
}

/**
 * Resolve the question ONCE.
 *
 * Assistant turns are never treated as the question. The model's own previous
 * output echoed back into the transcript is exactly how a fabrication becomes
 * self-reinforcing — it must not be able to re-enter as the thing being asked.
 */
export function resolveQuestion(input: ResolveInput): ResolvedQuestion {
  const empty: ResolvedQuestion = {
    originalInput: '', resolvedQuestion: '', source: 'none', confidence: 0,
    isFollowUp: false, activeEntities: [], requiresClarification: true,
    clarificationReason: 'no question could be resolved from the input',
  };

  // 1 — manual input wins outright, and is NOT cleaned: the user typed exactly
  // what they meant, and "filler removal" on deliberate text is corruption.
  const manual = input.manualQuestion?.trim();
  if (manual) {
    return {
      originalInput: manual, resolvedQuestion: manual, source: 'manual', confidence: 1,
      isFollowUp: PRONOUN_ONLY.test(manual), activeEntities: entitiesOf(manual),
      requiresClarification: false,
    };
  }

  // 2 — an explicit selection is a deliberate act too.
  const selected = input.selectedText?.trim();
  if (selected) {
    const cleaned = cleanUtterance(selected);
    return {
      originalInput: selected, resolvedQuestion: cleaned || selected, source: 'selection',
      confidence: 0.95, isFollowUp: PRONOUN_ONLY.test(cleaned),
      activeEntities: entitiesOf(cleaned), requiresClarification: false,
    };
  }

  // 3 — the latest stable interviewer question inside the window.
  const turns = input.transcript ?? [];
  if (!turns.length) return empty;

  const now = input.now ?? Math.max(...turns.map((t) => t.timestamp));
  const windowMs = input.windowMs ?? 60_000;

  const candidates = turns
    .filter((t) => t.role === 'interviewer')          // never the assistant, never the user
    .filter((t) => now - t.timestamp <= windowMs)
    .reverse();                                       // most recent first

  for (const turn of candidates) {
    const cleaned = cleanUtterance(turn.text);
    if (!cleaned || isAbandoned(cleaned)) continue;
    if (!looksLikeQuestion(cleaned)) continue;

    const followUp = PRONOUN_ONLY.test(cleaned);
    return {
      originalInput: turn.text,
      resolvedQuestion: cleaned,
      source: followUp ? 'follow-up' : 'transcript',
      // A follow-up carries no subject of its own, so confidence is lower and
      // the caller is expected to resolve it against conversation state.
      confidence: followUp ? 0.55 : 0.8,
      isFollowUp: followUp,
      activeEntities: entitiesOf(cleaned),
      requiresClarification: followUp,
      ...(followUp ? { clarificationReason: 'follow-up has no subject of its own' } : {}),
    };
  }

  return {
    ...empty,
    originalInput: turns[turns.length - 1]?.text ?? '',
    clarificationReason: 'no stable interviewer question in the current window',
  };
}
