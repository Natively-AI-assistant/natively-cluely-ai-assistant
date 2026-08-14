// electron/intelligence/LiveTranscriptBrain.ts
//
// Spec Phase 3 — the canonical Live Transcript Brain read API:
// getLiveWindow / getHotWindow / getCurrentQuestion / getRollingSummary /
// getLiveAnswerContext / getTranscriptEntities.
//
// THIS IS A FACADE over the existing SessionTracker + the deterministic
// transcriptQuestionExtractor. Today these jobs are done inline inside the large
// `IntelligenceEngine.runWhatShouldISay()` method (getContext(180) + interim
// injection + extractLatestQuestion + …). This service consolidates the READ
// surface into one small, testable object without re-implementing or interposing
// on that orchestration — the live answer path keeps working exactly as it does.
//
// It also carries the FIX for the verified long-range-memory bug: `getDurableWindow`
// reads SessionTracker.getDurableContext() (backed by fullTranscript, which survives
// the 120s eviction) instead of getContext() (capped at 120s by evictOldEntries).
// Whether the live follow-up memory should USE the durable window is gated by the
// `durableMemoryWindow` flag (default OFF → current behavior preserved); this facade
// just exposes both windows and a helper that picks per the flag.
//
// Latency: every method here is pure in-memory array work (no LLM, no IO), so it
// trivially meets the spec's <30ms transcript-lookup budget.

import {
  isDurableMemoryWindowEnabled,
} from './intelligenceFlags';

/** Structural shape of the SessionTracker pieces this brain reads. Kept minimal so
 *  the facade depends on behavior, not the full class (and is trivially testable). */
export interface TranscriptContextItem {
  role: 'interviewer' | 'user' | 'assistant';
  text: string;
  timestamp: number;
}

export interface SessionTrackerLike {
  /** 120s-evicted rolling window (final-only). */
  getContext(lastSeconds?: number): TranscriptContextItem[];
  /** 120s window + the latest interim interviewer partial. */
  getContextWithInterim(lastSeconds?: number): TranscriptContextItem[];
  /** Durable window backed by fullTranscript (survives 120s eviction). */
  getDurableContext(lastSeconds?: number): TranscriptContextItem[];
  /** Last final interviewer turn, or null. */
  getLastInterviewerTurn(): string | null;
}

/** Question extractor dependency (electron/llm/transcriptQuestionExtractor). */
export interface QuestionExtractorLike {
  (turns: TranscriptContextItem[], windowTurns?: number): {
    latestQuestion: string;
    questionType: string;
    detectedSpeaker: string;
    isFollowUp: boolean;
    followUpTarget: string;
    confidence: number;
  };
}

export interface LiveAnswerContext {
  /** The 180s hot window including the latest interim interviewer partial. */
  window: TranscriptContextItem[];
  /** The current/latest extracted interviewer question ('' if none). */
  currentQuestion: string;
  /** Coarse question type (identity | profile_detail | technical | …). */
  questionType: string;
  isFollowUp: boolean;
  /** A light rolling summary of the window (deterministic, no LLM). */
  rollingSummary: string;
}

const DEFAULT_ANSWER_WINDOW_SECONDS = 180;
const DEFAULT_DURABLE_WINDOW_SECONDS = 7200;

// Common sentence-initial words a capitalized-token rule would mis-capture as
// "entities". Lowercased; kept small and generic (no domain assumptions).
const STOP_WORDS = new Set([
  'the', 'this', 'that', 'these', 'those', 'have', 'has', 'had', 'tell', 'what',
  'when', 'where', 'which', 'who', 'why', 'how', 'and', 'but', 'for', 'are', 'was',
  'were', 'can', 'could', 'would', 'should', 'will', 'did', 'does', 'your', 'you',
  'our', 'they', 'their', 'with', 'about', 'into', 'from', 'okay', 'yes', 'sure',
  'right', 'well', 'let', 'give', 'sorry', 'thanks', 'hello', 'maybe',
]);

export class LiveTranscriptBrain {
  constructor(
    private readonly session: SessionTrackerLike,
    private readonly extractQuestion?: QuestionExtractorLike | null,
  ) {}

  /**
   * The live answer window — finalized turns within `seconds` (default 180s). This
   * is the canonical accessor that `IntelligenceEngine` already approximates with
   * `getContext(180)`.
   */
  getLiveWindow(seconds: number = DEFAULT_ANSWER_WINDOW_SECONDS): TranscriptContextItem[] {
    try { return this.session.getContext(seconds) ?? []; } catch { return []; }
  }

  /**
   * The HOT window: the live window PLUS the latest interim interviewer partial
   * (matches the WTA path, which injects the interim so a half-spoken question is
   * still answerable). Default 30s for the spec's "hot 15-30s window", but callers
   * can widen.
   */
  getHotWindow(seconds: number = 30): TranscriptContextItem[] {
    try { return this.session.getContextWithInterim(seconds) ?? []; } catch { return []; }
  }

  /**
   * The DURABLE window — finalized turns within `seconds` (default 2h) read from the
   * persisted transcript that survives 120s eviction. This is what long-range
   * follow-up recall must use; `getLiveWindow` cannot see past ~120s. (Bound: in a
   * >1800-segment session the oldest raw turns are compacted into an epoch summary
   * and won't appear here — see SessionTracker.getDurableContext.)
   */
  getDurableWindow(seconds: number = DEFAULT_DURABLE_WINDOW_SECONDS): TranscriptContextItem[] {
    try { return this.session.getDurableContext(seconds) ?? []; } catch { return []; }
  }

