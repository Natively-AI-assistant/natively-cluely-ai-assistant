// electron/intelligence/CodingConversationState.ts
//
// CODING CONVERSATION STATE (spoken-answer-quality sprint, 2026-06-15).
//
// The coding follow-up bug: a multi-turn coding thread loses track of WHICH problem the
// follow-up refers to. "Give the complexity" / "dry run this" / "now optimize it" must
// analyse the CURRENT problem, while "what was the ORIGINAL problem I asked?" must return
// the FIRST problem — not the most recent unrelated coding prompt.
//
// ConversationMemoryService.getLastCodingTurn already returns the most-recent fenced-code
// turn (correct for the CODE BODY a complexity/dry-run needs). This class adds the missing
// piece: a per-session scoped snapshot that distinguishes originalProblem from
// currentProblem and tracks the running variant/language/format so the resolver can pick
// the right problem statement.
//
// It REUSES codingFollowup's classification (isContinuation is computed by the caller via
// isCodingContinuation) rather than re-deriving it. Per-session, in-memory, bounded,
// deterministic, never throws.

import type { ExplicitCodingContract } from '../llm/codingFollowup';

export interface CodingConversationSnapshot {
  /** The FIRST coding problem in this thread. Set once; only reset on a brand-new problem. */
  originalProblem: string;
  /** The problem the latest turn is about (advances when a new problem is introduced). */
  currentProblem: string;
  /** Running variant of the current solution ("iterative", "in-place", "handles duplicates"). */
  currentVariant?: string;
  lastLanguage?: string;
  lastFormatContract?: ExplicitCodingContract;
  lastComplexity?: string;
  lastDryRunInput?: string;
  /** Cheap hash of the last fenced code block (detects "new code" vs "same code, new analysis"). */
  lastCodeHash?: string;
  updatedAt: number;
}

export interface RecordCodingTurnInput {
  userMessage: string;
  assistantAnswer: string;
  explicitContract: ExplicitCodingContract;
  /** From codingFollowup.isCodingContinuation — DO NOT re-derive; pass it in. */
  isContinuation: boolean;
  /** Optional monotonic timestamp (pass Date.now() from the caller; the class never calls it). */
  timestamp: number;
}

export interface ResolvedProblem {
  problem: string;
  isOriginal: boolean;
}

const MAX_SESSIONS = 200;
const PROBLEM_MAX_CHARS = 400;

/** "what was the original/first problem/question I asked?" / "what did I originally ask?" */
const ORIGINAL_PROBLEM_RE =
  /\b(?:original|first|initial|very\s+first)\b[^?.!]*\b(?:problem|question|prompt|ask|one)\b|\bwhat\s+(?:was|were)\s+(?:the\s+)?(?:original|first)\b|\b(?:originally|initially|first)\s+ask(?:ed)?\b|\bask(?:ed)?\s+(?:you\s+)?(?:to\s+\w+\s+)?(?:originally|first|initially)\b/i;

const FENCE_RE = /```([A-Za-z0-9_+-]*)\s*\n?([\s\S]*?)```/;

const lc = (s?: string) => (s || '').toLowerCase();

/** A tiny, stable, non-crypto hash for "is this the same code block?" detection. */
function cheapHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Extract a short problem statement from the user's coding message. */
function problemStatementOf(userMessage: string): string {
  return (userMessage || '').replace(/\s+/g, ' ').trim().slice(0, PROBLEM_MAX_CHARS);
}

/** Pull the language tag + a hash of the first fenced code block, if any. */
function codeMetaOf(assistantAnswer: string): { language?: string; codeHash?: string } {
  const m = (assistantAnswer || '').match(FENCE_RE);
  if (!m) return {};
  const language = (m[1] || '').toLowerCase() || undefined;
  const body = (m[2] || '').trim();
  return { language, codeHash: body ? cheapHash(body) : undefined };
}

/** Detect a stated variant from a continuation message ("make it iterative", "in place"). */
const VARIANT_RES: Array<{ re: RegExp; variant: string }> = [
  { re: /\bin[- ]?place\b|\bconstant\s+(?:extra\s+)?space\b|\bo\(1\)\s+space\b/i, variant: 'in_place' },
  { re: /\biterativ/i, variant: 'iterative' },
  { re: /\brecursiv/i, variant: 'recursive' },
  { re: /\btwo[- ]pointers?\b/i, variant: 'two_pointer' },
  { re: /\bone[- ]pass\b|\bsingle\s+pass\b/i, variant: 'one_pass' },
  { re: /\bhandle\s+(?:duplicates?|negatives?|empty|nulls?)\b/i, variant: 'edge_cases' },
  { re: /\boptimi[sz]e|\bmore\s+efficient|\bfaster\b/i, variant: 'optimized' },
];
function variantOf(message: string): string | undefined {
  for (const { re, variant } of VARIANT_RES) if (re.test(message)) return variant;
  return undefined;
}

