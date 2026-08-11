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
}): boolean {
  if (input.answerPolicy !== 'refuse_insufficient_evidence') return true;
  return sourceAuthorityPermitsRefusal(input.sourceAuthority);
}
