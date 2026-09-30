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

export type ClaimVerifierKind = 'personal' | 'product' | 'life';

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
export function claimVerifierKind(input: { modeId: string | null | undefined; question: string; draft: string }): ClaimVerifierKind | null {
  const mode = String(input.modeId ?? '');
  const q = String(input.question ?? '');
  const draft = String(input.draft ?? '');
  if (/```/.test(draft)) return null;
  if (mode === 'looking-for-work') return 'personal';
  if (mode === 'technical-interview' || mode === 'seminar') return TI_PERSONAL_RE.test(q) || DRAFT_PERSONAL_RE.test(draft) ? 'personal' : null;
  if (mode === 'sales' || mode === 'call-center') return 'product';
  if (mode === 'general') return LIFE_RE.test(q) || DRAFT_PERSONAL_RE.test(draft) ? 'life' : null;
  return null;
}

const SPEAKER: Record<string, string> = {
  'looking-for-work': 'a job candidate is about to say aloud in an interview',
  'technical-interview': 'a job candidate is about to say aloud in a technical interview',
  seminar: 'a presenter is about to say aloud to the audience of their research seminar',
  sales: 'a seller is about to say aloud to a prospect',
  'call-center': 'a support agent is about to say aloud to a customer',
  general: 'the user is about to say aloud in a conversation',
};
const SUBJECT: Record<string, string> = {
  sales: 'the seller, their product or their company',
  'call-center': 'the agent, their product, their company or its policies',
};

/** The typed surface: the reply is read by the user (advice or a script), not said by them. */
const WRITTEN_FOR: Record<string, string> = {
  'looking-for-work': 'a job candidate',
  'technical-interview': 'a job candidate in a technical interview',
  seminar: 'a presenter at their research seminar',
  sales: 'a seller on a sales call',
  'call-center': 'a support agent on a customer call',
  general: 'the user',
};
const TYPED_SUBJECT: Record<string, string> = {
  sales: 'the seller, their product or their company',
  'call-center': 'the agent, their product, their company or its policies',
};

/**
 * System prompt for the verifier call. The spoken wording is the one measured
 * offline (tools/scrub-experiment.mjs) plus "change as little as possible", so a
 * reply with nothing unsupported comes back byte-identical and is kept as it
 * was. The typed surface differs only where the reply's reader differs.
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
const NO_PRODUCT_MATERIAL = ' No document describes the product or the company, so unless the conversation itself states it, every statement about what the product does, how it works, costs, includes, integrates with, delivers or promises is unsupported, even when it sounds generic: replace it with the discovery question that lets the user answer precisely ("Walk me through what your dispatchers do today, so I can show you the part that matters").';

export function claimVerifierSystemPrompt(modeId: string, surface: 'spoken' | 'typed' = 'spoken', opts: { noDocuments?: boolean } = {}): string {
  const typed = surface === 'typed';
  const productGap = opts.noDocuments && (modeId === 'sales' || modeId === 'call-center') ? NO_PRODUCT_MATERIAL : '';
  const reply = typed
    ? `a reply the assistant wrote privately for ${WRITTEN_FOR[modeId] ?? 'the user'}`
    : `a reply that ${SPEAKER[modeId] ?? 'the user is about to say aloud'}`;
  const subject = typed ? (TYPED_SUBJECT[modeId] ?? 'the user themselves') : (SUBJECT[modeId] ?? 'the speaker themselves');
  return `You edit ${reply}. You receive the material the assistant had (documents, profile, conversation) and, after the last "---" line, the draft reply.
Remove or neutralise every statement about ${subject} that the material does not state: preferences and stances ("I'm open to", "that works for me", "I'm taking it seriously"), willingness, motives and reasons, strengths and weaknesses, habits or practices presented as their own history, feelings, events, numbers, prices, capabilities, integrations, customers, results, guarantees and commitments not in the material. A denial ("I haven't", "we don't") is a statement too.${productGap}
Keep everything the material supports, everything the other person stated, and general reasoning. ${typed ? 'Keep the same voice, format and length.' : 'Keep the same voice, natural and speakable.'} Never say you cannot speak to something, do not have it, or that it is not available; never mention the material, a résumé, notes or what is missing. Do not add facts.
If removing a claim leaves the question unanswered, answer with what stays true and hand it back with one practical question (for example "I'd want to talk that through properly. What does the timeline look like?").
Change as little as possible. Output only the revised reply. If nothing needs changing, output it unchanged.`;
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
const NUM_RE = /\d+(?:[.,]\d+)*/g;
const nums = (s: string): Set<string> => new Set((String(s).match(NUM_RE) ?? []).map((n) => n.replace(/,/g, '')));

export interface VerifiedAnswer { accepted: boolean; changed: boolean; reason: string; text: string }

/**
 * Decide whether the verifier's edit replaces the answer. Deterministic.
 * `original` may carry a [[GIST]] trailer; the verifier only ever saw the body.
 */
export function acceptVerifiedAnswer(input: { original: string; edited: string | null | undefined; material: string }): VerifiedAnswer {
  const { body } = splitGistTrailer(input.original);
  const keep = (reason: string): VerifiedAnswer => ({ accepted: false, changed: false, reason, text: input.original });
  const edited = splitGistTrailer(String(input.edited ?? '').replace(/^\s*DRAFT REPLY\s*:\s*/i, '')).body.replace(/^["“]|["”]$/g, '').trim();
  if (!edited) return keep('empty');
  if (edited === body) return { accepted: true, changed: false, reason: 'unchanged', text: input.original };
  if (edited.length < 20 || edited.length < body.length * 0.25) return keep('too_short');
  if (/```/.test(edited) || /```/.test(body)) return keep('code');
  if (/^(?:MATERIAL|DRAFT REPLY)\s*:/im.test(edited)) return keep('echoed_prompt');
  const allowed = new Set([...nums(body), ...nums(input.material)]);
  for (const n of nums(edited)) if (!allowed.has(n)) return keep(`new_number:${n}`);
  if (EPISTEMIC_RE.test(edited) && !EPISTEMIC_RE.test(body)) return keep('epistemic_introduced');
  if (DENIAL_RE.test(edited) && !DENIAL_RE.test(body)) return keep('denial_introduced');
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
      shouldAbort: () => out.length > body.length * 2 + 400 || opts.parentSignal?.aborted === true || opts.isSuperseded?.() === true,
      onToken: (tok: string) => { out += tok; },
      onCleanup: (reason) => { if (reason !== 'done') child.abort(); },
    });
  } catch { ending = 'error'; }
  finally { opts.parentSignal?.removeEventListener('abort', onParentAbort); }
  if (ending !== 'done') return keep(ending);
  const edited = opts.clean ? opts.clean(out.trim()) : out.trim();
  const verdict = acceptVerifiedAnswer({ original: opts.answer, edited, material: opts.material });
  return { text: verdict.text, changed: verdict.changed, outcome: verdict.reason, ms: Date.now() - started };
}
