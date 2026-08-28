// electron/context-intelligence/policies/source-authority-policy.ts
//
// Which sources are authoritative for which claims — the rule set that stops a
// JD from proving the user has a skill.
//
// See docs/context-intelligence-v3/06_SOURCE_AUTHORITY_SPEC.md

import type { ClaimType, SourceType, EvidenceScope, AuthorizedSource } from '../contracts/types';
import { isRetrievalFixEnabled } from '../contracts/retrieval-flags';

export interface ClaimAuthority {
  authoritative: SourceType[];
  /** Sources that must NEVER support this claim, even if retrieved. */
  prohibited: SourceType[];
}

/**
 * Exhaustive by construction: `Record<ClaimType, …>` means a new ClaimType that
 * lacks an entry is a COMPILE error. The mode-id lists in the legacy codebase
 * are plain string sets with no such link, which is why adding the 8th mode
 * silently disabled its routing in six places.
 */
export const CLAIM_AUTHORITY: Record<ClaimType, ClaimAuthority> = {
  // A JD states what the EMPLOYER wants. It can never evidence what the user has.
  //
  // CANDIDATE_FILE is authoritative for the same claims because in Recruiting the
  // person being described is the CANDIDATE, not the operator — the claim types
  // are named USER_* but they mean "the person this turn is about". Omitting it
  // made Recruiting structurally unanswerable: its primary source is
  // CANDIDATE_FILE, the primary-source fallback therefore emitted USER_PROJECT,
  // and USER_PROJECT's authoritative list contained nothing Recruiting
  // authorizes — so the turn's authorized source types resolved to [] and NO
  // retrieval was possible. Measured: raw candidates 0 in Recruiting where the
  // identical query returned 9 in every other mode.
  //
  // This does not widen anything elsewhere: a mode must ALSO authorize
  // CANDIDATE_FILE for it to be reachable, and only Recruiting does.
  USER_EMPLOYMENT: { authoritative: ['RESUME', 'CANDIDATE_FILE', 'PROFILE_FACT'], prohibited: ['JOB_DESCRIPTION'] },
  // CODING_SAMPLE added 2026-08-01 (deep-test D3/D7): technical-interview
  // authorizes coding samples precisely so they can evidence the user's own
  // project ("what is the worker batch size?" lives in a .py sample). Without
  // it, a correctly-typed CODING_SAMPLE chunk was retrieved and then dropped by
  // claim authority on every USER_PROJECT turn.
  USER_PROJECT:    { authoritative: ['RESUME', 'CANDIDATE_FILE', 'PROJECT_FILE', 'CODING_SAMPLE', 'PROFILE_FACT'], prohibited: ['JOB_DESCRIPTION'] },
  USER_SKILL:      { authoritative: ['RESUME', 'CANDIDATE_FILE', 'PROFILE_FACT'], prohibited: ['JOB_DESCRIPTION'] },
  USER_EDUCATION:  { authoritative: ['RESUME', 'CANDIDATE_FILE', 'PROFILE_FACT'], prohibited: ['JOB_DESCRIPTION'] },
  // Motivation is only ever direct user context. Anything else is inference and
  // must be labelled as such, never asserted as history.
  // CANDIDATE_FILE added 2026-08-01 (Defect F): the operator's OWN résumé stays
  // prohibited (a résumé's facts are not the user's motives), but a candidate
  // file may carry an explicit objective/reason-for-change statement, and
  // omitting it here while Recruiting authorizes no PROFILE_FACT made every
  // candidate-motivation question unreachable — the résumé was never queried
  // and the answer claimed no résumé existed. When the file states no reason,
  // retrieval now runs and the absence is disclosed as grounded absence.
  USER_MOTIVATION: { authoritative: ['PROFILE_FACT', 'CONVERSATION_STATE', 'CANDIDATE_FILE'], prohibited: ['JOB_DESCRIPTION', 'RESUME'] },

  // Symmetric rule: a resume cannot state what a job requires.
  JOB_RESPONSIBILITY:   { authoritative: ['JOB_DESCRIPTION'], prohibited: ['RESUME'] },
  JOB_REQUIRED_SKILL:   { authoritative: ['JOB_DESCRIPTION'], prohibited: ['RESUME'] },
  JOB_PREFERRED_SKILL:  { authoritative: ['JOB_DESCRIPTION'], prohibited: ['RESUME'] },

  // RESUME/CANDIDATE_FILE/JOB_DESCRIPTION added 2026-08-01 (deep-test D2/D10):
  // a DOCUMENT_FACT claim means "a fact this mode's ATTACHED DOCUMENTS state"
  // ("what is the canary written in this résumé?"). A résumé and a JD are
  // attached documents; excluding them meant document-deictic questions about
  // them planned only REFERENCE_FILE and the correctly-retrieved chunks were
  // dropped by claim authority. The JD-as-experience protection is untouched:
  // it lives on the USER_* claims, which still prohibit JOB_DESCRIPTION.
  DOCUMENT_FACT:     { authoritative: ['REFERENCE_FILE', 'PROJECT_FILE', 'CODING_SAMPLE', 'RESUME', 'CANDIDATE_FILE', 'JOB_DESCRIPTION'], prohibited: [] },
  // One meeting cannot evidence another. Enforced by scope, not by ranking.
  MEETING_STATEMENT: { authoritative: ['MEETING_TRANSCRIPT'], prohibited: [] },
  MEETING_DECISION:  { authoritative: ['MEETING_TRANSCRIPT'], prohibited: [] },
  SCREEN_FACT:       { authoritative: ['SCREEN_CONTEXT'], prohibited: [] },

  // Capability-backed, not source-backed: no private source is required, and
  // none is authoritative either.
  GENERAL_TECHNICAL: { authoritative: [], prohibited: [] },
  GENERAL_INDUSTRY:  { authoritative: [], prohibited: [] },
  RECOMMENDATION:    { authoritative: [], prohibited: [] },
};

