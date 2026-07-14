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
  deriveEvidenceSufficiency,
  MIN_ANSWER_CONFIDENCE,
  selectSmallestSufficientEvidence,
  type EvidenceSufficiency,
} from './evidenceSufficiency';
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
// `MIN_ANSWER_CONFIDENCE` comes from evidenceSufficiency so hybrid gating and
// final pre-dispatch policy cannot silently diverge.
const OKF_CARD_HIGH_CONFIDENCE_SCORE = 0.55;

// Generic English function words that carry no topical signal in a question.
// Deliberately small — only words that appear in nearly every question phrasing.
const QUESTION_STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'and', 'or',
  'is', 'are', 'was', 'were', 'be', 'been', 'this', 'that', 'these', 'those',
  'it', 'its', 'as', 'by', 'from', 'has', 'have', 'had', 'not', 'but', 'which',
  'what', 'when', 'where', 'who', 'whom', 'how', 'why', 'does', 'did', 'do',
  'my', 'about', 'listed', 'given', 'used', 'named', 'many', 'much', 'two',
  'three', 'name', 'list', 'there', 'their',
]);

/**
 * Tokenize text into lowercased content words. Unicode-aware (`\p{L}\p{N}`) so
 * accented Latin / CJK terms survive rather than being split into noise. Hyphens
 * inside a token are kept ("open-source", "6g-networking"). Pure + deterministic.
 */
function contentTokens(text: string): string[] {
  return String(text || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu) || [];
}

/**
 * Distinctive content words in a question: lowercased words ≥3 chars that are
 * neither a generic stopword nor part of one of the question's target entities.
 * These are the terms whose PRESENCE in an evidence card indicates the card can
 * actually answer the question — as opposed to the entity words, which a merely
 * topical parent card also contains. Pure + deterministic.
 */
function distinctiveQueryTerms(question: string, targetEntities: string[]): string[] {
  const entityWords = new Set<string>(targetEntities.flatMap((e) => contentTokens(e)));
  const words = contentTokens(question)
    .filter((w) => w.length >= 3 && !QUESTION_STOPWORDS.has(w) && !entityWords.has(w));
  return [...new Set(words)];
}

/**
 * Of the distinctive query terms, the SALIENT ones are those rarest across the
 * pack's card bodies — the terms that actually pin down the answer-bearing card.
 * A specific-value question ("what working VOLTAGE is listed…") carries both a
 * high-frequency filler distinctive word ("working", in many prose cards) and a
 * low-frequency answer word ("voltage", in ~1 card). Requiring coverage of ANY
 * distinctive term let "working" spuriously satisfy the gate, so OKF answered
 * from a topical card that never contained "voltage". Ranking by card
 * document-frequency and keeping only the rarest tier fixes this generically —
 * rarity is measured from the pack itself; no term is special-cased.
 *
 * Returns the subset of `distinctive` whose card-frequency is at or below the
 * median (rounded down, min 1), i.e. the more distinctive half. When every term
 * is equally common the whole set is returned (no term is more salient).
 */
