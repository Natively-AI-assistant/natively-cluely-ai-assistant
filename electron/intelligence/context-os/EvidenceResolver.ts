// electron/intelligence/context-os/EvidenceResolver.ts
//
// Context OS (evidence-execution-repair, 2026-07-11) — THE single factual
// retrieval entry point for a Context OS-governed turn.
//
// WHY THIS EXISTS: the prior architecture ran retrieval TWICE per turn — once
// (loosely) before the provider call to build the generation prompt, and a
// SECOND, textually independent retrieval AFTER the provider had already
// answered, inside what was nominally a "post-stream validator". The two
// retrievals used different parameters (retriever choice, answer type, query
// expansion) and could return different chunks for the same question, so a
// "validated"/"repaired" answer could be grounded in evidence the original
// generation never saw. See docs/context-os/evidence-execution-repair/
// 01_EXECUTION_TIMELINE.md and 02_RETRIEVAL_CALL_GRAPH.md for the full
// forensic trace that found this.
//
// THE FIX: exactly one retrieval call per generation version. `resolve()` is
// called ONCE, before the provider request, and its result (a typed
// `EvidencePack` with a stable `packId`) is threaded — by IDENTITY, not by
// re-derivation — through generation, validation, and claim persistence. A
// repair pass (Phase 9) explicitly builds a NEW pack version
// (`parentPackId` chain) and regenerates; it never silently re-checks the
// same answer against different evidence.
//
// Retrieval strategy (deterministic, generalizes to any document — no
// hardcoded entity/document names anywhere in this file):
//   A. Resolve requested property (kernel-provided) + candidate entity.
//   B. Search OKF cards for the active mode's reference files (if the OKF
//      knowledge pack exists — self-gated by isOkfKnowledgePacksEnabled).
//   C. If a high-confidence card DIRECTLY satisfies the requested property
//      (or is a synthesis-question match), use it: 'okf_exact'/'okf_property'.
//   D. Otherwise run Hybrid RAG (semantic + lexical, confidence-gated rerank
//      when ragLocalRerank is on).
//   E/F/G. Reranking, section/entity/property boosts, and ToC/generic-chunk
//      exclusion are handled inside ModeHybridRetriever/ModeContextRetriever
//      (Phase 5 unifies the section-aware boosts that already exist for the
//      lexical path onto the hybrid path — see 05_OKF_RESULTS.md /
//      06_HYBRID_RAG_RESULTS.md for what was verified, not re-implemented).
//   H. Confidence check — an EvidencePack with `coverage.confidence` below
//      floor and no property match becomes an 'insufficient' pack; the
//      caller must not fabricate.
//   I/J. Build + return the typed EvidencePack.

import { randomUUID } from 'crypto';
import type {
  RequestedProperty,
  SourceKind,
  TurnContextContract,
} from './types';
import { allowsEvidence, allowsRetrieval } from './types';
import type { EvidenceItem, EvidencePack, RejectedEvidenceItem } from './evidencePack';
import { textCanProveProperty } from './requestedProperty';
import {
  isOkfKnowledgePacksEnabled,
  isOkfHybridRetrievalEnabled,
  isRagConfidenceGateEnabled,
  isRagLocalRerankEnabled,
} from '../intelligenceFlags';

// ── Public types ─────────────────────────────────────────────────────────────

export type EvidenceResolutionStrategy =
  | 'okf_exact'
  | 'okf_property'
  | 'hybrid_rag'
  | 'lexical_fallback'
  | 'insufficient';

export interface RejectedSource {
  sourceKind: SourceKind;
  reason: 'forbidden_source' | 'no_files' | 'no_pack' | 'low_confidence' | 'empty_retrieval';
}

export interface EvidenceResolutionResult {
  pack: EvidencePack;
  strategy: EvidenceResolutionStrategy;
  attemptedSources: SourceKind[];
  retrievedSources: SourceKind[];
  rejectedSources: RejectedSource[];
  confidence: number;
}

