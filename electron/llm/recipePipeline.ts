// electron/llm/recipePipeline.ts
//
// Notepad recipes "List my todos", "Write tldr" and "Write follow up email",
// built for a small fast model (2026-10-31).
//
// Asked in one prompt, the model kept giving the user other people's tasks:
// "I'll send you a report every Monday" said by a colleague became the user's,
// and the meeting notes (written by the same model earlier) often name the
// wrong owner. Granola beat us on todos 7.6 to 5.4 in a blind grade for that
// reason. So these recipes now run in steps:
//   1. The model lists every commitment as JSON, each with the transcript
//      words it rests on (commitmentsPrompt).
//   2. Code finds that line and reads its ME/THEM label, which speech
//      recognition gets right, and decides whose task it is (decideOwner).
//   3. "List my todos" is written by code from that list (renderTodos). The
//      tldr and the email get the checked list as WHO DOES WHAT and answer as
//      JSON; code writes their fixed parts (first line, greeting, sign-off).
// Pure module: no Electron, no I/O. The caller passes the chat function.

import { isSpokenSavedLine } from '../intelligence/savedTranscriptOrigin';

export type CommitmentJson = {
  task?: unknown;
  owner?: unknown;
  due?: unknown;
  quote?: unknown;
};

export type CommitmentsJson = {
  commitments: CommitmentJson[];
  followups?: unknown[];
  people?: Array<{ name?: unknown; side?: unknown }>;
  user_names?: unknown[];
  kind?: unknown;
  open?: unknown[];
};

/** `voice`: who on the other side spoke, when the transcript knows ("Noah", "Speaker 2"). */
type Line = { who: 'ME' | 'THEM'; text: string; voice?: string };
type Commitment = { task: string; owner: string; due: string | null; quote: string };
type Decision = { mine: boolean; owner: string; at: Line | null };
type Decided = { c: Commitment; d: Decision };

export type MeetingAnalysis = {
  decided: Decided[];
  theirs: string[];
  ours: string[];
  userNames: Set<string>;
  kind: 'class' | 'meeting';
  open: string[];
};

export type ChatFn = (system: string, user: string) => Promise<string | null | undefined>;

/** The recipes this pipeline writes; every other recipe keeps its one-prompt path. */
export const STEPPED_RECIPE_IDS = ['todos', 'tldr', 'follow-up-email'] as const;
export type SteppedRecipeId = (typeof STEPPED_RECIPE_IDS)[number];
export const isSteppedRecipe = (id: string): id is SteppedRecipeId => (STEPPED_RECIPE_IDS as readonly string[]).includes(id);

// ── Step 1: the commitments, as JSON ────────────────────────────────────────

const COMMITMENTS_SYSTEM = `You read a meeting transcript and list the commitments made in it, as JSON.
Lines starting "ME:" are spoken by the user. Lines starting "THEM:" are spoken by anyone else; a line starting "THEM (Noah):" names who spoke, so a promise on it is Noah's and "owner" is "Noah". "THEM (Speaker 2):" is a voice nobody named: when the lines show who it is (someone speaks to them by name just before), use that name in "owner" and "people"; never list "Speaker 2" as a person. Speech recognition joins some turns and mishears names and words, so read for meaning: when a phrase makes no sense, take its meaning from the lines around it and from the NOTES.
A commitment is something a person will do: a promise ("I'll send...", "I can have it on staging by..."), an agreement to a request ("Yes, I'll email her today"), or a task one person gives another ("Paul, you get a staging build on the 20th", "I want you to take Friday off").
For each commitment give:
- "task": a short imperative phrase, as a to-do, naming the person it is for when there is one ("Send Aisha a short brief", "Show Ifeoma order tracking"). Leave the due date out of it. When the NOTES state the same task, use their wording, which was read more cleanly.
- "owner": "me" when the user (ME) will do it; otherwise the name of the person who will do it, as the transcript says it.
- "due": when it is due, as said ("by Wednesday", "by Thursday, November 5", "today", "in January", "every Monday from November 9"), or null.
- "quote": the exact words from the ONE transcript line where the owner promises it, agrees to it, or is given it.
Who owns it:
- "I'll ..." on a THEM line is that other person's commitment, never mine, even when it is about me.
- On a ME line, "I'll ..." or "let me ..." is mine; but a ME line telling or asking someone else to do something ("can you...", "I want you to...", "write a one-page summary", "Mei: endpoint by the fifth") gives it to them.
- Work a speaker sets for everyone listening, me included (homework, reading, a quiz or exam to sit, something to hand in, a deadline the class must meet), is mine: owner "me", quoting the line that sets it.
- A recap of who does what repeats commitments; list each commitment once, quoting where it was first made.
Also give "followups": one to three things the user should do that the meeting implies but nobody promised, such as checking that someone else delivers ("Confirm Kemal reconnects the feed by November 6"), each with "task" and "quote" (the transcript words it comes from). Something I said I would do is a commitment, not a followup. Never a commitment already listed, never something the meeting already settled (a decision made, a yes already given), and never a task someone else was asked or offered to do (a candidate's own preparation is the candidate's).
Also give:
- "people": the people taking part in the meeting (they speak, or are spoken to as present), never people only talked about and never the user; each with "side": "mine" for the user's own colleagues or team (someone ME brings along, introduces as "our ..." or "from our ... team", or works with day to day), or "theirs" for the people the user is meeting (a customer, candidate, investor, guest, lecturer).
- "user_names": the names the others use when talking to the user (ME), if any.
- "kind": "class" for a lecture, lesson or talk the user attends, else "meeting".
- "open": up to four things raised but not agreed, or put off, each a short phrase saying who left it open ("the $40M pre-money valuation: Samuel wants to see how it was reached first").
Write every task, quote and open point in the language the meeting is spoken in (quotes word for word).
Answer with JSON only: {"commitments":[{"task":"...","owner":"...","due":"...","quote":"..."}],"followups":[{"task":"...","quote":"..."}],"people":[{"name":"...","side":"theirs"}],"user_names":["..."],"kind":"meeting","open":["..."]}`;

/** The ME/THEM lines of a recipe context (ended: FULL TRANSCRIPT; live: TRANSCRIPT SO FAR). */
const LINE_HEAD = /^(ME|THEM)(?: \(([^()\n]{1,40})\))?:\s*/;

export function transcriptLines(context: string): Line[] {
  const out: Line[] = [];
  for (const l of context.split('\n')) {
    const m = LINE_HEAD.exec(l);
    if (!m) continue;
    out.push({ who: m[1] === 'ME' ? 'ME' : 'THEM', text: l.slice(m[0].length), ...(m[2] ? { voice: m[2].trim() } : {}) });
  }
  return out;
}

export type VoiceRow = { speaker?: unknown; text?: unknown; speakerId?: unknown; origin?: unknown };

const VOICE_ID = /^speaker_(\d{1,3})$/;

/**
 * A finished meeting whose other side was told apart by voice (provider diarization:
 * transcripts.speaker_id, named through the meeting's speakerLabels when someone named
 * them) gets its transcript rebuilt from those rows, as "THEM (Noah): ...". The RAG
 * chunks the context is built from keep only ME/THEM, and speech recognition joins
 * several people into one THEM line, so a promise ("I'll put the breakdown in the data
 * room") could not be told from the request before it. Unchanged when no row has a
 * voice, or when the transcript was cut to fit (its chunks then cover only the start).
 */
