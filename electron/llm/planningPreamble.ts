// electron/llm/planningPreamble.ts
//
// RC-6 (live shadow session C, 2026-08-21): the model sometimes opens a
// What-to-Answer response with its own DELIBERATION — planning notes addressed
// to itself, not spoken content:
//
//   "Since the interviewer is asking directly about what I built in Natively,
//    and the résumé shows me as the builder of the whole project (16,000+
//    users, $25K+ revenue…), I should answer in my own voice describing what I
//    personally built. The prior assistant turn already established the
//    product story, so this should go deeper…"  → then the real answer.
//
// Live presses 5/13/20/47 all shipped this; press 5 additionally leaked résumé
// figures inside the meta-commentary. Every existing guard was a no-op on the
// verbatim text (measured): the scaffold detector needs ≥2 markdown headings,
// the candidate sanitizer's markers only match assistant-IDENTITY phrasing
// ("as an AI model"), and detectAssistantVoiceMisfire targets misfired
// identity replies. Nothing recognized self-directed planning prose.
//
// This module strips LEADING planning sentences deterministically — sentence
// by sentence from the top, stopping at the first sentence that reads as real
// answer content. Conservative on purpose:
//   - only the answer's OPENING run of sentences is ever touched; a mid-answer
//     "I should mention…" is content and stays;
//   - a sentence must carry an explicit deliberation frame (the interviewer
//     is asking / I should answer / let me answer with / the résumé shows me)
//     to be stripped;
//   - if stripping would empty the answer, the original is returned unchanged
//     (fail-open — a wrong answer is worse than a leaky one).

/** Optional discourse lead-ins a planning sentence may open with, chained up
 *  to twice ("Okay, so I should frame…"). Measured miss 2026-09-30: the old
 *  single lead-in never matched "Okay, so I should…". */
const LEAD = String.raw`(?:(?:so|okay|ok|now|first|alright|well|and|since),?\s+){0,2}`;

/** Sentence-level deliberation frames. Each must be a PLANNING statement about
 * the exchange itself, never plausible first-person spoken content. Matched
 * against a quote-normalized copy (’ → ') so "I’ll answer" counts too. */
