// MeetingSummaryV3.ts
// Canonical, spec-aligned schema for Natively post-meeting notes (Phase 5).
//
// This is the single source of truth for the MeetingSummaryV3 shape and its runtime
// validation/repair. It deliberately uses a hand-written validator (no new dependency)
// that mirrors the repo's existing defensive-coercion convention. The validator never
// throws and always returns a usable result or a clear `ok:false` so the caller can fall
// back safely.
//
// Privacy: this module only shapes/validates data. It performs no I/O, no telemetry, and
// no network calls. Evidence quotes live only inside the note object (stored locally).

export type Confidence = 'high' | 'medium' | 'low';

export type SummaryStatus =
  | 'queued'
  | 'chunking'
  | 'summarizing_chunks'
  | 'reducing'
  | 'validating'
  | 'completed'
  | 'failed';

export type SummaryStrategy = 'direct' | 'map_reduce' | 'long_context' | 'fallback';

export interface EvidenceRef {
  speakerId?: string;
  speakerName?: string;
  timestampMs?: number;
  quote?: string;
  segmentId?: string;
}

export interface NoteBullet {
  id?: string;
  text: string;
  evidence?: EvidenceRef[];
  confidence?: Confidence;
  /**
   * The line restates or fills in a point the user typed in their own notes
   * during the meeting (2026-10-15). Absent: written from the transcript only.
   * The meeting page shows these lines in the primary text colour.
   */
  fromUserNotes?: boolean;
}

export interface MeetingNoteSection {
  id: string;
  title: string;
  bullets: NoteBullet[];
  order: number;
}

export interface DecisionItem {
  id?: string;
  text: string;
  owner?: string;
  timestampMs?: number;
  evidence?: EvidenceRef[];
  confidence: Confidence;
  /** From a point in the user's own notes (see NoteBullet.fromUserNotes). */
  fromUserNotes?: boolean;
}

export interface ActionItem {
  id?: string;
  text: string;
  owner?: string;
  deadline?: string;
  sourceTimestampMs?: number;
  explicitness: 'explicit' | 'inferred';
  evidence?: EvidenceRef[];
  confidence: Confidence;
  status?: 'open' | 'done' | 'deferred';
  /** Also in the previous meeting of this series (2026-10-15; absent on older notes). */
  carriedOver?: boolean;
  /** Whose it is: the user's side ("ours") or the other side of the call ("theirs"). */
  party?: 'ours' | 'theirs';
  /** From a point in the user's own notes (see NoteBullet.fromUserNotes). */
  fromUserNotes?: boolean;
}

export interface QuestionItem {
  id?: string;
  text: string;
  owner?: string;
  status: 'open' | 'answered' | 'deferred';
  evidence?: EvidenceRef[];
  confidence?: Confidence;
  /** Also open in the previous meeting of this series (2026-10-15). */
  carriedOver?: boolean;
  /** From a point in the user's own notes (see NoteBullet.fromUserNotes). */
  fromUserNotes?: boolean;
}

export interface RiskItem {
  id?: string;
  text: string;
  severity: 'low' | 'medium' | 'high';
  evidence?: EvidenceRef[];
  confidence?: Confidence;
}

export type FollowUpDraftType =
  | 'email'
  | 'slack'
  | 'project_update'
  | 'crm_note'
  | 'study_notes'
  | 'interview_feedback';

// 'your_style': the user's own voice, from the writing samples of the mode the
// meeting ran under (Modes Manager). The default when that mode has samples; a
// preset tone drafts in that tone alone, so the two never pull against each other.
export type FollowUpTone = 'professional' | 'warm' | 'concise' | 'friendly' | 'your_style';

export interface FollowUpDraft {
  type: FollowUpDraftType;
  subject?: string;
  body: string;
  tone: FollowUpTone;
  basedOnActionItemIds?: string[];
  basedOnDecisionIds?: string[];
  /** Written in the user's own voice, from their saved writing (outputs/writingStyle.ts). */
  styled?: boolean;
}

export type TimelineItemType = 'topic_shift' | 'decision' | 'action_item' | 'risk' | 'question';

export interface TimelineItem {
  id?: string;
  timestampMs?: number;
  title: string;
  description?: string;
  type: TimelineItemType;
  evidence?: EvidenceRef[];
}

export interface PersonMention {
  speakerId?: string;
  name?: string;
  role?: string;
  organization?: string;
  mentions?: number;
  confidence?: Confidence;
}

export interface SourceQuality {
  transcriptCoverage: number; // 0..1
  speakerQuality: 'good' | 'mixed' | 'poor';
  actionItemConfidence: Confidence;
  warnings: string[];
}

// Per-meeting map of canonical speaker id → user-assigned display name.
// e.g. { "speaker_1": "John from Client", "speaker_2": "Sarah, PM" }
// "me" is reserved for the local user and is renameable too.
export type SpeakerLabelMap = Record<string, string>;

export interface MeetingSummaryModeMeta {
  selectedModeId?: string;
  selectedModeName?: string;
  selectedTemplateType?: string;
  detectedModeId?: string;
  detectedModeName?: string;
  detectedConfidence?: number;
  summaryModeUsed?: string;
  /** The note template the notes were written in (noteTemplates.ts), when one was picked. */
  noteTemplateId?: string;
  noteTemplateName?: string;
}

export interface MeetingSummaryGenerationMeta {
  strategy: SummaryStrategy;
  provider?: string;
  model?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  chunkCount?: number;
  warnings: string[];
}

// Render/back-compat helper block (additive; not part of the strict spec but kept so the
// UI can render typed blocks and copy/export without re-deriving structure).
export type NoteBlock =
  | { type: 'heading'; text: string }
  | { type: 'bullet'; text: string; evidence?: EvidenceRef[] }
  | { type: 'action'; item: ActionItem }
  | { type: 'decision'; item: DecisionItem }
  | { type: 'question'; item: QuestionItem }
  | { type: 'risk'; item: RiskItem }
  | { type: 'quote'; text: string; speaker?: string; timestampMs?: number };

export interface MeetingSummaryV3 {
  schemaVersion: 3;
  title: string;
  tldr: string[];
  overview: string;
  whatChanged: string[];
  decisions: DecisionItem[];
  actionItems: ActionItem[];
  openQuestions: QuestionItem[];
  risks: RiskItem[];
  sections: MeetingNoteSection[];
  followUpDraft?: FollowUpDraft;
  timeline?: TimelineItem[];
  people?: PersonMention[];
  topics?: string[];
  sourceQuality: SourceQuality;
  mode: MeetingSummaryModeMeta;
  generation: MeetingSummaryGenerationMeta;
  // Additive render/export helpers:
  noteBlocks?: NoteBlock[];
  recipes?: Record<string, string>;
}

