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
}

export interface MeetingEvidence {
  ports: RetrievalPort[];
  /** Put on the turn's scope.meetingId so containment admits the JIT chunks. Null when there is no JIT port. */
  scopeMeetingId: string | null;
}

export function resolveMeetingEvidence(input: MeetingEvidenceInput): MeetingEvidence {
  if (!input.allowedSourceTypes.includes('MEETING_TRANSCRIPT')) {
    return { ports: [], scopeMeetingId: null };
  }

  const ports: RetrievalPort[] = [];
  let scopeMeetingId: string | null = null;

  // Semantic port over the JIT-embedded chunks, scoped to the live index id.
  // Additive: a closed vector store must not cost the turn the raw transcript.
  try {
    const liveId = input.rag?.getLiveMeetingId() ?? null;
    if (liveId && input.rag) {
      ports.push(createMeetingRetrievalPort({
        retriever: input.rag.getRetriever(),
        currentMeetingId: liveId,
        userId: input.userId,
        tokenBudget: input.tokenBudget,
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
    });
    if (livePort) ports.push(livePort);
  } catch (e) {
    console.warn('[meeting-evidence] live transcript port unavailable:', (e as Error)?.message ?? e);
  }

  return { ports, scopeMeetingId };
}