/** The minimal mode-snapshot shape the resolver needs — decoupled from the
 *  concrete ModesManager class so this module stays testable in isolation. */
export interface EvidenceResolverModeSnapshot {
  modeId: string | null;
  modeUniqueId?: string | null;
}

export interface EvidenceResolutionRequest {
  turnId: string;
  question: string;
  sourceContract: TurnContextContract;
  activeMode: EvidenceResolverModeSnapshot;
  requestedProperty: RequestedProperty;
  /** Rolling transcript snapshot, when the contract permits transcript as a peer source. */
  transcript?: string;
  /** Round-7 Failure-2 parity: prior assistant answer text, used ONLY to expand
   *  the retrieval query for anaphoric follow-ups — never shown to the model. */
  followUpReferentHint?: string;
  /** Repair-pass escalation (Phase 9): widen topK / relax thresholds for a v2+ pack. */
  relaxed?: boolean;
  /** When resolving a repair pack, the parent pack this one supersedes. */
  parentPackId?: string;
  packVersion?: number;
}

// Minimal interfaces for the retrievers this module depends on — kept
// decoupled from the concrete ModesManager/KnowledgeManager classes so the
// resolver can be unit-tested with fakes and so a require() cycle with
// ModesManager (which is not part of intelligence/context-os) never forms.
export interface ReferenceFileLike {
  id: string;
  fileName: string;
  content: string;
}

export interface HybridRetrieverLike {
  retrieveHybrid(
    mode: { id: string; templateType: string; customContext: string },
    files: ReferenceFileLike[],
    options: {
      query: string;
      transcript?: string;
      tokenBudget?: number;
      topK?: number;
      allowRerank?: boolean;
      forceDocumentGrounding?: boolean;
      followUpReferentHint?: string;
    },
  ): Promise<{
    chunks: Array<{
      sourceId: string;
      fileName: string;
      text: string;
      chunkIndex: number;
      score: number;
      ftsScore: number;
      vectorScore: number;
    }>;
    formattedContext: string;
    usedFallback: boolean;
    usedHybrid: boolean;
    confidence?: { topScore: number; secondScore: number; isLowConfidence: boolean };
  }>;
}

export interface KnowledgeManagerLike {
  getPackForFile(fileId: string): {
    packId: string;
    packVersion: number;
    cards: Array<{
      id: string;
      title: string;
      body: string;
      sourcePages: number[];
      sourceSections: string[];
      entities: string[];
      confidence: 'high' | 'medium' | 'low';
      approvalStatus?: string;
    }>;
  } | null;
}

export interface EvidenceResolverDeps {
  getModeSnapshot: () => { id: string; templateType: string; customContext: string } | null;
  getReferenceFiles: (modeId: string) => ReferenceFileLike[];
  hybridRetriever: HybridRetrieverLike;
  knowledgeManager: KnowledgeManagerLike;
  classifyQuestion: (question: string) => { type: string; isSynthesis: boolean; targetEntities: string[] };
  queryOkfCards: (
    pack: { cards: any[]; packVersion: number },
    question: string,
    classification: { type: string; isSynthesis: boolean; targetEntities: string[] },
    options?: { topN?: number; minScore?: number; fileId?: string },
  ) => Array<{ card: any; score: number }>;
}

// ── Confidence floor for "is this pack good enough to answer from" ─────────
// Deliberately conservative: prefer an honest insufficient-evidence result
// over a low-confidence fabrication. Matches the incident brief's "prefer a
// small, high-confidence evidence set" requirement.
const MIN_ANSWER_CONFIDENCE = 0.32;
const OKF_CARD_HIGH_CONFIDENCE_SCORE = 0.55;

export class EvidenceResolver {
  constructor(private readonly deps: EvidenceResolverDeps) {}