// ── T1: a user's own reference file may evidence their own work ─────────────
//
// THE DEFECT (docs/retrieval-handoff/01-ROOT-CAUSES.md RC1, the master cause).
// `PERSONAL_RE` makes any second-person question a USER_* claim, and
// REFERENCE_FILE was authoritative for NO USER_* claim. In an interview every
// question is second person, so an uploaded reference file describing the
// user's own projects was unreachable for every one of them — in all nine
// modes. Measured: 0 of 6 realistic interviewer phrasings reached the file
// anywhere; 3 of 3 neutral document-shaped lookups reached it everywhere. Proved
// with perfect retrieval: a chunk LITERALLY CONTAINING THE ANSWER at score 0.99
// is discarded by 9/9 modes, evidence=0, answerability=NONE.
//
// The routing was deliberate — "personal experience" belongs in the résumé. The
// defect is that the product separately invites users to upload reference files
// describing their work, and then makes those files unreadable for every
// question about that work. The user's own workaround was to duplicate facts
// into the Real-time Prompt, which is injected unconditionally and never passes
// this gate — the workaround succeeded precisely because it bypassed it.
//
// WHY THIS IS THE SAME CHANGE MADE FOR USER_PROJECT ON 2026-08-01
// PROJECT_FILE and CODING_SAMPLE were added to USER_PROJECT (line 43) for
// exactly this reason: a correctly-typed chunk was retrieved and then dropped by
// claim authority. This is that repair, applied to the claims interview
// questions actually produce.
//
// SCOPE, and why it stops where it does:
//   • USER_EMPLOYMENT and USER_SKILL — measured: all six second-person
//     phrasings produce USER_EMPLOYMENT, one also USER_SKILL. These two are the
//     whole of the reported failure.
//   • USER_EDUCATION — same shape, included for consistency; conditional on the
//     contamination suite staying green.
//   • USER_PROJECT — added 2026-08-29, reversing the exclusion this list carried
//     for one day. See its entry below for the evidence that overturned it.
//   • USER_MOTIVATION is untouched. A document describing what someone BUILT
//     cannot evidence why they want a job; that inference is exactly what the
//     motivation claim's narrow list exists to prevent.
//
// WHAT IS NOT WIDENED, AND MUST NEVER BE
// Every `prohibited` list is byte-identical. The JD-as-experience protection —
// a job description stating what the EMPLOYER wants can never evidence what the
// USER has — lives there, and nothing here touches it. A mode must also
// authorize a source type for it to be reachable at all, so this cannot give a
// mode a pool its own policy forbids.
const USER_CLAIM_DOCUMENT_WIDENING: Partial<Record<ClaimType, SourceType[]>> = {
  USER_EMPLOYMENT: ['REFERENCE_FILE', 'PROJECT_FILE', 'CODING_SAMPLE'],
  USER_SKILL:      ['REFERENCE_FILE', 'PROJECT_FILE', 'CODING_SAMPLE'],
  USER_EDUCATION:  ['REFERENCE_FILE', 'PROJECT_FILE', 'CODING_SAMPLE'],
  // USER_PROJECT added 2026-08-29, REVERSING the exclusion recorded here on
  // 2026-08-28. That exclusion said "no measured interview phrasing routes to
  // USER_PROJECT" — which was true of the SYNTHETIC question set and false of
  // the real one. Run against the reporter's own sanitized pack in General
  // mode, three of his twelve questions route straight to USER_PROJECT:
  //
  //   "What exactly did you personally build or code in that project?"
  //   "Tell me specifically about Project A. What was the problem, what did
  //    you build, how did you test it, and what was the result?"
  //   "What did you monitor after Project A went live?"
  //
  // and each resolved `requires RESUME, CANDIDATE_FILE, PROJECT_FILE,
  // CODING_SAMPLE, PROFILE_FACT, which mode "general" does not authorize` ->
  // shouldRetrieve=false. General is the mode his own README recommends, and it
  // authorizes none of those five. So the claim most likely to be about a
  // user's project could not read the file describing that project.
  //
  // USER_PROJECT is THE project-shaped claim, so this is the centre of D1's
  // "option (a) scoped to project-shaped claims", not an extension of it. It
  // was excluded only because a synthetic corpus never produced it.
  USER_PROJECT:    ['REFERENCE_FILE'],
};

