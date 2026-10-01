// Post-generation CLAIM VERIFIER for the what-to-answer hotkey (2026-09-30).
//
// The spec's "personal evidence required" state had no runtime form: every
// safeguard was prompt text, and the external judge (gpt-6-astra) still capped
// 42-55% of Sales, Call Center and Looking-for-work answers for claims nothing
// supported — "$412 per seat" with no price sheet, "HVAC is a big part of who we
// work with", "I'm open to relocating", "that works as a starting point for me",
// an invented weakness. Four prompt formulations moved these by 0-0.5 points.
//
// A second, short pass that sees exactly what the answer was built from (the
// composed V3 user message: question, conversation, evidence) and removes what
// that material does not state did move them. Offline on the dev set, judged
// externally: Sales 6.93 -> 8.29 (hard fails 18 -> 5), Looking-for-work
// 6.73 -> 7.5-7.8 (22 -> 10-13), one deepseek-flash call, p50 ~0.8 s.
//
// It runs where the doc-grounded repair already runs — after the stream, before
// the final answer is emitted — so time to first word is unchanged; the final
// text replaces the streamed one when it differs (the existing repair
// contract). Every edit must pass deterministic rails (acceptVerifiedAnswer);
// anything doubtful keeps the original. Pure module: the engine owns the call.

import { splitGistLine } from './promptSystemV2';
import { raceStreamWithDeadline, type StreamObserver } from './liveDeadlines';

export type ClaimVerifierKind = 'personal' | 'product' | 'life' | 'meeting';

/**
 * Total time the edit may take, first token to last. Offline the pass took
 * ~0.8 s at the median; an edit that has not finished by the budget is never
 * shipped, so the cost of a slow provider is this wait, not a worse answer.
 */
export const CLAIM_VERIFIER_BUDGET_MS = 3500;
/** A replayed call that carries the screenshot pays a multimodal prefill. */
export const CLAIM_VERIFIER_IMAGE_BUDGET_MS = 6000;

/** Personal questions in the technical interview. */
const TI_PERSONAL_RE = /\b(?:tell me about (?:a time|yourself|your)|your (?:background|experience|role|last|current|previous|team|r[eé]sum[eé]|project)|why (?:did|do|are|would) you|have you (?:actually |ever |already |personally )?(?:used|run|built|worked|led|done|managed|shipped|designed|written|operated|debugged|migrated)|what (?:did|was|have) you|walk me through (?:your|a time|how you (?:handled|dealt|debugged|approached|ran))|strength|weakness|relocat|salary|compensation|notice period|mentor)/i;

