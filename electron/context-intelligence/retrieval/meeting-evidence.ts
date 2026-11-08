// electron/context-intelligence/retrieval/meeting-evidence.ts
//
// The ONE builder of live-meeting evidence for the V3 surfaces (issue #552).
//
// WHY THIS EXISTS
// Manual chat and what-to-answer each built their own meeting port, and both
// scoped it by `getMeetingMetadata().id`. No normal meeting sets that id
// (App.tsx starts a meeting with {audio, doNotPersist}), and the JIT indexer
// stores its chunks under the id main.ts passes to startLiveIndexing — a
// constant — so neither surface ever retrieved a JIT chunk. Manual chat was
// worse: it reached the id through a method that does not exist, hidden by
// `as any`, so its meeting port was never even constructed. The only thing
// giving typed chat any transcript grounding was a RAG pre-flight that ran
// BEFORE V3 and carried no conversation history.
//
// TWO PORTS, DELIBERATELY
// The JIT port is semantic retrieval over embedded chunks — the right tool
// for "what did Jonas say about the relocation window" ten minutes later.
// The BM25 live-transcript port is always added beside it: it covers the
// first minute before any chunk is embedded, an embedding outage, and the
// newest utterances the indexer has not reached yet. combineRetrievalPorts
// dedupes identical passages, so overlap costs nothing.
//
// SCOPE
// scopeAdmits (legacy-adapter.ts) rejects a source whose meetingId differs
// from the turn's. The meeting port declares each chunk's scope as its own
// meeting id, which for JIT rows is the live index id — so the TURN must
// carry that same id. `scopeMeetingId` is how the caller learns it; putting
// anything else (or nothing) on the turn's scope makes every JIT chunk
// OUT_OF_SCOPE. The test file proves admission end to end.
//
// inLiveMeeting (task 7b, issue #552 live-verification)
// Building at least one port here proves the turn is genuinely inside a live
// meeting with something the transcript could answer — a live run showed the
// JIT and live-transcript ports both admitting the right chunk for "what did
// jonas say about the elasticsearch window" in General mode while the
// classifier never PLANNED MEETING_TRANSCRIPT at all, because General's
// primary source is REFERENCE_FILE and no attribution wording matched. The
// deleted typed-chat RAG pre-flight used to cover this; `inLiveMeeting` lets
// the classifier claim the transcript as an ALTERNATIVE for an unclassified
// factual question without forcing every mode, in or out of a meeting, to
// always plan MEETING_TRANSCRIPT.

import type { SourceType } from '../contracts/types';
import type { RetrievalPort } from '../orchestration/orchestrator';
import { createMeetingRetrievalPort, type MeetingRetrieverLike } from './meeting-retrieval-port';
import { createLiveTranscriptRetrievalPort, type LiveTranscriptSegment } from './live-transcript-port';

/** The slice of RAGManager this resolver uses. Structural — no legacy import. */
export interface MeetingRagLike {
  getRetriever(): MeetingRetrieverLike;
  /** Live index id when JIT indexing is running AND has ≥1 embedded chunk; else null. */
  getLiveMeetingId(): string | null;
}

export interface MeetingEvidenceInput {
  rag: MeetingRagLike | null;
  /** The session's spoken transcript so far (IntelligenceManager.getCurrentMeetingTranscript()). */
  segments: readonly LiveTranscriptSegment[];
  /** The active mode policy's allowedSourceTypes — a mode that does not authorize transcripts gets nothing. */
  allowedSourceTypes: readonly SourceType[];
  userId: string;
  sessionId: string;
  tokenBudget: number;
  roleOf?: (speaker: string) => 'interviewer' | 'user' | 'assistant';
  /** SessionTracker.getAssistantViewStartedAt(): semantic chunks older than a mid-meeting reset are left out. */
  notBeforeMs?: number;
  /** The rolling meeting recap (SessionTracker.getMeetingRecaps()), served for whole-meeting questions. */
  recaps?: ReadonlyArray<{ lines: number; text: string }>;
}

export interface MeetingEvidence {
  ports: RetrievalPort[];
  /** Put on the turn's scope.meetingId so containment admits the JIT chunks. Null when there is no JIT port. */
  scopeMeetingId: string | null;
  /**
   * True when at least one meeting port was actually built — the JIT port,
   * the live-transcript port, or both (issue #552, task 7b). This is NOT the
   * same question as "does the mode allow MEETING_TRANSCRIPT": a mode can
   * authorize the source with nothing spoken yet and no JIT chunks embedded,
   * in which case this is false. The turn-classifier uses it to decide
   * whether an unclassified factual question in a document-primary mode
   * (General) can ALSO be answered by what was just said — see
   * ClassificationInput.inLiveMeeting.
   */
  inLiveMeeting: boolean;
}

