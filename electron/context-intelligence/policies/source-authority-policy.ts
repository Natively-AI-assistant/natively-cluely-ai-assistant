// electron/context-intelligence/policies/source-authority-policy.ts
//
// Which sources are authoritative for which claims — the rule set that stops a
// JD from proving the user has a skill.
//
// See docs/context-intelligence-v3/06_SOURCE_AUTHORITY_SPEC.md

import type { ClaimType, SourceType, EvidenceScope, AuthorizedSource } from '../contracts/types';

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
  USER_PROJECT:    { authoritative: ['RESUME', 'CANDIDATE_FILE', 'PROJECT_FILE', 'PROFILE_FACT'], prohibited: ['JOB_DESCRIPTION'] },
  USER_SKILL:      { authoritative: ['RESUME', 'CANDIDATE_FILE', 'PROFILE_FACT'], prohibited: ['JOB_DESCRIPTION'] },
  USER_EDUCATION:  { authoritative: ['RESUME', 'CANDIDATE_FILE', 'PROFILE_FACT'], prohibited: ['JOB_DESCRIPTION'] },
  // Motivation is only ever direct user context. Anything else is inference and
  // must be labelled as such, never asserted as history.
  USER_MOTIVATION: { authoritative: ['PROFILE_FACT', 'CONVERSATION_STATE'], prohibited: ['JOB_DESCRIPTION', 'RESUME'] },

  // Symmetric rule: a resume cannot state what a job requires.
  JOB_RESPONSIBILITY:   { authoritative: ['JOB_DESCRIPTION'], prohibited: ['RESUME'] },
  JOB_REQUIRED_SKILL:   { authoritative: ['JOB_DESCRIPTION'], prohibited: ['RESUME'] },
  JOB_PREFERRED_SKILL:  { authoritative: ['JOB_DESCRIPTION'], prohibited: ['RESUME'] },

  DOCUMENT_FACT:     { authoritative: ['REFERENCE_FILE', 'PROJECT_FILE', 'CODING_SAMPLE'], prohibited: [] },
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

export function isAuthoritativeFor(source: SourceType, claim: ClaimType): boolean {
  return CLAIM_AUTHORITY[claim].authoritative.includes(source);
}

export function isProhibitedFor(source: SourceType, claim: ClaimType): boolean {
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