  async resolve(request: EvidenceResolutionRequest): Promise<EvidenceResolutionResult> {
    const { sourceContract, question, requestedProperty } = request;
    const attemptedSources: SourceKind[] = [];
    const retrievedSources: SourceKind[] = [];
    const rejectedSources: RejectedSource[] = [];

    // Clarify turns never retrieve — the answer is a deterministic question.
    if (sourceContract.sourceOwner === 'clarify') {
      return {
        pack: this.emptyPack(request, 'insufficient'),
        strategy: 'insufficient',
        attemptedSources,
        retrievedSources,
        rejectedSources,
        confidence: 0,
      };
    }

    // Only reference-file-owned turns retrieve document evidence in THIS
    // resolver — profile/transcript resolution is a separate, equally
    // capability-scoped path (electron/intelligence/context-os/ProfileEvidenceService.ts
    // for profile; transcript evidence is assembled by the caller from the
    // live session snapshot). This keeps EvidenceResolver's document-retrieval
    // logic generic and reusable without conflating source universes.
    const canRetrieveReferenceFiles = allowsRetrieval(sourceContract, 'mode_reference_chunk')
      || allowsRetrieval(sourceContract, 'mode_reference_file');
    if (!canRetrieveReferenceFiles) {
      rejectedSources.push({ sourceKind: 'mode_reference_chunk', reason: 'forbidden_source' });
      return {
        pack: this.emptyPack(request, 'insufficient'),
        strategy: 'insufficient',
        attemptedSources,
        retrievedSources,
        rejectedSources,
        confidence: 0,
      };
    }

    const mode = this.deps.getModeSnapshot();
    if (!mode) {
      rejectedSources.push({ sourceKind: 'mode_reference_chunk', reason: 'no_files' });
      return {
        pack: this.emptyPack(request, 'insufficient'),
        strategy: 'insufficient',
        attemptedSources,
        retrievedSources,
        rejectedSources,
        confidence: 0,
      };
    }
    const files = this.deps.getReferenceFiles(mode.id).filter((f) => f.content.trim());
    if (files.length === 0) {
      rejectedSources.push({ sourceKind: 'mode_reference_chunk', reason: 'no_files' });
      return {
        pack: this.emptyPack(request, 'insufficient'),
        strategy: 'insufficient',
        attemptedSources,
        retrievedSources,
        rejectedSources,
        confidence: 0,
      };
    }

    // ── Step B/C: OKF card lookup (structured-fact-first) ────────────────────
    attemptedSources.push('okf_document_card');
    if (isOkfKnowledgePacksEnabled() && isOkfHybridRetrievalEnabled()) {
      const okfResult = this.resolveFromOkf(request, files);
      if (okfResult) {
        retrievedSources.push('okf_document_card');
        return okfResult;
      }
    }
    rejectedSources.push({ sourceKind: 'okf_document_card', reason: 'no_pack' });

    // ── Step D-H: Hybrid RAG (semantic + lexical, confidence-gated rerank) ──
    attemptedSources.push('mode_reference_chunk');
    const hybridResult = await this.resolveFromHybrid(request, mode, files);
    if (hybridResult.strategy !== 'insufficient') {
      retrievedSources.push('mode_reference_chunk');
      return { ...hybridResult, attemptedSources, retrievedSources, rejectedSources };
    }
    rejectedSources.push({ sourceKind: 'mode_reference_chunk', reason: 'low_confidence' });

    return { ...hybridResult, attemptedSources, retrievedSources, rejectedSources };
  }

  // ── OKF path ────────────────────────────────────────────────────────────

