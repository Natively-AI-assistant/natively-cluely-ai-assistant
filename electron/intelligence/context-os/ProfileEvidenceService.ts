// electron/intelligence/context-os/ProfileEvidenceService.ts
//
// Context OS (Phase 13) — Profile Intelligence unification facade.
//
// Natively has two parallel profile systems (legacy manualProfileIntelligence
// fast path + ProfileTree/OKF). This facade is the ONE door both must pass
// through under the Context OS: every profile access is gated by the
// TurnContextContract's capability grants, so a doc-grounded turn cannot
// reach the fast path no matter which caller asks.
//
// Rules encoded (source-authority-architect invariants 6/7):
//   • Legacy fast path runs only when the contract grants profile evidence.
//   • JD facts are tagged role_requirement — never candidate claims.
//   • Persona is style-only; never returned as evidence.
//   • Custom notes are weak/unverified profile context.

import { allowsEvidence, type TurnContextContract } from './types';
import type { EvidenceItem, EvidencePack } from './evidencePack';
import { emptyEvidencePack } from './evidencePack';
import { textCanProveProperty } from './requestedProperty';
import {
  selectManualProfileEvidence,
  type ManualProfileRouteResult,
} from '../../llm/manualProfileIntelligence';

export interface ProfileEvidenceServiceInput {
  question: string;
  contract: TurnContextContract;
  /** Structured resume (KnowledgeOrchestrator.activeResume.structured_data). */
  profile: any;
  /** Structured JD (KnowledgeOrchestrator.activeJD.structured_data). */
  jobDescription?: any;
  /** The legacy AnswerType (drives the fast-path's 11 routes). */
  answerType: string;
}

export class ProfileEvidenceService {
  /** May the deterministic fast path even be consulted for this turn? */
  canAnswerDeterministically(input: Pick<ProfileEvidenceServiceInput, 'contract'>): boolean {
    return allowsEvidence(input.contract, 'profile_resume')
      || allowsEvidence(input.contract, 'profile_project');
  }

  /**
   * Contract-gated wrapper around the legacy fast path. Returns null when the
   * contract denies profile evidence — the legacy selector is NOT invoked at
   * all (capability-scoped access, not post-hoc filtering).
   */
  selectEvidence(input: ProfileEvidenceServiceInput): ManualProfileRouteResult | null {
    if (!this.canAnswerDeterministically(input)) return null;
    try {
      return selectManualProfileEvidence({
        question: input.question,
        profile: input.profile,
        jobDescription: allowsEvidence(input.contract, 'profile_jd') ? input.jobDescription : undefined,
        answerType: input.answerType as any,
      });
    } catch {
      return null;
    }
  }

  /**
   * Typed retrieval: the legacy selection converted into a contract-scoped
   * EvidencePack. JD-derived items carry supports.property='role_requirement'
   * so the property validator can never count them as candidate claims.
   */
  retrieveEvidence(input: ProfileEvidenceServiceInput): EvidencePack {
    const contract = input.contract;
    if (!this.canAnswerDeterministically(input)) {
      return {
        ...emptyEvidencePack({
          turnId: contract.turnId,
          sourceOwner: contract.sourceOwner,
          requestedProperty: contract.requestedProperty,
          answerPolicy: contract.sourceOwner === 'clarify' ? 'ask_clarification' : 'refuse_insufficient_evidence',
        }),
        rejected: [{ sourceKind: 'profile_resume', reason: 'forbidden_source' }],
      };
    }

    const selection = this.selectEvidence(input);
    const items: EvidenceItem[] = [];

    if (selection) {
      let i = 0;
      for (const item of selection.items ?? []) {
        // ProfileEvidenceItem carries {field, value, sourceKind (legacy),
        // sourceRef} — value may be a string, array, or object.
        const raw = (item as any)?.value;
        const text = (typeof raw === 'string' ? raw : JSON.stringify(raw ?? '')).trim();
        if (!text || text === '""' || text === '{}' || text === '[]') continue;
        const sourceRef = String((item as any)?.sourceRef ?? '');
        const isJd = (item as any)?.sourceKind === 'profile_jd'
          || /\bjd\b|job.?description/i.test(sourceRef);
        const sourceKind = isJd ? 'profile_jd' as const : 'profile_resume' as const;
        const canProve = !isJd && textCanProveProperty(text, contract.requestedProperty);
        items.push({
          evidenceId: `${contract.turnId}:profile:${i++}`,
          sourceKind,
          sourceId: sourceRef || 'active-profile',
          sourceOwner: 'profile',
          authority: 'evidence',
          trustLevel: 'profile_verified',
          text,
          supports: {
            // JD facts prove the ROLE requirement, never the candidate claim.
            property: isJd ? 'role_requirement' : (canProve ? contract.requestedProperty : 'unknown'),
          },
          score: { propertyMatch: canProve ? 1 : 0, final: selection.confidence === 'high' ? 0.9 : selection.confidence === 'medium' ? 0.6 : 0.3 },
          reasonIncluded: isJd
            ? 'JD evidence: role requirement framing only'
            : 'deterministic profile evidence selection',
        });
      }
    }

    const factual = items;
    const propertySatisfied = contract.requestedProperty === 'unknown'
      ? factual.length > 0
      : factual.some((it) => it.supports.property === contract.requestedProperty);

    return {
      turnId: contract.turnId,
      sourceOwner: contract.sourceOwner,
      requestedProperty: contract.requestedProperty,
      items,
      rejected: [],
      coverage: {
        hasDirectEvidence: factual.length > 0,
        propertySatisfied,
        entityMatched: factual.length > 0,
        sourceOwnerSatisfied: factual.every((it) => it.sourceOwner === 'profile'),
        confidence: factual.length > 0 ? Math.max(...factual.map((it) => it.score.final)) : 0,
      },
      conflicts: [],
      answerPolicy: factual.length === 0
        ? 'refuse_insufficient_evidence'
        : propertySatisfied ? 'answer' : 'answer_with_uncertainty',
    };
  }
}