/** Pull a stated dry-run input ("dry run this with [2,7,11,15], target 9"). */
function dryRunInputOf(message: string): string | undefined {
  const m = message.match(/\b(?:with|on|for|using|input)\s+(\[[^\]]*\][^.?!]*)/i);
  return m ? m[1].trim().slice(0, 120) : undefined;
}

/**
 * Per-session coding thread state. Distinguishes the original problem from the current
 * one so a follow-up resolves against the right problem statement.
 */
export class CodingConversationState {
  private bySession = new Map<string, CodingConversationSnapshot>();

  get(sessionId: string): CodingConversationSnapshot | null {
    return this.bySession.get(sessionId) ?? null;
  }

  /**
   * Record a coding turn. Update rules:
   *   - A NON-continuation that introduces a new problem (no prior state, or new code hash)
   *     ADVANCES currentProblem. originalProblem is set once and only reset when a genuinely
   *     new (non-continuation) problem arrives — it then becomes both original and current.
   *   - A continuation (complexity/dry-run/optimize/variant) KEEPS currentProblem and only
   *     updates the running metadata (variant/language/complexity/dry-run/code hash).
   */
  recordCodingTurn(sessionId: string, input: RecordCodingTurnInput): void {
    try {
      const prior = this.bySession.get(sessionId) ?? null;
      const { language, codeHash } = codeMetaOf(input.assistantAnswer);
      const stmt = problemStatementOf(input.userMessage);

      // Is this a NEW problem? Yes when it's not a continuation AND it either has no prior
      // thread or introduces different code than the current solution.
      const isNewProblem = !input.isContinuation && (!prior || (codeHash != null && codeHash !== prior.lastCodeHash && stmt.length > 0));

      let snap: CodingConversationSnapshot;
      if (!prior || isNewProblem) {
        snap = {
          // originalProblem is the FIRST coding problem of the session and is sticky: once
          // set it is NEVER overwritten by a later problem, so "what was the original
          // problem I asked?" always returns the first one (the sprint's Phase 5 rule). It
          // only clears on clearSession(). currentProblem DOES advance to the new problem.
          originalProblem: prior?.originalProblem || stmt || '',
          currentProblem: stmt || prior?.currentProblem || '',
          currentVariant: variantOf(input.userMessage),
          lastLanguage: language,
          lastFormatContract: input.explicitContract,
          lastComplexity: undefined,
          lastDryRunInput: dryRunInputOf(input.userMessage),
          lastCodeHash: codeHash,
          updatedAt: input.timestamp,
        };
      } else {
        // Continuation: keep the problem, update running metadata.
        snap = {
          ...prior,
          currentVariant: variantOf(input.userMessage) ?? prior.currentVariant,
          lastLanguage: language ?? prior.lastLanguage,
          lastFormatContract: input.explicitContract ?? prior.lastFormatContract,
          lastDryRunInput: dryRunInputOf(input.userMessage) ?? prior.lastDryRunInput,
          lastCodeHash: codeHash ?? prior.lastCodeHash,
          updatedAt: input.timestamp,
        };
        if (input.explicitContract === 'complexity_only') {
          snap.lastComplexity = (input.assistantAnswer || '').replace(/\s+/g, ' ').trim().slice(0, 160);
        }
      }

      this.bySession.set(sessionId, snap);
      if (this.bySession.size > MAX_SESSIONS) {
        const oldest = this.bySession.keys().next().value;
        if (oldest !== undefined) this.bySession.delete(oldest);
      }
    } catch { /* never throw */ }
  }

  /**
   * Which problem statement does `question` refer to? "what was the original problem" →
   * originalProblem; a normal continuation → currentProblem. Returns null when there is no
   * coding thread yet.
   */
  resolveProblemFor(sessionId: string, question: string): ResolvedProblem | null {
    const snap = this.bySession.get(sessionId);
    if (!snap) return null;
    if (ORIGINAL_PROBLEM_RE.test(lc(question)) && snap.originalProblem) {
      return { problem: snap.originalProblem, isOriginal: true };
    }
    if (snap.currentProblem) return { problem: snap.currentProblem, isOriginal: false };
    if (snap.originalProblem) return { problem: snap.originalProblem, isOriginal: false };
    return null;
  }

  /** Is this question explicitly asking for the ORIGINAL problem? */
  isOriginalProblemQuery(question: string): boolean {
    return ORIGINAL_PROBLEM_RE.test(lc(question));
  }

  clearSession(sessionId: string): void {
    try { this.bySession.delete(sessionId); } catch { /* ignore */ }
  }

  get sessionCount(): number { return this.bySession.size; }
}
