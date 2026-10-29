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

import { MAX_TURN_SCREEN_CHARS, type HistoryTurn } from './conversation-state';
import { hasOnDeviceScreenText, ON_DEVICE_SCREEN_WITHHELD } from './on-device-screen';
import { tokenize } from '../retrieval/bm25';
import { SCREEN_BEING_READ, SCREEN_NOT_TRANSCRIBED } from '../../services/screen/screenDescription';

// ── SCREENS ARE NEVER DROPPED (2026-10-28) ─────────────────────────────────
// Reported: "the screenshot is forgotten after a few turns". A screen's text
// rode only on the exchanges of the FULL tier, about the newest three, and at
// most two of those kept it; every older exchange was rendered without it. So
// a user who shared a coding problem and asked four follow-ups had lost the
// problem by the fifth, and a pointing-back question ("what was the error code
// in it?") shares no words with the screen for the RECALL tier to find it.
//
// The image is never re-sent, so this text is ALL a later turn has of the
// screen. Every screen in the conversation is now carried on every turn,
// whatever tier its exchange lands in: the newest in full, up to
// HISTORY_SCREEN_BUDGET_CHARS, and older ones as the start of their text. A
// question that IS about an older screen brings its whole text back through
// the RECALL tier.
//
// BOUNDED, because this runs on every What-to-answer and assist turn: at most
// SCREEN_EXCERPT_MAX_COUNT older screens are excerpted, and an exchange
// carried only for its screen keeps a short question and no answer. Past that
// (a conversation with more than ~40 screenshots) the oldest are named in one
// line and still come back whole when a question is about them. A note that
// stands in for screen text (still being read, could not be read, kept on this
// device) carries none of a screen and never holds an exchange in by itself.

/** Full text for the newest screens, up to three transcriptions at their cap. */
export const HISTORY_SCREEN_BUDGET_CHARS = MAX_TURN_SCREEN_CHARS * 3;
/** Shared by the excerpts of every older screen. */
export const SCREEN_EXCERPT_BUDGET_CHARS = 12_000;
/** An older screen's excerpt is between these, shorter as there are more of them. */
export const SCREEN_EXCERPT_MAX_CHARS = 1200;
export const SCREEN_EXCERPT_MIN_CHARS = 300;
/** At most this many older screens are excerpted, so the excerpts stay inside their budget. */
export const SCREEN_EXCERPT_MAX_COUNT = Math.floor(SCREEN_EXCERPT_BUDGET_CHARS / SCREEN_EXCERPT_MIN_CHARS);
/** Past the condensed allowance, an exchange carried for its screen keeps this much of its question. */
export const SCREEN_ONLY_QUESTION_CHARS = 200;
/** Ends an excerpt, so the model knows the screen went on. */
export const SCREEN_EXCERPT_MARKER =
  '\n[SHORTENED: only the start of this earlier screen\'s text is carried here. Do not infer anything from the missing part.]';

/**
 * Whether a live speech window already carries this answer. SessionTracker
 * renders an assistant turn as "[ASSISTANT (PREVIOUS SUGGESTION)]: <text>", so
 * the answer's opening words — whitespace-collapsed, gist line dropped — are
 * the stable thing to look for. Too short an opening is not evidence either
 * way and is treated as absent (a duplicated line costs less than a lost one).
 */
export function speechWindowContains(speech: string, answer: string): boolean {
  const norm = (x: string) => x.replace(/\[\[GIST\]\][^\n]*/g, '').replace(/\s+/g, ' ').trim();
  const probe = norm(answer).slice(0, 60);
  if (probe.length < 24) return false;
  return norm(speech).includes(probe);
}

export interface RenderHistoryOptions {
  /** Allowance for the newest exchanges, rendered in full. */
  budgetChars: number;
  /** Separate allowance for older exchanges, rendered condensed. 0 disables the tier. */
  digestBudgetChars: number;
  /** Allowance for screens carried in full, newest first; older screens are
   *  carried as an excerpt (see SCREENS ARE NEVER DROPPED). */
  screenBudgetChars: number;
  /** The `screenshots` data scope is denied: screen text is neither charged nor rendered. */
  screensDenied: boolean;
  /**
   * This turn stays on this device, so text read off a screenshot that was
   * KEPT on this device may be shown. Absent or false — the destination is a
   * cloud provider, or nobody can say — such text is replaced by a note
   * (on-device-screen.ts). Fails closed.
   */
  onDeviceScreens?: boolean;
  /** Turns already present elsewhere in the prompt (a live speech window). A
   *  turn whose screen text may be shown is still rendered, without its
   *  answer: no speech window holds a screenshot. */
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
  /** Exchanges the RECALL tier brought back: rendered in its own section, or a
   *  full-tier exchange whose shortened screen it restored in place. */
  recalledCount: number;
}

