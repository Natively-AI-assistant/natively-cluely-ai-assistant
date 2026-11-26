// Which part of the user's repository briefs a live question needs (#781).
//
// A brief is ~20-27k characters per repository: too much to send on every
// turn. This picks, for one question, the repositories it is about and the
// parts of their briefs it touches (a function's entry, a flow, a route, a
// data model, a likely interview question), within a character budget. When
// the question names a function or file the brief does not describe, or asks
// for the code itself, the exact lines are read from GitHub at the commit the
// brief was built from, within a short deadline (the live fallback).
//
// A question about none of the repositories gets nothing: a coding exercise
// ("implement an LRU cache") must not be answered from the user's project.
//
// Pure text work plus one optional fetch; no platform branches.

import type { RepoBriefResult, RepoBriefIndexSymbol } from './repoBriefClient';

export interface ReadyBrief {
  entry: { key: string; owner: string; repo: string; projectName?: string };
  result: RepoBriefResult;
}

export interface RepoContextOptions {
  /** Total characters of brief text, all repositories together. */
  budgetChars?: number;
  /** Read exact lines for named functions not covered well enough by the brief. */
  fetchLines?: (url: string, signal: AbortSignal) => Promise<string>;
  /** The live fallback gives up after this long and the turn goes without it. */
  fetchDeadlineMs?: number;
  /** At most this many functions are read live per turn. */
  maxLiveSymbols?: number;
  /** The conversation: a follow-up that names nothing carries the previous repository over. */
  sessionId?: string;
  /** The caller's own verdict that the question follows up the previous turn. */
  isFollowUp?: boolean;
}

/** What the previous question of a conversation was about, for its follow-ups. */
export interface PreviousTurn {
  keys: string[];
  question: string;
}

const DEFAULT_BUDGET = 9000;
const OVERVIEW_CAP = 1600;
const LIVE_MAX_LINES = 80;

const STOP = new Set((
  'a an and are as at be been but by can could did do does doing for from had has have how i if in into is it its '
  + 'just me my of on or our so than that the their them then there these they this those to us was we were what when '
  + 'where which while who why will with would you your yours about tell explain walk through describe talk give '
  + 'please also more some any all one get got use used using work works working part parts thing things way').split(' '));

/**
 * Words that point at the user's own code without naming it. "The code", "the
 * API", "the backend" are how general questions talk too ("How would you
 * secure the API?"), so with the|this|that only the words that mean a project
 * count; "your"/"my" count with any of them.
 */
const OWN_CODE_RE = /\b(?:(?:your|my)\s+(?:own\s+)?(?:project|projects|repo|repository|repositories|codebase|code base|code|app|application|implementation|github|side project|backend|frontend|api|service)|(?:this|the|that)\s+(?:project|repo|repository|codebase|side project)|(?:your|my|this|the|that)\s+github)\b/i;
/**
 * Asked about the candidate's own past work: "how did you...", "have you built...".
 * Past forms only: "how would you build X" is a design question, not one about their code.
 */
