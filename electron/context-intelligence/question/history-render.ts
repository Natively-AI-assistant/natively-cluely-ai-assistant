// electron/context-intelligence/question/history-render.ts
//
// Renders the conversation ring into the prompt's "Conversation so far" text.
// Pure, so both call sites — typed chat (the ring IS the history) and the live
// what-to-answer / assist surfaces (the ring supplements a speech window) —
// render the same way and are tested in one place.
//
// TWO TIERS, because one flat budget could only trade recency for reach.
// Measured live (2026-09-24, tests/meeting-memory): a meeting's overlay history
// held at most 10 exchanges inside a ~2,400-token allowance, so a fact the user
// typed in the first minutes of an hour-long call was gone long before anyone
// asked about it again. Full answers are what that allowance buys the NEWEST
// turns; older turns keep the user's own words in full (that is where what
// they told the overlay lives) plus the answer's one-line gist, in a second
// allowance of the same size.
//
// Still a REFERENT, never evidence (§12.3) — this module decides what text is
// carried, not how the composer frames it.

import type { HistoryTurn } from './conversation-state';
import { tokenize } from '../retrieval/bm25';

export interface RenderHistoryOptions {
  /** Allowance for the newest exchanges, rendered in full. */
  budgetChars: number;
  /** Separate allowance for older exchanges, rendered condensed. 0 disables the tier. */
  digestBudgetChars: number;
  /** Allowance for "[screen attached that turn]" text, charged separately. */
  screenBudgetChars: number;
  /** The `screenshots` data scope is denied: screen text is neither charged nor rendered. */
  screensDenied: boolean;
  /** Turns already present elsewhere in the prompt (a live speech window). */
  exclude?: (turn: HistoryTurn) => boolean;
  /** The current question. With `recallBudgetChars`, older exchanges related to
   *  it are brought back in full (RECALL tier). */
  query?: string;
  /** Allowance for the RECALL tier. 0/absent disables it. */
  recallBudgetChars?: number;
}

export interface RenderedHistory {
  text: string;
  /** Exchanges rendered, both tiers. */
  turnCount: number;
  /** Exchanges rendered condensed. */
  condensedCount: number;
  /** A "[screen attached that turn]" line was rendered. */
  carriesScreen: boolean;
  /** A rendered turn HAD screen text that the denied scope withheld. */
  screenWithheld: boolean;
  /** Exchanges brought back by the RECALL tier. */
  recalledCount: number;
}

/** Per-turn cap on the user's words in the condensed tier. */
export const CONDENSED_QUESTION_CHARS = 600;
/** Per-turn cap on the assistant side in the condensed tier. */
export const CONDENSED_ANSWER_CHARS = 220;

const GIST_LINE_RE = /^\s*[-*•–—>]*\s*\[\[GIST\]\]\s*(.+?)\s*$/m;

/**
 * The one-line essence of an answer: its [[GIST]] line when the model wrote
 * one (promptSystemV2 asks for it on every answer past ~40 words), otherwise
 * its first sentence. Never the whole answer — the condensed tier exists to be
 * small.
 */
export function answerGist(answer: string): string {
  const a = String(answer ?? '');
  const lines = a.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(GIST_LINE_RE);
    if (m && m[1].trim()) return m[1].trim().slice(0, CONDENSED_ANSWER_CHARS);
  }
  const flat = a.replace(/\[\[GIST\]\][^\n]*/g, '').replace(/\s+/g, ' ').trim();
  const sentence = flat.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? flat;
  return sentence.slice(0, CONDENSED_ANSWER_CHARS);
}

/** Who asked. Typed-chat turns are the user's own words; a live turn's question
 *  was heard in the meeting (usually the other party), and labelling it "User:"
 *  would present the interviewer's words as the user's. */
function questionLabel(t: Pick<HistoryTurn, 'from'>): string {
  return t.from === 'meeting' ? 'Question heard in the meeting' : 'User';
}

// ── RECALL tier (2026-09-24) ────────────────────────────────────────────────
// The two tiers above carry the NEWEST exchanges; an hour-long meeting has
// ~120 of them. Measured in the app (tests/meeting-memory session-hour): a
// screenshot's text, a manual answer and a what-to-answer suggestion from the
// first minutes were in no store a follow-up could reach — typed chat, answers
// and screen analyses never enter the meeting index (speech only), and the ring
// is the only record of them. The ring now keeps the session; this tier finds
// the older exchanges a question is ABOUT and renders them in full, with their
// screen text. Lexical on purpose: in memory, no network, well under a
// millisecond per question — the per-turn term counts are cached on the
// (immutable) turn objects.

