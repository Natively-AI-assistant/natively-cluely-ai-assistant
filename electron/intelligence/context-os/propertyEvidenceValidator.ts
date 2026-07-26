// electron/intelligence/context-os/propertyEvidenceValidator.ts
//
// Context OS (Phase 5) — property-aware evidence validation.
//
// Rejects topic overlap that does not prove the requested property:
//   • collaboration is NOT funding
//   • a general project description is NOT a cost
//   • a generic hardware overview is NOT a processor/controller
//   • a JD requirement is NOT candidate experience
//
// Pure and deterministic. Shares the evidence-vocabulary table with the Phase 2
// detector (requestedProperty.ts) so question-side and evidence-side vocab can
// never drift apart.

import type { EvidenceItem, EvidencePack } from './evidencePack';
import { propertyRuleFor } from './requestedProperty';
import type { RequestedProperty } from './types';

export interface PropertyEvidenceValidationResult {
  ok: boolean;
  reason: string;
  propertySatisfied: boolean;
  usableEvidenceIds: string[];
  rejectedEvidenceIds: string[];
}

/**
 * Validate that the pack's FACTUAL evidence proves the requested property.
 * Referent-only items never count. `unknown` property degrades to "any direct
 * evidence is fine" (legacy behavior — never stricter without a detection).
 */
export function validateEvidenceForProperty(pack: EvidencePack): PropertyEvidenceValidationResult {
  const property = pack.requestedProperty;
  const factual = pack.items.filter((i) => i.authority === 'evidence');

  if (property === 'unknown') {
    return {
      ok: factual.length > 0,
      reason: factual.length > 0
        ? 'unknown property allowed with direct evidence'
        : 'no direct evidence',
      propertySatisfied: factual.length > 0,
      usableEvidenceIds: factual.map((i) => i.evidenceId),
      rejectedEvidenceIds: [],
    };
  }

  let usable = factual.filter((item) => itemSupportsProperty(item, property));

  // M3 (trust hierarchy, invariant 13): custom_profile_notes are user-asserted
  // and UNVERIFIED. They may SUPPORT an answer but must not INDEPENDENTLY prove a
  // strong candidate property. If the only items that "prove" the property are
  // custom notes, require corroboration from a structured profile source
  // (resume/project/OKF card) that ALSO supports it — otherwise the notes-only
  // proof is rejected. This keeps notes from carrying the same weight as a
  // structured resume.
  const CANDIDATE_PROPS = new Set(['candidate_experience', 'candidate_project', 'candidate_identity']);
  if (CANDIDATE_PROPS.has(property)) {
    const structuredProves = usable.some((i) =>
      i.sourceKind === 'profile_resume'
      || i.sourceKind === 'profile_project'
      || i.sourceKind === 'okf_profile_card');
    if (!structuredProves) {
      // Only notes (or other weak sources) proved it → drop notes-only proof.
      usable = usable.filter((i) => i.sourceKind !== 'custom_profile_notes');
    }
  }

  const rejectedIds = factual
    .filter((i) => !usable.includes(i))
    .map((i) => i.evidenceId);

  return {
    ok: usable.length > 0,
    reason: usable.length > 0
      ? `evidence satisfies requested property ${property}`
      : `no evidence satisfies requested property ${property}`,
    propertySatisfied: usable.length > 0,
    usableEvidenceIds: usable.map((i) => i.evidenceId),
    rejectedEvidenceIds: rejectedIds,
  };
}

/**
 * Does this single item prove `property`? The item's own TEXT must contain the
 * property's evidence vocabulary — a stamped supports.property alone is not
 * trusted (the orchestrator stamps optimistically; validation re-derives).
 */
export function itemSupportsProperty(item: EvidenceItem, property: RequestedProperty): boolean {
  if (property === 'unknown') return true;
  const rule = propertyRuleFor(property);
  if (!rule || rule.evidencePatterns.length === 0) return true;
  const text = String(item.text || '');
  if (!rule.evidencePatterns.some((re) => re.test(text))) return false;

  // JD isolation (validator-evals invariant 9): JD text can prove
  // role_requirement, but NEVER candidate_experience / candidate_project /
  // candidate_identity — a requirement in the JD is not a candidate claim.
  if (
    item.sourceKind === 'profile_jd'
    && (property === 'candidate_experience'
      || property === 'candidate_project'
      || property === 'candidate_identity')
  ) {
    return false;
  }

  return true;
}

/**
 * The honest refusal line for a doc-grounded turn whose evidence has topic
 * overlap but not the requested property (Scenario D). Includes what the
 * material DOES mention when a near-miss category is identifiable — general
 * wording, never entity-specific.
 */
export function buildInsufficientPropertyAnswer(input: {
  property: RequestedProperty;
  nearMissNote?: string | null;
}): string {
  const base = 'This is not directly mentioned in the uploaded material.';
  if (input.nearMissNote && input.nearMissNote.trim()) {
    return `${base} ${input.nearMissNote.trim()}`;
  }
  if (input.property === 'funding_source') {
    return `${base} The material may mention collaborations or partners, but collaboration is not the same as funding.`;
  }
  return base;
}
