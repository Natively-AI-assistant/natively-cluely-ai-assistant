// electron/services/knowledge/ownAnswers.ts
//
// "Cue Cards" (2026-10-14): the questions only the user can answer.
//
// A 2.9.2 user reported that Natively wrote a good answer and then replaced it
// with "let me come back to you on that". The cause was structural: asked
// "what is your biggest weakness?" with only a résumé loaded, an answer has to
// name a weakness the résumé does not state, so one pass either invents it or
// defers. Four prompt wordings did not change that on two models. The only
// source for these answers is the user, and the app had nowhere to hold them:
// PROFILE_FACT, the source type that is authoritative for claims about the
// user, had no store (v3ProfileSources: "the pool is empty").
//
// This module is the pure half: which questions exist, how an answer is
// cleaned, which answers a meeting may read, and the one prompt that drafts
// them from a résumé. No Electron, no database, no model call: the store
// (OwnAnswersStore) and the IPC handlers own those.

export type OwnAnswerStatus = 'draft' | 'saved';

export interface OwnAnswerQuestion {
  key: string;
  /** Shown above the box, and the heading the model reads the answer under. */
  label: string;
  /** What the box is for, in one line under the label. */
  hint: string;
  /**
   * How the question is put in an interview, for the model that reads the
   * answer. Measured in the app with a salary range and a "why this role"
   * answer both saved: heard "what are you looking for in base?" was answered
   * with the answer about the role, whose text happened to say "looking for".
   * The label alone ("Salary expectation") shares no word with "base".
   */
  askedAs: string;
  /**
   * Whether Natively may draft it from the résumé. False for what only the
   * user can know (a number, a yes or no, a date): a draft there would be a
   * guess the user might say aloud as their own.
   */
  drafted: boolean;
  /** Only drafted when a job description is loaded: the answer is about that role. */
  needsJob?: boolean;
  maxChars: number;
}

/** A spoken answer runs to about 80 words; 600 characters holds one with room. */
export const OWN_ANSWER_MAX_CHARS = 600;
export const OWN_ANSWER_NOTES_MAX_CHARS = 1500;

export const OWN_ANSWER_QUESTIONS: readonly OwnAnswerQuestion[] = [
  { key: 'weakness', label: 'Biggest weakness', askedAs: 'your biggest weakness, what you need to improve or get better at', hint: 'What you are working on, and what you do about it.', drafted: true, maxChars: OWN_ANSWER_MAX_CHARS },
  { key: 'strength', label: 'Biggest strength', askedAs: 'your biggest strength, what you are best at', hint: 'What you do best, with the work that shows it.', drafted: true, maxChars: OWN_ANSWER_MAX_CHARS },
  { key: 'why_field', label: 'Why this field', askedAs: 'why you chose this field, career or degree', hint: 'Why you chose this kind of work.', drafted: true, maxChars: OWN_ANSWER_MAX_CHARS },
  { key: 'why_leaving', label: 'Why you left, or are leaving, your last job', askedAs: 'why you left a job, why you are leaving, why you are looking', hint: 'The reason you would give an interviewer.', drafted: true, maxChars: OWN_ANSWER_MAX_CHARS },
  { key: 'why_role', label: 'Why this role', askedAs: 'why this role, why this company, why you applied', hint: 'What draws you to the job you are applying for.', drafted: true, needsJob: true, maxChars: OWN_ANSWER_MAX_CHARS },
  { key: 'conflict', label: 'A conflict at work', askedAs: 'a conflict or disagreement with a colleague and how you handled it', hint: 'A disagreement and how you handled it.', drafted: true, maxChars: OWN_ANSWER_MAX_CHARS },
  { key: 'failure', label: 'A mistake or failure', askedAs: 'a mistake, a failure, something that went wrong', hint: 'What went wrong and what you changed.', drafted: true, maxChars: OWN_ANSWER_MAX_CHARS },
  { key: 'salary', label: 'Salary expectation', askedAs: 'salary, pay, base, compensation expectations, what you are looking for in base', hint: 'The range you would say out loud.', drafted: false, maxChars: OWN_ANSWER_MAX_CHARS },
  { key: 'relocation', label: 'Relocation, remote or office', askedAs: 'relocating, moving, remote, hybrid or in-office work', hint: 'Where you can work, and whether you would move.', drafted: false, maxChars: OWN_ANSWER_MAX_CHARS },
  { key: 'notice', label: 'Notice period or start date', askedAs: 'notice period, when you can start, availability', hint: 'When you could start.', drafted: false, maxChars: OWN_ANSWER_MAX_CHARS },
  { key: 'notes', label: 'Anything else about you', askedAs: 'other facts about you', hint: 'Facts your résumé leaves out that you want Natively to know.', drafted: false, maxChars: OWN_ANSWER_NOTES_MAX_CHARS },
];

const QUESTION_BY_KEY = new Map(OWN_ANSWER_QUESTIONS.map((q) => [q.key, q]));

export function ownAnswerQuestion(key: unknown): OwnAnswerQuestion | undefined {
  return typeof key === 'string' ? QUESTION_BY_KEY.get(key) : undefined;
}