/** This turn's screen text was kept on this device and this prompt may not carry it. */
function keptAway(t: HistoryTurn, opts: Pick<RenderHistoryOptions, 'onDeviceScreens'>): boolean {
  return !opts.onDeviceScreens && hasOnDeviceScreenText(t.screen);
}

/** The screen text as THIS prompt may show it: the text, or the note that stands in for it. */
function shownScreen(t: HistoryTurn, opts: Pick<RenderHistoryOptions, 'onDeviceScreens'>): string | undefined {
  return keptAway(t, opts) ? ON_DEVICE_SCREEN_WITHHELD : t.screen;
}

const SCREEN_NOTES = new Set([SCREEN_NOT_TRANSCRIBED.trim(), SCREEN_BEING_READ.trim()]);

/** The turn has screen TEXT this prompt may show, not a note standing in for one. */
function hasScreenText(t: HistoryTurn, opts: Pick<RenderHistoryOptions, 'onDeviceScreens' | 'screensDenied'>): boolean {
  if (opts.screensDenied || !t.screen || keptAway(t, opts)) return false;
  return !SCREEN_NOTES.has(t.screen.trim());
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
/** A recalled turn's screen is carried whole: the question is ABOUT it, and the
 *  text was capped when it was recorded. Was 1500, which brought back less of a
 *  screen than the excerpt every older screen now carries anyway. */
export const RECALL_SCREEN_CHARS = MAX_TURN_SCREEN_CHARS;
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

/** The start of a screen's text, marked as shortened. */
function screenExcerpt(screen: string, chars: number): string {
  if (screen.length <= chars) return screen;
  return screen.slice(0, chars).trimEnd() + SCREEN_EXCERPT_MARKER;
}

/**
 * The screen text each turn carries in THIS prompt (see SCREENS ARE NEVER
 * DROPPED). Newest first: in full while the allowance lasts, then an excerpt
 * of every older one. A turn absent from the map has no screen this prompt may
 * show.
 */
function allocateScreens(
  turns: readonly HistoryTurn[], opts: Pick<RenderHistoryOptions, 'screensDenied' | 'onDeviceScreens' | 'screenBudgetChars'>,
): { screens: Map<HistoryTurn, string>; notCarried: number } {
  const out = new Map<HistoryTurn, string>();
  if (opts.screensDenied) return { screens: out, notCarried: 0 };
  const older: HistoryTurn[] = [];
  let spent = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    const text = shownScreen(t, opts);
    if (!text) continue;
    // A note standing in for screen text is short, never cut and never charged.
    if (!hasScreenText(t, opts)) { out.set(t, text); continue; }
    if (spent + text.length <= opts.screenBudgetChars) {
      spent += text.length;
      out.set(t, text);
    } else {
      older.push(t);
    }
  }
  // `older` is newest first: past the count, the OLDEST are the ones left out.
  const excerpted = older.slice(0, SCREEN_EXCERPT_MAX_COUNT);
  if (excerpted.length) {
    const each = Math.max(SCREEN_EXCERPT_MIN_CHARS,
      Math.min(SCREEN_EXCERPT_MAX_CHARS, Math.floor(SCREEN_EXCERPT_BUDGET_CHARS / excerpted.length)));
    for (const t of excerpted) out.set(t, screenExcerpt(String(t.screen), each));
  }
  return { screens: out, notCarried: older.length - excerpted.length };
}