  /**
   * The window the long-range follow-up MEMORY should be built from. When the
   * `durableMemoryWindow` flag is ON, returns the durable (fullTranscript-backed)
   * window so an entity from minute 1 is still present at minute 62. When OFF,
   * returns the legacy getContext() window (current behavior, ~120s) — so enabling
   * the flag is the ONLY thing that changes live recall.
   */
  getMemoryWindow(seconds: number = DEFAULT_DURABLE_WINDOW_SECONDS): TranscriptContextItem[] {
    return isDurableMemoryWindowEnabled()
      ? this.getDurableWindow(seconds)
      : this.getLiveWindow(seconds);
  }

  /**
   * The current/latest interviewer question. Uses the deterministic extractor over
   * the hot window when available; otherwise falls back to the last interviewer
   * turn. Returns '' when nothing meaningful is present.
   */
  getCurrentQuestion(seconds: number = DEFAULT_ANSWER_WINDOW_SECONDS): string {
    try {
      if (this.extractQuestion) {
        const window = this.session.getContextWithInterim(seconds) ?? [];
        const extracted = this.extractQuestion(window);
        if (extracted?.latestQuestion?.trim()) return extracted.latestQuestion.trim();
      }
    } catch { /* fall through to last-interviewer-turn */ }
    try { return this.session.getLastInterviewerTurn()?.trim() || ''; } catch { return ''; }
  }

  /**
   * A lightweight, DETERMINISTIC rolling summary of the recent window — the most
   * recent interviewer turn + a compact count of who spoke. This is NOT an LLM
   * summary (the spec's <30ms budget forbids a model call here); it's a cheap
   * orientation string. The heavyweight epoch summary remains in SessionTracker for
   * the post-meeting path.
   */
  getRollingSummary(seconds: number = DEFAULT_ANSWER_WINDOW_SECONDS): string {
    const window = this.getLiveWindow(seconds);
    if (!window.length) return '';
    const interviewer = [...window].reverse().find(t => t.role === 'interviewer');
    const counts = window.reduce(
      (acc, t) => { acc[t.role] = (acc[t.role] || 0) + 1; return acc; },
      {} as Record<string, number>,
    );
    const parts: string[] = [];
    if (interviewer) {
      const q = interviewer.text.length > 160 ? `${interviewer.text.slice(0, 157)}…` : interviewer.text;
      parts.push(`Latest interviewer turn: ${q}`);
    }
    const turnSummary = Object.entries(counts).map(([role, n]) => `${n} ${role}`).join(', ');
    if (turnSummary) parts.push(`(${turnSummary} in last ${seconds}s)`);
    return parts.join(' ');
  }

  /**
   * Distinct lightweight entities mentioned in the window — capitalized tokens /
   * tech terms, deduped. Deterministic, no LLM. Useful for follow-up target hints
   * and the in-meeting search index without a model round-trip.
   */
  getTranscriptEntities(seconds: number = DEFAULT_ANSWER_WINDOW_SECONDS, max = 24): string[] {
    const window = this.getLiveWindow(seconds);
    const seen = new Set<string>();
    const out: string[] = [];
    const TOKEN_RE = /\b([A-Z][a-zA-Z0-9+#.]{2,}|[A-Za-z]+(?:\+\+|#)|[A-Za-z]{2,}\.[A-Za-z]{2,})\b/g;
    for (const turn of window) {
      let m: RegExpExecArray | null;
      TOKEN_RE.lastIndex = 0;
      while ((m = TOKEN_RE.exec(turn.text)) !== null) {
        const tok = m[1].trim();
        const key = tok.toLowerCase();
        if (key.length < 3 || seen.has(key)) continue;
        // Drop sentence-initial common words ("The", "Have", "Tell") that the
        // capitalized-token rule would otherwise mistake for entities — they're
        // noise for follow-up hints / the search index (code-review 2026-06-12 LOW).
        if (STOP_WORDS.has(key)) { seen.add(key); continue; }
        seen.add(key);
        out.push(tok);
        if (out.length >= max) return out;
      }
    }
    return out;
  }

  /**
   * One-shot assembly of everything a live answer needs from the transcript — the
   * spec's getLiveAnswerContext(). Pure, fast, and the single object a caller can
   * pass into prompt assembly.
   */
  getLiveAnswerContext(seconds: number = DEFAULT_ANSWER_WINDOW_SECONDS): LiveAnswerContext {
    const window = this.getHotWindow(seconds);
    let currentQuestion = '';
    let questionType = 'general';
    let isFollowUp = false;
    try {
      if (this.extractQuestion) {
        const extracted = this.extractQuestion(window);
        currentQuestion = extracted?.latestQuestion?.trim() || '';
        questionType = extracted?.questionType || 'general';
        isFollowUp = Boolean(extracted?.isFollowUp);
      }
    } catch { /* keep defaults */ }
    if (!currentQuestion) currentQuestion = this.getCurrentQuestion(seconds);
    return {
      window,
      currentQuestion,
      questionType,
      isFollowUp,
      rollingSummary: this.getRollingSummary(seconds),
    };
  }
}