/**
 * The authority for a claim, with T1's widening applied.
 *
 * Resolved PER CALL rather than baked into `CLAIM_AUTHORITY` at module load.
 * That is not a style choice: `turn-classifier.ts` derives `CLAIM_TO_SOURCE`
 * from this table, and a module-load derivation would freeze whatever the
 * environment happened to be at import time — the flag would then be
 * unobservable to any test that sets it after importing, and to any caller that
 * resolves settings later in boot. It is the same freezing trap `FlagSpec.default`
 * documents in intelligenceFlags.ts.
 *
 * Prefer this over reading `CLAIM_AUTHORITY` directly. The raw table stays
 * exported because it is the legacy shape and reading it is correct wherever
 * only the PROHIBITED side or list-emptiness matters — neither of which this
 * widening can change.
 */
export function claimAuthority(claim: ClaimType): ClaimAuthority {
  const base = CLAIM_AUTHORITY[claim];
  const extra = USER_CLAIM_DOCUMENT_WIDENING[claim];
  if (!extra || !isRetrievalFixEnabled('referenceFilesEvidenceUserClaims')) return base;
  // `prohibited` is passed through untouched, by construction.
  return {
    authoritative: [...base.authoritative, ...extra.filter((s) => !base.authoritative.includes(s))],
    prohibited: base.prohibited,
  };
}

export function isAuthoritativeFor(source: SourceType, claim: ClaimType): boolean {
  return claimAuthority(claim).authoritative.includes(source);
}

export function isProhibitedFor(source: SourceType, claim: ClaimType): boolean {
  // Never widened — see the note above. Read straight from the base table so
  // that stays true even if `claimAuthority` grows another caller.
  return CLAIM_AUTHORITY[claim].prohibited.includes(source);
}

/** Claim types a given source may legitimately support. */
export function authorityOf(source: SourceType): ClaimType[] {
  return (Object.keys(CLAIM_AUTHORITY) as ClaimType[])
    .filter((c) => isAuthoritativeFor(source, c));
}

// ── Scope / version filtering ───────────────────────────────────────────────
//
// THE measured requirement. Phase 2: pure semantic retrieval surfaced a
// SUPERSEDED resume version on 54.8% of questions; production hybrid on 47.6%.
// resume_v1 and resume_v2 are near-identical prose, so their embeddings are
// correctly almost identical — no reranker or weight change can separate them.
//
// Therefore scope and version are applied BEFORE scoring, as a filter, and a
// superseded version is not retrievable at all rather than merely ranked lower.

export interface ScopeFilterInput {
  scope: EvidenceScope;
  authorized: AuthorizedSource[];
}

export interface ScopeCandidate {
  sourceId: string;
  versionId: string;
  scopeId: string;
  sourceType: SourceType;
}

export type ScopeRejection = 'OUT_OF_SCOPE' | 'SUPERSEDED_VERSION' | 'UNAUTHORIZED_SOURCE';

export interface ScopeFilterResult<T extends ScopeCandidate> {
  admitted: T[];
  rejected: Array<{ candidate: T; reason: ScopeRejection }>;
}

/**
 * Admit only candidates that are (a) from an authorized source, (b) in scope,
 * and (c) the ACTIVE version. Rejections are returned with a reason rather than
 * dropped, so a trace can distinguish "nothing matched" from "matched and
 * excluded" — today those two are indistinguishable to both user and telemetry.
 */
export function filterByScopeAndVersion<T extends ScopeCandidate>(
  candidates: T[],
  { authorized }: ScopeFilterInput,
): ScopeFilterResult<T> {
  const bySourceId = new Map(authorized.map((a) => [a.sourceId, a]));
  const admitted: T[] = [];
  const rejected: Array<{ candidate: T; reason: ScopeRejection }> = [];

  for (const c of candidates) {
    const auth = bySourceId.get(c.sourceId);
    if (!auth) { rejected.push({ candidate: c, reason: 'UNAUTHORIZED_SOURCE' }); continue; }
    if (auth.scopeId !== c.scopeId) { rejected.push({ candidate: c, reason: 'OUT_OF_SCOPE' }); continue; }
    if (auth.versionId !== c.versionId) { rejected.push({ candidate: c, reason: 'SUPERSEDED_VERSION' }); continue; }
    admitted.push(c);
  }
  return { admitted, rejected };
}