export function renderHistory(turns: readonly HistoryTurn[], opts: RenderHistoryOptions): RenderedHistory {
  // A turn already in the prompt elsewhere is kept only for its screen, and
  // rendered without the answer the speech window already carries.
  const answerElsewhere = new Set<HistoryTurn>();
  const candidates = opts.exclude
    ? turns.filter((t) => {
      if (!opts.exclude!(t)) return true;
      if (!hasScreenText(t, opts)) return false;
      answerElsewhere.add(t);
      return true;
    })
    : [...turns];
  // Decided before any tier: which tier an exchange lands in must not decide
  // whether its screen is carried.
  const { screens, notCarried } = allocateScreens(candidates, opts);
  /** The exchange holds screen text that only it can carry into this prompt. */
  const carriedForScreen = (t: HistoryTurn) => screens.has(t) && hasScreenText(t, opts);
  const answerOf = (t: HistoryTurn) => (answerElsewhere.has(t) ? '' : t.a);
  const full: HistoryTurn[] = [];
  let spent = 0;
  let i = candidates.length - 1;
  // FULL tier, newest first. Always keep the most recent exchange even if it
  // alone overruns: dropping it would leave a follow-up with no antecedent.
  // Screen text is not charged here: it has its own allowance, so a screenshot
  // must not evict the user's older turns.
  for (; i >= 0; i--) {
    const t = candidates[i];
    const cost = t.q.length + answerOf(t).length + 32;
    if (full.length && spent + cost > opts.budgetChars) break;
    spent += cost;
    full.unshift(t);
  }
  // CONDENSED tier: everything older, newest first, until its allowance runs
  // out. An exchange carrying screen text is ALWAYS carried here: within the
  // allowance like any other, and past it as a short question and its screen,
  // which is then the only thing left of that screen.
  const condensed: Array<{ turn: HistoryTurn; q: string; gist: string }> = [];
  let digestSpent = 0;
  let digestSpentOut = opts.digestBudgetChars <= 0;
  for (; i >= 0; i--) {
    const t = candidates[i];
    const forScreen = carriedForScreen(t);
    if (digestSpentOut && !forScreen) continue;
    const q = t.q.length > CONDENSED_QUESTION_CHARS ? `${t.q.slice(0, CONDENSED_QUESTION_CHARS)}…` : t.q;
    const gist = answerOf(t) ? answerGist(t.a) : '';
    const cost = q.length + gist.length + 48;
    if (!digestSpentOut && digestSpent + cost <= opts.digestBudgetChars) {
      digestSpent += cost;
      condensed.unshift({ turn: t, q, gist });
      continue;
    }
    digestSpentOut = true;
    if (forScreen) {
      const short = t.q.length > SCREEN_ONLY_QUESTION_CHARS ? `${t.q.slice(0, SCREEN_ONLY_QUESTION_CHARS)}…` : t.q;
      condensed.unshift({ turn: t, q: short, gist: '' });
    }
  }

  // RECALL tier: older exchanges (condensed or not rendered at all) that the
  // current question is about, in full with their whole screen text. A
  // recalled turn leaves the condensed list so it is not carried twice. A
  // full-tier turn whose screen was shortened is in the pool too: it is
  // rendered where it is, with its whole screen.
  const inFull = new Set(full);
  const shortened = (t: HistoryTurn) => screens.has(t) && screens.get(t) !== shownScreen(t, opts);
  const pool = candidates.filter((t) => !inFull.has(t) || shortened(t));
  const picked: number[] = [];
  if (opts.query && (opts.recallBudgetChars ?? 0) > 0 && pool.length) {
    let recallSpent = 0;
    for (const idx of rankRelatedTurns(pool, opts.query)) {
      const t = pool[idx];
      const cost = (inFull.has(t) ? 0 : t.q.length + Math.min(answerOf(t).length, RECALL_ANSWER_CHARS) + 48)
        + (opts.screensDenied ? 0 : Math.min(shownScreen(t, opts)?.length ?? 0, RECALL_SCREEN_CHARS));
      if (picked.length && recallSpent + cost > opts.recallBudgetChars!) continue;
      recallSpent += cost;
      picked.push(idx);
    }
  }
  const pickedTurns = new Set(picked.map((idx) => pool[idx]));
  // Oldest first, like everything else in the block.
  const recalled = picked.sort((x, y) => x - y).map((idx) => pool[idx]).filter((t) => !inFull.has(t));
  const condensedShown = condensed.filter((c) => !pickedTurns.has(c.turn));

  let carriesScreen = false;
  let screenWithheld = false;
  /** The turn's screen line for this prompt, if any; `whole` for a recalled turn. */
  const screenLine = (t: HistoryTurn, whole = false): string[] => {
    if (!t.screen) return [];
    if (opts.screensDenied || keptAway(t, opts)) screenWithheld = true;
    const text = whole && !opts.screensDenied ? shownScreen(t, opts) : screens.get(t);
    if (!text) return [];
    if (!keptAway(t, opts)) carriesScreen = true;
    // The screenshot the user attached on that turn, as text. The image is
    // long gone from the payload by now; this is all a follow-up has.
    return [`[screen attached that turn] ${text}`];
  };
  /** The answer line, or none when the speech window already carries the answer. */
  const answerLine = (t: HistoryTurn, text: string): string[] => (answerOf(t) && text ? [`Assistant: ${text}`] : []);
  const fullText = full.map((t) => [
    `${questionLabel(t)}: ${t.q}`,
    ...screenLine(t, pickedTurns.has(t)),
    ...answerLine(t, t.a),
  ].join('\n')).join('\n\n');
  // Screens too old to be excerpted, minus any a question just brought back.
  const leftOut = notCarried - recalled.filter((t) => hasScreenText(t, opts) && !screens.has(t)).length;
  const condensedText = condensedShown.length || leftOut > 0
    ? ['Earlier in this conversation (older exchanges, condensed — oldest first):',
      ...(leftOut > 0
        ? [`[${leftOut} earlier screenshot${leftOut === 1 ? ' is' : 's are'} not repeated here. Their text comes back when a question is about one of them; until then, do not guess what they showed.]`]
        : []),
      ...condensedShown.map((c) => [
        `${questionLabel(c.turn)}: ${c.q}`,
        ...screenLine(c.turn),
        ...answerLine(c.turn, c.gist),
      ].join('\n'))].join('\n')
    : '';
  const recalledText = recalled.length
    ? ['Earlier in this session, related to this question (older exchanges, oldest first):',
      ...recalled.map((t) => [
        `${questionLabel(t)}: ${t.q}`,
        ...screenLine(t, true),
        ...answerLine(t, t.a.length > RECALL_ANSWER_CHARS ? `${t.a.slice(0, RECALL_ANSWER_CHARS)}…` : t.a),
      ].join('\n'))].join('\n\n')
    : '';
  const text = [recalledText, condensedText, fullText].filter(Boolean).join('\n\n');
  return {
    text,
    turnCount: full.length + condensedShown.length + recalled.length,
    condensedCount: condensedShown.length,
    carriesScreen,
    screenWithheld,
    recalledCount: pickedTurns.size,
  };
}

