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
// Deliberately NOT included (out of scope for Stage 0 / this file): checks
// #3 (required-direction empty-pack), #4 (clarify/answer contradiction —
// already exists as assertNoAuthorityContradiction in integration.ts), #5
// (JD-as-candidate-claim), #6 (pack/turn identity mismatch), #7
// (zeroEvidenceReason conflation). Required-direction enforcement in
// particular is excluded deliberately, not just deferred: RC-8 (a real, live
// false-refusal bug found the same day this gate was designed) shows that
// direction is unsafe to enforce before its own dedicated shadow period.

import { PROFILE_SOURCE_KINDS } from './sourceKinds';
import { itemSupportsProperty } from './propertyEvidenceValidator';
import type { EvidenceItem, EvidencePack } from './evidencePack';

export type ImpossibleStateViolationCode =
  | 'forbidden_policy_profile_item_present'
  | 'allowed_policy_unrelated_profile_item';

export interface ImpossibleStateViolation {
  code: ImpossibleStateViolationCode;
  evidenceId: string;
  sourceKind: EvidenceItem['sourceKind'];
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
    // profileContextPolicy === 'required': explicitly out of scope for
    // Stage 0 — see file header. A profile-family item present under
    // 'required' is exactly what should happen; no check needed here.
  }

  return { ok: violations.length === 0, violations };
}
