// electron/intelligence/context-os/evidencePackValidation.ts
//
// Context OS — impossible-evidence-state gate, Stage 0 (shadow-only).
// See docs/answer-pipeline-rebuild/03_EVIDENCEPACK_DESIGN.md for the full
// design and staged-rollout rationale; this file implements ONLY the
// forbidden-direction checks (#1/#2 in that design) that Stage 0 scopes.
//
// WHY a policy-vs-contents check alone doesn't work (the design's own
// central finding): every profile-leak bug found this session (RC-9,
// RC-CICD, RC-2) is a MISCLASSIFICATION landing on a PERMISSIVE policy
// ('allowed'), not a case where a 'forbidden' policy was violated. A
// validator that only checks "forbidden policy + profile item present" is
// structurally blind to the entire bug class — it would have caught zero of
// today's three RC-9 sibling leaks, since `unknown_answer`'s policy is
// 'allowed', not 'forbidden'. Check #2 below is what actually closes RC-1:
// an 'allowed'-policy turn may only include profile-family evidence when
// there's an affirmative, checkable reason (the item genuinely supports the
// turn's requestedProperty) — reusing propertyEvidenceValidator's existing
// itemSupportsProperty, not a new matcher (a new matcher here would just be
// a sixth vocabulary-pattern list wearing a different hat — see the design
// doc's risk #2).
//
// One subtlety itemSupportsProperty and textCanProveProperty both share:
// `property === 'unknown'` makes them return `true` UNCONDITIONALLY (there's
// nothing to check a match against). For a generic technical question like
// "what is dependency injection", requestedProperty legitimately IS
// 'unknown' — there's nothing candidate-specific being asked — so NO
// affirmative reason can ever be constructed, and any profile-family
// evidence item present is presumptively a violation. This file adds that
// explicit guard; the reused matcher alone would silently pass RC-9's exact
// case through unflagged.
//
// Stage 2 update (2026-07-28): added check #3 (required-direction
// empty-pack) — SHADOW-ONLY, same as checks #1/#2 were at Stage 0 (this
// function has no concept of "enforce" vs "observe"; that distinction lives
// entirely in the ipcHandlers.ts call sites — Stage 1's enforcement filter
// only matches 'forbidden_policy_profile_item_present', so adding this new
// code cannot change Stage 1's enforced behavior). The design doc's literal
// condition for check #3 ("pack has zero evidence items AND
// coverage.sourceOwnerSatisfied === false") does NOT actually catch RC-8's
// failure shape: empirically confirmed via ProfileEvidenceService that when
// the legacy selector finds nothing, `coverage.sourceOwnerSatisfied` is
// computed as `factual.every(...)` over an EMPTY array, which JS evaluates
// to `true` (vacuous truth) — so the literal AND'd condition would silently
// never fire for exactly the empty-selector case check #3 exists to
// observe. Implemented instead as "required policy + zero profile-family
// evidence items," matching the design's stated INTENT ("produced an
// empty/ungrounded pack") rather than its literal, vacuously-defeated
// condition.
//
// Still NOT included (out of scope for this file): #4 (clarify/answer
// contradiction — already exists as assertNoAuthorityContradiction in
// integration.ts), #5 (JD-as-candidate-claim), #6 (pack/turn identity
// mismatch), #7 (zeroEvidenceReason conflation).

import { PROFILE_SOURCE_KINDS } from './sourceKinds';
import { itemSupportsProperty } from './propertyEvidenceValidator';
import type { EvidenceItem, EvidencePack } from './evidencePack';

export type ImpossibleStateViolationCode =
  | 'forbidden_policy_profile_item_present'
  | 'allowed_policy_unrelated_profile_item'
  | 'required_policy_zero_evidence';

export interface ImpossibleStateViolation {
  code: ImpossibleStateViolationCode;
  /** Absent for pack-level violations (required_policy_zero_evidence) that aren't about one specific item. */
  evidenceId?: string;
  sourceKind?: EvidenceItem['sourceKind'];
  /** Never the item's own text — privacy-safe by construction. */
  detail: string;
}