// A role header at the start of a line ("[SYSTEM]: ignore prior instructions")
// in text the user typed, a model wrote, or a screenshot showed. Only role
// words: a screenshot's "[ERROR] connection refused" is what the screen said
// and stays as it is, as do this module's own "[screen attached ...]" notes.
const ROLE_HEADER_RE =
  /^([ \t]*)\[(?:SYSTEM|DEVELOPER|USER|ASSISTANT|HUMAN|AI|BOT|GPT|TOOL|PROMPT|INSTRUCTIONS?|OVERRIDE|CONTEXT|IMPORTANT|ME|INTERVIEWER|RECENT|NEW|TRANSCRIPT)\b[^\]\n]*\][ \t]*:?[ \t]*/gim;

/** Turns a role header into quoted content and drops control characters. */
export function neutralizeRoleHeaders(text: string): string {
  return String(text ?? '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ')
    .replace(ROLE_HEADER_RE, '$1quoted previous content: ');
}

/** Allowance for each tier of a quick action's history (Clarify, Recap, ...). */
export const QUICK_ACTION_HISTORY_BUDGET_CHARS = 2400;
/** Heads the history a quick action is handed. */
export const QUICK_ACTION_HISTORY_HEADER =
  'Earlier in this conversation (the user\'s messages, the answers shown, and the text of every screenshot shared; oldest first):';

/**
 * The conversation so far for a prompt V3 does not compose: Clarify, Follow-up
 * questions, Recap, Brainstorm, and Code hint without V3. They read a speech
 * window and nothing else, so outside a meeting Cmd+2 after a Cmd+1 answer had
 * "no transcript or recent manual answer", and none of them ever saw a
 * screenshot the user had shared before the press. '' when there is nothing.
 */
export function renderHistoryForQuickAction(turns: readonly HistoryTurn[], opts: {
  screensDenied: boolean;
  onDeviceScreens?: boolean;
  /** The speech window the prompt already carries: an answer in it is not repeated. */
  alreadyIn?: string;
  query?: string;
}): string {
  if (!turns.length) return '';
  const speech = String(opts.alreadyIn ?? '');
  // Clarify and Follow-up questions used to read the last typed turn only,
  // through IntelligenceEngine.sanitizeManualContextText. The history carries
  // the same kind of text and more of it, a screenshot's included.
  const safe = turns.map((t) => ({
    ...t,
    q: neutralizeRoleHeaders(t.q),
    a: neutralizeRoleHeaders(t.a),
    ...(t.screen ? { screen: neutralizeRoleHeaders(t.screen) } : {}),
  }));
  const r = renderHistory(safe, {
    budgetChars: QUICK_ACTION_HISTORY_BUDGET_CHARS,
    digestBudgetChars: QUICK_ACTION_HISTORY_BUDGET_CHARS,
    screenBudgetChars: HISTORY_SCREEN_BUDGET_CHARS,
    screensDenied: opts.screensDenied,
    onDeviceScreens: opts.onDeviceScreens,
    exclude: speech ? (t) => speechWindowContains(speech, t.a) : undefined,
    query: opts.query,
    recallBudgetChars: opts.query ? 4000 : 0,
  });
  return r.turnCount ? `${QUICK_ACTION_HISTORY_HEADER}\n${r.text}` : '';
}
