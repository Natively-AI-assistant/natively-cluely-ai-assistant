// electron/llm/positionList.ts
//
// Questions that ask for a list of positions (#776): "what should be the
// first line, middle line, last line?" asks for three things with a single
// wh-word and no chain of question marks, so clause-based detectors read it as
// one question. The parts are the positions themselves.
//
// Their content terms can't measure coverage either: the shared noun ("line")
// is in every part, and an answer marks a position with its own words
// ("then", "finally") or with a numbered item, not by repeating the question's.
// So each position carries the words an answer uses for it.
//
// Used by the answer prompt (answerStyle.ts: name the parts so the model
// answers each one) and by the coverage check (documentGroundedPrompt.ts).

export type PositionSlot = 'first' | 'second' | 'third' | 'middle' | 'last';

export interface PositionPart {
  slot: PositionSlot;
  /** The position with the noun the question names: "first line", "last instructions". */
  label: string;
}

const POSITION_WORD_TO_SLOT: Record<string, PositionSlot> = {
  first: 'first', second: 'second', third: 'third', middle: 'middle', last: 'last', final: 'last',
};

// Words that mark a position wherever they appear.
const STRONG_MARKERS: Record<PositionSlot, readonly string[]> = {
  first: ['first', 'firstly'],
  second: ['second', 'secondly'],
  third: ['third', 'thirdly'],
  middle: ['middle'],
  last: ['last', 'lastly', 'final', 'finally'],
};
// Words that are ordinary filler mid-sentence ("in the end", "at the top",
// "next to") and mark a position only when they open a clause ("Then RUN …",
// ", next COPY …") or lead "with"/"by" ("ends with CMD", "start by …").
const WEAK_MARKERS: Record<PositionSlot, readonly string[]> = {
  first: ['start', 'starts', 'begin', 'begins', 'opening', 'top', 'initially'],
  second: ['next', 'then'],
  third: ['next', 'then'],
  middle: ['next', 'then', 'between'],
  last: ['end', 'ends', 'bottom', 'closing'],
};

const POSITION_WORD = '(?:first|second|third|middle|last|final)';
// The noun is never a joiner word, or "first, middle and last" would end at "middle and".
const POSITION_ITEM = `(?:the\\s+)?(?<![\\w-])${POSITION_WORD}(?![\\w-])(?:\\s+(?!(?:and|then|or)\\b)[a-z]+)?`;
// Joiners between list items. "or" is not one: "the first or second approach"
// is a choice between two, not a request for both.
const LIST_JOINER = '(?:\\s*,\\s*(?:and\\s+|then\\s+)?|\\s+and(?:\\s+then)?\\s+|\\s+then\\s+)';
const POSITION_LIST_RE = new RegExp(`${POSITION_ITEM}(?:${LIST_JOINER}${POSITION_ITEM})+`, 'i');
// Ordinary phrases that pair two positions without asking for two parts.
const POSITION_IDIOM_RE = /\bfirst\s+(?:and|&)\s+last\s+names?\b/i;
const NOT_A_PART_NOUN = new Set(['and', 'or', 'then', 'the', 'like', 'at', 'in', 'of', 'one', 'is', 'be']);

/**
 * The positions a question asks for, in order, each labelled with the noun it
 * names ("first line", "middle line", "last line"). Read from the list itself,
 * not from position words elsewhere in the question. Empty unless at least two
 * distinct positions are joined as a list.
 */
export function extractPositionParts(question: string): PositionPart[] {
  const q = String(question || '');
  const m = POSITION_LIST_RE.exec(q);
  if (!m) return [];
  const span = m[0];
  if (POSITION_IDIOM_RE.test(span)) return [];
  // "the first, second, or third one?" ends as a choice.
  if (/^\s*,?\s*or\s/i.test(q.slice(m.index + span.length))) return [];
  const found: Array<{ slot: PositionSlot; word: string; noun?: string }> = [];
  const re = new RegExp(`(?<![\\w-])(${POSITION_WORD})(?![\\w-])(?:\\s+([a-z]+))?`, 'gi');
  for (const item of span.matchAll(re)) {
    const word = item[1].toLowerCase();
    const slot = POSITION_WORD_TO_SLOT[word];
    if (found.some((f) => f.slot === slot)) continue;
    const noun = item[2] && !NOT_A_PART_NOUN.has(item[2].toLowerCase()) ? item[2].toLowerCase() : undefined;
    found.push({ slot, word, noun });
  }
  if (found.length < 2) return [];
  // "first, middle and last instructions": the one named noun applies to all.
  const sharedNoun = found.find((f) => f.noun)?.noun;
  return found.map((f) => ({ slot: f.slot, label: [f.word, f.noun ?? sharedNoun].filter(Boolean).join(' ') }));
}

/** Whether the answer marks this position in words. Whole words only. */
export function answerMarksPosition(answer: string, slot: PositionSlot): boolean {
  const a = String(answer || '').toLowerCase();
  if (STRONG_MARKERS[slot].some((w) => new RegExp(`(?<![\\w-])${w}(?![\\w-])`).test(a))) return true;
  return WEAK_MARKERS[slot].some((w) =>
    new RegExp(`(?:^|[\\n.;:!?,(]\\s*|\\band\\s+)${w}(?![\\w-])|(?<![\\w-])${w}\\s+(?:with|by)\\b`).test(a));
}

/**
 * How many list items the answer has: line-leading numbers or bullets, or an
 * inline run "1) … 2) … 3) …" counted from 1.
 */
export function answerListItemCount(answer: string): number {
  const a = String(answer || '');
  const lineItems = (a.match(/^[ \t]*(?:\d{1,2}[.)]|[-*•])[ \t]+\S/gm) || []).length;
  const numbers = new Set<number>();
  for (const m of a.matchAll(/(?:^|\s)(\d{1,2})[.)]\s+\S/g)) numbers.add(Number(m[1]));
  let run = 0;
  while (numbers.has(run + 1)) run++;
  return Math.max(lineItems, run);
}

/**
 * The parts an answer leaves out. A list item covers the part at its place
 * (item 1 the first part, and so on), so a numbered answer in the asked order
 * needs no position words; otherwise the answer's words decide.
 */
export function missingPositionLabels(answer: string, parts: readonly PositionPart[]): string[] {
  const items = answerListItemCount(answer);
  return parts
    .filter((p, i) => i >= items && !answerMarksPosition(answer, p.slot))
    .map((p) => p.label);
}