const PAST_WORK_RE = /\b(did you|have you|had you|you('ve| have)? (built|made|implemented|designed|wrote|written|used|handled|chose|picked|structured|tested|deployed))\b/i;
/**
 * Everyday words that turn up in repository names (SonyConnect, ai-assistant,
 * chat-app, full-stack-template). Alone they do not name the repository:
 * "how do devices connect?" is not about SonyConnect. The whole name, or a
 * word of it not on this list ("sony", "proshop", "microblog"), still does.
 * Stemmed like terms().
 */
const COMMON_NAME_WORDS = new Set((
  'connect connection assistant agent app application api server client web website site service chat blog shop store '
  + 'data user auth login test demo project react node python java javascript typescript tool bot clone starter template '
  + 'backend frontend mobile android ios system manager tracker search cache queue full stack simple basic portfolio '
  + 'todo game note task social media music video audio image photo file cloud home dashboard admin core lib library '
  + 'sdk cli kit hub lab net code dev learn course tutorial example sample machine model smart auto easy mini open free '
  + 'real time live map weather new book movie food health finance bank pay payment ecommerce commerce market analytic '
  + 'monitor engine framework platform network design plugin extension helper util config setup script docker deploy '
  + 'build generator analyzer detector scanner finder reader writer editor viewer player recorder converter translator '
  + 'summarizer classifier recommender meeting interview transcript transcription speech voice text email message '
  + 'notification event calendar schedule booking order product cart checkout review rating comment post feed profile '
  + 'account dashboard report form survey quiz exam school student job resume').split(' ').map((w) => stem(w)));
/** A function name said aloud ("get user", "set up") needs this many words: two everyday words are just speech. */
const SPOKEN_SYMBOL_MIN_WORDS = 3;
/** Distinct question words one part of a brief must share for an unnamed past-work question to match. */
const PAST_WORK_MIN_OVERLAP = 3;
/**
 * The question is about some other part of the user's working life: a job, an
 * employer, a team, a salary. An unnamed "how did you handle X?" with these
 * words is not about the repository, even when X matches something in it.
 */
const OTHER_WORK_RE = /\b(job|jobs|company|companies|employer|employers|role|roles|position|internship|manager|managers|boss|colleague|colleagues|coworkers?|co-workers?|team|teams|teammates?|salary|compensation|workplace|organi[sz]ation|stakeholders?)\b/i;
/** Short and pointing back: "why that way?", "how does it scale?", "and the tests for it?" */
const POINTS_BACK_RE = /\b(it|that|this|those|these|them|there|then|its)\b/i;
const FOLLOW_UP_MAX_WORDS = 14;
/**
 * A longer question that points back carries the previous repository only when
 * it shares this many words with one part of that repository's brief ("And how
 * does password reset work there? How long is the reset link valid for?").
 */
const LONG_FOLLOW_UP_MIN_OVERLAP = 2;
/** A follow-up carries the previous repository for this long. */
export const FOLLOW_UP_WINDOW_MS = 10 * 60_000;
const IMPROVE_RE = /\b(improve|improvement|weak|weakness|bug|bugs|problem|problems|issue|issues|challenge|challenges|limitation|limitations|differently|refactor|scale|scaling|tradeoff|trade-off|security|change)\b/i;
const SHOW_CODE_RE = /\b(show|read|paste|walk me through|line by line|exact code|the code (of|for)|source (of|for))\b/i;

function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s')) return w.slice(0, -1);
  return w;
}

/** Content words, camelCase and snake_case split, stemmed. */
export function terms(text: string): Set<string> {
  const out = new Set<string>();
  const split = String(text || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  for (const w of split) {
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue;
    out.add(stem(w));
  }
  return out;
}

/** " add order items " for addOrderItems / add_order_items / "Add order items?" — padded for whole-word includes(). */
function spokenForm(text: string): string {
  const words = String(text || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return ` ${words.join(' ')} `;
}

/** Identifiers as written: names with a capital inside, an underscore, or a dot. */
function identifiers(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of String(text || '').match(/[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*/g) || []) {
    if (m.length >= 4 && (/[a-z][A-Z]/.test(m) || m.includes('_') || m.includes('.'))) out.add(m.toLowerCase());
  }
  return out;
}

interface Unit {
  section: string;
  text: string;
  terms: Set<string>;
  idents: Set<string>;
}

/** The brief cut into answerable pieces: one bullet, or one ### subsection. */
export function briefUnits(brief: string): { overview: string; units: Unit[] } {
  const sections = String(brief || '').split(/^(?=## )/m);
  let overview = '';
  const units: Unit[] = [];
  const add = (section: string, text: string) => {
    const t = text.trim();
    if (t) units.push({ section, text: t, terms: terms(t), idents: identifiers(t) });
  };
  for (const sec of sections) {
    const m = /^## +(.+)\n?/.exec(sec);
    if (!m) { if (!overview) overview = sec.trim(); continue; }
    const name = m[1].trim();
    const body = sec.slice(m[0].length);
    if (/^overview/i.test(name)) { overview = body.trim(); continue; }
    if (/^###/m.test(body)) {
      for (const sub of body.split(/^(?=### )/m)) add(name, sub);
    } else if (/^\s*[-*] /m.test(body)) {
      for (const item of body.split(/^(?=\s*[-*] )/m)) add(name, item);
    } else {
      add(name, body);
    }
  }
  return { overview, units };
}


interface RepoMatch {
  brief: ReadyBrief;
  score: number;
  namedSymbols: RepoBriefIndexSymbol[];
}

/**
 * How sure the match is. 'sure': the question names the repository, one of its
 * functions or files, or follows up on a question that did; the brief is the
 * main source. 'possible': an unnamed "how did you handle X" that shares words
 * with the brief; the answer uses it only if it fits. Below that nothing is
 * attached and the answer is a general one. No level ever refuses: a brief
 * that does not cover the question leaves a general answer (see
 * codeReposSection).
 */
export type RepoMatchConfidence = 'sure' | 'possible';
/** A name, a function or a file scores at least 3; unnamed matches score 1 or 2. */
const SURE_MIN_SCORE = 3;
export function matchConfidence(score: number, carried: boolean): RepoMatchConfidence {
  return carried || score >= SURE_MIN_SCORE ? 'sure' : 'possible';
}
/** Written under a 'possible' repository's header, for the prompt's rule on it. */
export const POSSIBLE_MATCH_NOTE = 'Possible match: the question does not name this project. Use it only if it fits the question.';
/**
 * Written under a repository's header when no part of its brief is about what
 * was asked ("how did you handle rate limiting in Microblog?" and the brief
 * has none). The composer sees its first words (REPO_NOT_COVERED_MARK) and
 * puts the answer shape right after the question (repoAnswerShapeSection):
 * live 2026-11-26 a rule here alone still drew "Microblog doesn't have rate
 * limiting" and "I didn't do it there".
 */
export const NOT_COVERED_NOTE = 'Not in this brief: no part below is directly about what was asked. Use what below relates; how to answer is set out after the question.';
/** Question words that say nothing about the topic, for the coverage check. */
const NOT_TOPIC = new Set(['handle', 'handl', 'app', 'application', 'project', 'add', 'code', 'improve', 'build', 'built',
  'implement', 'make', 'made', 'set', 'go', 'deal', 'approach', 'design', 'write', 'new'].map((w) => stem(w)));
/**
 * Does one part of the brief hold most of the question's topic? Topic words
 * leave out the repository's name, words that name no topic ("handle", "add"),
 * and words in a fifth or more of the brief's parts ("api" in a web app's
 * brief says nothing about rate limiting). More than half of what is left
 * must be in one part: "rate limiting" against a part about pagination
 * "limit"s is not covered.
 */
function coversQuestion(question: string, b: ReadyBrief, units: Unit[]): boolean {
  const name = new Set([...terms(b.entry.repo), ...terms(b.entry.projectName || '')]);
  const everywhere = (t: string) => units.filter((u) => u.terms.has(t)).length * 5 >= units.length;
  const topic = [...terms(question)].filter((t) => !name.has(t) && !NOT_TOPIC.has(t) && !everywhere(t));
  if (!topic.length) return true;
  const best = units.reduce((n, u) => Math.max(n, topic.filter((t) => u.terms.has(t)).length), 0);
  return best * 2 > topic.length;
}

/** The most question words any one part of this brief shares. */
function sharedWords(q: Set<string>, b: ReadyBrief): number {
  return briefUnits(b.result.brief).units.reduce((n, u) => Math.max(n, [...q].filter((t) => u.terms.has(t)).length), 0);
}

/** Which repositories the question is about, best first. */
export function matchRepos(question: string, briefs: ReadyBrief[]): RepoMatch[] {
  const q = terms(question);
  const qIdents = identifiers(question);
  const qSpoken = spokenForm(question);
  const ownCode = OWN_CODE_RE.test(question);
  const out: RepoMatch[] = [];
  for (const b of briefs) {
    let score = 0;
    // Named: the whole name ("sony connect", "SonyConnect"), a word of it that
    // is not an everyday word ("proshop" of proshop_mern), or half the
    // résumé project's name the same way.
    const nameSaid = (name: string): boolean => {
      const spoken = spokenForm(name).trim();
      if (!spoken) return false;
      return qSpoken.includes(` ${spoken} `) || qSpoken.includes(` ${spoken.replace(/ /g, '')} `);
    };
    const distinctive = (t: string) => !COMMON_NAME_WORDS.has(t);
    const repoTerms = [...terms(b.entry.repo)].filter(distinctive);
    const projectTerms = [...terms(b.entry.projectName || '')].filter(distinctive);
    const projectHits = projectTerms.filter((t) => q.has(t)).length;
    if (nameSaid(b.entry.repo) || (b.entry.projectName && nameSaid(b.entry.projectName))
      || repoTerms.some((t) => q.has(t)) || (projectTerms.length && projectHits / projectTerms.length >= 0.5)) score += 6;
    else if (projectHits) score += 2;
    const named: RepoBriefIndexSymbol[] = [];
    for (const s of b.result.index?.symbols || []) {
      if (s.name.length < 4) continue;
      // Typed as written ("addOrderItems"), or spoken ("add order items"):
      // speech-to-text never writes camelCase. A name of one or two words
      // ("render", "setUp", "get_user") only counts when typed as an
      // identifier: said aloud it is ordinary speech ("how do you set up JWT?").
      const phrase = spokenForm(s.name);
      const said = phrase.trim().split(' ').length >= SPOKEN_SYMBOL_MIN_WORDS && qSpoken.includes(phrase);
      if (qIdents.has(s.name.toLowerCase()) || said) named.push(s);
    }
    for (const f of b.result.index?.files || []) {
      const base = f.path.split('/').pop()!.replace(/\.[a-z0-9]+$/i, '');
      const phrase = spokenForm(base);
      if (base.length >= 5 && (qIdents.has(base.toLowerCase()) || (phrase.trim().split(' ').length >= SPOKEN_SYMBOL_MIN_WORDS && qSpoken.includes(phrase)))) score += 3;
    }
    const unique = named.filter((s, i) => named.findIndex((o) => o.path === s.path && o.start === s.start) === i)
      .sort((x, y) => y.name.length - x.name.length || (y.score ?? 0) - (x.score ?? 0));
    score += Math.min(unique.length, 3) * 4;
    out.push({ brief: b, score, namedSymbols: unique.slice(0, 3) });
  }
  const anyNamed = out.some((m) => m.score > 0);
  if (!anyNamed) {
    const pastWork = PAST_WORK_RE.test(question);
    for (const m of out) {
      const best = sharedWords(q, m.brief);
      // "Your project" with no name: the only repository, or one whose brief
      // shares enough words. "How did you stop duplicate reviews?" (a follow-up
      // that names nothing): only a strong match, so a question about some other
      // job is not answered from this repository.
      if (ownCode) m.score = briefs.length === 1 || best >= 2 ? 1 : 0;
      else if (pastWork && best >= PAST_WORK_MIN_OVERLAP && !OTHER_WORK_RE.test(question)) m.score = 1;
    }
  }
  return out.filter((m) => m.score > 0).sort((a, b) => b.score - a.score);
}

function scoreUnit(u: Unit, q: Set<string>, qIdents: Set<string>, improve: boolean): number {
  let s = 0;
  for (const t of q) if (u.terms.has(t)) s += 1;
  for (const id of qIdents) if (u.idents.has(id)) s += 5;
  if (/weak spot|improve/i.test(u.section)) s = improve ? s + 2 : s * 0.3;
  if (/interview question/i.test(u.section)) s *= 1.2;
  return s;
}

function header(b: ReadyBrief): string {
  const r = b.result;
  const cov = r.coverage || {};
  const scope = r.tier === 'small'
    ? 'read in full'
    : `only part was read (${cov.fetchedFiles ?? '?'} of ${cov.codeFiles ?? '?'} code files${cov.ownFiles ? `, ${cov.ownFiles} of them the user's own commits` : ''})`;
  return `## ${r.repo.owner}/${r.repo.name}${b.entry.projectName ? ` (résumé project "${b.entry.projectName}")` : ''}`
    + ` at commit ${r.repo.sha.slice(0, 7)}, ${scope}`;
}

/**
 * The brief text for this question, without the live lines. '' when the
 * question is about none of the repositories.
 */
export function isFollowUpQuestion(question: string, callerSaysFollowUp = false): boolean {
  if (OTHER_WORK_RE.test(question)) return false;
  if (callerSaysFollowUp) return true;
  const words = question.trim().split(/\s+/).length;
  return words <= FOLLOW_UP_MAX_WORDS && POINTS_BACK_RE.test(question);
}

/** Points back at the previous turn, and is not about some other job. */
function pointsBack(question: string): boolean {
  return POINTS_BACK_RE.test(question) && !OTHER_WORK_RE.test(question);
}

/**
 * Too long for isFollowUpQuestion, but pointing back and sharing words with the
 * previous repository: interviewers ask two-part follow-ups ("And how does
 * password reset work there? How long is the reset link valid for?"). A long
 * question that only says "there" about something else does not carry.
 */
function isLongFollowUp(question: string, previousBriefs: ReadyBrief[]): boolean {
  if (!pointsBack(question)) return false;
  const q = terms(question);
  return previousBriefs.some((b) => sharedWords(q, b) >= LONG_FOLLOW_UP_MIN_OVERLAP);
}

export function selectRepoContext(
  question: string,
  briefs: ReadyBrief[],
  budgetChars: number = DEFAULT_BUDGET,
  previous?: PreviousTurn | null,
  callerSaysFollowUp = false,
): { text: string; matches: RepoMatch[]; carried: boolean } {
  if (!question?.trim() || !briefs.length) return { text: '', matches: [], carried: false };
  let matches = matchRepos(question, briefs).slice(0, 2);
  // A follow-up that names nothing ("why did you do it that way?"): the
  // repositories the previous question was about, ranked with that question's
  // words too, so "it" finds the function the conversation is on.
  let carried = false;
  let rankText = question;
  if (!matches.length && previous?.keys.length) {
    const previousBriefs = briefs.filter((b) => previous.keys.includes(b.entry.key)).slice(0, 2);
    if (previousBriefs.length && (isFollowUpQuestion(question, callerSaysFollowUp) || isLongFollowUp(question, previousBriefs))) {
      matches = previousBriefs.map((brief) => ({ brief, score: 1, namedSymbols: [] }));
      carried = true;
      rankText = `${question} ${previous.question}`;
    }
  }
  if (!matches.length) return { text: '', matches: [], carried: false };
  const q = terms(rankText);
  const qIdents = identifiers(rankText);
  const improve = IMPROVE_RE.test(question);
  const perRepo = Math.floor(budgetChars / matches.length);
  const parts: string[] = [];
  for (const m of matches) {
    const { overview, units } = briefUnits(m.brief.result.brief);
    let left = perRepo;
    const lines: string[] = [header(m.brief)];
    if (matchConfidence(m.score, carried) === 'possible') lines.push(POSSIBLE_MATCH_NOTE);
    else if (!coversQuestion(rankText, m.brief, units)) lines.push(NOT_COVERED_NOTE);
    const ov = overview.length > OVERVIEW_CAP ? `${overview.slice(0, OVERVIEW_CAP).replace(/\s+\S*$/, '')} …` : overview;
    if (ov) { lines.push(`### Overview\n${ov}`); left -= ov.length; }
    const ranked = units
      .map((u) => ({ u, s: scoreUnit(u, q, qIdents, improve) }))
      .filter((x) => x.s >= 1)
      .sort((a, b) => b.s - a.s);
    const bySection = new Map<string, string[]>();
    for (const { u } of ranked) {
      if (u.text.length > left) continue;
      left -= u.text.length;
      if (!bySection.has(u.section)) bySection.set(u.section, []);
      bySection.get(u.section)!.push(u.text);
      if (left < 200) break;
    }
    for (const [section, items] of bySection) lines.push(`### ${section}\n${items.join('\n')}`);
    parts.push(lines.join('\n\n'));
  }
  return { text: parts.join('\n\n'), matches, carried };
}

// The previous repository question per conversation. In memory only: it is the
// last few minutes of one meeting, and a restart starting fresh is correct.
const previousBySession = new Map<string, PreviousTurn & { at: number }>();
const PREVIOUS_MAX_SESSIONS = 50;

function previousFor(sessionId: string | undefined, now: number): PreviousTurn | null {
  if (!sessionId) return null;
  const p = previousBySession.get(sessionId);
  return p && now - p.at <= FOLLOW_UP_WINDOW_MS ? p : null;
}

function rememberTurn(sessionId: string | undefined, matches: RepoMatch[], question: string, now: number): void {
  if (!sessionId) return;
  previousBySession.delete(sessionId);
  if (matches.length) previousBySession.set(sessionId, { keys: matches.map((m) => m.brief.entry.key), question, at: now });
  while (previousBySession.size > PREVIOUS_MAX_SESSIONS) previousBySession.delete(previousBySession.keys().next().value as string);
}

/** Tests only. */
export function resetConversationMemoryForTests(): void {
  previousBySession.clear();
}

function numbered(text: string, start: number, end: number): string {
  const all = text.split('\n');
  const last = Math.min(end, start + LIVE_MAX_LINES - 1, all.length);
  const out: string[] = [];
  for (let i = start; i <= last; i++) out.push(`${i}: ${all[i - 1] ?? ''}`);
  return out.join('\n');
}

const lineCache = new Map<string, string>();
const LINE_CACHE_MAX = 64;

/**
 * The brief selection plus, when the question names functions, their exact
 * lines at the brief's commit. Never throws and never waits past the deadline.
 */
export async function buildRepoContext(question: string, briefs: ReadyBrief[], opts: RepoContextOptions = {}): Promise<string> {
  const now = Date.now();
  const previous = previousFor(opts.sessionId, now);
  const { text, matches, carried } = selectRepoContext(question, briefs, opts.budgetChars ?? DEFAULT_BUDGET, previous, opts.isFollowUp === true);
  // A carried follow-up keeps the question the repository was named in, so a
  // second "and why?" still knows what "it" is. Anything else (a match, or a
  // question about nothing here) replaces it.
  // A question that points back but did not carry ("what would break first in
  // it?") is still on the same thread, so it keeps the repository for the next
  // one, without extending its window. One that points nowhere moves on.
  const stillOnThread = !carried && !matches.length && !!previous && pointsBack(question);
  if (!carried && !stillOnThread) rememberTurn(opts.sessionId, matches, question, now);
  else if (opts.sessionId) previousBySession.get(opts.sessionId)!.at = now; // a long thread stays on the repository
  if (!text) return '';
  const fetchLines = opts.fetchLines;
  if (!fetchLines) return text;
  const wantsCode = SHOW_CODE_RE.test(question);
  const targets: Array<{ m: RepoMatch; s: RepoBriefIndexSymbol }> = [];
  for (const m of matches) {
    for (const s of m.namedSymbols) {
      // The brief already describes it, and nobody asked for the code itself.
      const described = new RegExp(`\\b${s.name.replace(/[$.]/g, '\\$&')}\\b`).test(m.brief.result.brief);
      if (described && !wantsCode) continue;
      targets.push({ m, s });
    }
  }
  const picked = targets.slice(0, opts.maxLiveSymbols ?? 2);
  if (!picked.length) return text;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.fetchDeadlineMs ?? 1500);
  (timer as any).unref?.();
  try {
    const reads = await Promise.all(picked.map(async ({ m, s }) => {
      const url = `${m.brief.result.rawBaseUrl}${s.path.split('/').map(encodeURIComponent).join('/')}`;
      try {
        let body = lineCache.get(url);
        if (body === undefined) {
          body = await fetchLines(url, controller.signal);
          lineCache.set(url, body);
          while (lineCache.size > LINE_CACHE_MAX) lineCache.delete(lineCache.keys().next().value as string);
        }
        return `${m.brief.result.repo.owner}/${m.brief.result.repo.name} ${s.path}:${s.start}-${s.end} (${s.kind} ${s.qualified || s.name})\n${numbered(body, s.start, s.end)}`;
      } catch { return ''; }
    }));
    const code = reads.filter(Boolean);
    return code.length ? `${text}\n\n### Exact code read from GitHub for this question\n${code.join('\n\n')}` : text;
  } finally {
    clearTimeout(timer);
  }
}

/** fetchLines for buildRepoContext: GitHub's raw file host, size-capped. */
export function rawGithubFetcher(fetchImpl: typeof fetch = globalThis.fetch, maxBytes = 400_000) {
  return async (url: string, signal: AbortSignal): Promise<string> => {
    if (!url.startsWith('https://raw.githubusercontent.com/')) throw new Error('not a GitHub raw URL');
    const res = await fetchImpl(url, { signal });
    if (!res.ok) throw new Error(`GitHub raw ${res.status}`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > maxBytes) throw new Error('file too large');
    const text = await res.text();
    if (text.length > maxBytes) throw new Error('file too large');
    return text;
  };
}
