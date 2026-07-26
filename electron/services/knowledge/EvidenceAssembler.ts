// electron/services/knowledge/EvidenceAssembler.ts
//
// OKF Phase 3 — merges OKF card evidence with the existing raw-chunk
// retrieval output (modeContextBlock, unchanged from Phases 0-1) into a
// single RetrievalEvidencePack, and computes the 4-tier answer-policy
// decision per the migration plan:
//
//   Tier 1 (confident answer):  top card/chunk score >= 0.6 AND
//                                >= 1 target entity present in evidence
//   Tier 2 (synthesis answer):  top score in [0.3, 0.6) OR isSynthesis
//   Tier 3 (soft refusal):      top score < 0.3 but SOME evidence exists
//   Tier 4 (hard refusal):      zero cards AND zero chunks
//
// WIRING NOTE (2026-07-01, senior review fix): this module was fully built
// and unit-tested but had ZERO production call sites for its first pass —
// the live doc-grounded prompt-assembly path (LLMHelper.ts) calls
// queryOkfCards/formatCardsForPrompt/buildOkfEvidenceBlock directly and
// never consulted a tier. It is now wired in as an ADDITIONAL
// strong-evidence signal for the false-refusal repair gate in
// ipcHandlers.ts (Tier 1/2 → `isTier1Or2Evidence`, OR'd alongside — never
// replacing — the existing term-count/high-signal-entity heuristic, so the
// already-verified 19/19 benchmark result can't regress). It is NOT yet the
// sole/primary answer-policy gate the original migration plan envisioned
// (that would mean routing the whole doc-grounded prompt-shaping decision
// through computeTier, a larger change deferred as future work).

import type { QuestionClassification } from './QuestionClassifier';
import type { ScoredCard } from './OkfRetriever';
import type { CitationPlanEntry, EvidencePackSource, EvidenceTier, RetrievalEvidencePack } from './RetrievalEvidencePack';
import type { KnowledgePack } from './types';

function extractRawChunkPages(rawChunkText: string): number[] {
  const matches = rawChunkText.match(/\[Page (\d+)\]/g) || [];
  return [...new Set(matches.map((m) => Number(m.match(/\d+/)?.[0])))].filter((n) => !Number.isNaN(n));
}

function buildCitationPlan(cards: ScoredCard[]): CitationPlanEntry[] {
  const plan: CitationPlanEntry[] = [];
  for (const { card } of cards) {
    for (const page of card.sourcePages) {
      plan.push({ text: card.title, page, section: card.sourceSections[0], type: 'card' });
    }
  }
  return plan;
}

function computeTier(params: {
  cards: ScoredCard[];
  rawChunkCount: number;
  classification: QuestionClassification;
}): EvidenceTier {
  const { cards, rawChunkCount, classification } = params;
  const hasAnyEvidence = cards.length > 0 || rawChunkCount > 0;
  if (!hasAnyEvidence) return 4;

  if (classification.isSynthesis) return 2;

  const topScore = cards.length > 0 ? Math.max(...cards.map((c) => c.score)) : 0;
  const targetEntities = classification.targetEntities.map((e) => e.toLowerCase());
  const hasTargetEntityInCards = targetEntities.length > 0 && cards.some(
    (c) => c.card.entities.some((e) => targetEntities.includes(e.toLowerCase()))
      || targetEntities.some((e) => c.card.title.toLowerCase().includes(e)),
  );

  if (topScore >= 0.6 && (hasTargetEntityInCards || targetEntities.length === 0)) return 1;
  if (topScore >= 0.3) return 2;
  if (hasAnyEvidence) return 3;
  return 4;
}

export function assembleEvidence(params: {
  pack: KnowledgePack | null;
  scoredCards: ScoredCard[];
  rawChunkText: string;
  classification: QuestionClassification;
  sourceFileName?: string;
}): RetrievalEvidencePack {
  const { pack, scoredCards, rawChunkText, classification } = params;

  const rawChunkPages = extractRawChunkPages(rawChunkText);
  const rawChunkCount = rawChunkText
    ? (rawChunkText.match(/\[Page \d+\]|\[Section [\d.]+/g) || []).length || (rawChunkText.trim() ? 1 : 0)
    : 0;

  const allSources: EvidencePackSource[] = [];
  if (pack) {
    const cardPages = [...new Set(scoredCards.flatMap((c) => c.card.sourcePages))].sort((a, b) => a - b);
    allSources.push({ sourceId: pack.sourceId, fileName: pack.fileName, pages: [...new Set([...cardPages, ...rawChunkPages])].sort((a, b) => a - b) });
  } else if (rawChunkPages.length > 0) {
    allSources.push({ sourceId: 'unknown', fileName: params.sourceFileName || 'uploaded document', pages: rawChunkPages });
  }

  const scores = scoredCards.map((c) => c.score);
  const topScore = scores.length > 0 ? Math.max(...scores) : 0;
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

  const tier = computeTier({ cards: scoredCards, rawChunkCount, classification });

  return {
    cards: scoredCards,
    rawChunkText,
    rawChunkCount,
    allSources,
    topScore,
    avgScore,
    tier,
    citationPlan: buildCitationPlan(scoredCards),
  };
}
