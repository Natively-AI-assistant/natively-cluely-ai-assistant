// electron/intelligence/context-os/meetingRagEvidence.ts
//
// Context OS (Phase 12) — meeting RAG EvidencePack integration.
//
// The baseline gap (current-state report §8): meeting RAG had no typed
// evidence, no confidence gate, and no source-owner distinction from
// long-term memory. This adapter wraps RAGRetriever's ScoredChunk output into
// EvidenceItems with full provenance (meetingId, chunkId, speaker,
// timestampMs) — the "~50-line addition" the report recommended, plus the
// confidence gate meeting RAG never had.
//
// Cross-meeting isolation invariant: chunks from a DIFFERENT meeting than the
// live one are rejected (`wrong_entity`) unless the contract explicitly scopes
// meeting_rag_chunk with scopeId=null (cross-meeting grant). queryGlobal
// results therefore cannot silently enter a live-meeting answer.

import type { ScoredChunk } from '../../rag/VectorStore';
import type { EvidenceItem, RejectedEvidenceItem } from './evidencePack';
import { previewText } from './evidencePack';
import { textCanProveProperty } from './requestedProperty';
import { capabilityFor, type TurnContextContract } from './types';

/** Meeting RAG confidence gate — same spirit as the mode-doc ragConfidenceGate. */
export const MEETING_RAG_MIN_SIMILARITY = 0.3;

export interface MeetingRagConversionResult {
  items: EvidenceItem[];
  rejected: RejectedEvidenceItem[];
  /** True when at least one chunk cleared the confidence gate. */
  confident: boolean;
}

export function meetingChunksToEvidenceItems(input: {
  chunks: ScoredChunk[];
  contract: TurnContextContract;
  /** The live meeting id; chunks from other meetings are rejected unless cross-meeting is granted. */
  currentMeetingId?: string | null;
}): MeetingRagConversionResult {
  const { chunks, contract } = input;
  const items: EvidenceItem[] = [];
  const rejected: RejectedEvidenceItem[] = [];

  const cap = capabilityFor(contract, 'meeting_rag_chunk');
  if (!cap || !cap.permissions.useAsEvidence) {
    for (const c of chunks) {
      rejected.push({
        sourceKind: 'meeting_rag_chunk',
        sourceId: `${c.meetingId}:${c.chunkIndex}`,
        reason: 'forbidden_source',
        textPreview: previewText(c.text),
      });
    }
    return { items, rejected, confident: false };
  }

  // Cross-meeting isolation: DURING a live meeting the caller passes
  // currentMeetingId and only that meeting's chunks may become evidence
  // (queryGlobal results are rejected `wrong_entity`). Post-meeting global
  // search passes no currentMeetingId — the explicit cross-meeting case.
  const allowCrossMeeting = !input.currentMeetingId;
  const scopeMeetingId = input.currentMeetingId ?? null;

  let idx = 0;
  for (const c of chunks) {
    if (!c || typeof c.text !== 'string' || !c.text.trim()) continue;

    if (!allowCrossMeeting && scopeMeetingId && c.meetingId !== scopeMeetingId) {
      rejected.push({
        sourceKind: 'meeting_rag_chunk',
        sourceId: `${c.meetingId}:${c.chunkIndex}`,
        reason: 'wrong_entity',
        textPreview: previewText(c.text),
      });
      continue;
    }

    const similarity = typeof c.similarity === 'number' ? c.similarity : 0;
    if (similarity < MEETING_RAG_MIN_SIMILARITY) {
      rejected.push({
        sourceKind: 'meeting_rag_chunk',
        sourceId: `${c.meetingId}:${c.chunkIndex}`,
        reason: 'low_confidence',
        textPreview: previewText(c.text),
      });
      continue;
    }

    const canProve = textCanProveProperty(c.text, contract.requestedProperty);
    items.push({
      evidenceId: `${contract.turnId}:meeting_rag:${idx++}`,
      sourceKind: 'meeting_rag_chunk',
      sourceId: `${c.meetingId}:${c.chunkIndex}`,
      sourceOwner: 'meeting_rag',
      authority: 'evidence',
      trustLevel: cap.trustLevel,
      text: c.text,
      pointer: {
        meetingId: c.meetingId,
        chunkId: `${c.meetingId}:${c.chunkIndex}`,
        timestampMs: c.startMs,
        speaker: c.speaker,
      },
      supports: {
        property: canProve ? contract.requestedProperty : 'unknown',
      },
      score: {
        vector: similarity,
        propertyMatch: canProve ? 1 : 0,
        final: typeof c.finalScore === 'number' ? c.finalScore : similarity,
      },
      reasonIncluded: 'meeting RAG chunk under meeting_rag_chunk capability',
    });
  }

  return { items, rejected, confident: items.length > 0 };
}
