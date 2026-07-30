// electron/context-intelligence/question/conversation-state-store.ts
//
// The process-wide home for V3 conversation state.
//
// WHY THIS EXISTS
// conversation-state.ts shipped complete and tested with ZERO production
// callers — question-resolver lowered confidence on follow-ups "expecting the
// caller to resolve against conversation state", and no caller did. The live
// result, measured across four modes in one session: "Why not?" produced a
// clarification about the wrong turn, "Can you explain it generally instead?"
// lost its referent entirely. The module worked; nothing fed it.
//
// WHY globalThis
// Same rule as ModesManager's active-mode snapshot and the answer-policy
// store: esbuild inlines this module per entry bundle, and harness runs
// co-load bundles. State written by one copy must be visible to every copy.
//
// BOUNDED BY CONSTRUCTION
// One ConversationState per session key, hard cap on sessions, oldest evicted.
// Prior answers are stored only as capped SUMMARIES (MAX_SUMMARY_CHARS) — a
// referent aid, never evidence (§12.3).

import type { EvidenceScope } from '../contracts/types';
import {
  advance, resolveReference, type ConversationState, type ResolvedReference,
} from './conversation-state';

const STORE_KEY = '__nativelyV3ConversationStateV1__';
const MAX_SESSIONS = 32;

type Store = Map<string, ConversationState>;

function store(): Store {
  const g = globalThis as unknown as Record<string, unknown>;
  let s = g[STORE_KEY] as Store | undefined;
  if (!s) { s = new Map(); g[STORE_KEY] = s; }
  return s;
}

export function getConversationState(sessionId: string): ConversationState | null {
  return store().get(sessionId) ?? null;
}

export interface AdvanceTurnInput {
  sessionId: string;
  scope: EvidenceScope;
  question: string;
  evidenceIds?: string[];
  sourceIds?: string[];
}

/** Advance after a decided turn. Called by orchestrate(); scope changes reset. */
export function advanceConversationState(input: AdvanceTurnInput): ConversationState {
  const s = store();
  const next = advance(s.get(input.sessionId) ?? null, {
    scope: input.scope,
    question: input.question,
    evidenceIds: input.evidenceIds,
    sourceIds: input.sourceIds,
    at: 0,
  });
  s.delete(input.sessionId);           // re-insert to refresh LRU position
  s.set(input.sessionId, next);
  while (s.size > MAX_SESSIONS) {
    const oldest = s.keys().next().value;
    if (oldest === undefined) break;
    s.delete(oldest);
  }
  return next;
}

/**
 * Attach the answer summary AFTER the stream completes. Split from
 * advanceConversationState because the caller has the final text only after
 * the provider finishes; the referent for the NEXT turn should include what
 * was just answered, not only what was asked.
 */
export function recordAnswerSummary(sessionId: string, answerText: string): void {
  const s = store();
  const cur = s.get(sessionId);
  if (!cur) return;
  s.set(sessionId, { ...cur, previousAnswerSummary: String(answerText ?? '').slice(0, 280) || undefined });
}

/** Resolve a question against the session's state. Pure pass-through when no state. */
export function resolveAgainstSession(sessionId: string, question: string): ResolvedReference {
  return resolveReference(question, getConversationState(sessionId));
}

/** Mode switches and session resets must not carry referents across. */
export function clearConversationState(sessionId?: string): void {
  if (sessionId === undefined) store().clear();
  else store().delete(sessionId);
}
