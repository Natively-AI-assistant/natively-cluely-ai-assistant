// electron/services/knowledge/RetrievalEvidencePack.ts
//
// OKF Phase 3 — the unified evidence container EvidenceAssembler produces
// and the prompt-builder/false-refusal-repair logic consumes. Mirrors the
// `RetrievalEvidencePack` interface in the migration plan, with an added
// `tier` field carrying the 4-tier answer policy decision.

import type { ScoredCard } from './OkfRetriever';

export type EvidenceTier = 1 | 2 | 3 | 4;

export interface EvidencePackSource {
  sourceId: string;
  fileName: string;
  pages: number[];
}

export interface CitationPlanEntry {
  text: string;
  page: number;
  section?: string;
  type: 'card' | 'chunk';
}

export interface RetrievalEvidencePack {
  cards: ScoredCard[];
  /** Raw chunk text already formatted by the existing retriever (modeContextBlock) — kept as opaque text, not re-parsed. */
  rawChunkText: string;
  rawChunkCount: number;

  allSources: EvidencePackSource[];

  topScore: number;
  avgScore: number;

  /** 1 = confident answer, 2 = synthesis answer, 3 = soft refusal, 4 = hard refusal. See EvidenceAssembler.computeTier. */
  tier: EvidenceTier;

  citationPlan: CitationPlanEntry[];
}

export function emptyEvidencePack(): RetrievalEvidencePack {
  return {
    cards: [], rawChunkText: '', rawChunkCount: 0, allSources: [],
    topScore: 0, avgScore: 0, tier: 4, citationPlan: [],
  };
}
