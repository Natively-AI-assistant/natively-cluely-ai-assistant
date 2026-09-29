// electron/llm/interimInjectionGuard.ts
//
// RC-1 (live shadow session C, 2026-08-21): shared guard for injecting the
// rolling interim interviewer transcript into an LLM context window.
//
// Why this exists: the Natively STT relay was observed sending CUMULATIVE
// interim results — a single interim that grew monotonically from 21 to
// 10,126 chars across a 56-minute session instead of resetting per utterance.
// The two injection sites (IntelligenceEngine's What-to-Answer path and
// SessionTracker.getContextWithInterim) guarded only with exact-equality or a
// 1-second timestamp window, so the whole-session blob was appended as the
// "newest interviewer turn" and extractLatestQuestion returned it verbatim as
// the question (measured: 86/86 injected presses had question === interim;
// 0/66 non-injected presses produced a blob question). Downstream, 20/85
// answers froze on the opening monologue and 17 routed into
// ethical_usage_answer via a cross-sentence stealth-classifier false positive.
//
// The resolver is deliberately provider-agnostic and platform-independent
// (pure function, injectable clock): whether the cumulative interim came from
// the relay, Deepgram, or a future Windows-only provider, the client must
// never forward more than the NOVEL portion of an interim into the prompt.
//
// Decision order:
//   1. empty        -> skip
//   2. stale        -> skip  (interims are in-flight speech; a dead one is noise)
//   3. duplicate    -> skip  (legacy guard preserved: exact text match, or the
//                             last interviewer item landed within 1s — the
//                             final for this same utterance already arrived)
//   4. containment  -> find the newest final whose tail-anchor occurs in the
//                      interim; everything up to and including that anchor is
//                      already covered by finals, so inject only what follows
//                      (the novel tail). Empty tail -> skip.
//   5. length cap   -> backstop for a cumulative interim no anchor matched
//                      (e.g. finals lost, or interim/final wording diverged):
//                      inject only the last MAX chars, cut at a word boundary,
//                      so the live question at the END always survives.

export interface InterimInjectionInterim {
  text: string;
  timestamp: number;
}

export interface InterimInjectionContextItem {
  role: string;
  text: string;
  timestamp: number;
}

export interface InterimInjectionInput {
  interim: InterimInjectionInterim;
  /** Interviewer finals already in the context window, oldest -> newest. */
  recentInterviewerFinals: ReadonlyArray<InterimInjectionContextItem>;
  /** The last item of the context window the interim would be appended to. */
  lastContextItem: InterimInjectionContextItem | null | undefined;
  now: number;
}

export type InterimInjectionResult =
  | { action: 'inject'; text: string; reason: 'fresh' | 'novel_tail' | 'length_capped_tail' }
  | { action: 'skip'; reason: 'empty' | 'stale' | 'duplicate' | 'no_novel_content' };

/**
 * Hard ceiling on injected interim length. A real utterance-scoped interim is
 * one person's in-flight sentence(s); in the measured sessions per-utterance
 * finals ran 5–107 chars and long monologue turns a few hundred. 1200 leaves
 * generous headroom for a genuinely long spoken turn while making a
 * session-cumulative blob (measured up to 10,126 chars) impossible to forward.
 */
export const MAX_INTERIM_INJECTION_CHARS = 1200;

/**
 * An interim older than this is dead speech — its utterance either finalized
 * (and the final cleared it) or the provider abandoned it. Cumulative interims
 * refresh their timestamp on every partial, so this only skips genuinely
 * stale leftovers, never an active stream.
 */
export const INTERIM_STALE_MS = 30_000;

/** Anchors need enough signal to be safe: at least this many words... */
const MIN_ANCHOR_WORDS = 3;
/** ...and at least this many normalized chars, so "so is it ok" can't chop. */
const MIN_ANCHOR_CHARS = 10;
/** Tail-anchor length taken from each final (its last N words). */
const ANCHOR_WORDS = 8;
/** Only the newest finals are worth scanning; older ones can't cut more. */
const MAX_FINALS_SCANNED = 10;

