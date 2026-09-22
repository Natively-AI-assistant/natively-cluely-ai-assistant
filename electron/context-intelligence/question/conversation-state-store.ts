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
  advance, appendTurn, resolveReference, MAX_SUMMARY_CHARS,
  type ConversationState, type ResolvedReference,
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

/**
 * THE session key for V3 conversation state. Every writer and every reader must
 * derive its key from here.
 *
 * It exists because they did not. Typed chat wrote the ring under
 * `String(senderId)` (a webContents id) while what-to-answer read it under
 * `meetingId ?? meetingMarker` — two namespaces, so a screenshot described in
 * typed chat was invisible to the spoken surface and vice versa, and neither
 * surface's history could ever contain the other's. The bug is invisible in
 * isolation: each surface is internally consistent and passes its own tests.
 *
 * The meeting wins when there is one, because THAT is the conversation a user
 * means; the sender/session id is only a fallback for chat outside a meeting.
 * Prefixed so a meeting id can never collide with a sender id.
 */
/**
 * The key returned when there is NO real conversation scope — no meeting and no
 * session. It is a shared bucket by construction, so a caller that has its own
 * scope (a webContents id, say) must prefer that instead of collapsing into it.
 */
export const NO_CONVERSATION_SCOPE = 'engine';

export function resolveConversationSessionId(
  meetingId: string | null | undefined,
  fallback: string | number | null | undefined,
): string {
  const meeting = typeof meetingId === 'string' ? meetingId.trim() : '';
  if (meeting) return `m:${meeting}`;
  const key = fallback === null || fallback === undefined ? '' : String(fallback).trim();
  return key ? `s:${key}` : NO_CONVERSATION_SCOPE;
}

export interface AdvanceTurnInput {
  sessionId: string;
  scope: EvidenceScope;
  question: string;
  evidenceIds?: string[];
  sourceIds?: string[];
  decision?: import('../contracts/types').PriorTurnDecision;
  /** This turn's planned source types (T5) — a bare follow-up reuses them. */
  plannedSourceTypes?: readonly import('../contracts/types').SourceType[];
  /**
   * This turn's answer, when the caller already has it.
   *
   * `AdvanceInput.answerSummary` has existed and been consumed by `advance()`
   * since the module shipped, but this input never carried it — so every
   * advance reset `previousAnswerSummary` to undefined and the carry-forward
   * was designed and never wired. Callers that only know the answer after the
   * stream (manual chat) still use `recordAnswerSummary`.
   */
  answerSummary?: string;
}

/** Advance after a decided turn. Called by orchestrate(); scope changes reset. */
export function advanceConversationState(input: AdvanceTurnInput): ConversationState {
  const s = store();
  const next = advance(s.get(input.sessionId) ?? null, {
    scope: input.scope,
    question: input.question,
    evidenceIds: input.evidenceIds,
    sourceIds: input.sourceIds,
    decision: input.decision,
    plannedSourceTypes: input.plannedSourceTypes,
    answerSummary: input.answerSummary,
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
export function recordAnswerSummary(
  sessionId: string, answerText: string, screenContext?: string,
  /** Seeds state when the turn never went through orchestrate() — a legacy or
   *  V3-off turn, whose answer would otherwise leave no antecedent at all.
   *  Only passed by callers that HAVE a question: `appendTurn` refuses a
   *  question-less turn, and seeding one with '' would create a permanently
   *  unappendable state rather than fixing anything. */
  question?: string,
  opts?: {
    /**
     * True when this write is a turn that completed SYNCHRONOUSLY and is
     * certainly the newest — the live RAG turn (task 7b, issue #552,
     * live-verified). An anchored write moves `previousQuestion` too, so the
     * next follow-up ("expand on that") resolves against THIS turn instead
     * of whichever typed question happened to advance the state last.
     *
     * The deferred what-to-answer writer (IntelligenceEngine ~1491) must
     * NEVER anchor: it awaits a transcription and can land after the NEXT
     * turn has already advanced the state, so treating it as "certainly
     * newest" would move the anchor BACKWARDS onto a stale question.
     */
    anchor?: boolean;
  },
): void {
  const s = store();
  let cur = s.get(sessionId);
  if (!cur && question?.trim()) {
    cur = { previousQuestion: question.trim(), turns: [] } as unknown as ConversationState;
  }
  if (!cur) return;
  // THE question this answer answers, captured by the caller at turn time.
  //
  // `cur.previousQuestion` is read HERE, at write time, and that is wrong twice
  // over. It is only ever updated by advance(), so on any path that does not
  // reach orchestrate() it keeps the FIRST question forever — measured, three
  // turns each passing their own question were all recorded under the first, so
  // a screenshot attached on turn 3 reached the model as the answer to turn 1.
  // And because the live writer defers behind an awaited transcription, a turn
  // that lands after the NEXT turn has advanced the state would be filed under
  // that later question instead.
  //
  // Falling back to previousQuestion keeps the typed-chat path byte-identical:
  // it passes no question because advance() has already set the right one for
  // this very turn.
  const turnQuestion = question?.trim() || cur.previousQuestion || '';
  const text = String(answerText ?? '');
  s.set(sessionId, {
    ...cur,
    previousAnswerSummary: text.slice(0, MAX_SUMMARY_CHARS) || undefined,
    // COMPLETES the open turn: `advance()` recorded the question when the turn
    // started, and this is the first moment its answer exists. Appending here
    // (rather than only overwriting a single slot) is what lets turn N see
    // turn N-2. A turn whose stream was truncated never reaches this call, so
    // it correctly leaves no half-turn behind.
    turns: appendTurn(cur.turns ?? [], turnQuestion, text, screenContext),
    // An ANCHORED write also moves the follow-up anchor (task 7b, issue #552,
    // live-verified): a voice turn answered and recorded via the live RAG
    // path, but the next TYPED "expand on that" resolved against whichever
    // typed question had last gone through orchestrate() — because only
    // advance() ever set `previousQuestion`, and this call never reached it.
    // Only a caller passing `{ anchor: true }` may do this — see the
    // parameter's docblock for why the deferred what-to-answer writer must
    // not.
    ...(opts?.anchor && turnQuestion ? { previousQuestion: turnQuestion } : {}),
  });
}

/** Resolve a question against the session's state. Pure pass-through when no state. */
export function resolveAgainstSession(
  sessionId: string,
  question: string,
  scope?: EvidenceScope,
): ResolvedReference {
  // `scope` (T7): when the caller knows this turn's scope, a referent from a
  // DIFFERENT scope is not resolved against. Optional so existing callers are
  // byte-for-byte unchanged.
  return resolveReference(question, getConversationState(sessionId), scope);
}

/** Mode switches and session resets must not carry referents across. */
export function clearConversationState(sessionId?: string): void {
  if (sessionId === undefined) store().clear();
  else store().delete(sessionId);
}