function salientDistinctiveTerms(distinctive: string[], cardBodies: string[]): string[] {
  if (distinctive.length <= 1) return distinctive;
  const cardWordSets = cardBodies.map((b) => new Set(contentTokens(b)));
  const df = new Map<string, number>();
  for (const term of distinctive) {
    df.set(term, cardWordSets.reduce((acc, set) => acc + (set.has(term) ? 1 : 0), 0));
  }
  const sorted = [...distinctive].sort((a, b) => (df.get(a)! - df.get(b)!));
  const minDf = df.get(sorted[0])!;
  const maxDf = df.get(sorted[sorted.length - 1])!;
  // All terms equally frequent → none is more salient; keep all.
  if (minDf === maxDf) return distinctive;
  // Keep the rarer half (ties at the cutoff included).
  const cutoffIdx = Math.max(0, Math.floor(sorted.length / 2) - 1);
  const cutoffDf = df.get(sorted[cutoffIdx])!;
  return sorted.filter((t) => df.get(t)! <= cutoffDf);
}

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
    // All card bodies across the active files — used to measure query-term rarity
    // for the salient-distinctive-term gate below. Collected once here.
    const corpusBodies: string[] = [];
    for (const file of files) {
      const pack = this.deps.knowledgeManager.getPackForFile(file.id);
      if (!pack || pack.cards.length === 0) continue;
      for (const c of pack.cards) corpusBodies.push(`${c.title}\n${c.body}`);
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

    // Distinctive-term gate (2026-07-13): OKF scoring is title/entity-centric, so a
    // specific-fact question that NAMES an entity ("What working voltage is listed
    // for Mercury X1?") lets the topical PARENT card ("Mercury X1 Robot") win on the
    // entity match even though the value lives in a generically-titled sub-section
    // ("Technical Specifications") the parent card never contains. For a
    // non-synthesis question, require the selected cards to collectively contain at
    // least one DISTINCTIVE query term — a content word that is NOT one of the
    // question's target entities and not a generic stopword. When they don't, OKF is
    // only a topical match; fall through to hybrid RAG, which routes to the exact
    // sub-section. Generic: distinctiveness is derived from the question itself, no
    // document/field is special-cased.
    if (!classification.isSynthesis) {
      const distinctive = distinctiveQueryTerms(question, classification.targetEntities);
      if (distinctive.length > 0) {
        // Fall through to hybrid RAG when the selected OKF cards do not carry a
        // SALIENT distinctive term — one of the rarest (lowest card-frequency)
        // non-entity query words, which is what actually pins the answer-bearing
        // card. Requiring merely ANY distinctive term let a high-frequency filler
        // word ("working" in "what working voltage…") spuriously retain a topical
        // parent card that never contained the real answer word ("voltage"). The
        // answer then lives only in hybrid's section-routed chunk. Checking the
        // whole selected set (not just the top card) keeps a case where the
        // answer-bearing card ranked 2nd behind a topical parent.
        //
        // Match on WHOLE-WORD membership, not substring: a substring `includes`
        // would count "storage" as covering the distinctive term "age", spuriously
        // retaining a topical card. Tokenize the card text into a word set instead.
        const salient = salientDistinctiveTerms(distinctive, corpusBodies);
        const cardWords = new Set(items.flatMap((it) => contentTokens(it.text)));
        const covered = salient.some((term) => cardWords.has(term));
        if (!covered) return null;
      }
    }

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
    const classification = this.deps.classifyQuestion(request.question);
    const factual = items.filter((item) => item.authority === 'evidence');
    const candidatePack = {
      items: factual,
      requestedProperty,
      coverage: { hasDirectEvidence: factual.length > 0, propertySatisfied: false, entityMatched: false, sourceOwnerSatisfied: true, confidence: 0 },
      conflicts: [] as EvidencePack['conflicts'],
    };
    const initialSufficiency = deriveEvidenceSufficiency({
      pack: candidatePack,
      targetEntities: classification.targetEntities,
      isSynthesis: classification.isSynthesis,
    });
    const selectedItems = initialSufficiency.answerable
      ? selectSmallestSufficientEvidence({
          items: factual,
          requestedProperty,
          answerShape: sourceContract.answerShape,
          targetEntities: classification.targetEntities,
          // Property-aware ranking (Priority 2): the distinctive (non-entity,
          // non-stopword) query terms let selection prefer the chunk that
          // actually carries the answer value over a merely topical chunk with a
          // higher raw retrieval score.
          distinctiveTerms: distinctiveQueryTerms(request.question, classification.targetEntities),
        })
      : factual;
    const selectedIds = new Set(selectedItems.map((item) => item.evidenceId));
    const excludedItems = factual.filter((item) => !selectedIds.has(item.evidenceId));
    const selectionRejected: RejectedEvidenceItem[] = excludedItems.map((item) => ({
      sourceKind: item.sourceKind,
      sourceId: item.sourceId,
      textPreview: item.text.slice(0, 80),
      reason: 'low_confidence',
    }));
    const selectedFactual = selectedItems.filter((item) => item.authority === 'evidence');
    const confidence = selectedFactual.length > 0
      ? Math.max(...selectedFactual.map((item) => item.score.final || 0))
      : 0;
    const sufficiency = deriveEvidenceSufficiency({
      pack: {
        items: selectedFactual,
        requestedProperty,
        coverage: { hasDirectEvidence: selectedFactual.length > 0, propertySatisfied: false, entityMatched: false, sourceOwnerSatisfied: true, confidence },
        conflicts: [] as EvidencePack['conflicts'],
      },
      targetEntities: classification.targetEntities,
      isSynthesis: classification.isSynthesis,
    });
    const answerPolicy = sourceContract.sourceOwner === 'clarify'
      ? 'ask_clarification' as const
      : sufficiency.answerable
        ? 'answer' as const
        : 'refuse_insufficient_evidence' as const;

    const version = packVersion ?? 1;
    return {
      packId: `${turnId}:pack:${version}:${strategy}:${randomUUID().slice(0, 8)}`,
      version,
      parentPackId,
      turnId,
      sourceOwner: sourceContract.sourceOwner,
      requestedProperty,
      items: selectedItems,
      rejected: [...rejected, ...selectionRejected],
      coverage: {
        hasDirectEvidence: selectedFactual.length > 0,
        propertySatisfied: sufficiency.propertySatisfied,
        entityMatched: sufficiency.entitySatisfied,
        sourceOwnerSatisfied: selectedFactual.every((item) => item.sourceOwner === sourceContract.sourceOwner),
        confidence: sufficiency.confidence,
      },
      sufficiency,
      selection: {
        candidateEvidenceIds: factual.map((item) => item.evidenceId),
        selectedEvidenceIds: selectedFactual.map((item) => item.evidenceId),
        excludedEvidenceIds: excludedItems.map((item) => item.evidenceId),
        strategy: 'smallest_sufficient_set',
      },
      resolver: { strategy, attemptedSources: [], retrievedSources: [] },
      conflicts: [] as EvidencePack['conflicts'],
      answerPolicy,
    };
  }
}
