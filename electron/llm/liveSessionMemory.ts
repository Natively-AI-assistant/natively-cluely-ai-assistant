// electron/llm/liveSessionMemory.ts
//
// Thin orchestration layer the LIVE IntelligenceEngine "What to answer?" path uses
// to drive SessionMemory from real transcript turns (release 2026-06-07c). Keeps the
// engine wiring small: feed it the session's turns + active mode + the latest
// question, and it returns the resolved follow-up (or a clarification) using the
// validated SessionMemory + resolveSessionFollowup, respecting the feature flag.
//
// CRITICAL UNIT CONTRACT: `LiveTurn.t` and `now` MUST be in SECONDS (SessionMemory's
// half-life decay is in seconds). The engine adapter converts SessionTracker's
// wall-clock MILLISECOND timestamps via Math.floor(timestamp/1000) BEFORE calling in
// — feeding raw ms would collapse a 1-hour half-life to a ~15-second window. The
// unit tests (LiveSessionMemory2026_06_07c) pin this.
//
// Pure logic over the data the caller already has — no I/O, no LLM. Privacy: logs
// (when NATIVELY_SESSION_MEMORY_DEBUG=true) are MARKER-ONLY (kinds + counts), never
// raw entity/transcript content.

import { SessionMemory, type MemoryMode } from './SessionMemory';
import { resolveSessionFollowup, type SessionFollowupResult } from './sessionFollowupResolver';
import { extractTranscriptEntities, isCorrectionTurn, isExplicitCrossModeInvite } from './transcriptEntityExtractor';
import { isBareFollowUp, type FollowUpSurface } from './FollowUpResolver';
import { liveSessionMemoryMaxItems, liveSessionMemoryDebug } from './liveSessionMemoryConfig';
import type { AnswerType } from './AnswerPlanner';

export interface LiveTurn {
  role: 'interviewer' | 'user' | 'assistant';
  text: string;
  /** Seconds (session-relative or wall-clock — consistent within a session). */
  t: number;
}

export interface LiveResolveInput {
  /** All meaningful prior turns this session (oldest-first), incl. the latest. */
  turns: LiveTurn[];
  /** The latest meaningful question to resolve (may be a bare/demonstrative follow-up). */
  latestQuestion: string;
  /** The prior turn's planned answer type, if the caller knows it. */
  previousAnswerType?: AnswerType;
  /** A skill already on the table, if known. */
  lastSkill?: string;
  /** Active ModesManager mode → memory mode + surface. */
  mode: MemoryMode;
  surface: FollowUpSurface;
  /** "now" in the same unit as turn.t (defaults to the latest turn's t). */
  now?: number;
}

/** Map a ModesManager mode id → SessionMemory MemoryMode. */
export function toMemoryMode(modeId: string | undefined): MemoryMode {
  switch (modeId) {
    case 'technical-interview': return 'technical-interview';
    case 'looking-for-work': return 'looking-for-work';
    case 'recruiting': return 'recruiting';
    case 'sales': return 'sales';
    case 'lecture': return 'lecture';
    case 'team-meet': return 'team-meet';
    case 'general': default: return 'general';
  }
}

// Answer types whose context policy demands the RESTRICTIVE coding/negotiation memory
// boundary regardless of the ambient ModesManager mode (code-review 2026-06-07c HIGH:
// a coding/SQL question asked inside a `technical-interview` session must NOT recall
// the interview project — the ModesManager mode alone can't express that, so derive
// the memory mode from the QUESTION's intent).
const CODING_FORBIDDEN_TYPES = new Set<AnswerType>([
  'coding_question_answer', 'dsa_question_answer', 'technical_concept_answer',
  'system_design_answer', 'debugging_question_answer',
]);

/**
 * The EFFECTIVE memory mode for a turn: the ambient ModesManager mode, overridden to
 * the restrictive `coding` boundary when the question is a coding/technical answer
 * (project/skill/profile recall forbidden) or to `negotiation` when it's a comp
 * question (so comp can surface). Falls back to the ambient mode.
 */
export function effectiveMemoryMode(modeId: string | undefined, answerType: AnswerType | undefined): MemoryMode {
  if (answerType && CODING_FORBIDDEN_TYPES.has(answerType)) return 'coding';
  if (answerType === 'negotiation_answer') return 'negotiation';
  return toMemoryMode(modeId);
}

/** Map a ModesManager mode id → the follow-up clarification surface. */
export function toSurface(modeId: string | undefined, isWhatToAnswer: boolean): FollowUpSurface {
  if (isWhatToAnswer) return 'what_to_answer';
  switch (modeId) {
    case 'sales': return 'sales';
    case 'lecture': return 'lecture';
    case 'team-meet': return 'meeting';
    case 'technical-interview': case 'looking-for-work': case 'recruiting': return 'interview';
    default: return 'manual';
  }
}

