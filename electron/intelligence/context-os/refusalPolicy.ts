// electron/intelligence/context-os/refusalPolicy.ts
//
// WHEN IS A REFUSAL HONEST?
//
// Live report 2026-08-11: WTA with a screenshot in a looking-for-work mode
// (sourceAuthority=profile_only, zero reference files, empty question) answered
// "This is not directly mentioned in the uploaded material." — three times.
// The kernel's own trace said finalAction="answer"; the evidence layer overrode
// it. With zero candidates every pack decision site returns
// `refuse_insufficient_evidence`, the coordinator govern sites set
// `govern: true` unconditionally, and the surface yields the canned string
// without ever calling the model. The same screenshot through manual-chat
// answered normally.
//
// The line (independent review, 2026-08-11): a refusal is truthful only when
// the mode's authority promises a BOUNDED UNIVERSE — "answer only from X" as
// the product contract. Those are exactly the authorities modeSourceContract
// marks `evidenceRequired: true`. Everywhere else, an empty pack means the
// mode simply has nothing to add — the turn must FALL BACK to the model, not
// refuse on behalf of a universe that was never bounded (and, in the reported
// case, never populated).
//
// This module is deliberately tiny and pure so the line is testable on its
// own. It hand-mirrors EVIDENCE_REQUIRED_FOR_AUTHORITY rather than importing
// modeSourceContract (services → context-os would invert the layering);
// ContextOsRefusalGoverns2026_08_11.test.mjs is the drift guard that asserts
// the mirror agrees with the real mapping for every shipped authority.

import type { EvidencePack } from './evidencePack';

/** The authorities whose product contract is "answer only from this source" —
 *  `evidenceRequired: true` in modeSourceContract. Refusing over an empty
 *  retrieval is honest ONLY here. */
const BOUNDED_UNIVERSE_AUTHORITIES: ReadonlySet<string> = new Set([
  'reference_files_only',
  'reference_files_primary',
  'reference_files_plus_transcript',
  'transcript_only',
]);

/**
 * Does this authority make "I could not find it in the material" a truthful
 * answer? Unknown/legacy values fail toward `false`: refusing on an authority
 * we cannot classify would recreate the reported bug for any future value.
 */
export function sourceAuthorityPermitsRefusal(sourceAuthority: string | null | undefined): boolean {
  return typeof sourceAuthority === 'string' && BOUNDED_UNIVERSE_AUTHORITIES.has(sourceAuthority);
}

/**
 * Should this evidence pack GOVERN generation?
 *
 * `govern: false` reverts the turn to the legacy prompt path — every consumer
 * already guards on `.govern` — which is what lets the model answer a
 * screenshot/general question the evidence system has nothing to say about.
 *
 * Only the refusal outcome is gated. `answer` / `answer_with_uncertainty`
 * govern as before (the pack IS the evidence), and `ask_clarification` is
 * deliberately untouched by this change.
 */
export function packGovernsGeneration(input: {
  answerPolicy: EvidencePack['answerPolicy'] | string;
  sourceAuthority: string | null | undefined;
  /**
   * Review finding F2 (2026-08-12): the docblock above says "the bounded
   * universe actually EXISTS", and clarificationIsActionable already takes
   * this — but this function did not, so a reference_files_primary mode with
   * ZERO files was still classed as bounded. For the reference-bound trio the
   * universe exists only when files do; omitted/false fails toward answering,
   * because refusing on an unverified universe is the whole bug class.
   * transcript_only never has files and stays authority-only.
   */
  hasReferenceFiles?: boolean;
}): boolean {
  if (input.answerPolicy !== 'refuse_insufficient_evidence') return true;
  if (!sourceAuthorityPermitsRefusal(input.sourceAuthority)) return false;
  if (input.sourceAuthority === 'transcript_only') return true;
  return input.hasReferenceFiles === true;
}

/** The authorities whose universe is the mode's uploaded reference files. */
const REFERENCE_BOUND_AUTHORITIES: ReadonlySet<string> = new Set([
  'reference_files_only',
  'reference_files_primary',
  'reference_files_plus_transcript',
]);

/**
 * Is a sourceOwner='clarify' short-circuit ACTIONABLE for this turn?
 *
 * Second live report, 2026-08-11 (same day as the refuse-path fix): a WTA
 * screenshot turn in a blank GENERAL-template mode was short-circuited into
 * "This mode only answers from your uploaded material… switch to a mode that
 * enables that source". The general template's SEEDED contract claims
 * reference_files_primary; the mode had ZERO files; the kernel demoted the
 * owner to 'clarify'; and the short-circuit ran before the provider call. The
 * same contract FORBADE every profile source — so the message pointed at a
 * résumé it would not have used, about material never uploaded, for a question
 * never typed.
 *
 * The same honest line as packGovernsGeneration: a clarification between
 * source universes is only worth interrupting the user for when the mode's own
 * bounded universe actually EXISTS. A reference-bound authority with no files
 * has nothing to disambiguate into — the honest move is answering.
 *
 * Deliberately scoped to the reference-bound trio: ask_if_ambiguous /
 * general_mixed clarifications disambiguate between REAL universes and must
 * survive, and transcript_only never has files, so a bare files check would
 * gag it. Unknown authorities fail toward answering the user.
 */
export function clarificationIsActionable(input: {
  sourceAuthority: string | null | undefined;
  hasReferenceFiles: boolean;
}): boolean {
  if (typeof input.sourceAuthority !== 'string') return true;
  // R8 (2026-08-12, review finding): the docblock promised "unknown
  // authorities fail toward answering the user", but the fall-through
  // returned TRUE — letting the clarify short-circuit gag a turn on an
  // authority we cannot even classify (a 'legacy' or future value). The
  // known non-reference-bound authorities keep clarify available (they
  // disambiguate between REAL universes); the reference-bound trio needs
  // files; anything else is unclassifiable and must answer instead.
  if (REFERENCE_BOUND_AUTHORITIES.has(input.sourceAuthority)) {
    return input.hasReferenceFiles;
  }
  return KNOWN_SOURCE_AUTHORITIES.has(input.sourceAuthority);
}

/** Every authority modeSourceContract can produce (hand-mirror of
 *  ModeSourceAuthority — same layering constraint as
 *  BOUNDED_UNIVERSE_AUTHORITIES; the drift-guard test asserts agreement). */
const KNOWN_SOURCE_AUTHORITIES: ReadonlySet<string> = new Set([
  'reference_files_only',
  'reference_files_primary',
  'reference_files_plus_transcript',
  'profile_only',
  'profile_plus_transcript',
  'transcript_only',
  'general_mixed',
  'ask_if_ambiguous',
]);
