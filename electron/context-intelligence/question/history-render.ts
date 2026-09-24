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
  const condensed: Array<{ q: string; gist: string; from?: HistoryTurn['from'] }> = [];
  let digestSpent = 0;
  for (; i >= 0 && opts.digestBudgetChars > 0; i--) {
    const t = candidates[i];
    const q = t.q.length > CONDENSED_QUESTION_CHARS ? `${t.q.slice(0, CONDENSED_QUESTION_CHARS)}…` : t.q;
    const gist = answerGist(t.a);
    const cost = q.length + gist.length + 48;
    if (digestSpent + cost > opts.digestBudgetChars) break;
    digestSpent += cost;
    condensed.unshift({ q, gist, from: t.from });
  }

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
  const condensedText = condensed.length
    ? ['Earlier in this conversation (older exchanges, condensed — oldest first):',
      ...condensed.map((c) => `${questionLabel(c)}: ${c.q}\nAssistant: ${c.gist}`)].join('\n')
    : '';
  const text = [condensedText, fullText].filter(Boolean).join('\n\n');
  return {
    text,
    turnCount: full.length + condensed.length,
    condensedCount: condensed.length,
    carriesScreen,
    screenWithheld,
  };
}