/**
 * Build a SessionMemory from the session's turns and resolve the latest follow-up.
 * Returns the SessionFollowupResult (which may be a clarification when context-free).
 * The caller decides how to act on it (use resolvedQuestion / resolvedAnswerType, or
 * emit clarificationText).
 */
export function resolveLiveFollowup(input: LiveResolveInput): SessionFollowupResult {
  const mem = new SessionMemory(liveSessionMemoryMaxItems());
  const turns = input.turns || [];
  const latestLc = (input.latestQuestion || '').trim().toLowerCase();

  // Populate memory from ALL prior meaningful turns (exclude the latest question
  // itself so a follow-up never references itself). Comp values are auto-promoted to
  // `comp` inside SessionMemory.add (value-level guard), so a mislabeled salary
  // cannot leak across modes.
  let kindCount = 0;
  for (const turn of turns) {
    if ((turn.text || '').trim().toLowerCase() === latestLc) continue;
    const correction = isCorrectionTurn(turn.text);
    for (const e of extractTranscriptEntities(turn.text, turn.role)) {
      mem.note(e.kind, e.value, turn.t, input.mode, correction ? { corrects: true } : undefined);
      kindCount++;
    }
  }

  // The prior interviewer/speaker QUESTION = the latest ANSWERABLE such turn that
  // isn't the current one (a prior BARE fragment provides no context, so a following
  // bare fragment is still context-free). Plan it to recover its answer type when the
  // caller didn't supply one, so inferKind can route a demonstrative to the right
  // memory kind.
  const answerable = (t: LiveTurn) => (t.text || '').trim().toLowerCase() !== latestLc
    && !isBareFollowUp(t.text)
    && (t.text || '').trim().length > 3
    && !/^\[/.test((t.text || '').trim()); // skip "[no clear answer]" placeholders
  // Prefer the latest answerable INTERVIEWER/speaker QUESTION (the thing the follow-up
  // riffs on) over a candidate's own statement — "And SQL?" inherits from "How is your
  // SQL?", not from the candidate's "Also strong." reply.
  const priorQ = [...turns].reverse().find(t => t.role === 'interviewer' && answerable(t))
    || [...turns].reverse().find(t => (t.role === 'interviewer' || t.role === 'user') && answerable(t));
  let previousAnswerType = input.previousAnswerType;
  let lastSkill = input.lastSkill;
  if (priorQ && (!previousAnswerType || !lastSkill)) {
    try {
      const { planAnswer } = require('./AnswerPlanner') as typeof import('./AnswerPlanner');
      if (!previousAnswerType) previousAnswerType = planAnswer({ question: priorQ.text, source: 'manual_input', speakerPerspective: 'user' }).answerType;
    } catch { /* keep undefined */ }
    if (!lastSkill) {
      const sk = (priorQ.text || '').match(/\b(Python|SQL|TypeScript|JavaScript|React|Node|Go|Rust|FastAPI|Django|GraphQL|AWS|Docker|Tableau|Power\s?BI|Excel|Pandas|Spark)\b/i);
      if (sk) lastSkill = sk[0];
    }
  }

  const now = input.now ?? (turns.length ? turns[turns.length - 1].t : 0);
  const explicitCross = isExplicitCrossModeInvite(input.latestQuestion);

  const resolved = resolveSessionFollowup({
    latestQuestion: input.latestQuestion,
    previousQuestion: priorQ?.text,
    previousAnswerType,
    lastSkill,
    now,
    mode: input.mode,
    surface: input.surface,
    memory: mem,
    explicitCrossMode: explicitCross,
  });

  if (liveSessionMemoryDebug()) {
    // MARKER-ONLY log — never raw entity/transcript content.
    // eslint-disable-next-line no-console
    console.log('[LiveSessionMemory]', {
      mode: input.mode, surface: input.surface, memNotes: kindCount, memSize: mem.size(),
      via: resolved.resolvedVia, type: resolved.resolvedAnswerType,
      isClarification: !!resolved.isClarification, recalledAgeS: resolved.recalledAgeSeconds ?? null,
    });
  }

  return resolved;
}

/** Is the latest question a context-free bare follow-up given the prior turns? */
export function isContextFreeBareFollowup(latestQuestion: string, turns: LiveTurn[]): boolean {
  if (!isBareFollowUp(latestQuestion)) return false;
  const latestLc = (latestQuestion || '').trim().toLowerCase();
  // A prior ANSWERABLE interviewer/user turn provides context; a prior bare fragment
  // does not.
  const priorAnswerable = [...turns].reverse().find(t =>
    (t.role === 'interviewer' || t.role === 'user')
    && (t.text || '').trim().toLowerCase() !== latestLc
    && !isBareFollowUp(t.text));
  return !priorAnswerable;
}