  private resolveFromOkf(
    request: EvidenceResolutionRequest,
    files: ReferenceFileLike[],
  ): EvidenceResolutionResult | null {
    const { question, sourceContract, requestedProperty, turnId } = request;
    const classification = this.deps.classifyQuestion(question);

    const scoredAcrossFiles: Array<{ card: any; score: number; fileId: string }> = [];
    for (const file of files) {
      const pack = this.deps.knowledgeManager.getPackForFile(file.id);
      if (!pack || pack.cards.length === 0) continue;
      const scored = this.deps.queryOkfCards(pack, question, classification, { topN: 6, fileId: file.id });
      for (const s of scored) scoredAcrossFiles.push({ ...s, fileId: file.id });
    }
    if (scoredAcrossFiles.length === 0) return null;

    // A synthesis question (main_topic/objectives/…) is satisfied by ALL
    // returned cards in document order — queryOkfCards already encodes that.
    // For a property-bearing question, require at least one card that
    // actually PROVES the requested property (never trust score alone).
    const items: EvidenceItem[] = scoredAcrossFiles.map((s, i) => {
      const canProve = textCanProveProperty(s.card.body, requestedProperty);
      return {
        evidenceId: `${turnId}:okf:${i}`,
        sourceKind: 'okf_document_card' as const,
        sourceId: s.fileId,
        sourceOwner: 'reference_files' as const,
        authority: 'evidence' as const,
        trustLevel: 'user_uploaded',
        text: `${s.card.title}\n${s.card.body}`,
        pointer: {
          fileId: s.fileId,
          section: s.card.sourceSections?.[0],
        },
        supports: {
          entity: s.card.entities?.[0],
          property: canProve ? requestedProperty : 'unknown',
        },
        score: {
          rerank: s.score,
          propertyMatch: canProve ? 1 : 0,
          final: s.score,
        },
        reasonIncluded: classification.isSynthesis
          ? 'okf synthesis card (document-order span)'
          : 'okf card scored above retrieval threshold',
      };
    });

    const propertySatisfied = requestedProperty === 'unknown'
      ? items.length > 0
      : items.some((i) => i.supports.property === requestedProperty);

    const bestScore = Math.max(...items.map((i) => i.score.final));
    const isHighConfidenceExact = bestScore >= OKF_CARD_HIGH_CONFIDENCE_SCORE
      && (requestedProperty === 'unknown' || propertySatisfied);

    // A property-bearing question with no card that PROVES the property is
    // NOT a confident OKF result — fall through to hybrid RAG rather than
    // answering from a merely topically-similar card.
    if (requestedProperty !== 'unknown' && !propertySatisfied) return null;
    if (!isHighConfidenceExact && classification.isSynthesis === false) return null;

    const strategy: EvidenceResolutionStrategy = requestedProperty === 'unknown' ? 'okf_exact' : 'okf_property';
    const pack = this.finalizePack(request, items, [], strategy);
    return {
      pack,
      strategy,
      attemptedSources: [],
      retrievedSources: [],
      rejectedSources: [],
      confidence: bestScore,
    };
  }

  // ── Hybrid RAG path ─────────────────────────────────────────────────────

