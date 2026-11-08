// personFacts.ts
//
// After a meeting is saved: one short model call that looks for people saying
// what they do or where they work ("I lead sales at Acme", "Priya, our CTO,
// will join"), so the People page can offer a title or company the user
// accepts with one click.
//
// Nothing the model says is taken on trust. A fact is kept only when:
//   - it is about someone known to have been in the meeting (by full name, or
//     a first name nobody else there shares);
//   - its quote is found, word for word (spacing and case aside), in the
//     transcript or the user's own notes;
//   - the quote is theirs, or names them (a line labelled with their name, or
//     a line or note that mentions their first name);
//   - the value is in the quote: a company's name is said, a title shares a
//     real word with what was said ("lead sales" supports "Head of Sales").
// Everything else is dropped. No outside lookups, ever: the transcript and the
// user's notes are the only sources.
//
// Pure apart from the injected model call: no Electron, no database.

import { nameKey } from './people';

export type PersonFactKind = 'title' | 'company';

export interface FactLine {
  /** Who said it, as the transcript shows it: "Me", a name, or "Speaker 1". */
  label: string;
  text: string;
}

export interface FactInput {
  lines: FactLine[];
  /** The user's own notes from the meeting, if any. */
  userNotes?: string;
  /** Everyone known to have been in the meeting (the user excluded). */
  people: Array<{ name: string }>;
  /** The user's own name, never given a fact here. */
  userName?: string;
}

export interface PersonFact {
  /** The person's name as listed in `people`. */
  person: string;
  kind: PersonFactKind;
  value: string;
  /** The words the fact rests on, as they appear in the source. */
  quote: string;
  source: 'transcript' | 'notes';
}

const MAX_LINES = 500;
const MAX_CHARS = 16_000;
const MAX_LINE_CHARS = 400;
const MAX_NOTES_CHARS = 3_000;
const MAX_FACTS = 20;
const VALUE_MAX = 80;
const QUOTE_MIN = 8;
export const PERSON_FACTS_TIMEOUT_MS = 25_000;

export const PERSON_FACTS_PROMPT = `You read a meeting transcript and find where a person in the meeting states their own job title or role, or the organisation they work for, or where someone else states it about them.

Only report what was actually said. Never infer a title from what someone talked about, never guess a company from an email address or a topic, and never fill in a title or company that nobody said.

For every fact give:
- "person": the person's name exactly as listed under "People in the meeting".
- "kind": "title" for a job title or role, "company" for the organisation they work for.
- "value": the title or company, short, in the words used ("Head of Sales", "Acme").
- "quote": the exact words from one transcript line or from the user's notes that state it, copied word for word.

Skip the recording person ("Me"). Skip anyone not listed under "People in the meeting".

Reply with JSON only:
{"facts":[{"person":"Dana Fox","kind":"title","value":"Head of Sales","quote":"I lead the sales team here at Acme"},{"person":"Dana Fox","kind":"company","value":"Acme","quote":"I lead the sales team here at Acme"}]}
Reply {"facts":[]} when nobody states a title or company.`;

/** The context the prompt reads: who was there, then the numbered transcript, then the user's notes (all bounded). */
export function buildFactContext(input: FactInput): { context: string; lines: FactLine[]; notes: string } {
  const lines: FactLine[] = [];
  let chars = 0;
  for (const line of input.lines || []) {
    const text = String(line?.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LINE_CHARS);
    if (!text) continue;
    if (lines.length >= MAX_LINES || chars + text.length > MAX_CHARS) break;
    lines.push({ label: String(line.label || 'Speaker'), text });
    chars += text.length;
  }
  const notes = typeof input.userNotes === 'string' ? input.userNotes.trim().slice(0, MAX_NOTES_CHARS) : '';
  const people = (input.people || []).map((p) => p.name).filter(Boolean);
  const context = [
    `People in the meeting: ${people.length ? people.join('; ') : '(none)'}`,
    `The recording person ("Me"): ${input.userName?.trim() || '(name not known)'}`,
    '',
    'Transcript:',
    ...lines.map((l, i) => `${i + 1}. ${l.label}: ${l.text}`),
    ...(notes ? ['', "The user's own notes:", '"""', notes, '"""'] : []),
  ].join('\n');
  return { context, lines, notes };
}

interface RawFact {
  person?: unknown;
  kind?: unknown;
  value?: unknown;
  quote?: unknown;
}

