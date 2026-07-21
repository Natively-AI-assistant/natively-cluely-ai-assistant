// electron/intelligence/ConversationMemoryService.ts
//
// Spec Phase 13 — Conversation Memory. Layered follow-up memory:
//   1. Short-term: the current session's turn history (user msg + assistant answer).
//   2. Session-level: a cheap extractive rolling summary (no LLM on the hot path).
//   3. Meeting-level: carried via meetingId tagging.
//   4. Long-term: optional Hindsight (Phase 16) — NEVER required, strict-timeout.
//
// HONEST STATUS: same-session follow-up resolution already exists for the LIVE path
// (electron/llm/liveSessionMemory.ts + SessionMemory). What was missing is a single
// SERVICE that stores structured conversation turns (msg/answer/mode/timestamp/context
// sources/entities) and serves BOTH same-session (local-first) and cross-session
// (meeting/long-term) follow-ups behind one API. This is that store. It is in-memory,
// deterministic, bounded, and never throws. Cross-session recall is delegated to an
// injected long-term provider (Noop by default — the app works with memory disabled).

export interface ConversationTurn {
  sessionId: string;
  meetingId?: string;
  userMessage: string;
  assistantAnswer: string;
  mode?: string;
  timestamp: number;
  contextSourcesUsed?: string[];
  entities?: string[];
}

export interface StoredTurn extends ConversationTurn {
  id: string;
  summary: string;
}

/** Minimal long-term recall provider (Hindsight adapter implements this in Phase 16). */
export interface LongTermRecallProvider {
  recall(query: string, scope: { userId: string; sessionId?: string }, timeoutMs: number): Promise<Array<{ text: string; score?: number }>>;
}

const MAX_TURNS_PER_SESSION = 100;
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'to', 'of', 'in', 'on', 'for', 'with', 'i', 'you', 'we', 'it', 'that', 'this']);

