// electron/context-intelligence/generation/context-packer.ts
//
// Deterministic, budgeted evidence packing.
//
// WHAT THIS REPLACES
// Five of nine legacy answer surfaces pass `session.getFormattedContext(N)` —
// a raw transcript blob — straight to the model, and the profile path injects
// full resume/JD blocks from 11 independent sites. That is §32.16's anti-pattern
// ("do not inject complete transcripts or documents by default") as the DEFAULT.
//
// Packing here is deterministic: same evidence + same budget => byte-identical
// output. A non-deterministic packer makes every downstream regression
// unreproducible, which is how prompt-level fixes came to look like they worked.
//
// See docs/context-intelligence-v3/07_EVIDENCE_CONTRACT.md §7

import type { EvidenceItem, ClaimRequirement, TurnDecision } from '../contracts/types';

export interface PackBudget {
  evidenceTokens: number;
  conversationTokens: number;
  transcriptTokens: number;
}

export interface PackedContext {
  /** XML-tagged evidence block, ready for the composer. */
  evidenceBlock: string;
  includedEvidenceIds: string[];
  droppedEvidenceIds: string[];
  estimatedTokens: number;
}

/** Rough but STABLE token estimate (~4 chars/token). Exactness is not the point;
 *  determinism is — a fluctuating estimate would make packing non-reproducible. */
export const estimateTokens = (s: string): number => Math.ceil(s.length / 4);

/** XML-escape so document text can never close the tag it lives in or forge a
 *  sibling tag OR ATTRIBUTE. Retrieved content is DATA (§23) and must not be
 *  able to restructure the prompt around it. `"` matters as of 2026-07-31:
 *  section names are now derived from document content (the profile port's
 *  `Experience: <role> at <company>`), and an unescaped quote inside an
 *  attribute value let a hostile JD title forge `complete_inventory="true"` —
 *  the exact attribute the checked-absence contract keys on (review finding). */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Priority (§18): evidence for REQUIRED claims first, then by source priority,
 * then by score. Ties broken by evidenceId so the order is total and stable.
 */
function rank(evidence: EvidenceItem[], required: ClaimRequirement[]): EvidenceItem[] {
  const requiredClaims = new Set(
    required.filter((c) => c.authority === 'PRIVATE_SOURCE_REQUIRED').map((c) => c.claimType),
  );
  return [...evidence].sort((a, b) => {
    const aReq = a.acceptedFor.some((c) => requiredClaims.has(c)) ? 1 : 0;
    const bReq = b.acceptedFor.some((c) => requiredClaims.has(c)) ? 1 : 0;
    if (aReq !== bReq) return bReq - aReq;
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
    return a.evidenceId.localeCompare(b.evidenceId);   // total order
  });
}

function renderEvidence(e: EvidenceItem): string {
  const attrs = [
    `evidence_id="${esc(e.evidenceId)}"`,
    `source_type="${e.sourceType}"`,
    `source_id="${esc(e.sourceId)}"`,
    `version_id="${esc(e.versionId)}"`,
    `scope_id="${esc(e.scopeId)}"`,
    e.section ? `section="${esc(e.section)}"` : '',
    // Provenance (deep-test D8): the human-readable source name and the file's
    // own declared status. Without these the model saw two conflicting values
    // with no way to explain WHY one wins, and invented a rationale.
    e.documentTitle ? `source_name="${esc(e.documentTitle)}"` : '',
    // Physical origin of the text (issue 10 / Pattern D): lets the model say
    // "the reference brief proposes X" vs "the meeting decided X" from the
    // attribute instead of inferring provenance from a filename.
    e.provenance ? `provenance="${e.provenance}"` : '',
    typeof (e.metadata as Record<string, unknown> | undefined)?.documentStatus === 'string'
      ? `status="${esc(String((e.metadata as Record<string, unknown>).documentStatus))}"` : '',
    `authority="${e.authorityFor.join(',')}"`,
    `direct_fact="${e.isDirectFact}"`,
    // Surfaces the port's complete-record declaration so the composer's
    // checked-absence contract has something in the evidence to point at.
    (e.metadata as Record<string, unknown> | undefined)?.completeInventory === true
      ? 'complete_inventory="true"' : '',
  ].filter(Boolean).join(' ');
  return `<evidence ${attrs}>\n${esc(e.content.trim())}\n</evidence>`;
}

export function packContext(
  decision: Readonly<TurnDecision>,
  evidence: EvidenceItem[],
  budget: PackBudget,
): PackedContext {
  const ordered = rank(evidence, decision.claimRequirements);

  const included: string[] = [];
  const dropped: string[] = [];
  const parts: string[] = [];
  const seen = new Set<string>();
  let used = 0;

  for (const e of ordered) {
    // Duplicate content is dropped regardless of score — two copies of the same
    // passage buy nothing and crowd out a second perspective. Keyed per SOURCE:
    // cross-source duplicates (the profile résumé vs a duplicate mode
    // attachment) are handled upstream by combineRetrievalPorts, which keeps
    // one copy and merges its complete-record declaration — deduping across
    // sources HERE would also merge distinct reference files that share
    // boilerplate in strict modes (review finding, 2026-07-31).
    const key = `${e.sourceId}:${e.content.trim().toLowerCase().replace(/\s+/g, ' ')}`;
    if (seen.has(key)) { dropped.push(e.evidenceId); continue; }

    const rendered = renderEvidence(e);
    const cost = estimateTokens(rendered);
    if (used + cost > budget.evidenceTokens) { dropped.push(e.evidenceId); continue; }

    seen.add(key);
    parts.push(rendered);
    included.push(e.evidenceId);
    used += cost;
  }

  // Cap is enforced AFTER budget so the highest-priority items survive both.
  const cap = decision.retrievalPlan.maximumAcceptedEvidence;
  if (included.length > cap) {
    for (const id of included.splice(cap)) dropped.push(id);
    parts.length = included.length;
  }

  return {
    evidenceBlock: parts.join('\n\n'),
    includedEvidenceIds: included,
    droppedEvidenceIds: dropped,
    estimatedTokens: estimateTokens(parts.join('\n\n')),
  };
}