/** Per-turn cap on the recalled answer. */
export const RECALL_ANSWER_CHARS = 900;
/** Per-turn cap on a recalled turn's screen text. */
export const RECALL_SCREEN_CHARS = 1500;
/** At most this many exchanges come back per question. */
export const RECALL_MAX_TURNS = 3;
/** Minimum BM25 score: one distinctive shared term scores ~3-4. */
const RECALL_MIN_SCORE = 3;

/** Crude stem, so "screenshot" meets "screen" and "one-liner" meets "one-line". */
const stem = (w: string) => (w.length > 6 ? w.slice(0, 6) : w);
/** Words that say nothing about WHICH exchange is meant: function words, and the
 *  vocabulary of pointing back ("earlier", "remind", "told"). Within a pool of
 *  old exchanges they can look rare, so idf alone does not discount them. */
const RECALL_STOP = new Set(['the', 'and', 'for', 'you', 'your', 'yours', 'our', 'ours', 'with', 'what', 'whats',
  'how', 'why', 'who', 'when', 'where', 'which', 'would', 'could', 'should', 'will', 'can', 'did', 'does', 'was',
  'were', 'are', 'has', 'have', 'had', 'that', 'this', 'these', 'those', 'there', 'their', 'them', 'they', 'from',
  'into', 'about', 'just', 'also', 'like', 'then', 'than', 'some', 'any', 'all', 'one', 'use', 'get', 'got',
  'earlier', 'before', 'again', 'remind', 'tell', 'told', 'said', 'say', 'says', 'mention', 'mentio', 'give',
  'gave', 'back', 'going', 'went', 'previo', 'last', 'first', 'time', 'thing', 'things', 'think', 'know', 'want',
  'need', 'make', 'made', 'here', 'now', 'way', 'not', 'its', 'let', 'please', 'okay', 'right', 'well', 'really']);
const termCache = new WeakMap<HistoryTurn, { tf: Map<string, number>; len: number }>();
function termsOf(t: HistoryTurn): { tf: Map<string, number>; len: number } {
  let e = termCache.get(t);
  if (!e) {
    const words = tokenize(`${t.q} ${t.a} ${t.screen ?? ''}`).map(stem).filter((w) => !RECALL_STOP.has(w));
    const tf = new Map<string, number>();
    for (const w of words) tf.set(w, (tf.get(w) ?? 0) + 1);
    e = { tf, len: words.length };
    termCache.set(t, e);
  }
  return e;
}

/** BM25 of `query` over `pool`; returns pool indexes, best first, above the floor. */
export function rankRelatedTurns(pool: readonly HistoryTurn[], query: string): number[] {
  const qTerms = [...new Set(tokenize(query).map(stem).filter((w) => !RECALL_STOP.has(w)))];
  if (!qTerms.length || !pool.length) return [];
  const docs = pool.map(termsOf);
  const df = new Map<string, number>();
  for (const d of docs) for (const t of qTerms) if (d.tf.has(t)) df.set(t, (df.get(t) ?? 0) + 1);
  const N = docs.length;
  const avgdl = docs.reduce((n, d) => n + d.len, 0) / N || 1;
  const k1 = 1.5, b = 0.75;
  const scored = docs.map((d, i) => {
    let score = 0;
    for (const t of qTerms) {
      const f = d.tf.get(t);
      if (!f) continue;
      const n = df.get(t) ?? 0;
      const idf = Math.max(0, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (d.len / avgdl))));
    }
    return { i, score };
  }).filter((x) => x.score >= RECALL_MIN_SCORE).sort((x, y) => y.score - x.score);
  const top = scored[0]?.score ?? 0;
  return scored.filter((x) => x.score >= top * 0.5).slice(0, RECALL_MAX_TURNS).map((x) => x.i);
}

