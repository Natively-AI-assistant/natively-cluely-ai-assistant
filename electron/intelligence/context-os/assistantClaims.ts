// electron/intelligence/context-os/assistantClaims.ts
//
// Context OS (Phase 9) — memory safety for assistant output.
//
// The contamination loop this closes (memory-safety-engineer contract):
// one wrong assistant answer re-enters the next prompt as authority and
// becomes canonical truth. The fix: assistant text is stored as CONVERSATION
// (SessionTracker, unchanged), but factual CLAIMS live separately with a
// validation status. Only VERIFIED claims (with evidence pointers) may ever
// re-enter a prompt as evidence; everything else is referent-only.
//
// Pure module: extraction + verdicts here, persistence in DatabaseManager
// (assistant_claims / turn_context_contracts, schema v24).

import { randomUUID } from 'crypto';
import type { EvidencePack } from './evidencePack';
import type { RequestedProperty, SourceOwner, TurnContextContract } from './types';

export type ClaimValidationStatus = 'unverified' | 'verified' | 'contradicted';

export interface AssistantClaim {
  claimId: string;
  turnId: string;
  claimText: string;
  sourceOwner: SourceOwner;
  requestedProperty: RequestedProperty;
  validationStatus: ClaimValidationStatus;
  evidenceIds: string[];
  contradictedByClaimId?: string | null;
}

// ── Claim extraction ─────────────────────────────────────────────────────────

// Sentences that are conversational scaffolding, not factual claims.
const NON_CLAIM_OPENERS = /^(sure|okay|ok|here|let me|i'd|i would|i can|i'll|great|thanks|got it|of course|certainly|absolutely)\b/i;
// A factual claim usually asserts something concrete: number, proper noun,
// or a copular/action verb over a subject.
const LOOKS_FACTUAL_RE = /\d|[A-Z][a-z]+[A-Z]|\b(?:is|are|was|were|uses?|used|has|have|had|consists?|comprises?|includes?|achieved?|reached|funded|costs?)\b/i;

/**
 * Split an answer into candidate factual claims. Deliberately simple + high
 * precision: prefer missing a claim (stays conversational, referent-only) over
 * storing scaffolding as a claim.
 */
export function extractCandidateClaims(answer: string): string[] {
  return String(answer || '')
    .replace(/```[\s\S]*?```/g, ' ')      // code blocks are never claims
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && s.length <= 400)
    .filter((s) => !NON_CLAIM_OPENERS.test(s))
    .filter((s) => LOOKS_FACTUAL_RE.test(s));
}

// ── Claim ↔ evidence verification ────────────────────────────────────────────

function normalizeForOverlap(s: string): string[] {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4);
}

/**
 * A claim is `verified` when a factual evidence item substantially covers its
 * content words (>= 0.6 overlap). Conservative on purpose — the cost of a
 * false `verified` (future contamination) far exceeds a false `unverified`
 * (the claim just stays referent-only).
 */
export function verifyClaimAgainstEvidence(
  claimText: string,
  pack: Pick<EvidencePack, 'items'>,
): { status: ClaimValidationStatus; evidenceIds: string[] } {
  const claimWords = normalizeForOverlap(claimText);
  if (claimWords.length === 0) return { status: 'unverified', evidenceIds: [] };

  const supporting: string[] = [];
  for (const item of pack.items) {
    if (item.authority !== 'evidence') continue;
    const evidenceWords = new Set(normalizeForOverlap(item.text));
    const covered = claimWords.filter((w) => evidenceWords.has(w)).length;
    if (covered / claimWords.length >= 0.6) supporting.push(item.evidenceId);
  }

  return supporting.length > 0
    ? { status: 'verified', evidenceIds: supporting }
    : { status: 'unverified', evidenceIds: [] };
}

/** Extract + verify every claim in an answer against the turn's pack. */
export function buildAssistantClaims(input: {
  answer: string;
  contract: Pick<TurnContextContract, 'turnId' | 'sourceOwner' | 'requestedProperty'>;
  evidencePack: Pick<EvidencePack, 'items'>;
}): AssistantClaim[] {
  return extractCandidateClaims(input.answer).map((claimText) => {
    const verdict = verifyClaimAgainstEvidence(claimText, input.evidencePack);
    return {
      claimId: randomUUID(),
      turnId: input.contract.turnId,
      claimText,
      sourceOwner: input.contract.sourceOwner,
      requestedProperty: input.contract.requestedProperty,
      validationStatus: verdict.status,
      evidenceIds: verdict.evidenceIds,
    };
  });
}

// ── Reuse gate ───────────────────────────────────────────────────────────────

/**
 * May this stored claim re-enter a prompt as EVIDENCE under this contract?
 * Requires: verified status + evidence pointers + a contract that reads
 * prior-assistant facts (which no default contract does — an explicit future
 * grant is required) + matching source owner.
 */
export function claimReusableAsEvidence(
  claim: Pick<AssistantClaim, 'validationStatus' | 'evidenceIds' | 'sourceOwner'>,
  contract: Pick<TurnContextContract, 'memoryReadPolicy' | 'sourceOwner'>,
): boolean {
  if (claim.validationStatus !== 'verified') return false;
  if (!claim.evidenceIds || claim.evidenceIds.length === 0) return false;
  if (!contract.memoryReadPolicy.allowPriorAssistantFacts) return false;
  return claim.sourceOwner === contract.sourceOwner;
}

/**
 * Cross-turn staleness: does the current evidence contradict a prior claim?
 * Detected when the claim and an evidence item discuss the same property
 * vocabulary but the claim's distinctive value tokens are absent from ALL
 * current evidence. Used to mark prior claims `contradicted` (Scenario E).
 */
export function claimContradictedByEvidence(
  claim: Pick<AssistantClaim, 'claimText'>,
  pack: Pick<EvidencePack, 'items'>,
): boolean {
  const factual = pack.items.filter((i) => i.authority === 'evidence');
  if (factual.length === 0) return false;
  // Distinctive tokens: product-style alphanumerics ("ESP32") + proper nouns.
  const distinctive = (String(claim.claimText).match(/\b(?:[A-Z]{2,}\d+[A-Za-z0-9-]*|[A-Z][a-z]+(?:\s+[A-Z][a-z0-9]+)+)\b/g) || [])
    .map((t) => t.toLowerCase().replace(/\s+/g, ''));
  if (distinctive.length === 0) return false;
  const evidenceNorm = factual.map((i) => String(i.text).toLowerCase().replace(/\s+/g, '')).join(' ');
  // Contradicted when NONE of the claim's distinctive tokens appear in the
  // current evidence (the evidence talks about the topic with different facts).
  return distinctive.every((t) => !evidenceNorm.includes(t));
}
