// electron/context-intelligence/question/conversation-state.ts
//
// Compact, SCOPED follow-up continuity.
//
// WHAT THIS REPLACES
// Today five of nine surfaces pass `session.getFormattedContext(N)` — an
// unbounded transcript blob that also contains the assistant's own prior output
// labelled only as "ASSISTANT (PREVIOUS SUGGESTION)". A guard for that exists
// (context-os/assistantClaims) but is wired to ONE surface and disabled in
// production, so on the rest a single fabrication becomes self-reinforcing.
//
// Two rules follow, and both are enforced here rather than in a prompt:
//   1. State is SIZE-BOUNDED and reset on meeting change (§12.3).
//   2. Prior assistant output is a REFERENT, never evidence. It can tell you what
//      "it" refers to; it can never support a factual claim.

import type { EvidenceScope } from '../contracts/types';
import { scopeKey } from '../contracts/types';

export interface ConversationTurn {
  role: 'user' | 'interviewer' | 'assistant';
  text: string;
  timestamp: number;
}

export interface ConversationState {
  scopeId: string;
  activeTopic?: string;
  activeEntities: string[];
  previousQuestion?: string;
  /** A SUMMARY of the assistant's last answer, usable only to resolve
   *  references. Never promoted to evidence. */
  previousAnswerSummary?: string;
  previousEvidenceIds: string[];
  previousSourceIds: string[];
  unresolvedReferences: string[];
  updatedAt: number;
}

export const MAX_ENTITIES = 8;
export const MAX_SUMMARY_CHARS = 280;

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'was',
  'were', 'you', 'your', 'our', 'their', 'about', 'what', 'how', 'why', 'when', 'did', 'does',
  'can', 'could', 'would', 'should', 'they', 'them', 'been', 'into', 'more', 'than', 'then']);

/** Ordinary English words that are capitalised purely because they begin a
 *  sentence. Without this, "Tell me about the Cassandra migration" yields
 *  activeTopic = "Tell", and the next pronoun resolves against a verb — silently
 *  redirecting retrieval at nothing. */
const SENTENCE_STARTERS = new Set(['tell', 'what', 'how', 'why', 'when', 'where', 'who', 'which',
  'can', 'could', 'would', 'should', 'did', 'does', 'do', 'is', 'are', 'was', 'were', 'will',
  'explain', 'describe', 'walk', 'give', 'show', 'let', 'please', 'talk', 'help', 'compare',
  'summarize', 'summarise', 'list', 'write', 'and', 'but', 'so', 'now', 'okay', 'ok', 'also']);

/** Capitalised tokens and code-ish identifiers — the things a pronoun usually
 *  refers back to. Deliberately conservative: a wrong entity silently redirects
 *  the next retrieval, which is worse than resolving nothing. */
export function extractEntities(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (v: string) => { if (!seen.has(v)) { seen.add(v); out.push(v); } };

  for (const m of text.matchAll(/\b([A-Z][A-Za-z0-9]{2,}(?:\s+[A-Z][A-Za-z0-9]{2,})?)\b/g)) {
    const token = m[1];
    const idx = m.index ?? 0;
    // Sentence-initial = start of string, or preceded only by whitespace after
    // sentence-ending punctuation.
    const before = text.slice(0, idx);
    const sentenceInitial = /(^|[.!?]\s*)$/.test(before);
    if (sentenceInitial && SENTENCE_STARTERS.has(token.split(/\s+/)[0].toLowerCase())) continue;
    add(token);
  }
  for (const m of text.matchAll(/\b([a-z]+[A-Z]\w+|\w+\.\w+|\w+_\w+)\b/g)) add(m[1]);

  return out.filter((e) => !STOP.has(e.toLowerCase())).slice(0, MAX_ENTITIES);
}

export function emptyState(scope: EvidenceScope): ConversationState {
  return {
    scopeId: scopeKey(scope),
    activeEntities: [],
    previousEvidenceIds: [],
    previousSourceIds: [],
    unresolvedReferences: [],
    updatedAt: 0,
  };
}

export interface AdvanceInput {
  scope: EvidenceScope;
  question: string;
  answerSummary?: string;
  evidenceIds?: string[];
  sourceIds?: string[];
  at?: number;
}

/**
 * Advance the state after a turn.
 *
 * RESETS when the scope changes. A meeting change must not carry the previous
 * meeting's entities forward — the corpus contains two transcripts that REVERSE
 * each other's decisions precisely to make that failure visible.
 */
export function advance(prev: ConversationState | null, input: AdvanceInput): ConversationState {
  const sid = scopeKey(input.scope);
  const base = prev && prev.scopeId === sid ? prev : emptyState(input.scope);

  const fresh = extractEntities(input.question);
  const merged = [...new Set([...fresh, ...base.activeEntities])].slice(0, MAX_ENTITIES);

  return {
    scopeId: sid,
    activeTopic: fresh[0] ?? base.activeTopic,
    activeEntities: merged,
    previousQuestion: input.question,
    previousAnswerSummary: input.answerSummary
      ? input.answerSummary.slice(0, MAX_SUMMARY_CHARS)
      : undefined,
    previousEvidenceIds: input.evidenceIds ?? [],
    previousSourceIds: input.sourceIds ?? [],
    unresolvedReferences: [],
    updatedAt: input.at ?? 0,
  };
}

const PRONOUN_RE = /\b(it|that|this|those|these|they|them|the (?:same|latter|former)|there)\b/i;

export interface ResolvedReference {
  resolved: string;
  usedState: boolean;
  referent?: string;
}

/**
 * Resolve a bare follow-up against state.
 *
 * Returns the question UNCHANGED when there is nothing to resolve against —
 * guessing a referent silently redirects retrieval at a document the user never
 * mentioned, which is worse than asking.
 */
export function resolveReference(question: string, state: ConversationState | null): ResolvedReference {
  const q = question.trim();
  if (!state || !PRONOUN_RE.test(q)) return { resolved: q, usedState: false };

  const referent = state.activeTopic ?? state.activeEntities[0];
  if (!referent) return { resolved: q, usedState: false };

  return { resolved: `${q} (referring to: ${referent})`, usedState: true, referent };
}

/**
 * Prior source ids a follow-up may REUSE — but only as a retrieval hint.
 *
 * §12.4: reused sources must still be authorized, current and version-valid at
 * the time of reuse. This returns candidate ids only; it confers no authority,
 * and the scope/version filter still applies downstream.
 */
export function continuitySourceIds(state: ConversationState | null, scope: EvidenceScope): string[] {
  if (!state || state.scopeId !== scopeKey(scope)) return [];
  return state.previousSourceIds;
}