function entitiesOf(text: string, max = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of (text || '').match(/\b[A-Z][a-zA-Z0-9+.&-]{2,}\b|\b[a-z]+(?:\+\+|#)\b/g) || []) {
    const k = tok.toLowerCase();
    if (STOP.has(k) || seen.has(k)) continue;
    seen.add(k); out.push(tok);
    if (out.length >= max) break;
  }
  return out;
}

function summarize(userMessage: string, assistantAnswer: string): string {
  const q = (userMessage || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const a = (assistantAnswer || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return `Q: ${q}${a ? ` | A: ${a}` : ''}`;
}

/**
 * Conversation memory store. Same-session reads are local + synchronous. Cross-session
 * recall is async via an optional long-term provider (default Noop → empty). Never throws.
 */
export class ConversationMemoryService {
  private bySession = new Map<string, StoredTurn[]>();
  private seq = 0;

  constructor(private longTerm?: LongTermRecallProvider | null) {}

  /** Record a delivered turn. Bounded per session. */
  record(turn: ConversationTurn): StoredTurn {
    const stored: StoredTurn = {
      ...turn,
      id: `turn_${this.seq++}`,
      summary: summarize(turn.userMessage, turn.assistantAnswer),
      entities: turn.entities ?? entitiesOf(`${turn.userMessage} ${turn.assistantAnswer}`),
    };
    try {
      const arr = this.bySession.get(turn.sessionId) || [];
      arr.push(stored);
      if (arr.length > MAX_TURNS_PER_SESSION) arr.splice(0, arr.length - MAX_TURNS_PER_SESSION);
      this.bySession.set(turn.sessionId, arr);
    } catch { /* never throw */ }
    return stored;
  }

  /** Short-term: the last N turns of the current session (most recent last). */
  getRecentTurns(sessionId: string, n = 10): StoredTurn[] {
    const arr = this.bySession.get(sessionId) || [];
    return arr.slice(-Math.max(0, n));
  }

  /** Session-level extractive rolling summary (no LLM). */
  getSessionSummary(sessionId: string, maxTurns = 12): string {
    const arr = this.bySession.get(sessionId) || [];
    if (arr.length === 0) return '';
    return arr.slice(-maxTurns).map((t) => t.summary).join('\n');
  }

  /** The last assistant answer in the session (for "what was your previous suggestion?"). */
  getLastAssistantAnswer(sessionId: string): string | null {
    const arr = this.bySession.get(sessionId) || [];
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i].assistantAnswer) return arr[i].assistantAnswer;
    return null;
  }

  /**
   * The most recent CODING turn in the session — a prior Q/A whose answer contains a
   * fenced code block (so "give the complexity" / "dry run this" / "now optimize it"
   * can inherit the same problem + code). Returns null when no coding turn exists.
   * Used by the manual coding follow-up path (task Phase 11, bug #6). Synchronous.
   */
  getLastCodingTurn(sessionId: string): StoredTurn | null {
    const arr = this.bySession.get(sessionId) || [];
    for (let i = arr.length - 1; i >= 0; i--) {
      const a = arr[i].assistantAnswer || '';
      // A coding turn = the assistant answer has a fenced code block, OR the turn was
      // explicitly tagged as coding via contextSourcesUsed (the caller may set this).
      if (/```[\s\S]*```/.test(a) || (arr[i].contextSourcesUsed || []).includes('coding')) {
        return arr[i];
      }
    }
    return null;
  }

  /**
   * SAME-SESSION follow-up: resolve from local history first (the spec's rule). Returns
   * the most relevant prior turn by entity/token overlap, or null. Synchronous + fast.
   */
  resolveSameSession(sessionId: string, followUp: string): StoredTurn | null {
    try {
      const arr = this.bySession.get(sessionId) || [];
      if (arr.length === 0) return null;
      const ents = new Set(entitiesOf(followUp).map((e) => e.toLowerCase()));
      const matched: string[] = followUp.toLowerCase().match(/[a-z0-9']+/g) ?? [];
      const terms = new Set(matched.filter((t) => t.length > 2 && !STOP.has(t)));
      let best: StoredTurn | null = null;
      let bestScore = 0;
      // Walk most-recent first so ties favor recency.
      for (let i = arr.length - 1; i >= 0; i--) {
        const t = arr[i];
        const hay = `${t.userMessage} ${t.assistantAnswer}`.toLowerCase();
        let score = 0;
        for (const e of ents) if (hay.includes(e)) score += 2;
        for (const term of terms) if (hay.includes(term)) score += 1;
        if (score > bestScore) { bestScore = score; best = t; }
      }
      // Bare follow-up with no token overlap → most recent turn. Bare follow-ups are
      // content-free BY CONSTRUCTION (callers gate on isBareFollowUp), so when there's
      // no topical overlap the right resolution is simply "the last thing we discussed".
      // The fragment set covers demonstratives ("that/it/this") AND the common
      // continuation/clarification verbs ("why/how/go on/expand/more/elaborate/…") that
      // carry no topic — previously these returned null and dead-ended (test-engineer
      // Phase 11). Kept self-safe with a short-length guard so a stray long string can't
      // trip it even if a caller forgets the isBareFollowUp gate.
      const fu = (followUp || '').trim();
      const RECENCY_FALLBACK_RE = /\b(that|it|this|those|and|also|what about|continue|carry on|keep going|go on|previous|earlier|last|why|how|so|then|more|expand|elaborate|deeper|detail|tell me more|go deeper|explain)\b/i;
      if (!best && fu.split(/\s+/).length <= 6 && RECENCY_FALLBACK_RE.test(fu)) {
        return arr[arr.length - 1];
      }
      return best;
    } catch { return null; }
  }

  /**
   * CROSS-SESSION follow-up: delegate to the long-term provider with a strict timeout.
   * Returns [] when no provider (memory disabled) or on any error/timeout — the answer
   * proceeds without it (non-negotiable: long-term memory never blocks/breaks answers).
   */
  async recallCrossSession(
    query: string,
    scope: { userId: string; sessionId?: string },
    timeoutMs = 800,
  ): Promise<Array<{ text: string; score?: number }>> {
    if (!this.longTerm) return [];
    try {
      const result = await Promise.race([
        this.longTerm.recall(query, scope, timeoutMs),
        new Promise<Array<{ text: string; score?: number }>>((resolve) => setTimeout(() => resolve([]), timeoutMs)),
      ]);
      return Array.isArray(result) ? result : [];
    } catch {
      return [];
    }
  }

  /** Clear a session's memory (e.g. when a meeting ends after retain). */
  clearSession(sessionId: string): void {
    try { this.bySession.delete(sessionId); } catch { /* ignore */ }
  }

  get sessionCount(): number { return this.bySession.size; }
}