export function resolveMeetingEvidence(input: MeetingEvidenceInput): MeetingEvidence {
  if (!input.allowedSourceTypes.includes('MEETING_TRANSCRIPT')) {
    return { ports: [], scopeMeetingId: null, inLiveMeeting: false };
  }

  const ports: RetrievalPort[] = [];
  let scopeMeetingId: string | null = null;
  let semanticPort: RetrievalPort | null = null;

  // Semantic port over the JIT-embedded chunks, scoped to the live index id.
  // Additive: a closed vector store must not cost the turn the raw transcript.
  try {
    const liveId = input.rag?.getLiveMeetingId() ?? null;
    if (liveId && input.rag) {
      semanticPort = (createMeetingRetrievalPort({
        retriever: input.rag.getRetriever(),
        currentMeetingId: liveId,
        userId: input.userId,
        tokenBudget: input.tokenBudget,
        ...(input.notBeforeMs ? { notBeforeMs: input.notBeforeMs } : {}),
      }));
      scopeMeetingId = liveId;
    }
  } catch (e) {
    console.warn('[meeting-evidence] JIT meeting port unavailable — continuing with the live transcript only:', (e as Error)?.message ?? e);
  }

  // Lexical port over what was actually said. Returns null when nothing final
  // has been spoken yet.
  try {
    const livePort = createLiveTranscriptRetrievalPort({
      segments: input.segments,
      userId: input.userId,
      sessionId: input.sessionId,
      ...(input.roleOf ? { roleOf: input.roleOf } : {}),
      ...(input.recaps?.length ? { recaps: input.recaps } : {}),
    });
    if (livePort && semanticPort) ports.push(fuseMeetingPorts(semanticPort, livePort));
    else if (livePort) ports.push(livePort);
    else if (semanticPort) ports.push(semanticPort);
  } catch (e) {
    console.warn('[meeting-evidence] live transcript port unavailable:', (e as Error)?.message ?? e);
    if (semanticPort) ports.push(semanticPort);
  }

  return { ports, scopeMeetingId, inLiveMeeting: ports.length > 0 };
}

/** Reciprocal rank fusion constant (the usual 60: rank 1 and rank 5 differ little). */
const RRF_K = 60;
/** A semantic chunk this share of whose words is already in a chosen keyword window adds nothing new. */
export const MEETING_OVERLAP_CONTAINMENT = 0.7;

const wordsOf = (text: string): Set<string> => new Set(
  text.toLowerCase().replace(/^[^:\n]{1,40}:\s*/gm, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((w) => w.length > 2),
);

/**
 * One ranked list of meeting evidence from the semantic (JIT) and keyword
 * (live transcript) ports (2026-10-16).
 *
 * As two separate ports, combineRetrievalPorts interleaved them by rank and the
 * packer then re-sorted everything by score, comparing a cosine similarity
 * with a normalised BM25 score. Measured in the real app on a 3-hour meeting:
 * weak semantic matches (the meeting's opening lines, a run of earlier
 * questions) outscored the 2nd and 3rd keyword windows and used up the
 * evidence budget, so "what's the code name?" lost the window that said it.
 *
 * Here the two rankings are fused by reciprocal rank (scales never compared),
 * a semantic chunk that mostly repeats a keyword window already chosen is
 * dropped and counts as agreement for that window, and the fused order is
 * written into finalScore so the packer keeps it.
 */
export function fuseMeetingPorts(semantic: RetrievalPort, keyword: RetrievalPort): RetrievalPort {
  return {
    probeAnchors: (q) => Boolean(semantic.probeAnchors?.(q) || keyword.probeAnchors?.(q)),
    probeAnchorSources: (q) => [...new Set([...(semantic.probeAnchorSources?.(q) ?? []), ...(keyword.probeAnchorSources?.(q) ?? [])])],
    async retrieve(args) {
      const [sem, kw] = await Promise.all([
        semantic.retrieve(args).catch((e) => ({ evidence: [], attempts: [{ attempt: 1 as const, strategy: 'meeting_semantic_failure', queries: [], candidateCount: 0, admittedAfterScopeFilter: 0, rejectedByScopeFilter: 0, durationMs: 0, failed: e instanceof Error ? e.message : String(e) }] })),
        keyword.retrieve(args),
      ]);
      type Entry = { item: (typeof kw.evidence)[number]; rrf: number; words: Set<string> };
      const entries: Entry[] = kw.evidence.map((item, rank) => ({ item, rrf: 1 / (RRF_K + rank + 1), words: wordsOf(item.content) }));
      sem.evidence.forEach((item, rank) => {
        const words = wordsOf(item.content);
        const contribution = 1 / (RRF_K + rank + 1);
        let best: Entry | null = null; let bestShare = 0;
        for (const e of entries) {
          if (e.item.sourceId === item.sourceId) continue;
          let shared = 0;
          for (const w of words) if (e.words.has(w)) shared++;
          const share = words.size ? shared / words.size : 0;
          if (share > bestShare) { bestShare = share; best = e; }
        }
        if (best && bestShare >= MEETING_OVERLAP_CONTAINMENT) best.rrf += contribution;
        else entries.push({ item, rrf: contribution, words });
      });
      entries.sort((a, b) => b.rrf - a.rrf);
      const top = Math.max(0, ...entries.map((e) => e.item.finalScore));
      const evidence = entries.map((e, i) => ({ ...e.item, finalScore: Math.max(0, top * (1 - 0.01 * i)) }));
      return { evidence, attempts: [...sem.attempts, ...kw.attempts] };
    },
  };
}