  private async resolveFromHybrid(
    request: EvidenceResolutionRequest,
    mode: { id: string; templateType: string; customContext: string },
    files: ReferenceFileLike[],
  ): Promise<EvidenceResolutionResult> {
    const { question, turnId, requestedProperty, transcript, followUpReferentHint, relaxed } = request;

    let result: Awaited<ReturnType<HybridRetrieverLike['retrieveHybrid']>>;
    try {
      result = await this.deps.hybridRetriever.retrieveHybrid(mode, files, {
        query: question,
        transcript,
        // Doc-grounded budgets are auto-upgraded inside the retriever when
        // forceDocumentGrounding is true — pass undefined so it self-selects.
        tokenBudget: relaxed ? 5200 : undefined,
        topK: relaxed ? 24 : undefined,
        allowRerank: isRagLocalRerankEnabled(),
        forceDocumentGrounding: true,
        followUpReferentHint,
      });
    } catch {
      return {
        pack: this.emptyPack(request, 'insufficient'),
        strategy: 'insufficient',
        attemptedSources: [],
        retrievedSources: [],
        rejectedSources: [],
        confidence: 0,
      };
    }

    if (!result.chunks || result.chunks.length === 0) {
      return {
        pack: this.emptyPack(request, 'insufficient'),
        strategy: 'insufficient',
        attemptedSources: [],
        retrievedSources: [],
        rejectedSources: [],
        confidence: 0,
      };
    }

    const items: EvidenceItem[] = result.chunks.map((c, i) => {
      const canProve = textCanProveProperty(c.text, requestedProperty);
      return {
        evidenceId: `${turnId}:hybrid:${i}`,
        sourceKind: 'mode_reference_chunk' as const,
        sourceId: c.sourceId,
        sourceOwner: 'reference_files' as const,
        authority: 'evidence' as const,
        trustLevel: 'user_uploaded',
        text: c.text,
        pointer: {
          fileId: c.sourceId,
          chunkId: `${c.sourceId}:${c.chunkIndex}`,
          section: c.fileName,
        },
        supports: {
          property: canProve ? requestedProperty : 'unknown',
        },
        score: {
          lexical: c.ftsScore,
          vector: c.vectorScore,
          final: c.score,
          propertyMatch: canProve ? 1 : 0,
        },
        reasonIncluded: result.usedHybrid ? 'hybrid semantic+lexical retrieval' : 'lexical fallback retrieval',
      };
    });

    const propertySatisfied = requestedProperty === 'unknown'
      ? items.length > 0
      : items.some((i) => i.supports.property === requestedProperty);
    const bestScore = Math.max(...items.map((i) => i.score.final));

    // Confidence gate: an explicit floor even when the confidence-gate flag
    // itself is off (that flag only controls the OBSERVE-only telemetry
    // upstream; this resolver's own floor is the actual enforcement point).
    const confidenceGateEnabled = isRagConfidenceGateEnabled();
    const belowFloor = bestScore < MIN_ANSWER_CONFIDENCE;
    if (belowFloor && requestedProperty !== 'unknown' && !propertySatisfied) {
      return {
        pack: this.emptyPack(request, 'insufficient'),
        strategy: 'insufficient',
        attemptedSources: [],
        retrievedSources: [],
        rejectedSources: [],
        confidence: bestScore,
      };
    }

    const strategy: EvidenceResolutionStrategy = result.usedHybrid ? 'hybrid_rag' : 'lexical_fallback';
    const pack = this.finalizePack(request, items, [], strategy);
    return {
      pack,
      strategy,
      attemptedSources: [],
      retrievedSources: [],
      rejectedSources: [],
      confidence: bestScore,
    };
  }

  // ── Pack assembly ────────────────────────────────────────────────────────

  private emptyPack(request: EvidenceResolutionRequest, strategy: EvidenceResolutionStrategy): EvidencePack {
    return this.finalizePack(request, [], [], strategy);
  }

  private finalizePack(
    request: EvidenceResolutionRequest,
    items: EvidenceItem[],
    rejected: RejectedEvidenceItem[],
    strategy: EvidenceResolutionStrategy,
  ): EvidencePack {
    const { turnId, sourceContract, requestedProperty, parentPackId, packVersion } = request;
    const factual = items.filter((i) => i.authority === 'evidence');
    const propertySatisfied = requestedProperty === 'unknown'
      ? factual.length > 0
      : factual.some((i) => i.supports.property === requestedProperty);
    const confidence = factual.length > 0 ? Math.max(...factual.map((i) => i.score.final)) : 0;

    const answerPolicy = sourceContract.sourceOwner === 'clarify'
      ? 'ask_clarification' as const
      : factual.length === 0
        ? 'refuse_insufficient_evidence' as const
        : (requestedProperty !== 'unknown' && !propertySatisfied)
          ? 'refuse_insufficient_evidence' as const
          : 'answer' as const;

    const version = packVersion ?? 1;
    return {
      packId: `${turnId}:pack:${version}:${strategy}:${randomUUID().slice(0, 8)}`,
      version,
      parentPackId,
      turnId,
      sourceOwner: sourceContract.sourceOwner,
      requestedProperty,
      items,
      rejected,
      coverage: {
        hasDirectEvidence: factual.length > 0,
        propertySatisfied,
        entityMatched: factual.length > 0,
        sourceOwnerSatisfied: factual.every((i) => i.sourceOwner === sourceContract.sourceOwner),
        confidence,
      },
      conflicts: [],
      answerPolicy,
    };
  }
}