export interface ValidationResult<T> {
  ok: boolean;
  data?: T;
  errors: string[];
  repaired: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Coercion primitives
// ─────────────────────────────────────────────────────────────────────────────

const NUL_RE = /\x00/g;
const FENCE_RE = /```/g;
const FILLER_RE = /\b(the meeting discussed|covered various|talked about various|various topics|the conversation covered)\b/i;
const VALID_CONFIDENCE = new Set<Confidence>(['high', 'medium', 'low']);
const VALID_EXPLICITNESS = new Set(['explicit', 'inferred']);
const VALID_QUESTION_STATUS = new Set(['open', 'answered', 'deferred']);
const VALID_ACTION_STATUS = new Set(['open', 'done', 'deferred']);
const VALID_RISK_SEVERITY = new Set(['low', 'medium', 'high']);
const VALID_TIMELINE_TYPE = new Set<TimelineItemType>(['topic_shift', 'decision', 'action_item', 'risk', 'question']);
const VALID_FOLLOWUP_TYPE = new Set<FollowUpDraftType>(['email', 'slack', 'project_update', 'crm_note', 'study_notes', 'interview_feedback']);
const VALID_FOLLOWUP_TONE = new Set<FollowUpTone>(['professional', 'warm', 'concise', 'friendly', 'your_style']);

// Realistic density is 5-12 findings per section per chunk; a well-covered section across
// 4-10 chunks can legitimately reach ~120 bullets. This cap exists only to bound pathological
// input (a runaway chunk count or a misbehaving extractor), not to trim a normal dense
// meeting — 500 is far above anything the density contract should ever produce.
//
// Single source of truth: MeetingSummaryReducer.buildSections applies this same cap (with its
// own truncation warning) BEFORE validateMeetingSummaryV3 runs, and sanitizeSections below
// applies it again as the schema's own floor (so any summary object, not just one produced by
// the reducer, gets the same protection). Both call sites import this constant so they cannot
// drift apart.
export const SECTION_BULLET_CAP = 500;

export function cleanString(value: unknown): string {
  return String(value ?? '').replace(NUL_RE, '').replace(/\s+/g, ' ').trim();
}

export function cleanNoteText(value: unknown, max = 240): string {
  return cleanString(value).replace(FENCE_RE, '').replace(FILLER_RE, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// ─────────────────────────────────────────────────────────────────────────────
// Meeting title shape guard
// ─────────────────────────────────────────────────────────────────────────────
//
// The title is the one summary field with no schema validator behind it and the
// widest UI surface (history rows, window titles, email subjects). The prompt
// asks for three to six words, but that is advice, not a bound — a model that
// answers the transcript instead of naming it writes its whole reply into the
// title column. Two real rows, 2026-08-02:
//
//   197 chars  "I'm Natively, an AI assistant developed by Evin John. I help you ..."
//    60 chars  "A third-party GraphQL client is a separate tool, service, or"
//
// So the bound lives here, in code, and is deliberately prompt-agnostic: it has
// to hold whichever prompt system produced the text. The caps sit above the
// prompt's 3-6 words so a title that already obeys the contract is never
// touched — this only fires when generation has already gone wrong.
//
// Applied to GENERATED titles only. Calendar- and user-supplied titles are the
// user's own words and keep whatever length they have.
//
// 50 characters, spaces included (owner decision 2026-10-18): a title fits one
// line in the meeting list and on the notes page. The prompt asks for the same
// bound (MEETING_TITLE_RULE), so this clamp only fires when a model ignores it.
export const MEETING_TITLE_MAX_WORDS = 8;
export const MEETING_TITLE_MAX_CHARS = 50;

/**
 * The "title" field's instruction, shared by every notes call that names the
 * meeting (the whole-meeting overview, the short-session call, the V2 fallback).
 * The title rides along in the notes reply: naming a meeting never costs a
 * request of its own (2026-10-18).
 *
 * "Understandable" is the bar (owner, 2026-10-18). Real titles that missed it:
 * narration ("User asked the assistant to resume; the assistant answered"),
 * sentences cut mid-thought ("Evin said circular tide was not"), questions
 * ("Which Number Is Odd Or Even") and descriptions of an empty session ("No
 * Source Text Provided"). Ones that met it: "API Basics and REST vs GraphQL
 * Questions", "Competitiveness of a 7 LPA Offer". Examples are in single
 * quotes so the rule can sit inside a JSON-shaped prompt.
 */
export const MEETING_TITLE_RULE = `"title": the meeting's name, the way a well-named calendar event reads, so someone who missed it knows at a glance what it was about. At most ${MEETING_TITLE_MAX_CHARS} characters including spaces, on one line. A short noun phrase for the main subject or two, then who it was with when one or two named people from outside the user's side led it, by first name: 'Hotel scheduling pricing with Grace', 'Chatbot renewal and recovery with Ifeoma', 'Release 4.12 planning: deletion, crash fix', 'Backend engineer interview with Tomasz', 'Price elasticity lecture and quiz prep'. Use the meeting's own names: the company, product or project it was about and the person, spelled as the user's notes spell them when they wrote them; never a category label that fits any meeting ('Engineering candidate interview', 'Marketing budget and launch planning', 'Fundraising and strategy review'). Not a sentence and not a question; no narration ('User asked...', 'Evin said...', 'Discussion of...') and nothing about how much was said. When little was said, name that little ('Quick greeting'). It names the whole meeting, not its opening. Plain words in the meeting's language; no quotation marks, no ending punctuation, no date`;

// Spoken-answer furniture the composer can append to any output. A [[GIST]]
// line renders as a summary chip on screen; glued onto a title it is noise.
const GIST_MARKER = '[[GIST]]';
// "Title:", "Meeting title -", "Here's the title:", "Suggested title —", ...
const TITLE_PREAMBLE_RE = /^(?:here(?:'s|\s+is|\s+are)\s+)?(?:the\s+|a\s+|an\s+)?(?:suggested\s+|proposed\s+|meeting\s+|concise\s+)*title\s*[:\-–—]\s*/i;
// Double quotes go everywhere, not just at the ends — stripping only a wrapping
// pair turns `Review of "Project Falcon"` into an unbalanced `Review of "Project
// Falcon`. The prompt bans quotation marks in titles outright, and the call site
// this replaced stripped every `"`, so parity and correctness agree here.
const DOUBLE_QUOTES_RE = /["“”«»]/g;
// Single quotes only when they wrap, so `Sam's 1:1` keeps its apostrophe.
const WRAPPING_SINGLE_QUOTES_RE = /^['‘’]+|['‘’]+$/g;
// A title that ends on a connective was cut mid-thought; the stub reads worse
// than dropping it. Only ever applied to text this function truncated — an
// author who genuinely named a meeting "Sync On" keeps it.
// After a cut on a bare word boundary, auxiliaries, determiners and question
// words dangle too: "Evin said circular tide was not" and "what the other
// person's" were real cut titles. A cut at a phrase break keeps its whole
// phrase ("Evin asked what an API is"), so only the connectives apply there.
const DANGLING_WORD_RE = /[\s,]+(?:and|or|but|with|for|to|of|in|on|at|by|from|as|the|a|an)$/i;
const DANGLING_WORD_AFTER_WORD_CUT_RE = /[\s,]+(?:and|or|but|with|for|to|of|in|on|at|by|from|as|the|a|an|vs|via|into|than|then|if|when|while|because|so|during|about|after|before|over|under|through|between|is|was|are|were|be|been|not|that|which|what|who|whose|how|this|these|those|his|her|their|its|our|my|your|[\p{L}]+['’]s)$/iu;
// A negation never ends a thought, wherever the cut fell: "Evin said circular
// tide was not" is cut before "about" as readily as on a bare word.
const NEGATION_TAIL_RE = /[\s,]+(?:(?:is|was|are|were|do|does|did|has|have|had|can|could|will|would|should)\s+)?(?:not|never)$|[\s,]+\p{L}+n['’]t$/iu;

/** Where a too-long title may be cut and still read as a whole phrase: before
 *  punctuation, a spaced dash, an opening bracket, or a joining word. */
const PHRASE_BREAK_RE = /\s*(?:[:;,(]|\s[—–-]\s|\s(?:and|or|but|with|for|via|vs\.?|including|while|because|so|after|before|about|during|in|on|at|to|from|by|over|under|through|without|within|across|between|against)\s)/giu;

/** A meeting-shaped opener that names nothing: "Discussion of", "Meeting about"… */
const GENERIC_TITLE_PREFIX_RE = /^(?:(?:a|the)\s+)?(?:meeting|discussion|call|conversation|chat|session|talk)\s+(?:about|on|of|regarding|around)\s+(?:the\s+)?/i;

/**
 * Fit a title into `maxChars` (and `maxWords`) so it ends on a whole phrase:
 * the last phrase break that leaves at least two words, else the last whole
 * word, then any dangling connective dropped. Text already within both caps
 * is returned as it is. Shared by cleanMeetingTitle and the note-derived
 * fallback title (MeetingPersistence), so the two cut the same way.
 */
export function fitTitleLength(text: string, maxChars: number = MEETING_TITLE_MAX_CHARS, maxWords: number = MEETING_TITLE_MAX_WORDS): string {
  const full = String(text || '').replace(/\s+/g, ' ').trim();
  const words = full.split(' ').filter(Boolean);
  if (words.length <= maxWords && full.length <= maxChars) return full;

  const limit = Math.min(maxChars, words.slice(0, maxWords).join(' ').length);
  // Punctuation marks the writer's own phrase ends, so it wins over a joining
  // word ("…the onboarding funnel, agreed to cut" is cut at the comma, not
  // before "to"), as long as what it keeps still says something.
  // A joining word that leaves only a short stub after the last punctuation
  // ("…funnel, agreed") is that exception; one that keeps more of a list
  // ("Kickoff: scope, timeline, owners") is the better cut.
  let atPunctuation = '';
  let atWord = '';
  for (const m of full.matchAll(PHRASE_BREAK_RE)) {
    const at = m.index ?? 0;
    if (at > limit) break;
    const head = full.slice(0, at).trim();
    if (head.split(' ').length < 2 || head.length < 8) continue;
    if (/^\s*(?:[:;,(]|\s[—–-]\s)/.test(m[0])) atPunctuation = head;
    else atWord = head;
  }
  let out = atWord || atPunctuation;
  if (atPunctuation.length >= 15 && atWord.length > atPunctuation.length) {
    const stub = atWord.slice(atPunctuation.length).replace(/^[\s:;,(—–-]+/, '');
    if (isVerbStub(stub)) out = atPunctuation;
  } else if (atPunctuation.length >= 15) {
    out = atPunctuation;
  }
  const dangling = out ? DANGLING_WORD_RE : DANGLING_WORD_AFTER_WORD_CUT_RE;
  if (!out) {
    // No phrase break: cut on the last whole word inside the window. A single
    // unbroken over-long token is cut hard instead.
    const endsOnWord = limit >= full.length || full[limit] === ' ';
    out = full.slice(0, limit);
    if (!endsOnWord) {
      const lastSpace = out.lastIndexOf(' ');
      if (lastSpace > maxChars / 2) out = out.slice(0, lastSpace);
    }
  }
  out = out.replace(/[\s.,;:!?\-–—(]+$/g, '').trim();
  const trimTail = (re: RegExp) => {
    while (re.test(out) && out.split(' ').length > 2) out = out.replace(re, '').replace(/[\s.,;:!?\-–—(]+$/g, '').trim();
  };
  trimTail(NEGATION_TAIL_RE);
  trimTail(dangling);
  return out.replace(/[\s.,;:!?\-–—(]+$/g, '').trim();
}

/** The words a joining-word cut leaves after the last punctuation read as the
 *  start of a clause ("agreed to cut steps", "was"), not as a list item. */
function isVerbStub(stub: string): boolean {
  const words = stub.split(' ').filter(Boolean);
  if (words.length === 0) return true;
  return /^(?:\p{L}+ed|is|was|are|were|has|had|have|will|would|should|can|could|did|does|do)$/iu.test(words[0]);
}

// Abbreviations whose full stop does not end a sentence: "Dr. Patel",
// "St. Jude", "Q3 vs. Q4", "Acme Inc. renewal". Single letters are initials.
const ABBREVIATION_RE = /^(?:[\p{L}]|mr|mrs|ms|dr|st|sr|jr|prof|inc|ltd|co|corp|vs|etc|approx|dept|no|vol|fig|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|e\.g|i\.e|a\.m|p\.m|u\.s|u\.k)$/iu;

/**
 * The first sentence of a text: up to the first `.`, `!` or `?` that is followed
 * by a space and does not close an abbreviation or an initial. A full stop
 * inside a token ("v2.5", "heynatively.com") never ends a sentence.
 */
export function firstSentenceOf(text: string): string {
  const s = String(text || '').trim();
  for (const m of s.matchAll(/[.!?]+(?=\s+\S)/g)) {
    const at = m.index ?? 0;
    if (m[0] === '.') {
      const before = s.slice(0, at).split(/\s+/).pop() || '';
      if (ABBREVIATION_RE.test(before)) continue;
    }
    return s.slice(0, at + m[0].length).trim();
  }
  return s;
}

/** A hyphen / en dash / em dash / bullet followed by a space, at the start of a title. */
const LEADING_LIST_MARKER_RE = /^[-–—•]+\s+/;

export function cleanMeetingTitle(
  value: unknown,
  opts?: { maxWords?: number; maxChars?: number },
): string {
  const maxWords = opts?.maxWords ?? MEETING_TITLE_MAX_WORDS;
  const maxChars = opts?.maxChars ?? MEETING_TITLE_MAX_CHARS;

  let text = String(value ?? '').replace(NUL_RE, '');

  const gistAt = text.indexOf(GIST_MARKER);
  if (gistAt >= 0) text = text.slice(0, gistAt);

  // An over-explaining model puts the title on the first line and its reasoning
  // underneath. Take the first line that has content.
  text = text.replace(FENCE_RE, '');
  text = text.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? '';

  const stripQuotes = (s: string) => s.replace(DOUBLE_QUOTES_RE, '').replace(WRAPPING_SINGLE_QUOTES_RE, '');

  text = stripQuotes(cleanString(
    text
      .replace(/\*+/g, '')
      .replace(/`/g, '')
      .replace(/^#+\s*/, '')
      // A list marker the model put in front of the title ("- Summary was missing…").
      .replace(LEADING_LIST_MARKER_RE, ''),
  ));

  text = stripQuotes(cleanString(text.replace(TITLE_PREAMBLE_RE, ''))).trim();
  // ...and again once wrapping quotes are off: "\"- Q4 planning\"" only shows its marker now.
  text = text.replace(LEADING_LIST_MARKER_RE, '');
  if (!text) return '';

  // "Discussion of the Q3 roadmap" names the Q3 roadmap; the opener adds nothing.
  const withoutOpener = text.replace(GENERIC_TITLE_PREFIX_RE, '');
  if (withoutOpener !== text && withoutOpener.split(' ').length >= 2) {
    text = withoutOpener.charAt(0).toUpperCase() + withoutOpener.slice(1);
  }

  const words = text.split(' ');
  // Prose rather than a title: keep the first sentence before clamping, so the
  // cut lands on a thought boundary instead of mid-clause. Gated on already
  // being over budget so "Sync with Dr. Patel" is never cut at "Dr.".
  if (words.length > maxWords || text.length > maxChars) {
    const firstSentence = firstSentenceOf(text);
    const sentenceWords = firstSentence ? firstSentence.split(' ') : [];
    if (sentenceWords.length >= 2 && sentenceWords.length < words.length) text = firstSentence;
  }

  return fitTitleLength(text, maxChars, maxWords).replace(/[\s.,;:!?\-–—]+$/g, '').trim();
}

// ── Answer-fragment title rejection (RC-7 adjacent, live session C 2026-08-21) ──
// The length clamp above bounds SIZE, not SEMANTICS. Live rows from one session:
//
//   402 chars -> "Here's the C++ implementation"
//   294 chars -> "cpp"
//   185 chars -> "I'm sorry, but I don't have the full"
//    60 chars -> "Return [0, 1] for the two numbers that"
//
// All are the model ANSWERING the transcript instead of naming it, clamped to a
// first sentence. A rejected generated title is simply not applied — the
// meeting keeps its default until the structured V3 summary title (usually
// well-formed) lands, and user renames outrank both via user_titled.
// Deliberately conservative: only clear answer/refusal shapes are rejected, so
// a legitimate terse title ("Standup", "Sync with Dr. Patel") always passes.
const ANSWER_FRAGMENT_TITLE_RES: RegExp[] = [
  // Answer openers: "Here's the…", "Here is what…"
  /^here(?:'s|\s+is|\s+are)\b/i,
  // Refusals / apologies: "I'm sorry…", "I don't have…", "Unfortunately…"
  /^(?:i'?m sorry|sorry\b|i apologi[sz]e|i don'?t (?:have|know)|i can(?:no|')t|unfortunately)\b/i,
  // Code-answer imperatives: "Return [0, 1] for the two numbers that…"
  /^(?:return|print|output|write|implement|initialize)\b/i,
  // Conversational acknowledgements: "Yes, that's right", "Okay, so…"
  /^(?:yes|no|sure|okay|ok|yeah|yep)\b\s*[,.!]/i,
  // Complexity notation ("O(1)", "O(n log n)") is handled by
  // isComplexityAnswerTitle below — a blanket reject also threw away
  // legitimate DSA-interview names ("O(1) Store Class Design", 2026-08-26).
  // ── Session E live misses (2026-08-23) ────────────────────────────────
  // First-person answer speech: "I'll switch the solution to C++". A meeting
  // name never opens with "I " / "I'…" ("I/O Performance Review" is safe —
  // no space or apostrophe after the I).
  /^i(?:['’]|\s)/i,
  // "<language> code <verb>…" describes an answer, it doesn't name a meeting
  // ("Python code also uses the same backtracking approach"). Verb-anchored
  // so "Legacy Code Review" stays a valid title.
  /\bcode (?:also\s+|just\s+)?(?:uses|is|does|works|runs|solves|looks)\b/i,
  // Malayalam first/second-person pronouns — answer speech in any language
  // ("ഞാൻ ഇംഗ്ലീഷിൽ സംസാരിക്കാൻ വന്നതാണ്…"). Bare includes: \b is unreliable
  // outside ASCII. Extend per-script as other languages show up.
  /ഞാൻ|ഞങ്ങൾ|നിങ്ങൾ|എനിക്ക്/u,
];

// ── Narration instead of a name (2026-10-18, real saved titles) ─────────────
// Judged on model titles (isAnswerFragmentTitle) and on the note-built backup
// title alike (MeetingPersistence), since a note sentence narrates as readily.
// Each pattern needs the narrating verb, so a subject that merely starts with
// the same word stays a name: "User research synthesis", "Release notes
// review", "Team shares Q3 results", "Frequently asked questions".
const SPEECH_COMPLEMENT = `(?:that|to|about|how|what|why|whether|if|when|where|who|which|the|a|an|his|her|their|its|our|my|your|he|she|they|we|it|i|you|them|him)\\b`;
const NARRATION_TITLE_RES: RegExp[] = [
  // The exchange with the assistant: "User asked the assistant to resume",
  // "The assistant answered…", "User mentions the deadline".
  new RegExp(`^(?:the\\s+)?(?:user|assistant|ai)\\s+(?:asked|asks|said|says|answered|answers|replied|replies|requested|requests|wanted|wants|mentioned|mentions|explained|explains|shared|shares|told|tells|greeted|greets|noted|notes|provided|provides|gave|gives|wrote|writes|responded|responds|confirmed|confirms|did|does|was|is|had|has)\\b`, 'i'),
  // A description of the session instead of its subject:
  // "A very short session in which…", "This call was about…".
  /^(?:a|an|this|the)\s+(?:(?:very|short|brief|quick)\s+)*(?:session|meeting|call|conversation|chat)\s+(?:in which|where|that|was|is|about|with no)\b/i,
  // Reported speech: "Evin said circular tide was not". Said/says/told/tells
  // after a leading name are always narration…
  /^[\p{Lu}][\p{L}'’-]*\s+(?:said|says|told|tells)(?![\p{L}\p{N}])/u,
  // …the verbs that are also nouns or adjectives only when the speech follows:
  // "Evin asked what an API is", "Priya wants to cancel".
  new RegExp(`^[\\p{Lu}][\\p{L}'’-]*\\s+(?:asked|asks|mentioned|mentions|explained|explains|wanted|wants|shared|shares|noted|notes)\\s+${SPEECH_COMPLEMENT}`, 'iu'),
  // A speaker label and a clause: "Evin: HackerRank was not flagging anything".
  /^[\p{L}'’-]+:\s+\S+(?:\s+\S+)?\s+(?:was|were|is|are|did|does|has|had|didn['’]t|doesn['’]t|isn['’]t|wasn['’]t)\b/iu,
  // "Autofocus was mentioned", "Pricing got briefly discussed".
  /\b(?:was|were|is|are|got)\s+(?:briefly\s+)?(?:mentioned|discussed|asked|explained|covered|raised|brought up|talked about)$/i,
];

/** True when a title narrates the exchange (who said or asked what) or
 *  describes the session, instead of naming what it was about. */
export function isNarrationTitle(title: string): boolean {
  const t = String(title || '').trim();
  return !!t && NARRATION_TITLE_RES.some((re) => re.test(t));
}

// ── Complexity notation: answer vs. name (2026-08-26) ────────────────────────
// "O(n)" in a generated title is TWO different failures wearing one shape.
//
//   answer   "O(1)" / "O(n log n)" / "O(1) time, O(n) space"
//   answer   "The two-pointer approach solves this in O(n) time"
//   NAME     "O(1) Store Class Design" / "Designing an O(1) Store"
//
// The user runs DSA interviews constantly, so the complexity IS often the
// distinguishing feature of the meeting — rejecting every title that mentions
// it left those sessions unnamed. Reject only when the notation is the whole
// point of the string rather than one token inside a descriptive noun phrase:
//
//   1. ≤2 tokens survive once the notation is removed — the notation IS the title.
//   2. an assertion verb is present — the phrase claims something about the
//      complexity ("solves this in O(n) time", "Hash map gives O(1) lookup"),
//      i.e. it is the answer. Covers the "<language> code uses/is/…" verbs
//      above plus the ones a complexity claim actually uses (gives/takes/
//      costs/…), which land inside the 3-6-word window rule 3 can't see.
//   3. more than MEETING_TITLE_MAX_WORDS words — longer than any title the
//      clamp keeps, so anything that long quoting complexity is a sentence.
//      (It was 6 while the naming prompt asked for 3-6 words; titles are now
//      bounded by 50 characters, and "Two Sum in O(n) with a hash map" is 8.)
//
// Detection is the unchanged pattern; only the decision narrowed.
const COMPLEXITY_NOTATION_RE = /\bO\([^)]{1,12}\)/g;
const ASSERTION_VERB_RE = /\b(?:uses|is|does|works|runs|solves?|looks|gives?|takes|costs|achieves?|yields|requires?|reduces?|needs)\b/i;
const TITLE_WORD_WINDOW_MAX = MEETING_TITLE_MAX_WORDS;

function isComplexityAnswerTitle(t: string): boolean {
  const stripped = t.replace(COMPLEXITY_NOTATION_RE, ' ');
  if (stripped === t) return false; // no complexity notation at all
  const residual = stripped.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (residual.length <= 2) return true;
  if (ASSERTION_VERB_RE.test(stripped)) return true;
  return t.split(/\s+/).filter(Boolean).length > TITLE_WORD_WINDOW_MAX;
}

// ── Not a name, in any language the notes are written in (2026-10-18) ──────
// Two shapes a model writes instead of naming the meeting, judged per language
// because the notes follow the meeting's language: the app's own (English,
// Spanish, Japanese, Russian, Chinese) plus the speech languages seen in real
// meetings (French, Hindi, Malayalam) and the nearest neighbours (German,
// Portuguese, Italian). A real one: "Session très courte sans contenu
// substantiel". JS \b only knows ASCII letters, so word edges are lookarounds.
const WORD_START = '(?<![\\p{L}\\p{N}])';
const WORD_END = '(?![\\p{L}\\p{N}])';
const titleRe = (body: string) => new RegExp(body, 'iu');

/** A description of the session's emptiness or brevity rather than its subject. */
const EMPTY_SESSION_TITLE_RES: RegExp[] = [
  // English: "No Source Text Provided", "No substantive content", "Nothing was
  // discussed", "A very short session", "Empty transcript".
  // "no"/"without" only before a word that can only mean emptiness, or at the
  // title's end: "Launch without data migration" and "No data loss strategy"
  // name a subject.
  titleRe(`^no\\s+(?:real\\s+|meaningful\\s+)?(?:source|content|text|transcript|substance|substantive|discussion|topics?)${WORD_END}`),
  titleRe(`${WORD_START}(?:with\\s+no|without(?:\\s+any)?)\\s+(?:real\\s+|meaningful\\s+|substantive\\s+)?(?:content|substance|discussion|transcript|topics?)${WORD_END}`),
  titleRe(`${WORD_START}(?:no|without)\\s+(?:source|content|text|transcript|context|information|data)(?:\\s+(?:provided|available|given|shared|recorded))?$`),
  titleRe(`${WORD_START}not provided$|${WORD_START}nothing (?:of (?:substance|note|importance|interest) )?(?:was |got )?(?:said|discussed|covered|decided|to (?:name|summari[sz]e))${WORD_END}`),
  titleRe(`^(?:(?:a|an|this|the)\\s+)?(?:very\\s+)?(?:short|brief|empty)\\s+(?:session|meeting|call|conversation|chat|transcript)$`),
  titleRe(`${WORD_START}empty\\s+(?:session|meeting|call|conversation|transcript)${WORD_END}`),
  // French
  titleRe(`${WORD_START}(?:sans|aucun|aucune|pas de)\\s+(?:contenu|sujet|échange|discussion|information|texte|transcription)${WORD_END}`),
  titleRe(`${WORD_START}(?:session|réunion|conversation|appel)\\s+(?:très\\s+)?(?:courte?|brève|vide)${WORD_END}`),
  titleRe(`${WORD_START}rien (?:n['’]a été |de )(?:dit|discuté|substantiel)${WORD_END}`),
  // Spanish
  titleRe(`${WORD_START}(?:sin|ningún|ninguna|no hay)\\s+(?:contenido|tema|información|texto|transcripción)${WORD_END}`),
  titleRe(`${WORD_START}(?:sesión|reunión|conversación|llamada)\\s+(?:muy\\s+)?(?:corta|breve|vacía)${WORD_END}`),
  // Portuguese
  titleRe(`${WORD_START}(?:sem|nenhum|nenhuma)\\s+(?:conteúdo|assunto|informação|texto|transcrição)${WORD_END}`),
  titleRe(`${WORD_START}(?:sessão|reunião|conversa|chamada)\\s+(?:muito\\s+)?(?:curta|breve|vazia)${WORD_END}`),
  // German
  titleRe(`${WORD_START}(?:kein|keine|keinen|ohne)\\s+(?:inhalt|inhalte|thema|informationen|text|transkript)${WORD_END}`),
  titleRe(`${WORD_START}(?:sehr\\s+)?(?:kurze|leere)\\s+(?:sitzung|besprechung|unterhaltung|session)${WORD_END}`),
  // Italian
  titleRe(`${WORD_START}(?:senza|nessun|nessuna)\\s+(?:contenuto|argomento|informazione|testo|trascrizione)${WORD_END}`),
  titleRe(`${WORD_START}(?:sessione|riunione|conversazione|chiamata)\\s+(?:molto\\s+)?(?:breve|corta|vuota)${WORD_END}`),
  // Russian
  titleRe(`${WORD_START}(?:без|нет)\\s+(?:содержания|содержимого|темы|информации|текста)${WORD_END}`),
  titleRe(`${WORD_START}(?:очень\\s+)?(?:короткая|короткий|пустая|пустой)\\s+(?:сессия|встреча|беседа|разговор|звонок)${WORD_END}`),
  // Japanese and Chinese (no spaces between words)
  titleRe(`内容(?:が|は)?(?:なし|ない|ありません)|発言(?:なし|がない)|(?:短い|空の)(?:セッション|会議|会話|通話)`),
  titleRe(`(?:没有|无)(?:实质)?(?:内容|讨论)|(?:很短|简短|空)的?(?:会话|会议|对话|通话)`),
  // Hindi and Malayalam
  titleRe(`कोई\\s+(?:सामग्री|विषय|जानकारी)\\s+नहीं|(?:बहुत\\s+)?(?:छोटा|छोटी|खाली)\\s+(?:सत्र|बैठक|बातचीत)`),
  titleRe(`ഉള്ളടക്കം\\s*ഇല്ല|ഉള്ളടക്കമില്ല|ചെറിയ\\s+(?:സെഷൻ|മീറ്റിംഗ്|സംഭാഷണം)`),
];

/** A question instead of a name: "Which Number Is Odd Or Even". A how-to
 *  ("How to scale Postgres", "Comment faire un CV", "如何部署") is a name. */
const QUESTION_TITLE_RES: RegExp[] = [
  // Question marks in any script, and Spanish's opening one.
  /[?？؟]\s*$/u,
  /^[¿]/u,
  // English: a question word then an auxiliary ("What Is An API", "Which
  // Number Is Odd"), or an auxiliary then its subject ("Is It Worth It").
  /^(?:which|what|who|whose|whom|when|where|why|how)\s+(?:is|are|was|were|do|does|did|can|could|should|would|will|has|have|had)\b/i,
  /^(?:which|what|whose)\s+\S+\s+(?:is|are|was|were|do|does|did|can|could|should|would|will|has|have)\b/i,
  /^(?:is|are|was|were|do|does|did|can|could|should|would|will|has|have|shall)\s+(?:i|we|you|they|he|she|it|this|that|these|those|there|the|a|an|our|my|your|their)\b/i,
  // French, Portuguese, German
  titleRe(`^(?:est-ce qu|qu['’]est-ce qu|pourquoi${WORD_END}|quel(?:le)?s?\\s+(?:est|sont)${WORD_END})`),
  titleRe(`^(?:por que|o que é|qual é|quais são)${WORD_END}`),
  titleRe(`^(?:was|wie|warum|wer|wo|welche[rsmn]?)\\s+(?:ist|sind|war|kann|können|soll|sollte|wird|hat|haben)${WORD_END}`),
  // Russian "why", Hindi "what/why" openers, Japanese and Chinese question endings.
  titleRe(`^(?:почему|зачем)${WORD_END}`),
  titleRe(`^(?:क्या|क्यों)\\s`),
  titleRe(`(?:ですか|ますか|でしょうか|のか)$`),
  titleRe(`(?:吗|呢)$|^(?:为什么|什么是|是否)`),
];

/** True when a title describes the session's emptiness instead of naming it. */
export function isEmptySessionTitle(title: string): boolean {
  const t = String(title || '').trim();
  return !!t && (EMPTY_SESSION_TITLE_RES.some((re) => re.test(t)) || isEmptyPlaceholder(t) || EMPTY_TITLE_RE.test(placeholderKey(t)));
}

// ── A reply that says "this is empty" ────────────────────────────────────────
// The notes prompts say what to send when there is nothing ('return an empty
// "summary" array'). Some models write that back as text, and "empty summary
// array." was saved as a meeting's Summary (GitHub #662). The check is narrow on
// purpose: notes hold real short lines that look alike. "Empty array", "Empty
// string" and "Value is null" are edge cases from a coding interview, "No resume
// provided" is a hiring note. A placeholder is one of:
//   - punctuation alone: "—", "[]", '""'
//   - a "nothing" word alone: "None", "N/A", "Nothing found", "Rien", "なし"
//   - an "empty" word naming the notes' own field: "empty summary array",
//     "No summary available", "Tableau « summary » vide", "摘要为空"
//   - the prompts' own condition: "The notes contain no concrete outcome."
// "Empty array" / "Empty string" is a placeholder only where the prompt asked for
// an empty array (isEmptyListPlaceholder), and "Untitled" / "No title" only as a
// title (isEmptySessionTitle).

function placeholderKey(text: string): string {
  return String(text || '').normalize('NFC').toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim()
    .replace(/(^| )n a(?= |$)/g, '$1na'); // "N/A", "N.A."
}

const PLACEHOLDER_NOTHING_RE = new RegExp(`^(?:${[
  'none', 'nothing', 'null', 'nil', 'undefined', 'empty', 'blank', 'not applicable',
  'ninguno', 'ninguna', 'nada', 'aucun', 'aucune', 'rien', 'néant', 'nenhum', 'nenhuma',
  'keine', 'keiner', 'nichts', 'nessuno', 'nessuna', 'niente', 'нет', 'ничего', 'пусто',
  'कुछ नहीं', 'कोई नहीं', 'ഒന്നുമില്ല', 'ഇല്ല',
].join('|')})(?: (?:found|given|provided|noted|identified|available|yet))?$`, 'u');

const PLACEHOLDER_EMPTY_WORDS = new Set([
  'empty', 'blank', 'no', 'none', 'null', 'nothing', 'unavailable', 'missing', 'na',
  'sin', 'ningún', 'ninguna', 'aucun', 'aucune', 'sem', 'nenhum', 'nenhuma', 'kein', 'keine', 'senza', 'nessun', 'без',
  'vacío', 'vacía', 'vacio', 'vacia', 'vide', 'vazio', 'vazia', 'leer', 'leere', 'leeres', 'vuoto', 'vuota',
  'пусто', 'пустой', 'пустая', 'пустое', 'пустые', 'खाली', 'ശൂന്യം', 'ശൂന്യമാണ്',
]);
// The notes' own fields, in the languages the notes are written in. Not French
// "résumé", which is also the English word for a CV.
const PLACEHOLDER_FIELD_WORDS = new Set([
  'summary', 'overview', 'resumen', 'resumo', 'zusammenfassung', 'riepilogo', 'резюме', 'сводка',
  'सारांश', 'अवलोकन', 'സംഗ്രഹം', 'അവലോകനം',
]);
const PLACEHOLDER_CONTAINER_WORDS = new Set([
  'array', 'list', 'string', 'tableau', 'liste', 'chaîne', 'chaine', 'lista', 'arreglo', 'matriz', 'cadena', 'elenco', 'stringa',
  'zeichenkette', 'массив', 'список', 'строка', 'सूची', 'सरणी', 'പട്ടിക',
]);
const PLACEHOLDER_FILL_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'here', 'available', 'provided', 'given', 'found',
  'field', 'value', 'json', 'output', 'response', 'text',
  'el', 'la', 'un', 'una', 'es', 'está', 'esta', 'le', 'les', 'une', 'est',
  'die', 'der', 'das', 'ist', 'il', 'lo', 'è', 'o', 'um', 'uma', 'है', 'ആണ്',
]);
const NOTHING_TO_SUMMARIZE_RE = /^(?:there is )?nothing (?:to (?:summari[sz]e|report)|was said)$/;
// The polish prompts' condition, written back. Pinned to the prompts' wording by
// EmptyPlaceholderReply2026_10_24.test.mjs.
const NO_OUTCOME_RE = /^(?:(?:the )?notes (?:contain|contained|have|had|include|included|hold|show) )?no (?:concrete |clear |real |meaningful )?(?:outcomes?|substance)(?: to (?:summari[sz]e|report))?$/;
// Chinese and Japanese, without spaces: "摘要为空", "空的摘要", "无", "なし".
const CJK_FIELD = '(?:摘要|总结|總結|概要|要約)';
const CJK_EMPTY = '(?:空白|空|无|無|没有|沒有|なし)';
const CJK_PLACEHOLDER_RE = new RegExp(`^(?:${CJK_FIELD}(?:は|が|の|为|為|是|的)*${CJK_EMPTY}(?:的|です)?|${CJK_EMPTY}(?:的|の)?${CJK_FIELD}|无|無|なし|没有|沒有)$`, 'u');
const CJK_EMPTY_LIST_RE = /^(?:空|空的|空の)(?:数组|數組|配列|列表|リスト)$/u;
const EMPTY_TITLE_RE = /^(?:(?:an? |the )?(?:empty|blank|no|untitled)(?: (?:title|meeting|name))?|untitled (?:call|session)|sans titre|titre vide|sin título|sin titulo|título vacío|sem título|sem titulo|kein titel|ohne titel|leerer titel|senza titolo|titolo vuoto|без названия|без заголовка|пустой заголовок|शीर्षक नहीं|无标题|無標題|タイトルなし)$/u;

function isFieldEcho(words: string[], nouns: Set<string>): boolean {
  return words.length <= 8
    && words.some((w) => PLACEHOLDER_EMPTY_WORDS.has(w))
    && words.some((w) => nouns.has(w))
    && words.every((w) => PLACEHOLDER_EMPTY_WORDS.has(w) || PLACEHOLDER_FIELD_WORDS.has(w) || PLACEHOLDER_CONTAINER_WORDS.has(w) || PLACEHOLDER_FILL_WORDS.has(w));
}

/** True when the text says "this is empty" instead of being a note, overview or summary line. */
export function isEmptyPlaceholder(text: string): boolean {
  const raw = String(text || '');
  if (/^[\p{P}\s]*$/u.test(raw)) return true;
  if (/^\s*n\s*[/.]\s*a\s*\.?\s*$/i.test(raw)) return true;
  const t = placeholderKey(raw);
  if (!t) return false; // symbols only ("✅", "$") are not empty
  return PLACEHOLDER_NOTHING_RE.test(t)
    || NOTHING_TO_SUMMARIZE_RE.test(t)
    || NO_OUTCOME_RE.test(t)
    || CJK_PLACEHOLDER_RE.test(t.replace(/\s+/g, ''))
    || isFieldEcho(t.split(' '), PLACEHOLDER_FIELD_WORDS);
}

/** isEmptyPlaceholder, plus "Empty array" / "Empty string": for a list the prompt
 *  said to return empty (the polished summary, action items, decisions, risks,
 *  open questions), where such a line is the instruction, never a note. */
export function isEmptyListPlaceholder(text: string): boolean {
  if (isEmptyPlaceholder(text)) return true;
  const t = placeholderKey(text);
  return isFieldEcho(t.split(' '), PLACEHOLDER_CONTAINER_WORDS) || CJK_EMPTY_LIST_RE.test(t.replace(/\s+/g, ''));
}

/** True when a title is a question rather than a name. Judge the text as the
 *  model wrote it: cleanMeetingTitle drops the trailing question mark. */
export function isQuestionTitle(title: string): boolean {
  const t = String(title || '').trim();
  return !!t && QUESTION_TITLE_RES.some((re) => re.test(t));
}

/** True when a GENERATED title reads as an answer fragment, not a name. */
export function isAnswerFragmentTitle(title: string): boolean {
  const t = String(title || '').trim();
  if (!t) return false;
  if (ANSWER_FRAGMENT_TITLE_RES.some((re) => re.test(t))) return true;
  if (isNarrationTitle(t) || isEmptySessionTitle(t) || isQuestionTitle(t)) return true;
  if (isComplexityAnswerTitle(t)) return true;
  // A single all-lowercase token ("cpp") is an answer artifact — the 3-6-word
  // title prompt never legitimately produces one, and user/calendar titles do
  // not pass through this predicate.
  const words = t.split(/\s+/);
  if (words.length === 1 && t === t.toLowerCase() && /^[a-z0-9+#.]+$/.test(t)) return true;
  // An ENTIRELY-lowercase multi-word Latin title is a truncation fragment
  // ("ral backend for every keystroke" — the clamp caught a line mid-word,
  // session E 2026-08-23). Generated titles are Title Case; any uppercase
  // anywhere ("iOS Migration Kickoff") passes. Code-review 2026-08-23: the
  // rule requires EVERY word to carry an ASCII letter — a mixed-script title
  // ("പ്രോജക്ട് sync review") has caseless words that can never satisfy the
  // Title Case expectation, so it must not be judged by it.
  if (words.length >= 2 && !/[A-Z]/.test(t) && words.every((w) => /[a-z]/.test(w))) return true;
  return false;
}

/**
 * Catch-all for a GENERATED title whose source text is an ANSWER, whatever
 * the clamp salvages from it: after stripping code fences and the [[GIST]]
 * tail (the same pre-cleaning cleanMeetingTitle applies), a first content
 * line over 200 chars is the model answering the transcript — a real title
 * attempt, even a verbose one with reasoning underneath, keeps its first
 * line short. Code-review 2026-08-23: the first version of this rule lived
 * at the call site and measured the RAW first line, so a fence-wrapped
 * answer ("```\n<450-char explanation>\n```") measured 3 chars and walked
 * straight past it.
 */
export function isAnswerShapedGeneration(rawGenerated: unknown): boolean {
  let text = String(rawGenerated ?? '').replace(NUL_RE, '');
  const gistAt = text.indexOf('[[GIST]]');
  if (gistAt >= 0) text = text.slice(0, gistAt);
  text = text.replace(FENCE_RE, '');
  const firstLine = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
  return firstLine.length > 200;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function num(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeConfidence(value: unknown): Confidence {
  return VALID_CONFIDENCE.has(value as Confidence) ? (value as Confidence) : 'medium';
}

function inferSeverity(value: unknown): RiskItem['severity'] {
  const text = cleanString(value).toLowerCase();
  if (/\b(blocked|critical|security|legal|cannot|won't|miss deadline|outage)\b/.test(text)) return 'high';
  if (/\b(risk|concern|delay|budget|slip|unclear|dependency)\b/.test(text)) return 'medium';
  return 'low';
}

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\b(the|a|an|to|for|and|or|of|in|on|by)\b/g, '').replace(/\s+/g, ' ').trim();
}

function cleanId(value: unknown): string {
  return cleanString(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'section';
}

function arr(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Field coercers. Each accepts loose input (LLM JSON, legacy rows) and a mutable
// `track` flag set to true whenever a value had to be coerced/dropped.
// ─────────────────────────────────────────────────────────────────────────────

interface Track { repaired: boolean; }

export function sanitizeEvidenceArray(value: unknown, max: number): EvidenceRef[] {
  return arr(value)
    .map((item: any) => {
      // Accept both new (timestampMs, speakerId/speakerName) and legacy (timestamp, speaker).
      const ts = num(item?.timestampMs) ?? num(item?.timestamp);
      const speakerName = item?.speakerName ?? item?.speaker;
      const ref: EvidenceRef = {
        ...(item?.speakerId ? { speakerId: cleanString(item.speakerId).slice(0, 80) } : {}),
        ...(speakerName ? { speakerName: cleanString(speakerName).slice(0, 80) } : {}),
        ...(ts !== undefined ? { timestampMs: ts } : {}),
        ...(item?.quote ? { quote: cleanString(item.quote).slice(0, 220) } : {}),
        ...(item?.segmentId ? { segmentId: cleanString(item.segmentId).slice(0, 80) } : {}),
      };
      return ref;
    })
    .filter((e: EvidenceRef) => e.speakerId || e.speakerName || typeof e.timestampMs === 'number' || e.quote || e.segmentId)
    .slice(0, max);
}

export function sanitizeStringArray(value: unknown, max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of arr(value)) {
    const cleaned = cleanNoteText(item);
    if (!cleaned || FILLER_RE.test(cleaned) || isEmptyPlaceholder(cleaned)) continue;
    const key = normalizedKey(cleaned);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= max) break;
  }
  return out;
}

function dedupeByText<T extends { text: string }>(items: T[], max: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = normalizedKey(item.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

export function sanitizeDecisions(value: unknown, max: number, t?: Track): DecisionItem[] {
  return dedupeByText(arr(value).map((item: any) => {
    const ts = num(item?.timestampMs) ?? num(item?.timestamp);
    return {
      text: cleanNoteText(typeof item === 'string' ? item : item?.text),
      ...(item?.owner ? { owner: cleanString(item.owner).slice(0, 80) } : {}),
      ...(ts !== undefined ? { timestampMs: ts } : {}),
      evidence: sanitizeEvidenceArray(item?.evidence, 3),
      confidence: normalizeConfidence(item?.confidence),
      ...(item?.fromUserNotes === true ? { fromUserNotes: true } : {}),
    } as DecisionItem;
  }).filter((d: DecisionItem) => d.text && !isEmptyListPlaceholder(d.text)), max);
}

export function sanitizeActions(value: unknown, max: number, t?: Track): ActionItem[] {
  return dedupeByText(arr(value).map((item: any) => {
    const ts = num(item?.sourceTimestampMs) ?? num(item?.sourceTimestamp);
    return {
      text: cleanNoteText(typeof item === 'string' ? item : item?.text),
      ...(item?.owner ? { owner: cleanString(item.owner).slice(0, 80) } : {}),
      ...(item?.deadline ? { deadline: cleanString(item.deadline).slice(0, 80) } : {}),
      ...(ts !== undefined ? { sourceTimestampMs: ts } : {}),
      explicitness: VALID_EXPLICITNESS.has(item?.explicitness) ? item.explicitness : 'inferred',
      evidence: sanitizeEvidenceArray(item?.evidence, 3),
      confidence: normalizeConfidence(item?.confidence),
      ...(VALID_ACTION_STATUS.has(item?.status) ? { status: item.status } : {}),
      ...(item?.carriedOver === true ? { carriedOver: true } : {}),
      ...(item?.party === 'ours' || item?.party === 'theirs' ? { party: item.party } : {}),
      ...(item?.fromUserNotes === true ? { fromUserNotes: true } : {}),
    } as ActionItem;
  }).filter((a: ActionItem) => a.text && !isEmptyListPlaceholder(a.text)), max);
}

export function sanitizeQuestions(value: unknown, max: number): QuestionItem[] {
  return dedupeByText(arr(value).map((item: any) => ({
    text: cleanNoteText(typeof item === 'string' ? item : item?.text),
    ...(item?.owner ? { owner: cleanString(item.owner).slice(0, 80) } : {}),
    status: VALID_QUESTION_STATUS.has(item?.status) ? item.status : 'open',
    evidence: sanitizeEvidenceArray(item?.evidence, 3),
    ...(item?.confidence ? { confidence: normalizeConfidence(item.confidence) } : {}),
    ...(item?.carriedOver === true ? { carriedOver: true } : {}),
    ...(item?.fromUserNotes === true ? { fromUserNotes: true } : {}),
  } as QuestionItem)).filter((q: QuestionItem) => q.text && !isEmptyListPlaceholder(q.text)), max);
}

export function sanitizeRisks(value: unknown, max: number): RiskItem[] {
  return dedupeByText(arr(value).map((item: any) => ({
    text: cleanNoteText(typeof item === 'string' ? item : item?.text),
    severity: VALID_RISK_SEVERITY.has(item?.severity) ? item.severity : inferSeverity(item?.text),
    evidence: sanitizeEvidenceArray(item?.evidence, 3),
    ...(item?.confidence ? { confidence: normalizeConfidence(item.confidence) } : {}),
  } as RiskItem)).filter((r: RiskItem) => r.text && !isEmptyListPlaceholder(r.text)), max);
}

function sanitizeBullets(value: unknown, max: number): NoteBullet[] {
  return arr(value).map((item: any) => {
    const text = typeof item === 'string' ? item : item?.text;
    return {
      ...(item?.id ? { id: cleanString(item.id).slice(0, 80) } : {}),
      text: cleanNoteText(text),
      evidence: sanitizeEvidenceArray(item?.evidence, 3),
      ...(item?.confidence ? { confidence: normalizeConfidence(item.confidence) } : {}),
      ...(item?.fromUserNotes === true ? { fromUserNotes: true } : {}),
    } as NoteBullet;
  }).filter((b: NoteBullet) => b.text && !isEmptyPlaceholder(b.text)).slice(0, max);
}

function sanitizeSections(value: unknown, max: number): MeetingNoteSection[] {
  return arr(value).map((section: any, index: number) => ({
    id: cleanId(section?.id || section?.title || `section_${index}`),
    title: cleanString(section?.title || `Section ${index + 1}`),
    bullets: sanitizeBullets(section?.bullets, SECTION_BULLET_CAP),
    order: num(section?.order) ?? index,
  })).filter((s: MeetingNoteSection) => s.title && s.bullets.length > 0)
    .sort((a, b) => a.order - b.order)
    .slice(0, max);
}

function sanitizePeople(value: unknown, max: number): PersonMention[] {
  return arr(value).map((p: any) => ({
    ...(p?.speakerId ? { speakerId: cleanString(p.speakerId).slice(0, 80) } : {}),
    ...(p?.name ? { name: cleanString(p.name).slice(0, 80) } : {}),
    ...(p?.role ? { role: cleanString(p.role).slice(0, 80) } : {}),
    ...(p?.organization ? { organization: cleanString(p.organization).slice(0, 80) } : {}),
    ...(num(p?.mentions) !== undefined ? { mentions: num(p.mentions) } : {}),
    ...(p?.confidence ? { confidence: normalizeConfidence(p.confidence) } : {}),
  } as PersonMention)).filter((p: PersonMention) => p.name || p.speakerId).slice(0, max);
}

function sanitizeTimeline(value: unknown, max: number): TimelineItem[] {
  return arr(value).map((item: any, index: number) => {
    const ts = num(item?.timestampMs) ?? num(item?.timestamp);
    return {
      ...(item?.id ? { id: cleanId(item.id) } : { id: `moment_${index}` }),
      ...(ts !== undefined ? { timestampMs: ts } : {}),
      title: cleanNoteText(item?.title, 160),
      ...(item?.description ? { description: cleanNoteText(item.description, 260) } : {}),
      type: VALID_TIMELINE_TYPE.has(item?.type) ? item.type : 'topic_shift',
      evidence: sanitizeEvidenceArray(item?.evidence, 3),
    } as TimelineItem;
  }).filter((item: TimelineItem) => item.title).slice(0, max);
}

export function sanitizeFollowUpDraft(value: unknown): FollowUpDraft | undefined {
  if (!value) return undefined;
  // Legacy: a plain string body.
  if (typeof value === 'string') {
    const body = cleanString(value);
    if (!body) return undefined;
    return { type: 'email', body: value.trim(), tone: 'professional' };
  }
  if (typeof value !== 'object') return undefined;
  const raw = value as any;
  const body = typeof raw.body === 'string' ? raw.body.trim() : '';
  if (!body) return undefined;
  return {
    type: VALID_FOLLOWUP_TYPE.has(raw.type) ? raw.type : 'email',
    ...(raw.subject ? { subject: cleanString(raw.subject).slice(0, 160) } : {}),
    body: body.slice(0, 4000),
    tone: VALID_FOLLOWUP_TONE.has(raw.tone) ? raw.tone : 'professional',
    ...(Array.isArray(raw.basedOnActionItemIds) ? { basedOnActionItemIds: raw.basedOnActionItemIds.map((x: any) => cleanString(x)).filter(Boolean).slice(0, 50) } : {}),
    ...(Array.isArray(raw.basedOnDecisionIds) ? { basedOnDecisionIds: raw.basedOnDecisionIds.map((x: any) => cleanString(x)).filter(Boolean).slice(0, 50) } : {}),
  };
}

function sanitizeMode(value: unknown): MeetingSummaryModeMeta {
  const raw = (value && typeof value === 'object') ? value as any : {};
  const conf = num(raw.detectedConfidence);
  return {
    ...(raw.selectedModeId ? { selectedModeId: cleanString(raw.selectedModeId).slice(0, 80) } : {}),
    ...(raw.selectedModeName ? { selectedModeName: cleanString(raw.selectedModeName).slice(0, 80) } : {}),
    ...(raw.selectedTemplateType ? { selectedTemplateType: cleanString(raw.selectedTemplateType).slice(0, 80) } : {}),
    ...(raw.detectedModeId ? { detectedModeId: cleanString(raw.detectedModeId).slice(0, 80) } : {}),
    ...(raw.detectedModeName ? { detectedModeName: cleanString(raw.detectedModeName).slice(0, 80) } : {}),
    ...(conf !== undefined ? { detectedConfidence: clamp(conf, 0, 1) } : {}),
    ...(raw.summaryModeUsed ? { summaryModeUsed: cleanString(raw.summaryModeUsed).slice(0, 80) } : {}),
    ...(raw.noteTemplateId ? { noteTemplateId: cleanString(raw.noteTemplateId).slice(0, 64) } : {}),
    ...(raw.noteTemplateName ? { noteTemplateName: cleanString(raw.noteTemplateName).slice(0, 80) } : {}),
  };
}

function sanitizeGeneration(value: unknown): MeetingSummaryGenerationMeta {
  const raw = (value && typeof value === 'object') ? value as any : {};
  const validStrategy = new Set<SummaryStrategy>(['direct', 'map_reduce', 'long_context', 'fallback']);
  return {
    strategy: validStrategy.has(raw.strategy) ? raw.strategy : 'fallback',
    ...(raw.provider ? { provider: cleanString(raw.provider).slice(0, 80) } : {}),
    ...(raw.model ? { model: cleanString(raw.model).slice(0, 120) } : {}),
    startedAt: typeof raw.startedAt === 'string' && raw.startedAt ? raw.startedAt : new Date(0).toISOString(),
    ...(raw.completedAt ? { completedAt: cleanString(raw.completedAt) } : {}),
    ...(num(raw.durationMs) !== undefined ? { durationMs: num(raw.durationMs) } : {}),
    ...(num(raw.chunkCount) !== undefined ? { chunkCount: num(raw.chunkCount) } : {}),
    warnings: sanitizeStringArray(raw.warnings, 12),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: validate + repair a full MeetingSummaryV3.
// ─────────────────────────────────────────────────────────────────────────────

export function validateMeetingSummaryV3(value: unknown): ValidationResult<MeetingSummaryV3> {
  if (!value || typeof value !== 'object') {
    return { ok: false, errors: ['summary is not an object'], repaired: false };
  }
  const raw = value as any;
  const errors: string[] = [];

  const tldr = sanitizeStringArray(raw.tldr, 6);
  // Overview is a whole-meeting paragraph TLDR (up to ~400 words ≈ 2800 chars).
  const overview = cleanNoteText(raw.overview, 2800);
  const repairedTldr = tldr.length > 0
    ? tldr
    : overview.split(/(?<=[.!?])\s+/).map(s => cleanNoteText(s)).filter(Boolean).slice(0, 4);

  const decisions = sanitizeDecisions(raw.decisions, 40);
  const actionItems = sanitizeActions(raw.actionItems, 40);
  const openQuestions = sanitizeQuestions(raw.openQuestions, 40);
  const risks = sanitizeRisks(raw.risks, 40);
  const sections = sanitizeSections(raw.sections, 24);
  const followUpDraft = sanitizeFollowUpDraft(raw.followUpDraft);

  const summary: MeetingSummaryV3 = {
    schemaVersion: 3,
    title: cleanString(raw.title || 'Meeting Notes') || 'Meeting Notes',
    tldr: repairedTldr,
    overview,
    whatChanged: sanitizeStringArray(raw.whatChanged, 8),
    decisions,
    actionItems,
    openQuestions,
    risks,
    sections,
    ...(followUpDraft ? { followUpDraft } : {}),
    timeline: sanitizeTimeline(raw.timeline, 24),
    people: sanitizePeople(raw.people, 30),
    topics: sanitizeStringArray(raw.topics, 30),
    sourceQuality: {
      transcriptCoverage: clamp(Number(raw.sourceQuality?.transcriptCoverage ?? 0), 0, 1),
      speakerQuality: ['good', 'mixed', 'poor'].includes(raw.sourceQuality?.speakerQuality) ? raw.sourceQuality.speakerQuality : 'mixed',
      actionItemConfidence: normalizeConfidence(raw.sourceQuality?.actionItemConfidence),
      warnings: sanitizeStringArray(raw.sourceQuality?.warnings, 12),
    },
    mode: sanitizeMode(raw.mode),
    generation: sanitizeGeneration(raw.generation),
    ...(Array.isArray(raw.noteBlocks) ? { noteBlocks: raw.noteBlocks.slice(0, 120) } : {}),
    ...(raw.recipes && typeof raw.recipes === 'object'
      ? { recipes: Object.fromEntries(Object.entries(raw.recipes).map(([k, v]) => [cleanId(k), cleanString(v)]).filter(([k, v]) => k && v)) }
      : {}),
  };

  const hasStructuredContent =
    summary.decisions.length > 0 ||
    summary.actionItems.length > 0 ||
    summary.openQuestions.length > 0 ||
    summary.risks.length > 0 ||
    summary.sections.length > 0;

  const hasNarrative = Boolean(summary.overview) || summary.tldr.length > 0 || summary.whatChanged.length > 0;

  if (!hasStructuredContent && !hasNarrative) {
    errors.push('summary has no usable content');
    return { ok: false, errors, repaired: true };
  }

  return { ok: true, data: summary, errors, repaired: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Back-compat: render a legacy (pre-V3) detailedSummary as a minimal V3 view.
// Does NOT mutate or rewrite the stored row — purely for rendering/normalization.
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeLegacySummary(detailed: any): MeetingSummaryV3 | null {
  if (!detailed || typeof detailed !== 'object') return null;
  if (detailed.schemaVersion === 3) {
    const res = validateMeetingSummaryV3(detailed);
    return res.ok ? res.data! : null;
  }

  const overview = cleanNoteText(detailed.overview, 600);
  const keyPoints = sanitizeStringArray(detailed.keyPoints, 12);
  const legacyActions = sanitizeStringArray(detailed.actionItems, 30);
  const legacySections = arr(detailed.sections).map((s: any, i: number) => ({
    id: cleanId(s?.title || `section_${i}`),
    title: cleanString(s?.title || `Section ${i + 1}`),
    bullets: sanitizeStringArray(s?.bullets, 30).map(text => ({ text })),
    order: i,
  })).filter((s: MeetingNoteSection) => s.title && s.bullets.length > 0);

  if (!overview && keyPoints.length === 0 && legacyActions.length === 0 && legacySections.length === 0) {
    return null;
  }

  const v3: MeetingSummaryV3 = {
    schemaVersion: 3,
    title: cleanString(detailed.title || 'Meeting Notes') || 'Meeting Notes',
    tldr: keyPoints.length > 0 ? keyPoints.slice(0, 5) : (overview ? [overview] : []),
    overview,
    whatChanged: [],
    decisions: [],
    actionItems: legacyActions.map(text => ({ text, explicitness: 'inferred' as const, confidence: 'low' as const })),
    openQuestions: [],
    risks: [],
    sections: legacySections,
    ...(sanitizeFollowUpDraft(detailed.followUpDraft) ? { followUpDraft: sanitizeFollowUpDraft(detailed.followUpDraft) } : {}),
    sourceQuality: { transcriptCoverage: 0, speakerQuality: 'mixed', actionItemConfidence: 'low', warnings: ['Rendered from a legacy summary format.'] },
    mode: {},
    generation: { strategy: 'fallback', startedAt: new Date(0).toISOString(), warnings: ['legacy'] },
  };
  return v3;
}