export function withVoiceTranscript(context: string, rows: VoiceRow[] | null | undefined, labels?: Record<string, unknown> | null): string {
  if (!Array.isArray(rows) || !rows.some((r) => VOICE_ID.test(String(r?.speakerId ?? '')))) return context;
  const head = /^FULL TRANSCRIPT[^\n]*\n/m.exec(context);
  if (!head) return context;
  const name = (id: string) => {
    const label = labels && typeof labels[id] === 'string' ? String(labels[id]).trim() : '';
    return (label || `Speaker ${VOICE_ID.exec(id)![1]}`).replace(/[():\n]/g, ' ').trim().slice(0, 40);
  };
  const lines: string[] = [];
  for (const r of rows) {
    // Natively's answers and typed chat are saved with the transcript; only what was said counts.
    if (!isSpokenSavedLine({ speaker: typeof r?.speaker === 'string' ? r.speaker : undefined, origin: typeof r?.origin === 'string' ? r.origin : null })) continue;
    const text = String(r?.text ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (/^(user|me)$/i.test(String(r?.speaker ?? ''))) { lines.push(`ME: ${text}`); continue; }
    const id = String(r?.speakerId ?? '');
    lines.push(VOICE_ID.test(id) ? `THEM (${name(id)}): ${text}` : `THEM: ${text}`);
  }
  if (!lines.length) return context;
  return `${context.slice(0, head.index)}FULL TRANSCRIPT (ME is the user; THEM is everyone else; "THEM (Name)" names who spoke):\n${lines.join('\n')}`;
}

/** Null when the context has no transcript lines (nothing to check owners against). */
/** The notes above the transcript, for wording only (their owners are checked against the transcript). */
function notesForWording(context: string): string {
  const at = context.search(/^(FULL TRANSCRIPT|TRANSCRIPT)/m);
  if (at <= 0) return '';
  return context.slice(0, at).replace(/^NOTES[^\n]*\n/, '').trim().slice(0, 6000);
}

export function commitmentsPrompt(context: string): { system: string; user: string } | null {
  const lines = transcriptLines(context);
  if (lines.length === 0) return null;
  // The notes were written from a cleaner reading of the same meeting ("early-afternoon
  // slot" where the transcript says "enough to noon slot"); they help with wording and
  // with tasks the transcript garbles. Owners still come from the transcript lines.
  const notes = notesForWording(context);
  const head = notes ? `NOTES (for wording and for tasks the transcript garbles; they sometimes give a task to the wrong person, so take owners and quotes from the transcript only):\n${notes}\n\n` : '';
  // The model skips small promises late in a long meeting ("I'll put it in the team
  // calendar"); listing my promise-like lines makes it look at each one.
  const promises = lines.filter((l) => l.who === 'ME' && FIRST_PERSON.test(l.text)).map((l) => `- ${l.text}`);
  const check = promises.length ? `\n\nMY LINES THAT MAY HOLD A PROMISE (list each real promise in them, about something to do after the meeting; skip remarks about the meeting itself, like "let me share my screen"):\n${promises.join('\n')}` : '';
  return { system: COMMITMENTS_SYSTEM, user: `${head}TRANSCRIPT:\n${lines.map((l) => `${l.who}${l.voice ? ` (${l.voice})` : ''}: ${l.text}`).join('\n')}${check}` };
}

/** Parses the model's JSON; when it is broken (a stray "]"), takes its flat objects one by one. */
export function parseModelJson(text: string | null | undefined): Record<string, unknown> | null {
  const t = String(text ?? '').replace(/^```(json)?/m, '').replace(/```\s*$/m, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  const body = t.slice(a, b + 1);
  for (const candidate of [body, body.replace(/"\]\s*"\s*,\s*"/g, '","')]) {
    // The second try repairs a list closed early: ["one."]","two"].
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch { /* next */ }
  }
  return salvageCommitments(t);
}

function salvageCommitments(t: string): Record<string, unknown> | null {
  const objs = (re: RegExp) =>
    (t.match(re) || [])
      .map((o) => { try { return JSON.parse(o); } catch { return null; } })
      .filter(Boolean);
  const strings = (key: string, stop: string[]) => {
    const i = t.indexOf(`"${key}"`);
    if (i < 0) return [];
    const rest = t.slice(i + key.length + 2);
    const ends = stop.map((k) => rest.indexOf(`"${k}"`)).filter((x) => x >= 0).sort((x, y) => x - y);
    const part = rest.slice(0, ends[0] ?? rest.length);
    return (part.match(/"((?:[^"\\]|\\.)*)"/g) || [])
      .map((q) => { try { return JSON.parse(q) as string; } catch { return null; } })
      .filter((q): q is string => !!q && q.length > 1);
  };
  const fAt = t.indexOf('"followups"');
  const before = fAt >= 0 ? t.slice(0, fAt) : t;
  const after = fAt >= 0 ? t.slice(fAt) : '';
  const objsIn = (part: string, re: RegExp) =>
    (part.match(re) || []).map((o) => { try { return JSON.parse(o); } catch { return null; } }).filter(Boolean);
  const commitments = objsIn(before, /\{\s*"task"[^{}]*\}/g);
  if (commitments.length === 0) {
    // A tldr or email answer: flat string fields.
    const field = (k: string) => { const m = t.match(new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`)); try { return m ? JSON.parse(`"${m[1]}"`) : undefined; } catch { return undefined; } };
    const out: Record<string, unknown> = {};
    for (const k of ['topic', 'to', 'subject']) { const v = field(k); if (v !== undefined) out[k] = v; }
    for (const k of ['bullets', 'paragraphs']) { const v = strings(k, ['topic', 'to', 'subject', 'bullets', 'paragraphs'].filter((x) => x !== k)); if (v.length) out[k] = v; }
    return Object.keys(out).length ? out : null;
  }
  return {
    commitments,
    followups: (() => { const o = objsIn(after.split(/"(people|user_names|kind)"/)[0], /\{\s*"task"[^{}]*\}/g); return o.length ? o : strings('followups', ['people', 'user_names', 'kind']); })(),
    people: objs(/\{\s*"name"[^{}]*\}/g),
    user_names: strings('user_names', ['kind', 'people', 'open']),
    open: strings('open', ['kind', 'people', 'user_names', 'followups']),
    kind: /"kind"\s*:\s*"class"/.test(t) ? 'class' : 'meeting',
  };
}

export function asCommitments(json: Record<string, unknown> | null): CommitmentsJson | null {
  if (!json || !Array.isArray(json.commitments)) return null;
  return json as unknown as CommitmentsJson;
}

// ── Step 2: whose task it is, from the line's ME/THEM label ─────────────────

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const firstName = (n: unknown) => String(n ?? '').trim().split(/\s+/)[0] || '';
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The transcript line a quote comes from. Speech recognition splits words ("del ete"), so compare letters only. */
export function locateQuote(lines: Line[], quote: string): Line | null {
  const q = norm(quote);
  if (q.length < 6) return null;
  for (const probe of [q, q.slice(0, 40), q.slice(-40), q.slice(0, 24)]) {
    if (probe.length < 12 && probe !== q) continue;
    const hit = lines.find((l) => norm(l.text).includes(probe));
    if (hit) return hit;
  }
  const words = new Set(String(quote).toLowerCase().match(/[a-z0-9']+/g) || []);
  let best: Line | null = null;
  let score = 0;
  for (const l of lines) {
    const w = String(l.text).toLowerCase().match(/[a-z0-9']+/g) || [];
    const s = w.filter((x) => words.has(x)).length / Math.max(words.size, 1);
    if (s > score) { score = s; best = l; }
  }
  return score >= 0.6 ? best : null;
}

const FIRST_PERSON = /\b(i'll|i will|i can|i'm going to|i am going to|let me|i'll aim|i'm adding|i'll have|i'll take)\b/i;
const SECOND_PERSON = /\b(you|your|everyone|all of you)\b/i;
const DIRECTIVE = /\b(i want you|i need you|can you|could you|would you|you'll|you get|you have|you take|you're|you are|your job)\b/i;
// An instruction opening my line, said to the room: "Make sure the endpoint has a
// runbook", "Please send the logs". Speech recognition often drops "sure" ("Make the
// endpoint has a runbook").
const OPENING_INSTRUCTION = /^(?:(?:ok(?:ay)?|noted|great|right|so|and|also|then)[,.]?\s+)*(?:[A-Z][a-z]+,\s+)?(make sure|make the|make it|please|remember to|don't forget|do not forget)\b/i;
const SET_WORK = /^(read|try|bring|send|submit|hand|finish|do|prepare|review|study|complete|write|sit)\b/i;

/**
 * Whose task a commitment is. The model's "me" is kept only when the line agrees:
 * a THEM line's own promise ("I'll send you a report") is never mine; a ME line
 * telling someone else to do it ("I want you to take Friday off") is theirs.
 */
// Work a class is set, said as a fact ("Problem set 4 is due Monday"); letters only,
// as speech recognition splits words ("re ad chapter 6").
const CLASS_WORK = /(due|quiz|exam|midterm|final|read|submit|handin|homework|problemset|assignment|essay|please)/;

export function decideOwner(lines: Line[], c: Commitment, userNames: Set<string> = new Set(), kind: 'class' | 'meeting' = 'meeting'): Decision {
  const at = locateQuote(lines, c.quote);
  const owner = c.owner.trim();
  // A promise on a line that names its speaker is that speaker's, whatever the model wrote.
  // An unnamed voice ("Speaker 2") cannot confirm a name; it can only rule out the name
  // of another voice.
  const promiseOnVoice = at?.who === 'THEM' && !!at.voice && FIRST_PERSON.test(c.quote);
  const named = (v: string | undefined) => !!v && !/^speaker \d+$/i.test(v);
  const voiceOwner = (fallback: string) => {
    if (!promiseOnVoice) return fallback;
    if (named(at!.voice)) return at!.voice!;
    const otherVoices = new Set(lines.filter((l) => named(l.voice)).map((l) => firstName(l.voice).toLowerCase()));
    return otherVoices.has(firstName(fallback).toLowerCase()) ? '' : fallback;
  };
  // A promise on my own line is mine, whatever name the model gave it ("Hugo" for the
  // user's "I'll send you a short brief"), unless it hands the task to the person it
  // names ("Ben, I'll need you to...").
  const ownerFirst = firstName(owner).toLowerCase();
  if (at?.who === 'ME' && FIRST_PERSON.test(c.quote) && !DIRECTIVE.test(c.quote)
    && !(ownerFirst && new RegExp(`\\b${ownerFirst.replace(/[^a-z'-]/g, '')}\\b`, 'i').test(c.quote))) {
    return { mine: true, owner: 'me', at };
  }
  if (!/^(me|i|myself|the user)$/i.test(owner)) return { mine: false, owner: voiceOwner(owner), at };
  if (!at) return { mine: true, owner: 'me', at };
  if (at.who === 'THEM') {
    // A THEM line puts a task on me when it asks or sets me something ("could you set
    // that up", "for next Monday, read chapter six", "Owen, the paperwork by Wednesday"),
    // never when it is the speaker's promise or the speaker's own status ("Code complete
    // by November 20", said of their own work).
    const setWork = SET_WORK.test(c.quote.replace(/^.*?,\s*/, ''));
    const promise = FIRST_PERSON.test(c.quote)
      || (FIRST_PERSON.test(at.text) && !SECOND_PERSON.test(c.quote) && !setWork);
    const quoteWords = c.quote.toLowerCase().match(/[a-z']+/g) || [];
    const asksMe = SECOND_PERSON.test(c.quote) || setWork || quoteWords.some((w) => userNames.has(w))
      || (kind === 'class' && CLASS_WORK.test(norm(c.quote)));
    const mine = !promise && asksMe;
    return { mine, owner: mine ? 'me' : voiceOwner(''), at };
  }
  if ((DIRECTIVE.test(c.quote) || OPENING_INSTRUCTION.test(c.quote.trim())) && !FIRST_PERSON.test(c.quote)) return { mine: false, owner: '', at };
  return { mine: true, owner: 'me', at };
}

function toCommitment(raw: CommitmentJson): Commitment | null {
  const task = typeof raw?.task === 'string' ? raw.task.trim() : '';
  if (!task) return null;
  const due = typeof raw.due === 'string' && raw.due.trim() ? raw.due.trim() : null;
  return { task, owner: typeof raw.owner === 'string' ? raw.owner : '', due, quote: typeof raw.quote === 'string' ? raw.quote : '' };
}

const wordSet = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9]{3,}/g) || []);

/**
 * The names the others use for the user. The model's guess is checked against the
 * transcript: a name I say is not mine (people rarely say their own name), and when
 * someone is spoken to by name, the next speaker tells whose name it is: ME answering
 * means it is mine ("Owen, this call is about..." / ME: "I figured"), THEM answering
 * means it is someone else's ("Noah, what's the failure rate?" / THEM: "1.4%").
 */
function answeredBy(n: string, context: string): { me: number; them: number } {
  const lines = transcriptLines(context);
  const re = addressRe(n);
  let me = 0, them = 0;
  lines.forEach((l, i) => {
    if (l.who !== 'THEM' || !re || !re.test(l.text.toLowerCase())) return;
    const next = lines[i + 1];
    if (next?.who === 'ME') me++; else if (next) them++;
  });
  return { me, them };
}

function userNamesFrom(json: CommitmentsJson, context: string): Set<string> {
  const clean = (n: unknown) => { const f = firstName(n).toLowerCase(); return /^[a-z][a-z'-]+$/.test(f) ? f : ''; };
  const out = new Set<string>();
  for (const n of (Array.isArray(json.user_names) ? json.user_names : []).map(clean)) {
    if (!n || saidByMe(n, context)) continue;
    const t = answeredBy(n, context);
    if (t.them <= t.me || t.me + t.them === 0) out.add(n);
  }
  for (const p of Array.isArray(json.people) ? json.people : []) {
    const n = clean(p?.name);
    if (!n || saidByMe(n, context)) continue;
    const t = answeredBy(n, context);
    if (t.me > t.them) out.add(n);
  }
  return out;
}

/**
 * Follow-ups come as { task, quote } (or plain strings from older answers). One whose
 * quote is a promise on one of my own lines ("I'll put it in the team calendar") is a
 * commitment the model filed in the wrong list: it moves to the commitments.
 */
export function normaliseCommitments(json: CommitmentsJson, context: string): CommitmentsJson {
  const lines = transcriptLines(context);
  const commitments = [...(json.commitments || [])];
  const followups: string[] = [];
  const taskWords = (t: unknown) => new Set(String(t ?? '').toLowerCase().match(/[a-z]{4,}/g) || []);
  const overlaps = (a: Set<string>, b: Set<string>) => [...a].filter((w) => b.has(w)).length / Math.max(Math.min(a.size, b.size), 1) >= 0.5;
  for (const f of Array.isArray(json.followups) ? json.followups : []) {
    const task = typeof f === 'string' ? f : typeof (f as any)?.task === 'string' ? (f as any).task : '';
    if (!task.trim()) continue;
    const quote = typeof f === 'object' && f && typeof (f as any).quote === 'string' ? (f as any).quote : '';
    const at = quote ? locateQuote(lines, quote) : null;
    if (at && at.who === 'ME' && FIRST_PERSON.test(quote) && !DIRECTIVE.test(quote)) {
      const w = taskWords(task);
      if (!commitments.some((c) => overlaps(w, taskWords(c?.task)))) commitments.push({ task, owner: 'me', due: null, quote });
      continue;
    }
    followups.push(task.trim());
  }
  return { ...json, commitments, followups };
}

/**
 * Unnamed voices ("Speaker 3") named from turn-taking: "Noah, what's the failure rate?"
 * answered by Speaker 3 makes Speaker 3 Noah. Only with at least two such turns, at
 * least two thirds of that voice's answers, and one name per voice; otherwise the
 * voice keeps its number.
 */
const NOT_NAMES = new Set(['okay', 'yes', 'yeah', 'well', 'so', 'thanks', 'thank', 'right', 'sure', 'great', 'perfect', 'please', 'sorry', 'honestly', 'look', 'listen', 'hi', 'hey', 'hello', 'good', 'fine', 'fair', 'and', 'but', 'also', 'then', 'now', 'first', 'second', 'last', 'one', 'two', 'speaker']);

/** Spoken to by name, as a voice is named from it: "Noah, a technical one", "I'm sorry, Chemo—how fast". */
function voiceAddressRe(name: string): RegExp | null {
  const w = name.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return null;
  return new RegExp(`(^|[.!?]["'”]?\\s+|,\\s+)["'“]?((hi|hey|hello|thanks|thank you|okay|ok|great|perfect|sorry)[,.]?\\s+)?${w}\\s*[,.!?:—–-]`);
}

/**
 * Unnamed voices ("Speaker 3") named from turn-taking: "Noah, what's the failure rate?"
 * answered by Speaker 3 makes Speaker 3 Noah. Candidate names are the model's people
 * plus names spoken to at the start of a sentence. A voice is named with two such
 * turns (two thirds of its votes), or with one when nothing contradicts it and the
 * voice speaks at least three times; one name per voice. Returns the lines and the
 * voice-to-name map.
 */
export function nameVoicesWithMap(lines: Line[], names: string[]): { lines: Line[]; named: Map<string, string> } {
  // A word spoken to at a sentence start counts only if it is also written capitalised
  // mid-sentence somewhere, as a name is ("Imogen, Noah, good to meet"); "Vaccines,
  // insulin, biologics" is not a name.
  const all = lines.map((l) => l.text).join(' ');
  const properNoun = (w: string) => new RegExp(`(?:[a-z,;]\\s+)${w}\\b`).test(all);
  const spoken = new Set<string>();
  for (const l of lines) {
    for (const m of l.text.matchAll(/(?:^|[.!?]["'”]?\s+)([A-Z][a-z]{2,})\s*[,—–]/g)) {
      if (!NOT_NAMES.has(m[1].toLowerCase()) && properNoun(m[1])) spoken.add(m[1]);
    }
  }
  const firsts = [...new Set([...names.map((n) => firstName(n)), ...spoken]
    .filter((n) => /^[A-Za-z][a-z'-]+$/.test(n) && !NOT_NAMES.has(n.toLowerCase())))];
  const votes = new Map<string, Map<string, number>>();
  const turns = new Map<string, number>();
  lines.forEach((l, i) => {
    if (l.voice) turns.set(l.voice, (turns.get(l.voice) ?? 0) + 1);
    const next = lines[i + 1];
    if (!next || next.who !== 'THEM' || !next.voice || !/^speaker \d+$/i.test(next.voice) || l.voice === next.voice) return;
    const text = l.text.toLowerCase();
    // A greeting to several people ("Imogen, Noah, good to meet you") or a sign-off
    // ("Thanks, Samuel. Speak soon.") says nothing about who answers next.
    const addressed = firsts.filter((n) => voiceAddressRe(n)?.test(text));
    if (addressed.length !== 1) return;
    if (new RegExp(`(thanks|thank you)[,.]?\\s+${addressed[0].toLowerCase()}\\b`).test(text)) return;
    const v = votes.get(next.voice) ?? new Map<string, number>();
    v.set(addressed[0], (v.get(addressed[0]) ?? 0) + 1);
    votes.set(next.voice, v);
  });
  const votedFor = (name: string) => [...votes.values()].filter((v) => v.has(name)).length;
  const named = new Map<string, string>();
  const taken = new Set<string>();
  for (const [voice, v] of votes) {
    const ranked = [...v.entries()].sort((a, b) => b[1] - a[1]);
    const total = ranked.reduce((n, [, c]) => n + c, 0);
    const [name, count] = ranked[0];
    const clear = count >= 2 ? count / total >= 2 / 3 : total === 1 && votedFor(name) === 1 && (turns.get(voice) ?? 0) >= 3;
    if (clear && !taken.has(name)) { named.set(voice, name); taken.add(name); }
  }
  return { lines: named.size ? lines.map((l) => (l.voice && named.has(l.voice) ? { ...l, voice: named.get(l.voice)! } : l)) : lines, named };
}

export function nameVoices(lines: Line[], names: string[]): Line[] {
  return nameVoicesWithMap(lines, names).lines;
}

export function analyseMeeting(rawJson: CommitmentsJson, context: string): MeetingAnalysis {
  const json = normaliseCommitments(rawJson, context);
  const peopleNames = (Array.isArray(json.people) ? json.people : []).map((p) => String(p?.name ?? ''));
  const voiced = nameVoicesWithMap(transcriptLines(context), peopleNames.filter((n) => !/^speaker \d+$/i.test(n.trim())));
  const lines = voiced.lines;
  // An owner the model wrote as the voice ("Speaker 2") takes that voice's name.
  const voiceName = (o: string) => voiced.named.get(o.trim().replace(/^speaker/i, 'Speaker')) ?? o;
  const userNames = userNamesFrom(json, context);
  const seen = new Set<string>();
  const commitments = (json.commitments || []).map(toCommitment).filter((c): c is Commitment => {
    if (!c) return false;
    const k = norm(c.task).slice(0, 30);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const decided: Decided[] = commitments.map((c) => {
    const d = decideOwner(lines, { ...c, owner: voiceName(c.owner) }, userNames, json.kind === 'class' ? 'class' : 'meeting');
    // Owner written as a name the others use for the user: mine only if ME said it;
    // a THEM line's own promise is someone else's whose name we do not know.
    if (!d.mine && userNames.has(firstName(d.owner).toLowerCase())) {
      const at = d.at || locateQuote(lines, c.quote);
      if (at && at.who === 'ME') return { c, d: { ...d, mine: true, owner: 'me' } };
      return { c, d: { ...d, owner: '' } };
    }
    return { c, d };
  });
  // The same task listed twice (once with a deadline, once without): keep the dated one.
  const mineAll = decided.filter((x) => x.d.mine);
  const isDup = (x: Decided) => !dueParts(x.c.due) && mineAll.some((o) => o !== x && !!dueParts(o.c.due)
    && [...wordSet(x.c.task)].filter((w) => wordSet(o.c.task).has(w)).length / Math.max(wordSet(x.c.task).size, 1) >= 0.6);
  const kept = decided.filter((x) => !(x.d.mine && isDup(x)));
  const people = (Array.isArray(json.people) ? json.people : [])
    .filter((p) => p && typeof p.name === 'string' && p.name.trim() && !userNames.has(firstName(p.name).toLowerCase()));
  const side = (p: { name?: unknown; side?: unknown }) => (p.side === 'theirs' && introducedAsMine(String(p.name), context) ? 'mine' : p.side);
  return {
    decided: kept,
    theirs: people.filter((p) => side(p) === 'theirs').map((p) => String(p.name)),
    ours: people.filter((p) => side(p) === 'mine').map((p) => String(p.name)),
    userNames,
    kind: json.kind === 'class' ? 'class' : 'meeting',
    open: (Array.isArray(json.open) ? json.open : []).filter((o): o is string => typeof o === 'string' && !!o.trim()).map((o) => o.trim()).slice(0, 4),
  };
}

// ── Dates and lines ─────────────────────────────────────────────────────────

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthDay = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;

/** "Wednesday" → "Wednesday, November 4", "today" → "today, October 31", counted from the meeting's date. */
export function withDate(phrase: string, base: Date | null): string {
  if (!base) return phrase;
  return phrase
    .replace(/^(today|tonight)$/i, (w) => `${w}, ${monthDay(base)}`)
    .replace(/^tomorrow$/i, (w) => { const d = new Date(base); d.setDate(d.getDate() + 1); return `${w}, ${monthDay(d)}`; })
    .replace(/^(this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/i, (_all, _pre, day: string) => {
      const d = new Date(base);
      let add = (DAYS.indexOf(day.toLowerCase()) - d.getDay() + 7) % 7;
      if (add === 0) add = 7;
      d.setDate(d.getDate() + add);
      return `${cap(day.toLowerCase())}, ${monthDay(d)}`;
    });
}

const PREPOSITION = /^(by|on|before|in|from|starting|at|until)\s+(.*)$/i;

export function dueParts(due: string | null, base: Date | null = null): { prep: string; what: string } | null {
  const d = String(due ?? '').trim().replace(/[.]$/, '');
  if (!d || /^(null|none|n\/a|no deadline.*)$/i.test(d)) return null;
  const m = d.match(PREPOSITION);
  if (m) return { prep: m[1].toLowerCase(), what: withDate(m[2], base) };
  if (/^next /i.test(d)) return { prep: 'by', what: d }; // "next Monday" is ambiguous: keep it as said
  if (/^(today|tonight|tomorrow|this |every |each )/i.test(d)) return { prep: '', what: withDate(d, base) };
  return { prep: 'by', what: withDate(d, base) };
}

/** "Put the model in by Friday" with due "by Friday, November 6" → "Put the model in". */
export function stripDueTail(task: string, due: string | null): string {
  const dw = new Set(String(due ?? '').toLowerCase().match(/[a-z0-9']+/g) || []);
  const re = /\s+(by|before|on|at|in|until|this|next|tomorrow|today)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(task))) {
    const tail = task.slice(m.index).toLowerCase().match(/[a-z0-9']+/g) || [];
    const content = tail.filter((w) => !['by', 'before', 'on', 'at', 'in', 'the', 'of', 'until'].includes(w));
    if (content.length && content.filter((w) => dw.has(w)).length / content.length >= 0.8) {
      const two = task.slice(m.index).match(/^\s+(in|on)\s+(?=(by|before|until)\b)/i); // keep the "in" of "in by Friday"
      if (two) return task.slice(0, m.index + two[0].length - 1).trimEnd();
      // "Read chapter 6, for next Monday" loses its due date: drop the "for" and the comma too.
      return task.slice(0, m.index).replace(/[,\s]+(for|by|before|on|until)$/i, '').replace(/[,\s]+$/, '');
    }
  }
  return task;
}

/** One to-do line in Granola's shape: the task, then its due date in bold, or "No deadline was promised.". */
export function todoLine(c: { task: string; due: string | null; owner?: string }, withOwner: boolean, base: Date | null): string {
  let task = cap(c.task.trim().replace(/[.;,]\s*$/, ''));
  const due = dueParts(c.due, base);
  let body: string;
  if (!due) body = `${task}. No deadline was promised.`;
  else {
    task = stripDueTail(task, c.due);
    const said = String(c.due).trim().replace(PREPOSITION, '$2').replace(/[.]$/, '');
    const i = task.toLowerCase().indexOf(said.toLowerCase());
    body = said.length > 2 && i >= 0
      ? `${task.slice(0, i)}**${task.slice(i, i + said.length)}**${task.slice(i + said.length)}.`
      : `${task} ${due.prep ? `${due.prep} ` : ''}**${due.what}**.`;
  }
  return withOwner ? `**${c.owner}:** ${body}` : body;
}

const NO_NAME = /^(me|i|them|someone|others?|everyone|the user|unknown)$/i;

// ── Step 3: writing ─────────────────────────────────────────────────────────

/** "List my todos": written by code from the checked commitments. */
export function renderTodos(rawJson: CommitmentsJson, context: string, base: Date | null): string {
  const json = normaliseCommitments(rawJson, context);
  const { decided } = analyseMeeting(json, context);
  const mine = decided.filter((x) => x.d.mine).map((x) => x.c);
  const others = decided.filter((x) => !x.d.mine && x.d.owner && !NO_NAME.test(x.d.owner)).map((x) => ({ ...x.c, owner: x.d.owner }));
  const out = ['**To do:**', ''];
  if (mine.length) mine.forEach((c) => out.push(`- ${todoLine(c, false, base)}`));
  else if (others.length) others.forEach((c) => out.push(`- ${todoLine(c, true, base)}`));
  else out.push('- Nothing has been committed to yet.');
  const mineKeys = mine.map((c) => new Set(c.task.toLowerCase().match(/[a-z]{4,}/g) || []));
  const followups = (Array.isArray(json.followups) ? json.followups : [])
    .filter((f): f is string => typeof f === 'string' && !!f.trim())
    .map((f) => f.trim())
    // A follow-up that restates one of my own tasks ("Confirm the Brightdesk order is signed").
    .filter((f) => { const w = f.toLowerCase().match(/[a-z]{4,}/g) || []; return !mineKeys.some((k) => w.filter((x) => k.has(x)).length / Math.max(k.size, 1) >= 0.5); })
    .slice(0, 3);
  if (followups.length) {
    out.push('', '**Inferred:**', '');
    followups.forEach((f) => out.push(`- ${cap(f.replace(/[.]$/, ''))}.`));
  }
  return out.join('\n');
}

/** The checked list the tldr and email are written from. */
export function factsBlock(a: MeetingAnalysis, base: Date | null): string {
  const out = ['WHO DOES WHAT (checked against the transcript; trust this over the notes, which sometimes give a task to the wrong person):'];
  for (const { c, d } of a.decided) {
    const who = d.mine ? 'Me' : d.owner && !NO_NAME.test(d.owner) ? d.owner : 'Someone else (not me; name unclear)';
    out.push(`- ${who}: ${todoLine(c, false, base).replace(/\*\*/g, '')}`);
  }
  if (a.decided.length === 0) out.push('- Nobody committed to anything.');
  const mine = a.decided.filter((x) => x.d.mine).map((x) => todoLine(x.c, false, base).replace(/\*\*/g, ''));
  out.push(mine.length ? `MY OWN TASKS (only these are mine; every other task belongs to someone else): ${mine.join(' ')}` : 'MY OWN TASKS: none; I committed to nothing myself.');
  if (a.userNames.size) out.push(`NAMES THE OTHERS USE FOR ME: ${[...a.userNames].map(cap).join(', ')} (that is me, the user; never write it as someone else)`);
  if (a.theirs.length) out.push(`THE PEOPLE I MET: ${a.theirs.join(', ')}`);
  if (a.ours.length) out.push(`MY OWN SIDE: ${a.ours.join(', ')}`);
  if (a.open.length) out.push(`STILL OPEN (raised but not agreed; never write any of these as agreed or accepted, and they are not the subject: give the meeting's substance first and mark one as open only where you state it): ${a.open.join('; ')}`);
  out.push(`KIND: ${a.kind}`);
  return out.join('\n');
}

/** The notes' "- Name: task" action lines name owners, often wrongly; the checked list replaces them. */
export function withoutOwnerLines(context: string): string {
  const at = context.search(/^(FULL TRANSCRIPT|TRANSCRIPT)/m);
  const notes = at >= 0 ? context.slice(0, at) : context;
  const rest = at >= 0 ? context.slice(at) : '';
  const kept = notes.split('\n').filter((l) => !/^\s*[-*]\s+(\*\*)?[A-Z][\w.' -]{0,24}(\*\*)?:\s/.test(l)
    || /^\s*[-*]\s+(Note|Summary|Context|Decision|Risk|Open question)s?:/i.test(l));
  return kept.join('\n') + rest;
}

const WRITE_RULES = `Everything ME says is the user, whatever name the others call them by; write as the user ("I", "we"), never about them by name. "I" on a THEM line is that other person: write their name ("Diego handles about 60% of escalations"), never "I". "THEM (Noah):" names who spoke; "Speaker 2" is a voice nobody named, so never write "Speaker 2": say "they", or leave the person out.
Use only what was said; keep names, figures and dates exactly as in the meeting; never add a figure that was not said. Write ranges with "to" ("£60k to £70k", "December 1 to February 28"): dashes are turned into commas after you answer.
Answer with JSON only, no other text.`;

export function tldrPrompt(context: string, facts: string): { system: string; user: string } {
  return {
    system: `You write a two-bullet TL;DR of a meeting for the user. ${WRITE_RULES}`,
    user: `Write the TL;DR as JSON: {"topic":"...","bullets":["...","..."]}
- "topic": what the meeting was about, as a phrase that follows "to discuss" or "on" (e.g. "the chatbot's resolution drop and the renewal price"); at most 12 words and two subjects, with no people's names.
- "bullets": exactly two, each one sentence of 20 to 30 words; a semicolon may join two short parts. Keep only the two or three figures and dates that matter most.
  - First bullet: the heart of what was learnt, with its key numbers. For a problem, what went wrong, why, and by how much. For a customer or research call, what they need and what they would pay. For an interview, how the candidate did and the terms. For a class, what the lesson taught (the idea and its example), not the logistics.
  - Second bullet: what was decided, with the figures that matter (prices, targets, dates), and the next steps with their dates and owners. For a class, the deadlines and what they require.
- Say only what was agreed as agreed: an offer someone asked about or put off is not accepted. Who does what must match WHO DOES WHAT below.

${withoutOwnerLines(context)}

${facts}`,
  };
}

/** Who "you" is in the email, decided by code before it is written. */
function recipientLine(recipient: string | undefined): string {
  if (!recipient) return '';
  if (recipient === 'there') return '\nTHE EMAIL GOES TO: the person I met, whose name was not caught. "You" in the email means them only; my colleagues and anyone only talked about are named.';
  if (recipient === 'all') return '\nTHE EMAIL GOES TO: everyone in the meeting.';
  return `\nTHE EMAIL GOES TO: ${recipient}. "You" in the email means ${recipient} only; everyone else is named.`;
}

export function emailPrompt(context: string, facts: string, recipient?: string): { system: string; user: string } {
  return {
    system: `You write the user's follow-up email after a meeting. ${WRITE_RULES}`,
    user: `Write the follow-up email as JSON: {"to":"<first name>","subject":"...","paragraphs":["...","..."]}
- "to": the first name of the person the email goes to (THE EMAIL GOES TO below), never someone only talked about.
- "subject": under 8 words.
- "paragraphs": exactly two, each exactly two sentences of at most 22 words (count them): first the agreed terms (the key prices, targets, dates) and what I will do ("I'll ..."), with dates; then what I need from them or what they said they would do, and what my colleagues will do, by name, with dates. Leave out background and anything they already know. Who does what must match WHO DOES WHAT exactly; never write that I will do someone else's task.
- No greeting, no sign-off: those are added for you.
The notes may give tasks to the wrong person; WHO DOES WHAT and MY OWN TASKS below are checked and win. A task listed for "Someone else (name unclear)" is written without a name ("the Monday reports start November 9"), never as mine and never as "you".

${withoutOwnerLines(context)}

${facts}${recipientLine(recipient)}`,
  };
}

/**
 * Someone the user speaks to directly ("Chris, start us off", "Hi. Field.", "Thank
 * you, Bob."), as opposed to someone only talked about ("I'd like to talk to Luis").
 */
function addressedByMe(name: string, context: string): boolean {
  return addressedBy('ME', name, context);
}

function addressRe(name: string): RegExp | null {
  const w = name.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return null;
  return new RegExp(`(^|[.!?]["'”]?\\s+)["'“]?((hi|hey|hello|thanks|thank you|okay|ok|great|perfect)[,.]?\\s+)?${w}\\s*[,.!?:]`);
}

function addressedBy(who: 'ME' | 'THEM', name: string, context: string): boolean {
  const re = addressRe(name);
  return !!re && transcriptLines(context).some((l) => l.who === who && re.test(l.text.toLowerCase()));
}

/** The people the first line may name: those I speak to (theirs, then mine), else those I name. */
function presentNames(a: MeetingAnalysis, context: string): string[] {
  const theirs = a.theirs.map(firstName).filter(Boolean);
  // A colleague I brought along is not who I met.
  const ours = a.ours.map(firstName).filter((n) => n && !introducedAsMine(n, context));
  for (const pool of [theirs, ours]) {
    const spokenTo = pool.filter((n) => addressedByMe(n, context));
    if (spokenTo.length) return spokenTo;
  }
  return (theirs.length ? theirs : ours).filter((n) => saidByMe(n, context));
}

/** "I've brought Kemal from our solutions team": the model sometimes puts my colleague on their side. */
function introducedAsMine(name: string, context: string): boolean {
  const w = name.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return false;
  // Letters only: speech recognition splits words ("from o ur solutions team").
  const re = new RegExp(`${w}(fromour|onour|frommyteam|mycolleague)|(mycolleague|ourcolleague)${w}`);
  return transcriptLines(context).some((l) => l.who === 'ME' && re.test(norm(l.text)));
}

function saidByMe(name: string, context: string): boolean {
  const w = name.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return false;
  const re = new RegExp(`\\b${w}\\b`);
  return transcriptLines(context).some((l) => l.who === 'ME' && re.test(l.text.toLowerCase()));
}

function tldrBullets(json: Record<string, unknown> | null): string[] {
  return (Array.isArray(json?.bullets) ? json!.bullets : [])
    .map((b) => String(Array.isArray(b) ? b.join('; ') : b ?? '').trim().replace(/^[-*]\s*/, ''))
    .filter(Boolean)
    .slice(0, 2);
}

/** The model writes 35-50-word bullets whatever the prompt says; a TL;DR bullet is about 25. */
export const TLDR_BULLET_MAX_WORDS = 32;

/**
 * "I"/"my" statements in the bullets that repeat another person's own words about
 * themselves and none of mine: "I worked 58 hours" from Diego's "I worked 58 hours
 * last week". Each comes with the line it came from, so the fix can name the speaker.
 */
export function borrowedFirstPerson(bullets: string[], context: string): Array<{ clause: string; line: string }> {
  const lines = transcriptLines(context);
  const meText = lines.filter((l) => l.who === 'ME').map((l) => norm(l.text)).join('|');
  const out: Array<{ clause: string; line: string }> = [];
  for (const b of bullets) {
    for (const clause of b.split(/;|\.\s/)) {
      const re = /\b(I|I'm|I've|I'd|my)\s+((?:[\w$%£€'.,-]+\s+){1,3}[\w$%£€'.,-]+|[\w$%£€'.,-]+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(clause))) {
        // "I worked 58 hours" -> "iworked58hours": letters and digits only, as speech
        // recognition splits words ("5 8 hours").
        const words = m[2].split(/\s+/).slice(0, 3).join(' ');
        const probe = norm(`${m[1]} ${words}`);
        if (probe.length < 8 || meText.includes(probe)) continue;
        const theirs = lines.find((l) => l.who === 'THEM' && norm(l.text).includes(probe));
        if (theirs) { out.push({ clause: clause.trim(), line: `THEM${theirs.voice ? ` (${theirs.voice})` : ''}: ${theirs.text.slice(0, 300)}` }); break; }
      }
    }
  }
  return out;
}

const HEDGE = /\b(open|not agreed|not yet|undecided|pending|unresolved|questioned|wants to understand|to be decided|reserved|deferred|still)\b/i;
// Money only ("$40M", "£2,750"): a price or valuation is what gets written as agreed.
const figures = (t: string) => (t.match(/[$£€]\s?\d[\d,.]*\s?(?:[kKmMbB]n?\b|million|billion)?/g) || []).map((f) => f.replace(/\s+/g, '').replace(/[,.]$/, '').toLowerCase());

/**
 * Open points (raised, not agreed) whose figure a bullet states with no hedge: "Samuel
 * wants $5M at $40M pre-money" when the $40M was one he wanted explained first.
 */
export function openPointsStatedAsAgreed(bullets: string[], open: string[]): string[] {
  const out: string[] = [];
  for (const o of open) {
    const f = figures(o);
    if (!f.length) continue;
    if (bullets.some((b) => !HEDGE.test(b) && figures(b).some((x) => f.includes(x)))) out.push(o);
  }
  return out;
}

/** Null when the bullets are already short enough (no extra call). */
export function shortenTldrPrompt(json: Record<string, unknown> | null): { system: string; user: string } | null {
  const bullets = tldrBullets(json);
  if (!bullets.some((b) => b.split(/\s+/).length > TLDR_BULLET_MAX_WORDS)) return null;
  return {
    system: 'You shorten meeting TL;DR bullets. Keep the meaning, names, figures and dates exactly; never add anything. Answer with JSON only.',
    user: `Rewrite each bullet in at most 26 words. Keep the two or three figures and dates that matter most, who does what, and every condition or hedge ("if Diane checks out", "pending", "not agreed yet"); drop background, causes behind causes and secondary numbers.
Answer as {"bullets":["...","..."]}.

${JSON.stringify({ bullets })}`,
  };
}

/**
 * A second small call, only when the (already short) bullets still say "I" for
 * someone else's words (borrowedFirstPerson) or state an open point as agreed
 * (openPointsStatedAsAgreed). Null when neither (no extra call).
 */
export function fixTldrPrompt(json: Record<string, unknown> | null, context: string, open: string[] = []): { system: string; user: string } | null {
  const bullets = tldrBullets(json);
  const borrowed = borrowedFirstPerson(bullets, context);
  const stillOpen = openPointsStatedAsAgreed(bullets, open);
  if (borrowed.length === 0 && stillOpen.length === 0) return null;
  const parts: string[] = [];
  if (borrowed.length) parts.push(`"I" is the user, who speaks the ME lines. These say "I" or "my" about what another person said about themselves; write it about that person by name (or "they" when the line names nobody):\n${borrowed.map((x) => `- "${x.clause}" comes from ${x.line}`).join('\n')}`);
  if (stillOpen.length) parts.push(`These were raised but NOT agreed. Where a bullet states one as agreed, or as part of what someone offered, mark it in place, such as "$40M pre-money (still open)":\n${stillOpen.map((o) => `- ${o}`).join('\n')}`);
  return {
    system: 'You correct meeting TL;DR bullets. Change only the words the fix needs; keep everything else exactly, and keep each bullet about the same length. Answer with JSON only.',
    user: `${parts.join('\n\n')}
Answer as {"bullets":["...","..."]}.

${JSON.stringify({ bullets })}`,
  };
}

export function withShortBullets(json: Record<string, unknown> | null, shortJson: Record<string, unknown> | null): Record<string, unknown> | null {
  const before = tldrBullets(json);
  const after = tldrBullets(shortJson);
  if (after.length !== before.length) return json;
  const words = (xs: string[]) => xs.join(' ').split(/\s+/).length;
  return words(after) < words(before) ? { ...json, bullets: after } : json;
}

/** A fix may add a few words ("Diego", "(still open)"); never a rewrite. */
export function withFixedBullets(json: Record<string, unknown> | null, fixedJson: Record<string, unknown> | null): Record<string, unknown> | null {
  const before = tldrBullets(json);
  const after = tldrBullets(fixedJson);
  if (after.length !== before.length) return json;
  const words = (xs: string[]) => xs.join(' ').split(/\s+/).length;
  return words(after) <= words(before) * 1.25 && words(after) >= words(before) * 0.75 ? { ...json, bullets: after } : json;
}

export function renderTldr(json: Record<string, unknown> | null, a: MeetingAnalysis, context: string): string | null {
  const bullets = tldrBullets(json);
  const topic = String(json?.topic ?? '').trim().replace(/^(to discuss|on|about)\s+/i, '').replace(/[.]$/, '');
  if (!topic || bullets.length === 0) return null;
  // Only people the user names or speaks to: the model also lists people who were only
  // talked about ("Met with Lars", the client's COO, who was not on the call).
  const names = presentNames(a, context);
  const who = names.length === 0 ? '' : names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and others`;
  const topicClean = names.reduce((t, n) => t.replace(new RegExp(`\\s+with\\s+${n}$`, 'i'), ''), topic);
  const head = a.kind === 'class' ? `Attended a class on ${topicClean}.` : who ? `Met with ${who} to discuss ${topicClean}.` : `Met to discuss ${topicClean}.`;
  return [head, '', ...bullets.map((b) => `- ${cap(b)}`)].join('\n');
}

/**
 * The email's recipient is someone I name or speak to on a ME line (I never say my
 * own name), present in the meeting, and not on my own side when anyone else is.
 */
export function emailRecipient(asked: unknown, a: MeetingAnalysis, context: string): string {
  const usable = (names: string[]) => names.map(firstName).filter((n) => n && !a.userNames.has(n.toLowerCase()));
  const theirs = usable(a.theirs);
  // A colleague I brought along ("Kemal from our solutions team") is never who the email is for.
  const ours = usable(a.ours).filter((n) => !introducedAsMine(n, context));
  const spokenTheirs = theirs.filter((n) => addressedByMe(n, context));
  if (spokenTheirs.length) {
    const want = firstName(asked).toLowerCase();
    return cap(spokenTheirs.find((n) => n.toLowerCase() === want) ?? spokenTheirs[0]);
  }
  if (a.kind === 'class') return 'there';
  const spokenOurs = ours.filter((n) => addressedByMe(n, context));
  // A meeting of my own team with several people spoken to: the email goes to all of them.
  // (Someone I only mention, "I'll take it to Joanna", is not who the email is for.)
  if (spokenOurs.length >= 2) return 'all';
  // One person I speak to by name ("Hi, Diego"): the email is theirs, even when the model
  // also listed someone I only talk about ("the Hendrix escalation") as present.
  if (spokenOurs.length === 1) return cap(spokenOurs[0]);
  // A meeting with people from outside (or with a colleague I brought along) none of
  // whom I speak to by name: the person I met was misheard or never named.
  if (theirs.length || usable(a.ours).length > ours.length) return 'there';
  const pick = spokenOurs[0] ?? ours.find((n) => saidByMe(n, context));
  return pick ? cap(pick) : 'there';
}

export const EMAIL_BODY_MAX_WORDS = 90;

const emailParagraphs = (json: Record<string, unknown> | null) => (Array.isArray(json?.paragraphs) ? json!.paragraphs : []).map((p) => String(p ?? '').trim()).filter(Boolean);
const keyFigures = (t: string) => new Set([
  ...(t.match(new RegExp(`\\b(${MONTHS.join('|')})\\s+\\d{1,2}\\b`, 'gi')) || []).map((d) => d.toLowerCase()),
  ...(t.match(/[$£€]\s?\d[\d,.]*\s?[kKmM]?/g) || []).map((f) => f.replace(/\s+/g, '').replace(/[,.]$/, '').toLowerCase()),
]);

/** Null when the body is short enough (no extra call). */
export function shortenEmailPrompt(json: Record<string, unknown> | null): { system: string; user: string } | null {
  const paragraphs = emailParagraphs(json);
  if (paragraphs.join(' ').split(/\s+/).length <= EMAIL_BODY_MAX_WORDS) return null;
  return {
    system: 'You shorten follow-up emails. Keep every task, who does it, every date and every figure exactly; never add anything. Answer with JSON only.',
    user: `Rewrite the two paragraphs in at most 80 words together, two sentences each. Keep every task with its owner and date, and every price or figure; drop thanks, background and anything already implied.
Answer as {"paragraphs":["...","..."]}.

${JSON.stringify({ paragraphs })}`,
  };
}

/** The shorter body, only when it kept every date and money figure. */
export function withShortEmail(json: Record<string, unknown> | null, shortJson: Record<string, unknown> | null): Record<string, unknown> | null {
  const before = emailParagraphs(json);
  const after = emailParagraphs(shortJson);
  if (after.length !== before.length) return json;
  const words = (xs: string[]) => xs.join(' ').split(/\s+/).length;
  if (words(after) >= words(before)) return json;
  const kept = keyFigures(after.join(' '));
  return [...keyFigures(before.join(' '))].every((f) => kept.has(f)) ? { ...json, paragraphs: after } : json;
}

export function renderEmail(json: Record<string, unknown> | null, a: MeetingAnalysis, context: string, userName: string | null, recipient?: string): string | null {
  const raw = Array.isArray(json?.paragraphs) ? json!.paragraphs : json?.paragraphs ? [json.paragraphs] : [];
  let paras = raw.map((p) => String(p ?? '').trim().replace(/\s{2,}/g, ' ')).filter(Boolean).slice(0, 2);
  if (paras.length === 0) return null;
  // Far over the length even after shortenEmailPrompt: keep each paragraph's first
  // three sentences.
  if (paras.join(' ').split(/\s+/).length > 120) paras = paras.map((p) => (p.match(/[^.!?]+[.!?]+(\s|$)/g) || [p]).slice(0, 3).join('').trim());
  const subject = String(json?.subject ?? '').trim() || 'Following up';
  return [`**Subject:** ${subject}`, '', `Hi ${recipient ?? emailRecipient(json?.to, a, context)},`, '', ...paras.flatMap((p) => [p, '']), 'Thanks,', firstName(userName) || '[Your name]'].join('\n');
}

/**
 * Whether code may write the recipe's fixed English parts ("To do:", "Met with",
 * "Hi", "Thanks,"). Not when the user added words to the recipe ("in Spanish"),
 * the answer language is set to something else, or the meeting is not in English.
 */
export function canWriteEnglishShape(extra: string, language: string | null | undefined, context: string): boolean {
  if (extra.trim()) return false;
  const lang = String(language || 'auto');
  if (lang !== 'auto' && lang !== 'English') return false;
  if (lang === 'English') return true;
  const words = transcriptLines(context).map((l) => l.text).join(' ').toLowerCase().match(/[a-zÀ-ɏЀ-ӿ؀-ۿऀ-ॿ一-鿿]+/g) || [];
  if (words.length < 30) return true;
  const common = words.filter((w) => /^(the|and|to|of|is|that|you|it|we|for|i|a|in|on|this|so|but|with|be|have|will)$/.test(w)).length;
  return common / words.length >= 0.12;
}

/**
 * The meeting's date, unless the transcript contradicts it ("tomorrow, Tuesday" in a
 * meeting saved on a Saturday: a replayed recording, a clock that was wrong). Then no
 * computed dates are added and every date stays as it was said.
 */
export function trustedMeetingDate(context: string, base: Date | null): Date | null {
  if (!base) return null;
  // Letters only: speech recognition splits words ("tom orrow, Tuesday").
  const re = /(today|tomorrow|yesterday)(?:is)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/g;
  for (const l of transcriptLines(context)) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(norm(l.text)))) {
      const shift = /^tomorrow$/i.test(m[1]) ? 1 : /^yesterday$/i.test(m[1]) ? -1 : 0;
      if ((base.getDay() + shift + 7) % 7 !== DAYS.indexOf(m[2].toLowerCase())) return null;
    }
  }
  return base;
}

export type SteppedResult = { text: string | null; facts: string | null };

/**
 * Runs one of the stepped recipes. Returns { text: null } when a step fails, so the
 * caller can fall back to the recipe's one-prompt path (with `facts` when step 1 worked).
 */
export async function runSteppedRecipe(params: {
  recipeId: SteppedRecipeId;
  context: string;
  meetingDate: Date | null;
  userName: string | null;
  shape: boolean;
  chat: ChatFn;
  commitments?: CommitmentsJson | null;
}): Promise<SteppedResult & { commitments: CommitmentsJson | null }> {
  let commitments = params.commitments ?? null;
  if (!commitments) {
    const p = commitmentsPrompt(params.context);
    if (!p) return { text: null, facts: null, commitments: null };
    commitments = asCommitments(parseModelJson(await params.chat(p.system, p.user)));
  }
  if (!commitments) return { text: null, facts: null, commitments: null };
  const analysis = analyseMeeting(commitments, params.context);
  const meetingDate = trustedMeetingDate(params.context, params.meetingDate);
  const facts = factsBlock(analysis, meetingDate);
  if (!params.shape) return { text: null, facts, commitments };
  if (params.recipeId === 'todos') return { text: renderTodos(commitments, params.context, meetingDate), facts, commitments };
  const recipient = params.recipeId === 'follow-up-email' ? emailRecipient(null, analysis, params.context) : undefined;
  const p = params.recipeId === 'tldr' ? tldrPrompt(params.context, facts) : emailPrompt(params.context, facts, recipient);
  let json = parseModelJson(await params.chat(p.system, p.user));
  if (params.recipeId === 'tldr') {
    const shorten = shortenTldrPrompt(json);
    if (shorten) json = withShortBullets(json, parseModelJson(await params.chat(shorten.system, shorten.user)));
    const fix = fixTldrPrompt(json, params.context, analysis.open);
    if (fix) json = withFixedBullets(json, parseModelJson(await params.chat(fix.system, fix.user)));
  } else {
    const shorten = shortenEmailPrompt(json);
    if (shorten) json = withShortEmail(json, parseModelJson(await params.chat(shorten.system, shorten.user)));
  }
  const text = params.recipeId === 'tldr' ? renderTldr(json, analysis, params.context) : renderEmail(json, analysis, params.context, params.userName, recipient);
  return { text, facts, commitments };
}