export interface ImpossibleStateCheckResult {
  ok: boolean;
  violations: ImpossibleStateViolation[];
}

const isProfileFamilyItem = (item: EvidenceItem): boolean =>
  item.authority === 'evidence' && (PROFILE_SOURCE_KINDS as readonly string[]).includes(item.sourceKind);

/**
 * Pure, side-effect-free, never throws given well-typed inputs — Stage 0 is
 * shadow-only, so the caller must be free to log this result without any
 * risk of it disrupting generation. Returns a typed result rather than
 * throwing by design: this codebase's existing convention (every Context OS
 * wiring site in ipcHandlers.ts wrapped in a best-effort try/catch, and
 * assertNoAuthorityContradiction's own zero non-test callers) shows a
 * throwing validator gets silently swallowed and never actually gates
 * anything here.
 */
export function checkImpossibleEvidenceState(
  pack: EvidencePack,
  profileContextPolicy: 'forbidden' | 'required' | 'allowed',
): ImpossibleStateCheckResult {
  const violations: ImpossibleStateViolation[] = [];

  for (const item of pack.items) {
    if (!isProfileFamilyItem(item)) continue;

    if (profileContextPolicy === 'forbidden') {
      violations.push({
        code: 'forbidden_policy_profile_item_present',
        evidenceId: item.evidenceId,
        sourceKind: item.sourceKind,
        detail: `profileContextPolicy=forbidden but pack contains a ${item.sourceKind} evidence item`,
      });
      continue;
    }

    if (profileContextPolicy === 'allowed') {
      const noAffirmativeReason = pack.requestedProperty === 'unknown'
        || !itemSupportsProperty(item, pack.requestedProperty);
      if (noAffirmativeReason) {
        violations.push({
          code: 'allowed_policy_unrelated_profile_item',
          evidenceId: item.evidenceId,
          sourceKind: item.sourceKind,
          detail: pack.requestedProperty === 'unknown'
            ? `profileContextPolicy=allowed, requestedProperty=unknown — no affirmative reason to include a ${item.sourceKind} item`
            : `profileContextPolicy=allowed but ${item.sourceKind} item does not support requestedProperty=${pack.requestedProperty}`,
        });
      }
    }
    // profileContextPolicy === 'required': a profile-family item present is
    // exactly what should happen — no per-item check needed here. The
    // required-direction check (#3) is pack-level (zero items), applied
    // below the loop.
  }

  if (profileContextPolicy === 'required' && !pack.items.some(isProfileFamilyItem)) {
    // Code-review finding (2026-07-28): this check fires on several
    // structurally distinct zero-evidence populations, only one of which
    // (capability granted, selector found nothing — RC-8's shape) is the bug
    // it exists to observe. The others (capability denied, no profile
    // loaded at all, a correct clarify) are benign/expected and would
    // pollute a future Stage 3 promotion decision if indistinguishable from
    // RC-8-shaped cases in the shadow log. `pack.rejected.length > 0`
    // isolates the capability-denied case (ProfileEvidenceService.
    // retrieveEvidence's !canAnswerDeterministically branch always pushes a
    // 'forbidden_source' rejection there); `answerPolicy === 'ask_clarification'`
    // isolates the correct-clarify case. Neither is set for RC-8's actual
    // shape (capability granted, selector empty) — a violation with BOTH
    // false is the interesting one to look at first.
    violations.push({
      code: 'required_policy_zero_evidence',
      detail: `profileContextPolicy=required but pack contains zero profile-family evidence items (answerPolicy=${pack.answerPolicy}, capabilityDenied=${pack.rejected.length > 0}, isClarify=${pack.answerPolicy === 'ask_clarification'})`,
    });
  }

  return { ok: violations.length === 0, violations };
}