/** Trimmed, whitespace runs collapsed inside a line, cut at the question's limit. */
export function cleanOwnAnswer(key: string, text: unknown): string {
  const q = QUESTION_BY_KEY.get(key);
  if (!q || typeof text !== 'string') return '';
  const t = text.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return t.length > q.maxChars ? t.slice(0, q.maxChars).trimEnd() : t;
}

export type OwnAnswerOrigin = 'user' | 'drafted';
/** `origin`: 'drafted' when the user accepted Natively's draft without changing a word, 'user' otherwise. */
export interface OwnAnswerRow { key: string; text: string; status: OwnAnswerStatus; origin?: OwnAnswerOrigin; updatedAt?: string }
export interface ServedOwnAnswer { key: string; label: string; askedAs: string; text: string; origin: OwnAnswerOrigin }

/**
 * The answers a meeting may read: only what the user wrote or approved.
 *
 * A draft is Natively's own text about the user. Served as evidence it would be
 * spoken in the first person as the user's own statement before they had read
 * it, which is the defect the résumé-based salary estimate had (see
 * v3ProfileSources, NO DERIVED PROFILE FACTS). A draft becomes evidence when the
 * user presses Use, or edits and saves it.
 */
export function servedOwnAnswers(rows: readonly OwnAnswerRow[]): ServedOwnAnswer[] {
  const byKey = new Map(rows.filter((r) => r.status === 'saved').map((r) => [r.key, r]));
  const out: ServedOwnAnswer[] = [];
  for (const q of OWN_ANSWER_QUESTIONS) {
    const row = byKey.get(q.key);
    const text = cleanOwnAnswer(q.key, row?.text);
    if (text) out.push({ key: q.key, label: q.label, askedAs: q.askedAs, text, origin: row?.origin === 'drafted' ? 'drafted' : 'user' });
  }
  return out;
}

// ── drafting ────────────────────────────────────────────────────────────────

/** How much of each document the drafting call reads. A résumé that fits the live prompt whole is under this. */
const DRAFT_DOCUMENT_MAX_CHARS = 24_000;

/** The questions a drafting run may fill: draftable, not already answered by the user, and about a job only when one is loaded. */
export function draftableOwnAnswerKeys(rows: readonly OwnAnswerRow[], hasJob: boolean): string[] {
  const saved = new Set(rows.filter((r) => r.status === 'saved' && r.text.trim()).map((r) => r.key));
  return OWN_ANSWER_QUESTIONS
    .filter((q) => q.drafted && !saved.has(q.key) && (!q.needsJob || hasJob))
    .map((q) => q.key);
}

/**
 * One prompt for every draft. The reply is JSON keyed by question.
 *
 * The draft is read and approved by the user before a meeting can use it, so it
 * may propose how the candidate works and why. It may not state a number, a
 * date, an employer, a title, a tool or a named event the résumé does not
 * state: those are the claims an interviewer can check, and a user skimming ten
 * drafts will not check each against their own history.
 */
export function ownAnswerDraftPrompt(input: { resumeText: string; jobText?: string | null; keys: readonly string[] }): string {
  const questions = input.keys
    .map((k) => QUESTION_BY_KEY.get(k))
    .filter((q): q is OwnAnswerQuestion => Boolean(q))
    .map((q) => `"${q.key}": ${q.label}. ${q.hint}`);
  const job = String(input.jobText ?? '').trim();
  return [
    'You draft short interview answers for a job candidate to review and edit. The candidate will read every draft before using it.',
    'Write each answer in the first person, as the candidate would say it aloud: two to four plain sentences, no bullet points, no headings, no bold.',
    'Build each answer on what the résumé states. You may describe how the candidate works, what they find hard, and why they made a choice, as a reasonable reading of the résumé.',
    'Never state a number, a date, an employer, a job title, a tool, a person or a named event that the résumé does not state. For a conflict or a mistake, describe the kind of situation and how they handle it, anchored to a real project from the résumé, without inventing who said what.',
    'Never mention the résumé, the job description or that this is a draft.',
    job ? 'A job description is included: use it only for the answer about the role.' : '',
    'Reply with one JSON object and nothing else. Its keys are exactly the keys listed below; each value is the answer as a string.',
    '',
    'Questions:',
    ...questions,
    '',
    'RÉSUMÉ:',
    String(input.resumeText ?? '').trim().slice(0, DRAFT_DOCUMENT_MAX_CHARS),
    job ? `\nJOB DESCRIPTION:\n${job.slice(0, DRAFT_DOCUMENT_MAX_CHARS)}` : '',
  ].filter((l) => l !== '').join('\n');
}

/** The model's reply, as cleaned answers for the keys that were asked. Anything else in it is dropped. */
export function parseOwnAnswerDrafts(reply: unknown, keys: readonly string[]): Record<string, string> {
  const text = String(reply ?? '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { return {}; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const key of keys) {
    const q = QUESTION_BY_KEY.get(key);
    if (!q || !q.drafted) continue;
    const cleaned = cleanOwnAnswer(key, (parsed as Record<string, unknown>)[key]);
    if (cleaned) out[key] = cleaned;
  }
  return out;
}