export function renderHistory(turns: readonly HistoryTurn[], opts: RenderHistoryOptions): RenderedHistory {
  const candidates = opts.exclude ? turns.filter((t) => !opts.exclude!(t)) : [...turns];
  const full: HistoryTurn[] = [];
  let spent = 0;
  let screenSpent = 0;
  let i = candidates.length - 1;
  // FULL tier, newest first. Always keep the most recent exchange even if it
  // alone overruns: dropping it would leave a follow-up with no antecedent.
  for (; i >= 0; i--) {
    const t = candidates[i];
    const cost = t.q.length + t.a.length + 32;
    if (full.length && spent + cost > opts.budgetChars) break;
    spent += cost;
    // Screen text has its OWN allowance (a screenshot must not evict the
    // user's older turns), newest screens first; a turn whose screen does not
    // fit keeps its exchange.
    const screenCost = opts.screensDenied ? 0 : (t.screen?.length ?? 0);
    if (screenCost && screenSpent + screenCost > opts.screenBudgetChars) {
      full.unshift({ ...t, screen: undefined });
      continue;
    }
    screenSpent += screenCost;
    full.unshift(t);
  }
  // CONDENSED tier: everything older, newest first, until its allowance runs out.
  const condensed: Array<{ q: string; qFull: string; gist: string; from?: HistoryTurn['from'] }> = [];
  let digestSpent = 0;
  for (; i >= 0 && opts.digestBudgetChars > 0; i--) {
    const t = candidates[i];
    const q = t.q.length > CONDENSED_QUESTION_CHARS ? `${t.q.slice(0, CONDENSED_QUESTION_CHARS)}…` : t.q;
    const gist = answerGist(t.a);
    const cost = q.length + gist.length + 48;
    if (digestSpent + cost > opts.digestBudgetChars) break;
    digestSpent += cost;
    condensed.unshift({ q, qFull: t.q, gist, from: t.from });
  }

  // RECALL tier: older exchanges (condensed or not rendered at all) that the
  // current question is about, in full with their screen text. A recalled turn
  // leaves the condensed list so it is not carried twice.
  const older = candidates.slice(0, candidates.length - full.length);
  const picked: number[] = [];
  if (opts.query && (opts.recallBudgetChars ?? 0) > 0 && older.length) {
    let recallSpent = 0;
    for (const idx of rankRelatedTurns(older, opts.query)) {
      const t = older[idx];
      const cost = t.q.length + Math.min(t.a.length, RECALL_ANSWER_CHARS)
        + (opts.screensDenied ? 0 : Math.min(t.screen?.length ?? 0, RECALL_SCREEN_CHARS)) + 48;
      if (picked.length && recallSpent + cost > opts.recallBudgetChars!) continue;
      recallSpent += cost;
      picked.push(idx);
    }
  }
  // Oldest first, like everything else in the block.
  const recalled: HistoryTurn[] = picked.sort((x, y) => x - y).map((idx) => {
    const t = older[idx];
    return {
      ...t,
      a: t.a.length > RECALL_ANSWER_CHARS ? `${t.a.slice(0, RECALL_ANSWER_CHARS)}…` : t.a,
      ...(t.screen ? { screen: t.screen.slice(0, RECALL_SCREEN_CHARS) } : {}),
    };
  });
  const recalledQs = new Set(picked.map((idx) => older[idx].q));
  const condensedShown = condensed.filter((c) => !recalledQs.has(c.qFull));

  let carriesScreen = false;
  let screenWithheld = false;
  const fullText = full.map((t) => {
    if (t.screen && opts.screensDenied) screenWithheld = true;
    const showScreen = Boolean(t.screen) && !opts.screensDenied;
    if (showScreen) carriesScreen = true;
    return [
      `${questionLabel(t)}: ${t.q}`,
      // The screenshot the user attached on that turn, as text. The image is
      // long gone from the payload by now; this is all a follow-up has.
      ...(showScreen ? [`[screen attached that turn] ${t.screen}`] : []),
      `Assistant: ${t.a}`,
    ].join('\n');
  }).join('\n\n');
  const condensedText = condensedShown.length
    ? ['Earlier in this conversation (older exchanges, condensed — oldest first):',
      ...condensedShown.map((c) => `${questionLabel(c)}: ${c.q}\nAssistant: ${c.gist}`)].join('\n')
    : '';
  const recalledText = recalled.length
    ? ['Earlier in this session, related to this question (older exchanges, oldest first):',
      ...recalled.map((t) => {
        if (t.screen && opts.screensDenied) screenWithheld = true;
        const showScreen = Boolean(t.screen) && !opts.screensDenied;
        if (showScreen) carriesScreen = true;
        return [
          `${questionLabel(t)}: ${t.q}`,
          ...(showScreen ? [`[screen attached that turn] ${t.screen}`] : []),
          `Assistant: ${t.a}`,
        ].join('\n');
      })].join('\n\n')
    : '';
  const text = [recalledText, condensedText, fullText].filter(Boolean).join('\n\n');
  return {
    text,
    turnCount: full.length + condensedShown.length + recalled.length,
    condensedCount: condensedShown.length,
    carriesScreen,
    screenWithheld,
    recalledCount: recalled.length,
  };
}