interface Token { word: string; start: number; end: number }

// Unicode-aware tokenization (transcripts carry non-Latin scripts — measured
// Malayalam turns mid-session). Apostrophes are stripped in the normalized
// word so "what's" (final) anchors against "whats" (interim).
const TOKEN_RE = /[\p{L}\p{N}']+/gu;

const tokenize = (text: string): Token[] => {
  const out: Token[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    out.push({ word: m[0].toLowerCase().replace(/'/g, ''), start: m.index, end: m.index + m[0].length });
  }
  return out;
};

/** Last occurrence of `anchor` (word sequence) in `tokens`; -1 when absent. */
const lastAnchorMatchEnd = (tokens: readonly Token[], anchor: readonly string[]): number => {
  for (let i = tokens.length - anchor.length; i >= 0; i--) {
    let hit = true;
    for (let j = 0; j < anchor.length; j++) {
      if (tokens[i + j].word !== anchor[j]) { hit = false; break; }
    }
    if (hit) return tokens[i + anchor.length - 1].end;
  }
  return -1;
};

/** Cut `text` down to its last MAX chars, starting at a word boundary. */
const capToWordBoundaryTail = (text: string): string => {
  if (text.length <= MAX_INTERIM_INJECTION_CHARS) return text;
  const roughStart = text.length - MAX_INTERIM_INJECTION_CHARS;
  const boundary = text.indexOf(' ', roughStart);
  return text.slice(boundary === -1 ? roughStart : boundary + 1).trim();
};

export function resolveInterimInjection(input: InterimInjectionInput): InterimInjectionResult {
  const raw = String(input.interim?.text ?? '');
  const trimmed = raw.trim();
  if (!trimmed) return { action: 'skip', reason: 'empty' };

  if (input.now - input.interim.timestamp > INTERIM_STALE_MS) {
    return { action: 'skip', reason: 'stale' };
  }

  // Legacy duplicate guard, preserved byte-for-byte in behavior: the final for
  // this same utterance already landed as the last context item.
  const last = input.lastContextItem;
  if (last && last.role === 'interviewer'
    && (last.text === raw || Math.abs(last.timestamp - input.interim.timestamp) < 1000)) {
    return { action: 'skip', reason: 'duplicate' };
  }

  const interimTokens = tokenize(trimmed);
  if (interimTokens.length === 0) return { action: 'skip', reason: 'empty' };

  // Containment: newest final first — the newest match cuts the most.
  const finalsNewestFirst = input.recentInterviewerFinals.slice(-MAX_FINALS_SCANNED).reverse();
  for (const fin of finalsNewestFirst) {
    const finTokens = tokenize(fin.text);
    if (finTokens.length < MIN_ANCHOR_WORDS) continue;
    const anchor = finTokens.slice(-ANCHOR_WORDS).map((t) => t.word);
    if (anchor.join('').length < MIN_ANCHOR_CHARS) continue;
    const matchEnd = lastAnchorMatchEnd(interimTokens, anchor);
    if (matchEnd === -1) continue;

    // Everything up to and including the anchor is already covered by finals.
    const tail = trimmed.slice(matchEnd).replace(/^[\s.,;:!?…]+/u, '').trim();
    if (!tail) return { action: 'skip', reason: 'no_novel_content' };
    return { action: 'inject', text: capToWordBoundaryTail(tail), reason: 'novel_tail' };
  }

  // No anchor matched. A small interim is genuinely fresh speech; a huge one
  // is cumulative with unmatchable finals — keep only the tail, where the
  // live question lives.
  if (trimmed.length <= MAX_INTERIM_INJECTION_CHARS) {
    return { action: 'inject', text: trimmed, reason: 'fresh' };
  }
  return { action: 'inject', text: capToWordBoundaryTail(trimmed), reason: 'length_capped_tail' };
}