/** The model's reply as raw facts; [] for anything that is not the JSON asked for. */
export function parseFactReply(raw: unknown): RawFact[] {
  if (typeof raw !== 'string') return [];
  const body = raw.replace(/```(?:json)?/gi, '').trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return Array.isArray(parsed?.facts) ? parsed.facts.filter((f: unknown) => f && typeof f === 'object').slice(0, MAX_FACTS * 2) : [];
  } catch {
    return [];
  }
}

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[‘’]/g, "'").replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
const wordsOf = (s: string) => norm(s).split(' ').filter(Boolean);

const STOP = new Set(['the', 'and', 'for', 'our', 'at', 'of', 'a', 'an', 'in', 'on', 'to', 'team', 'here', 'with', 'senior', 'junior', 'lead', 'head', 'chief', 'vice', 'president', 'principal', 'staff', 'associate', 'assistant']);
const COMPANY_SUFFIX = new Set(['inc', 'ltd', 'llc', 'llp', 'plc', 'corp', 'corporation', 'co', 'company', 'gmbh', 'ag', 'sa', 'bv', 'pty', 'limited', 'group']);

// Roles people say as a verb or a short form: "I lead sales" is "Head of Sales",
// "I run engineering" is "VP Engineering". Compared on the first five letters,
// so "engineer" / "engineering" and "sale" / "sales" meet.
const stem = (w: string) => (w.length > 5 ? w.slice(0, 5) : w);
const ABBREVIATIONS: Record<string, string[]> = {
  cto: ['technology', 'technical'], ceo: ['executive'], cfo: ['financial', 'finance'], coo: ['operating', 'operations'],
  cmo: ['marketing'], cpo: ['product', 'people'], cro: ['revenue'], vp: ['vice'], pm: ['product', 'project'],
  em: ['engineering'], swe: ['software', 'engineer'], hr: ['human', 'people'], ae: ['account'], sdr: ['sales', 'development'],
};

/** A title is in the quote when one of its real words (or what its abbreviation stands for) was said. */
export function titleSupported(value: string, quote: string): boolean {
  const q = new Set(wordsOf(quote).map(stem));
  const qRaw = new Set(wordsOf(quote));
  for (const w of wordsOf(value)) {
    if (qRaw.has(w) && w.length >= 2 && !STOP.has(w)) return true;
    if (ABBREVIATIONS[w]?.some((full) => q.has(stem(full)))) return true;
    for (const [abbr, fulls] of Object.entries(ABBREVIATIONS)) {
      if (qRaw.has(abbr) && fulls.some((f) => stem(f) === stem(w))) return true;
    }
    if (w.length >= 3 && !STOP.has(w) && q.has(stem(w))) return true;
  }
  return false;
}

/** A company is in the quote when every word of its name (legal suffixes aside) was said. */
export function companySupported(value: string, quote: string): boolean {
  const q = new Set(wordsOf(quote));
  const words = wordsOf(value).filter((w) => !COMPANY_SUFFIX.has(w));
  return words.length > 0 && words.every((w) => q.has(w));
}

function matchPerson(raw: string, people: Array<{ name: string }>): { name: string } | null {
  const k = nameKey(raw);
  if (!k) return null;
  const exact = people.filter((p) => nameKey(p.name) === k);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const first = k.split(' ')[0];
  const sameFirst = people.filter((p) => nameKey(p.name).split(' ')[0] === first);
  if (sameFirst.length === 1 && (!k.includes(' ') || !nameKey(sameFirst[0].name).includes(' '))) return sameFirst[0];
  return null;
}

/** The quote mentions this person's first name as a word. */
function names(text: string, person: { name: string }): boolean {
  const first = nameKey(person.name).split(' ')[0];
  return !!first && first.length >= 2 && wordsOf(text).includes(first);
}

/** The model's facts, kept only where the person, the quote and the value all check out. */
export function vetFacts(raw: RawFact[], input: FactInput, lines: FactLine[], notes: string): PersonFact[] {
  const out: PersonFact[] = [];
  const seen = new Set<string>();
  const userKey = nameKey(input.userName);
  for (const f of raw) {
    if (out.length >= MAX_FACTS) break;
    const kind = f.kind === 'title' || f.kind === 'company' ? f.kind : null;
    if (!kind || typeof f.person !== 'string' || typeof f.value !== 'string' || typeof f.quote !== 'string') continue;
    const value = f.value.replace(/\s+/g, ' ').trim();
    if (value.length < 2 || value.length > VALUE_MAX || !/\p{L}/u.test(value)) continue;
    const person = matchPerson(f.person, input.people || []);
    if (!person) continue;
    if (userKey && nameKey(person.name) === userKey) continue;
    const quote = norm(f.quote);
    if (quote.length < QUOTE_MIN) continue;

    // Where the quote is: a transcript line (theirs, or one that names them),
    // else the user's notes (only a passage that names them).
    let found: { text: string; source: 'transcript' | 'notes' } | null = null;
    for (const line of lines) {
      if (!norm(line.text).includes(quote)) continue;
      const theirs = !!nameKey(line.label) && matchPerson(line.label, input.people || []) === person;
      if (theirs || names(line.text, person)) { found = { text: line.text, source: 'transcript' }; break; }
    }
    if (!found && notes && norm(notes).includes(quote) && names(f.quote, person)) {
      found = { text: f.quote.trim(), source: 'notes' };
    }
    if (!found) continue;

    const supported = kind === 'company' ? companySupported(value, f.quote) : titleSupported(value, f.quote);
    if (!supported) continue;
    const key = `${nameKey(person.name)}|${kind}|${norm(value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ person: person.name, kind, value, quote: f.quote.replace(/\s+/g, ' ').trim().slice(0, 300), source: found.source });
  }
  return out;
}

/** One call with a deadline: the reply text, or '' on timeout or failure. */
async function ask(call: (system: string, context: string) => Promise<string>, context: string, timeoutMs: number): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const reply = call(PERSON_FACTS_PROMPT, context);
    reply.catch(() => { /* settled after the deadline */ });
    return await Promise.race([
      reply,
      new Promise<string>((resolve) => { timer = setTimeout(() => resolve(''), timeoutMs); }),
    ]);
  } catch {
    return '';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Titles and companies stated in the meeting, vetted. No call at all when
 * nobody else is known to have been there or nothing was said.
 */
export async function extractPersonFacts(
  input: FactInput,
  call: (system: string, context: string) => Promise<string>,
  opts: { timeoutMs?: number } = {},
): Promise<PersonFact[]> {
  if (!input.people?.length) return [];
  const { context, lines, notes } = buildFactContext(input);
  if (lines.length === 0 && !notes) return [];
  const reply = await ask(call, context, opts.timeoutMs ?? PERSON_FACTS_TIMEOUT_MS);
  return vetFacts(parseFactReply(reply), input, lines, notes);
}