const PLANNING_SENTENCE_RES: RegExp[] = [
  // "Since/So the interviewer is asking/pushing/probing…" — narration of the
  // interviewer's move. A candidate never says this aloud.
  /^(?:since|so|okay,?\s*so|now,?\s*)?\s*the interviewer (?:is|was|'s|seems|keeps?|just)\s+(?:asking|pushing|probing|looking|trying|wanting|testing|drilling|really)/i,
  // Self-directed answer planning: "I should answer…", "I'll answer with…",
  // "Let me answer…". Code-review 2026-08-22, two fixes in one:
  //   1. the old alternation required a SPACE before the contraction
  //      ("I 'll"), so "I'll answer…" — a documented live-leak shape — could
  //      never match;
  //   2. it was unanchored with content-capable verbs (address/focus/keep/
  //      describe), so a legitimate opener like "In this role I will address
  //      scalability by…" was silently deleted. Now anchored to the sentence
  //      start (with an optional short discourse lead-in) and restricted to
  //      verbs that are about ANSWERING itself, never about the subject
  //      matter.
  new RegExp(`^${LEAD}I(?:'ll|'m going to|\\s+(?:should|will|need to|want to|am going to))\\s+(?:answer|respond|reply|frame|structure|go deeper)\\b`, 'i'),
  /^let me answer\b/i,
  // 2026-09-30 misses (none of the frames above matched them). Each names the
  // asker or the question as its SUBJECT — narration about the exchange:
  //   "The interviewer's question is about scaling."
  new RegExp(`^${LEAD}(?:the )?interviewer's (?:question|ask|prompt) (?:is|was|asks|seems|boils|really)\\b`, 'i'),
  //   "The interviewer wants to know / wants me to…"
  new RegExp(`^${LEAD}the interviewer (?:wants|would like|wanted) (?:to know|to hear|me to|us to)\\b`, 'i'),
  //   "The user is asking…", "So the user wants me to…". "The user base grew"
  //   and "The user wants a faster checkout" are content and stay: the verb
  //   must be about the ASK, not about users.
  new RegExp(`^${LEAD}the user(?:'s question)? (?:is|was) (?:asking|looking for|trying to find out|wanting)\\b`, 'i'),
  new RegExp(`^${LEAD}the user (?:asks|asked|wants|would like|needs|wanted) (?:to know|me to|to understand|to hear|an? (?:answer|explanation|response|summary|breakdown|walkthrough|overview|rundown))\\b`, 'i'),
  //   "The candidate is asking about next steps, so give them…" (2026-09-30,
  //   final set: 7 recruiting answers narrated the ask before answering once
  //   the heard-question note named the speaker). Same rule as "the user": the
  //   verb must be about the ASK — "The candidate dodged the question" stays.
  new RegExp(`^${LEAD}the (?:candidate|prospect|customer|caller|examiner|interviewer|lecturer|professor|colleague|client|student|recruiter|audience member|panel)(?:'s question)? (?:is|was) (?:asking|looking for|trying to find out|wanting)\\b`, 'i'),
  new RegExp(`^${LEAD}the (?:candidate|prospect|customer|caller|examiner|lecturer|professor|colleague|client|student|recruiter|audience member|panel) (?:asks|asked|wants|would like|needs|wanted) (?:to know|you to|me to|to understand|to hear|(?:for )?an? (?:answer|explanation|example|response|summary|clarification|breakdown|walkthrough|overview))\\b`, 'i'),
  //   "The question is asking…", "This question asks…". "The question is a
  //   good one" / "The question is whether we shard" are spoken and stay.
  new RegExp(`^${LEAD}(?:the|this|their|his|her) question (?:is (?:really |basically |essentially |just )?asking|asks|wants|is looking for)\\b`, 'i'),
  //   "They want to know how I'd scale…" — only when the object of the ask is
  //   the speaker ("…how I'd / what my…"), inside one clause: "They want to
  //   know the timeline, so I send weekly updates." is a real answer about
  //   stakeholders and stays.
  new RegExp(`^${LEAD}(?:they|he|she)(?: want| wants| would like|'d like| wanted) to (?:know|hear|understand) (?:how|what|why|whether|if|when|where|which|about)\\b[^.!?\\n,;]{0,60}?\\b(?:I|I'd|I'm|I've|I'll|my|me|you|you'd|you're|you've|your)\\b`, 'i'),
  // Meta-references to the material as material: "the résumé shows me as…",
  // "the prior assistant turn already established…".
  /\bthe (?:r[eé]sum[eé]|resume|cv) shows (?:me|him|her|them|the candidate)\b/i,
  /\bthe prior (?:assistant )?(?:turn|suggestion|answer|response)\b/i,
  /\bthe previous suggestion (?:covered|already)\b/i,
  // Choosing an answer as an option: "X is the strongest, most specific one" /
  // "that directly ties to the grounded project".
  /\bthe grounded (?:project|fact|answer|example)\b/i,
];

/**
 * Colon hand-offs to the answer ("Here's how I'd answer:", "Here's what you
 * can say:", "Here is a response:"). Only the lead-in up to and including the
 * colon is removed, never the answer that follows it on the same line.
 * "Here's the thing: we moved to Kafka." is spoken and stays (no answer/say).
 */
const LEAD_IN_RE = new RegExp(
  `^${LEAD}here(?:'s| is|s) (?:`
  + `how (?:I'd|I would|I'll|I will|you (?:could|can|might|should|would)|to) (?:answer|respond|reply|put it|say it)(?: (?:this|that|it|them|him|her)(?: question| one)?)?`
  + `|what (?:you (?:can|could|might|should) say|to say|I'd say|I would say|I'll say)`
  + `|(?:a|one|my|the|your) (?:possible |suggested |good |strong |sample |spoken |natural |concise |short |quick )?(?:response|answer|reply)`
  + `)\\s*:\\s*`,
  'i',
);

/** A bare "Answer:" / "**Response:**" label on its OWN line. "Answer: yes" on
 *  one line is left alone. */
const ANSWER_LABEL_RE = /^(?:\*\*|__)?\s*(?:suggested |sample |spoken |possible |my |the )?(?:answer|response)\s*(?:\*\*|__)?\s*:\s*(?:\*\*|__)?[ \t]*\n\s*/i;

/** Sentence boundary: terminal punctuation followed by whitespace (the
 *  original splitter, so spacing survives byte-for-byte), or a line break. */
const SENTENCE_BOUNDARY_RE = /(?<=[.!?…])\s+|[ \t]*\n\s*/;

/** Curly quotes → straight, for MATCHING only (length-preserving, so indexes
 *  into the normalized copy are indexes into the original). */
const normalizeQuotes = (text: string): string => text.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"');

const isPlanningSentence = (sentence: string): boolean => {
  const s = normalizeQuotes(sentence).trim();
  if (!s) return false;
  return PLANNING_SENTENCE_RES.some((re) => re.test(s));
};

export interface PlanningPreambleResult {
  text: string;
  repaired: boolean;
  /** Number of leading sentences removed (0 when untouched). */
  removedSentences: number;
}

interface PreambleScan {
  /** Offset where the answer starts after the leading preamble (0 = none). */
  end: number;
  /** Preamble units (sentences / lead-ins) consumed. */
  units: number;
  /** Streaming only: the unit at `end` has not finished arriving, so whether
   *  it is preamble is still open. Always false for a final scan. */
  open: boolean;
}

/**
 * THE preamble scanner — shared by stripPlanningPreamble (whole answer) and
 * PreambleStreamGate (a stream prefix), so the streamed text and the final
 * text can never disagree about what the preamble was. Walks the answer's
 * opening units (colon lead-ins, "Answer:" labels, sentences) and stops at the
 * first one that is real content.
 */
function scanLeadingPreamble(text: string, streaming: boolean): PreambleScan {
  const norm = normalizeQuotes(text);
  let pos = /^\s*/.exec(norm)![0].length;
  let units = 0;
  for (;;) {
    const rest = norm.slice(pos);
    if (!rest) return { end: units ? pos : 0, units, open: streaming };
    const label = LEAD_IN_RE.exec(rest) ?? ANSWER_LABEL_RE.exec(rest);
    if (label) {
      pos += label[0].length;
      units++;
      continue;
    }
    const b = SENTENCE_BOUNDARY_RE.exec(rest);
    if (!b) {
      if (streaming) return { end: units ? pos : 0, units, open: true };
      if (isPlanningSentence(rest)) { pos += rest.length; units++; continue; }
      return { end: units ? pos : 0, units, open: false };
    }
    const sentence = rest.slice(0, b.index);
    if (!isPlanningSentence(sentence)) return { end: units ? pos : 0, units, open: false };
    pos += b.index + b[0].length;
    units++;
  }
}

/** The answer that follows a removed preamble: a stray opening quote and the
 *  whitespace after the preamble dropped (what the old rejoin did). */
const answerAfter = (text: string, end: number): string =>
  text.slice(end).replace(/^["']+/, '').replace(/^\s+/, '');

/**
 * Strip the answer's leading run of planning sentences. Fenced code at the top
 * (never seen live, but cheap to respect) disables the whole pass.
 */
export function stripPlanningPreamble(answer: string): PlanningPreambleResult {
  const original = String(answer ?? '');
  const trimmed = original.trim();
  if (!trimmed || trimmed.startsWith('```')) {
    return { text: original, repaired: false, removedSentences: 0 };
  }
  const scan = scanLeadingPreamble(trimmed, false);
  if (scan.units === 0) return { text: original, repaired: false, removedSentences: 0 };
  // Everything after keeps its original spacing (paragraph breaks included).
  const rest = answerAfter(trimmed, scan.end).trim();
  if (!rest) {
    // Everything was planning — nothing left to say. Fail open.
    return { text: original, repaired: false, removedSentences: 0 };
  }
  return { text: rest, repaired: true, removedSentences: scan.units };
}

/** How an opening that MAY still become a preamble begins (lowercase,
 *  straight quotes, discourse lead-ins already removed). */
const PREAMBLE_HEADS = [
  'the interviewer', 'interviewer\'s', 'the user ', 'the user\'s',
  'the candidate', 'the prospect', 'the customer', 'the caller', 'the examiner', 'the lecturer', 'the professor', 'the colleague', 'the client', 'the student', 'the recruiter', 'the audience member', 'the panel',
  'the question ', 'this question ', 'their question ', 'his question ', 'her question ',
  'they want', 'they\'d like', 'they would like', 'he want', 'he\'d like', 'he would like',
  'she want', 'she\'d like', 'she would like',
  'i\'ll ', 'i will ', 'i should ', 'i need to ', 'i want to ', 'i\'m going to ', 'i am going to ',
  'let me answer',
  'here\'s ', 'here is ', 'heres ',
  'answer', 'response', 'suggested ', 'sample ', 'spoken ', 'possible ', 'my answer', 'my response', 'the answer', 'the response',
  'the résumé', 'the resume', 'the cv ', 'the prior ', 'the previous suggestion', 'the grounded ',
  // A lead-in still arriving ("So", "Okay,").
  'so ', 'so,', 'okay', 'ok ', 'ok,', 'now ', 'now,', 'first', 'alright', 'well', 'and ', 'since ',
];
const LEAD_WORD_RE = /^(?:so|okay|ok|now|first|alright|well|and|since),?\s+/;

/** False once the opening can no longer turn into a preamble, so an ordinary
 *  answer ("Redis, because…", "```python", "I built…") is released after a
 *  few characters instead of waiting for its first sentence to end. */
function couldStillBePreamble(text: string): boolean {
  let t = normalizeQuotes(text).toLowerCase().replace(/^[\s*_"'>]+/, '');
  for (let i = 0; i < 2; i++) {
    const m = LEAD_WORD_RE.exec(t);
    if (!m) break;
    t = t.slice(m[0].length);
  }
  if (!t) return true;
  return PREAMBLE_HEADS.some((h) => h.startsWith(t) || t.startsWith(h));
}

/** Longest opening held while it still reads like a preamble. Past it the
 *  text is released as-is (a leak is better than a stalled answer). */
export const PREAMBLE_GATE_MAX_HOLD_CHARS = 240;

/**
 * Streaming twin of stripPlanningPreamble: holds the answer's opening only
 * while it could still be a planning preamble, removes a preamble that turns
 * out to be one, and then passes every later chunk through untouched.
 *
 * Contract: the concatenation of everything push() and flush() return equals
 * stripPlanningPreamble(fullText).text (modulo end-of-text whitespace) —
 * nothing on screen is ever rewritten, and a caller that records what it
 * emitted records exactly what the user saw.
 */
export class PreambleStreamGate {
  private held = '';
  private released = false;
  private removed = 0;

  constructor(private readonly maxHoldChars: number = PREAMBLE_GATE_MAX_HOLD_CHARS) {}

  /** Preamble units removed so far (0 until the gate releases). */
  get removedUnits(): number { return this.removed; }

  /** True once the gate has decided and passes chunks straight through. */
  get isReleased(): boolean { return this.released; }

  push(chunk: string): string {
    if (this.released) return chunk;
    this.held += chunk;
    const trimmedStart = this.held.trimStart();
    // Code first: stripPlanningPreamble never touches an answer that opens
    // with a fence, so neither does the gate.
    if (trimmedStart.startsWith('```')) return this.release(this.held);
    const scan = scanLeadingPreamble(this.held, true);
    if (!scan.open) {
      return this.release(scan.units ? answerAfter(this.held, scan.end) : this.held, scan.units);
    }
    const remainder = this.held.slice(scan.end);
    if (remainder.trim() && (!couldStillBePreamble(remainder) || this.held.length >= this.maxHoldChars)) {
      return this.release(scan.units ? answerAfter(this.held, scan.end) : this.held, scan.units);
    }
    return '';
  }

  /** End of stream: judge what is still held as a finished answer. */
  flush(): string {
    if (this.released) return '';
    const held = this.held;
    const trimmed = held.trim();
    if (!trimmed || trimmed.startsWith('```')) return this.release(held);
    const scan = scanLeadingPreamble(held, false);
    if (!scan.units) return this.release(held);
    const rest = answerAfter(held, scan.end);
    // All planning, nothing else: fail open exactly like stripPlanningPreamble.
    if (!rest.trim()) return this.release(held);
    return this.release(rest, scan.units);
  }

  private release(text: string, removedUnits = 0): string {
    this.released = true;
    this.removed = removedUnits;
    this.held = '';
    return text;
  }
}

/**
 * True when the user's own message asks ABOUT the question or the asker
 * ("what is the interviewer asking?", "what do they want?"). There an answer
 * that opens "The interviewer is asking about…" IS the answer, so a typed
 * surface must not run the preamble gate on it.
 */
export function asksAboutTheQuestion(message: string): boolean {
  const m = normalizeQuotes(String(message ?? ''));
  // A THIRD party (or the question itself) must be what is asked about:
  // "Why do you want to work here?" / "What questions do you have for us?"
  // are ordinary interview questions and keep the gate.
  return /\b(?:what|which|why)\b[^?.!\n]{0,40}\b(?:they|he|she|the (?:interviewer|user|customer|client|candidate|recruiter|panel|manager|caller))\b[^?.!\n]{0,30}\b(?:ask|asks|asking|asked|want|wants|wanted|mean|means|meant|looking for)\b/i.test(m)
    || /\bwhat(?:'s| is| was| were)? (?:the|their|his|her|that) (?:question|ask)\b/i.test(m)
    || /\bwhich question\b/i.test(m)
    || /\b(?:explain|summari[sz]e|repeat|rephrase|clarify|interpret|restate)\b[^?.!\n]{0,30}\b(?:question|ask)\b/i.test(m);
}