/** The user's own life in modes that never record it (same shapes as the composer's personal-life notice). */
const LIFE_RE = /\b(?:did you (?:catch|watch|see) (?:the|that|last)(?: [\w'-]+){0,2} (?:game|match|show|episode|finale|fight|race|movie|film|series|night|weekend|ending|concert|debate)|(?:watching|reading|listening to|binging) anything|up to (?:anything|much)|what (?:are|were|have) you (?:been )?(?:up to|watching|reading|listening to)|how (?:was|is|'s) your (?:weekend|day|week|trip|holiday|summer|morning)|where do you see yourself|(?:biggest|greatest|worst) (?:weakness|strength|fear)|are you (?:on|taking) any|any (?:allergies|medications|meds)\b|allergic to|what(?:'s| is) your (?:story|background|deal)|your (?:own )?background|what were you doing before|what did you do before|how long have you been (?:doing|in|at|working)|where (?:are|were) you (?:from|before))\b/i;

/**
 * The DRAFT speaks about the speaker's own past: "I've", "I built", "in my
 * experience", "at my last job", "my co-authors", "we migrated". Judged on the
 * dev set, technical and seminar answers invented exactly this even when the
 * question was not personal ("Walk me through how goroutines get scheduled" →
 * an invented Go side project; "why a held-out set?" → the presenter's own
 * testing workflow), so the answer, not only the question, opens the gate.
 */
export const DRAFT_PERSONAL_RE = /\b(?:I(?:'ve| have| had)\b(?! to\b)|I (?:built|ran|led|shipped|used|wrote|worked|designed|migrated|managed|owned|spent|learned|picked up|started|joined|left|chose|tried|set up|rolled out|cut|reduced|tested|ended up|got into|came (?:to|into|from))\b|in my (?:experience|last|previous|current|work|team|role|job|project|lab|own work)|at my (?:last|previous|current|old)|my (?:team|last|previous|current|side projects?|coursework|thesis|advisor|co-?authors?|lab|group|manager|old)\b|we (?:used|built|ran|shipped|chose|migrated|tried|went with|ended up|set up|rolled out)\b|on my (?:team|last|side))/i;

/** Which verification (if any) a heard what-to-answer turn gets. Code answers are never touched. */
export function claimVerifierKind(input: { modeId: string | null | undefined; question: string; draft: string; surface?: 'spoken' | 'typed' }): ClaimVerifierKind | null {
  const mode = String(input.modeId ?? '');
  const q = String(input.question ?? '');
  const draft = String(input.draft ?? '');
  if (/```/.test(draft)) return null;
  if (mode === 'looking-for-work') return 'personal';
  if (mode === 'technical-interview') return TI_PERSONAL_RE.test(q) || DRAFT_PERSONAL_RE.test(draft) ? 'personal' : null;
  // Seminar (2026-10-01): every turn. Its capped answers were claims about the research the paper does not make
  // and an "I don't have that figure" the draft pattern never opened the gate for. Replayed and judged:
  // 8.64 -> 8.99, hard fails 3 -> 1.
  if (mode === 'seminar') return 'personal';
  if (mode === 'sales' || mode === 'call-center') return 'product';
  // General, SPOKEN (2026-10-01): the user says these words as their own, and every capped General answer on the dev
  // set was an invented fact about them that neither pattern below catches ("I'm not going to pretend I don't order
  // it"). Every spoken turn verified, replayed and judged: 8.53 -> 8.80, hard fails 5 -> 1. A typed General turn is
  // ordinary assistant chat and keeps the narrower gate (one typed answer got worse when always verified).
  if (mode === 'general') return input.surface === 'spoken' || LIFE_RE.test(q) || DRAFT_PERSONAL_RE.test(draft) ? 'life' : null;
  // Team Meet and Recruiting (2026-10-01): judged on the dev set, their capped answers were the same class — a
  // deadline restated as "due today", "which Brightwire didn't", "it's the product owner's call", a reporting
  // line or team size the role brief never gave. Replayed through this pass: Team Meet 8.37 -> 8.93 (hard fails
  // 7 -> 2), Recruiting 8.83 -> 9.11 (5 -> 2).
  if (mode === 'team-meet' || mode === 'recruiting') return 'meeting';
  return null;
}

const SPEAKER: Record<string, string> = {
  'looking-for-work': 'a job candidate is about to say aloud in an interview',
  'technical-interview': 'a job candidate is about to say aloud in a technical interview',
  seminar: 'a presenter is about to say aloud to the audience of their research seminar',
  sales: 'a seller is about to say aloud to a prospect',
  'call-center': 'a support agent is about to say aloud to a customer',
  general: 'the user is about to say aloud in a conversation',
  'team-meet': 'a meeting participant is about to say aloud to colleagues',
  recruiting: 'a recruiter or interviewer is about to say aloud to a candidate',
};
const MEETING_SUBJECT = 'the speaker, their team, its past decisions, owners, dates, vendors or reasons';
const RECRUITING_SUBJECT = 'the recruiter, the role, the team, the company or its terms';
const SEMINAR_SUBJECT = 'the presenter, their research, its data, methods, results, numbers or prior work';
const SUBJECT: Record<string, string> = {
  seminar: SEMINAR_SUBJECT,
  sales: 'the seller, their product or their company',
  'call-center': 'the agent, their product, their company or its policies',
  'team-meet': MEETING_SUBJECT,
  recruiting: RECRUITING_SUBJECT,
};

/** The typed surface: the reply is read by the user (advice or a script), not said by them. */
const WRITTEN_FOR: Record<string, string> = {
  'looking-for-work': 'a job candidate',
  'technical-interview': 'a job candidate in a technical interview',
  seminar: 'a presenter at their research seminar',
  sales: 'a seller on a sales call',
  'call-center': 'a support agent on a customer call',
  general: 'the user',
  'team-meet': 'a meeting participant',
  recruiting: 'a recruiter or interviewer',
};
const TYPED_SUBJECT: Record<string, string> = {
  seminar: SEMINAR_SUBJECT,
  sales: 'the seller, their product or their company',
  'call-center': 'the agent, their product, their company or its policies',
  'team-meet': MEETING_SUBJECT,
  recruiting: RECRUITING_SUBJECT,
};

/**
 * System prompt for the verifier call. The spoken wording is the one measured
 * offline (tools/scrub-experiment.mjs) plus "change as little as possible", so a
 * reply with nothing unsupported comes back byte-identical and is kept as it
 * was. The typed surface differs only where the reply's reader differs.
 *
 * HAND-BACK (2026-10-01): the first wording ("if removing a claim leaves the
 * question unanswered … hand it back with one practical question (for example
 * 'What does the timeline look like?')") was over-applied: Looking-for-work
 * answers ending in a question went 3 → 18 of 40 in-app, 12 appended by this
 * pass, several copying the example ("I'd want to talk that through properly.
 * What does the timeline look like on your side?") onto a reply that still
 * answered. Replayed on the same fix6 drafts, the narrowed wording without an
 * example: appended questions LFW 14 → 3, Sales 1 → 0, Call Center 3 → 1; edit
 * rates unchanged.
 */
/**
 * The material holds no document at all: no evidence block (the V3 notices
 * vary — "nothing was searched", "No supporting evidence was retrieved"). Measured on DSALES-001 ("what does it actually do day to
 * day?"): with the general wording, the edit kept "the system flags the ones
 * that need a decision… status updates get handled automatically" because
 * removing them emptied the answer; the judge capped it before and after.
 */
export function materialHasNoDocuments(material: string): boolean {
  return !/<evidence\b/.test(String(material ?? ''));
}
/**
 * LIST, THEN REWRITE (2026-10-01). Asked only to "output the revised reply",
 * the edit model left the claims the external judge capped most often:
 * "Twice a year sounds manageable", "I'd be looking at a few weeks rather than
 * an immediate start", "the level and the ownership matter more to me than a
 * single number" — 18 of 40 Looking-for-work answers still capped after the
 * pass, and a longer description of what to remove changed nothing. Made to
 * NAME the unsupported phrases first (one hidden line, split off by
 * splitVerifierScratch), the same model finds them: on the same 40 drafts,
 * judged externally, 7.33 -> 8.20 with hard fails 18 -> 5; Call Center
 * 7.07 -> 7.46 (14 -> 10); Sales unchanged. ~95 output tokens, p50 0.95 s
 * (was 0.8 s). A second wording with more rules per kind scored the same
 * within sampling noise.
 *
 * CLAIM KINDS (2026-10-01). The first list step named "a yes or a no, an 'it
 * works for me'… what they want" and its rewrite said "acknowledge and ask the
 * one thing about the other side": in the app it removed what was never a
 * claim. Asked "Who's grabbing this one?", "I can take this one" became "I'll
 * come back on who's picking it up"; "Let's do the pads today and hold off on
 * the rotors" became a question to the mechanic. Of 149 in-app edits, 36 ended
 * in a question the draft did not ask and 26 lost a decision or ownership.
 * The list now takes only three kinds — a past fact, a fact about the speaker,
 * a consequential promise — and names what is NOT a claim: a decision made
 * now, taking a task, a recommendation, an ordinary small commitment. A second
 * line names a conflict inside the material, which the reply must surface
 * instead of asserting one side. Replayed on the same 256 drafts: replies
 * turned into a question 37 -> 4, decisions lost 28 -> 10, edits to
 * document-grounded replies 33 -> 13 of 72.
 *
 * NOT enforced in code, on purpose: about a fifth of the listed phrases
 * survive in the model's own reply, and most of those are listing mistakes it
 * then corrects (a résumé's "about 2.3 million a day" listed, then kept).
 * Deleting every listed sentence would remove grounded facts.
 */
const LIST_THEN_REWRITE = `
Work in two steps and output both.
Step 1, one line starting "UNSUPPORTED:" — only the phrases of the draft that state AS FACT something the material does not state, each followed by its kind in square brackets, separated by " | ":
[past] something that already happened or is already true and that only a record can establish: what they did, led, built, measured or agreed, a number, a price, a policy, a procedure, a capability, a customer, a result;
[self] a fact about who they already are: an existing preference, habit, motive, feeling, strength or weakness, or when they are available;
[promise] a promise with consequences: money, a refund or credit, a price or discount, a contract term, a delivery date or deadline, a guarantee, what the product or the company will do.
Never list these, they are not claims that need a record: a decision or choice they make now ("let's do the pads today", "I can take this", "I'd go with REST here"); taking a task or offering to; a recommendation or professional judgment ("I'd shift the plan rather than re-plan it"); an ordinary small commitment ("I'll send that today", "I'll check and come back to you", "I'll stay on this with you"); general knowledge; what the other person said or the request itself states; what the material states; an honest limit, that is saying they do not know something yet or cannot confirm or promise it yet ("I can't confirm a credit on this call", "I can't confirm that was agreed", "I don't know yet").
Write "UNSUPPORTED: none" when there is nothing to list.
Then one line starting "CONFLICT:" — if the material itself gives two different values or rules for the very thing that was asked, both in a few words; otherwise "CONFLICT: none".
Step 2, after a line containing only "---" — the revised reply, built by these rules in order:
1. Every phrase you listed is gone: none of them appears, in any wording.
2. Everything you did not list stays word for word, decisions, ownership, recommendations and small commitments included.
3. If CONFLICT is not "none", the reply asserts neither value. Where the draft asserted one, one sentence says it is given two ways, names both values, and says it needs confirming before anyone relies on it. If the draft already says so, leave it.
4. If removing the listed phrases leaves what was asked without an answer, do not hand the question back to the other person. For a preference, a willingness or their availability: one short sentence, in their own voice, that they will confirm it and come back on it, with a day if the draft implied one. For a reason, a motive or an event in their own past: the plain facts about it that are stated (the dates, the role, the project; for a question about a job, what that job is), said as their own facts, and nothing invented after it.
The reply is spoken by them: it never says "the material", "the record" or where a fact comes from.
If nothing was listed and there is no conflict, the revised reply is the draft unchanged.`;

/**
 * The verifier's output is `UNSUPPORTED: … \n---\n <reply>`. Only the reply is
 * ever shown or checked; a model that skipped the list returns its text whole.
 */
export function splitVerifierScratch(text: string): { scratch: string; reply: string } {
  const t = String(text ?? '').trim();
  const rule = t.match(/(?:^|\n)[ \t]*-{3,}[ \t]*(?:\n|$)/);
  if (rule && rule.index !== undefined && /UNSUPPORTED\s*:/i.test(t.slice(0, rule.index + 1))) {
    return { scratch: t.slice(0, rule.index).trim(), reply: t.slice(rule.index + rule[0].length).trim() };
  }
  const first = t.match(/^UNSUPPORTED\s*:[^\n]*(?:\n|$)/i);
  if (first) return { scratch: first[0].trim(), reply: t.slice(first[0].length).trim() };
  return { scratch: '', reply: t };
}

const NO_PRODUCT_MATERIAL = ' No document describes the product or the company, so unless the conversation itself states it, every statement about what the product does, how it works, costs, includes, integrates with, delivers or promises is unsupported, even when it sounds generic: replace it with the discovery question that lets the user answer precisely ("Walk me through what your dispatchers do today, so I can show you the part that matters").';
/**
 * Call Center with no document (2026-10-01): the capped answers were procedures the model supplied — "I'll ask her a
 * couple of quick questions to confirm her identity", "I can't send a reset by text", "nobody here can see inside
 * your home". Replayed on the same drafts, judged: 7.46 -> 8.25 on top of list-then-rewrite (hard fails 10 -> 4).
 */
const NO_POLICY_MATERIAL = ' No document describes the company\'s policies or procedures either, so a policy, a procedure, a verification step, a restriction, what the agent can or cannot see or do, a cause or a timeline is unsupported too, even when it sounds standard: acknowledge what the customer asked and say you will check how that is handled, or ask what they are seeing.';
/** Sales with no document: "it depends on how many people would be using it", "three years is a term I can work with". Judged 7.98 -> 8.22 (hard fails 8 -> 5). */
const NO_TERMS_MATERIAL = ' The same holds for what the price depends on, which terms, discounts or contract lengths exist, and what the seller can quote, promise or deliver by when: say you will confirm it, and ask the one thing you need from them.';

/**
 * An honest LIMIT is not a claim (2026-10-01, fix12). The list step filed
 * "I can't confirm a credit on this call [promise]", "I can't confirm it as a
 * freeze [past]" and "We didn't measure anything about colonies [past]" as
 * unsupported, so the edit removed the draft's answer to a yes-or-no ask: asked
 * "am I getting money back for today or not?", the shown reply was "I'll get
 * the outage documented… Can I get your account number". On dev, 19 of 41
 * drafts that stated a limit lost it (8 before list-then-rewrite), and the
 * Seminar "not measured" validator passed 2 of 6 replays.
 * Three narrowings, no new step: the never-list names an honest limit (not
 * knowing, cannot confirm or promise yet) and what the request itself says;
 * "Never say you cannot speak to…" is a rule for what the EDIT may add, not for
 * the draft; and a study's scope is closed, so "we did not measure X" is
 * supported when the material describes the study and X is not in it.
 * Capability and policy limits ("I can't send a reset by text") are still
 * listed: those were the invented restrictions. Replayed on the same drafts:
 * limits lost 19 -> 10 of 41 (dev), 3 -> 1 of 6 (supp-behavior), edits
 * 109 -> 94, the Seminar validator 2/6 -> 6/6, the invented reset-by-text
 * restriction still removed 6/6.
 */
const STUDY_SCOPE = ' The one exception is the scope of a study the material describes: that it did not measure, test or include something the material never mentions is supported, keep it.';

export function claimVerifierSystemPrompt(modeId: string, surface: 'spoken' | 'typed' = 'spoken', opts: { noDocuments?: boolean } = {}): string {
  const typed = surface === 'typed';
  const productGap = opts.noDocuments && (modeId === 'sales' || modeId === 'call-center')
    ? NO_PRODUCT_MATERIAL + (modeId === 'call-center' ? NO_POLICY_MATERIAL : NO_TERMS_MATERIAL) : '';
  const reply = typed
    ? `a reply the assistant wrote privately for ${WRITTEN_FOR[modeId] ?? 'the user'}`
    : `a reply that ${SPEAKER[modeId] ?? 'the user is about to say aloud'}`;
  const subject = typed ? (TYPED_SUBJECT[modeId] ?? 'the user themselves') : (SUBJECT[modeId] ?? 'the speaker themselves');
  return `You edit ${reply}. You receive the material the assistant had (documents, profile, conversation) and, after the last "---" line, the draft reply.
Remove or neutralise every statement about ${subject} that the material does not state: preferences and stances ("I'm open to", "that works for me", "I'm taking it seriously"), willingness, motives and reasons, strengths and weaknesses, habits or practices presented as their own history, feelings, events, numbers, prices, capabilities, integrations, customers, results, guarantees and commitments not in the material. A denial ("I haven't", "we don't") is a statement too.${modeId === 'seminar' ? STUDY_SCOPE : ''}${productGap}
Keep everything the material supports, everything the other person stated, and general reasoning. ${typed ? 'Keep the same voice, format and length.' : 'Keep the same voice, natural and speakable.'} Keep the draft's **double-asterisk** highlights on the words you keep. A caution that a document is expired, out of date, a draft or not the current version is supported whenever the material marks it so: keep it. Never add that you cannot speak to something, do not have it, or that it is not available; never mention the material, a résumé, notes or what is missing. Do not add facts.
Change as little as possible. If nothing needs changing, the revised reply is the draft unchanged. The revised reply is in the language the draft is written in.${LIST_THEN_REWRITE}`;
}

/** The part of the verifier's message after the answer call's own (inherited) message. */
export function claimVerifierDraftMessage(draftBody: string): string {
  return `DRAFT REPLY:\n${String(draftBody ?? '').trim()}`;
}

/** The whole verifier message when the answer call cannot be replayed: the V3 user message is the material. */
export function claimVerifierStandaloneMessage(material: string, draftBody: string): string {
  return `MATERIAL:\n${String(material ?? '').slice(0, 24000)}\n\n---\n${claimVerifierDraftMessage(draftBody)}`;
}

// ── acceptance rails ────────────────────────────────────────────────────────

/** The spoken body and the [[GIST]] chip line, split by the shared display helper. */
export function splitGistTrailer(text: string): { body: string; gist: string } {
  const { body, gist } = splitGistLine(String(text ?? ''));
  return { body: body.trim(), gist: gist ?? '' };
}

/** "I don't have X in front of me", "I can't speak to", "not in my notes" — never introduced by an edit. */
export const EPISTEMIC_RE = /\b(?:I (?:don'?t|do not) have (?:the|that|those|a|any|it|my|specifics|details|exact|numbers?|figures?|a record)\b|in front of me|I can'?t (?:speak to|confirm|see|pull|say)|(?:isn'?t|is not|not) (?:something|anything) I (?:have|can)|not (?:documented|available|in (?:the|my|your) (?:profile|resume|résumé|notes|brief|material|file|record)))/i;
/** Negative claims about the speaker ("I haven't", "we don't") — never introduced by an edit. */
export const DENIAL_RE = /\b(?:I (?:don'?t|do not|haven'?t|have not|never) (?:have|had|done|did|led|run|ran|worked|built|shipped|used|offer)|we (?:don'?t|do not|can'?t|cannot) (?:offer|support|integrate|do|have)|not in my background)\b/i;
/**
 * The reply's caution about a stale document ("that sheet ran through December", "let me confirm it's still the
 * current one"). The list-then-rewrite pass listed it as unsupported and confirmed the expired price instead
 * (DSALES-023: objective validator pass -> fail), so an edit that loses it is never shipped.
 */
export const FRESHNESS_RE = /\b(?:expired?|expir(?:y|es)|out of date|outdated|no longer (?:valid|current|in effect)|ran (?:through|until|to the end of)|still (?:the )?current|(?:current|latest|today'?s) (?:version|sheet|pricing|price list|terms|policy)|superseded|an? (?:older|old|earlier|previous) (?:version|sheet|copy)|is (?:a|still a) draft|last year'?s)\b/i;
const NUM_RE = /\d+(?:[.,]\d+)*/g;
const nums = (s: string): Set<string> => new Set((String(s).match(NUM_RE) ?? []).map((n) => n.replace(/,/g, '')));

/**
 * Share of the letters that are not Latin script. The transport appends the app's language instruction to every
 * system prompt ("If the user writes in Hindi, respond in Hindi…"), and on this call it sometimes turned an English
 * reply into Hindi: in-app, 3 of 360 dev answers in each of two runs (DCC-008/009/010, DSALES-002, DCC-004) streamed
 * in English and were REPLACED by a Hindi edit. An edit never changes the reply's script.
 */
export function nonLatinShare(text: string): number {
  const letters = String(text ?? '').match(/\p{L}/gu) ?? [];
  if (!letters.length) return 0;
  return letters.filter((c) => !/\p{Script=Latin}/u.test(c)).length / letters.length;
}

/**
 * Words for the copilot's own sources. The pass is told about "the material", and in the app it said so aloud: "The
 * material gives both, so let's confirm which one holds", "The material I have on Project Tern records the scope"
 * (3 of 61 edits, 2026-10-01). An edit that introduces one is never shipped.
 */
export const SOURCE_WORD_RE = /\b(?:the material|material (?:I have|gives|says|records|states)|(?:the|my) (?:r[eé]sum[eé]|profile|job description) (?:says|lists|shows|records|states|has)|on record|the record (?:shows|says))\b/i;

const formatInsensitive = (t: string): string => String(t ?? '')
  .replace(/\*\*/g, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

/**
 * The edit as it will be shown. A quote pair is removed only when it WRAPS the whole reply: stripping any trailing
 * quote cut the closing mark off replies that end on a quoted line (in-app 2026-10-01: 6 of 149 edits, for 5 of them
 * the only "change" — the text was replaced and its [[GIST]] chip dropped for nothing). Runs of spaces left where a
 * dash was normalised are collapsed (35 of 149 edits).
 */
function tidyEdit(text: string): string {
  let t = String(text ?? '').trim();
  const wrapped = t.match(/^["“]([\s\S]*)["”]$/);
  if (wrapped && !/["“”]/.test(wrapped[1])) t = wrapped[1].trim();
  return t.replace(/([^\s])[ \t]{2,}(?=\S)/g, '$1 ');
}

export interface VerifiedAnswer { accepted: boolean; changed: boolean; reason: string; text: string }

/**
 * Decide whether the verifier's edit replaces the answer. Deterministic.
 * `original` may carry a [[GIST]] trailer; the verifier only ever saw the body.
 */
export function acceptVerifiedAnswer(input: { original: string; edited: string | null | undefined; material: string }): VerifiedAnswer {
  const { body } = splitGistTrailer(input.original);
  const keep = (reason: string): VerifiedAnswer => ({ accepted: false, changed: false, reason, text: input.original });
  const edited = tidyEdit(splitGistTrailer(splitVerifierScratch(String(input.edited ?? '')).reply.replace(/^\s*DRAFT REPLY\s*:\s*/i, '')).body);
  if (!edited) return keep('empty');
  // Formatting is not a claim: an edit that differs only in **highlights**,
  // quote style or spacing keeps the original, highlights and all (in-app,
  // 2026-09-30: DSALES-023's only "edit" was dropping its three bold marks).
  if (edited === body || formatInsensitive(edited) === formatInsensitive(body)) return { accepted: true, changed: false, reason: 'unchanged', text: input.original };
  // With no document at all, one discovery question is the right edit of a paragraph of invented capabilities
  // (DSALES-001: the ratio rail kept the claims); otherwise an edit never cuts a reply to under a quarter.
  const words = edited.split(/\s+/).filter(Boolean).length;
  if (edited.length < 20 || words < 6) return keep('too_short');
  if (edited.length < body.length * 0.25 && !materialHasNoDocuments(input.material)) return keep('too_short');
  if (Math.abs(nonLatinShare(edited) - nonLatinShare(body)) > 0.3) return keep('language_changed');
  if (/```/.test(edited) || /```/.test(body)) return keep('code');
  if (/^(?:MATERIAL|DRAFT REPLY|UNSUPPORTED)\s*:/im.test(edited)) return keep('echoed_prompt');
  const allowed = new Set([...nums(body), ...nums(input.material)]);
  for (const n of nums(edited)) if (!allowed.has(n)) return keep(`new_number:${n}`);
  if (EPISTEMIC_RE.test(edited) && !EPISTEMIC_RE.test(body)) return keep('epistemic_introduced');
  if (DENIAL_RE.test(edited) && !DENIAL_RE.test(body)) return keep('denial_introduced');
  if (FRESHNESS_RE.test(body) && !FRESHNESS_RE.test(edited)) return keep('freshness_dropped');
  if (SOURCE_WORD_RE.test(edited) && !SOURCE_WORD_RE.test(body)) return keep('source_exposed');
  // A changed body drops the old [[GIST]] chip: it summarised the removed claims too.
  return { accepted: true, changed: true, reason: 'edited', text: edited };
}

// ── the pass itself, shared by both surfaces ────────────────────────────────

export interface ClaimVerifierRun { text: string; changed: boolean; outcome: string; ms: number }

/**
 * Run one verification: open the stream, bound it by a TOTAL budget (the
 * first-useful deadline never switches to the stall guard because nothing is
 * "useful" until the edit is whole), and keep the answer unless the edit
 * finished and the rails accept it. Never throws.
 */
export async function runClaimVerifier(opts: {
  answer: string;
  material: string;
  budgetMs: number;
  startStream: (draftBody: string, signal: AbortSignal) => AsyncGenerator<string> | AsyncIterable<string>;
  parentSignal?: AbortSignal;
  isSuperseded?: () => boolean;
  clean?: (text: string) => string;
  observe?: StreamObserver;
}): Promise<ClaimVerifierRun> {
  const started = Date.now();
  const keep = (outcome: string): ClaimVerifierRun => ({ text: opts.answer, changed: false, outcome, ms: Date.now() - started });
  const { body } = splitGistTrailer(opts.answer);
  if (!body) return keep('empty_answer');
  const child = new AbortController();
  const onParentAbort = () => child.abort();
  opts.parentSignal?.addEventListener('abort', onParentAbort, { once: true });
  let out = '';
  let ending = 'error';
  try {
    ending = await raceStreamWithDeadline({
      observe: opts.observe,
      stream: opts.startStream(body, child.signal) as AsyncGenerator<string>,
      firstUsefulDeadlineMs: opts.budgetMs,
      isUsefulYet: () => false,
      // The list quotes the draft and the reply repeats it: up to ~2x the draft is expected.
      shouldAbort: () => out.length > body.length * 3 + 600 || opts.parentSignal?.aborted === true || opts.isSuperseded?.() === true,
      onToken: (tok: string) => { out += tok; },
      onCleanup: (reason) => { if (reason !== 'done') child.abort(); },
    });
  } catch { ending = 'error'; }
  finally { opts.parentSignal?.removeEventListener('abort', onParentAbort); }
  if (ending !== 'done') return keep(ending);
  const reply = splitVerifierScratch(out).reply;
  const edited = opts.clean ? opts.clean(reply) : reply;
  const verdict = acceptVerifiedAnswer({ original: opts.answer, edited, material: opts.material });
  return { text: verdict.text, changed: verdict.changed, outcome: verdict.reason, ms: Date.now() - started };
}
