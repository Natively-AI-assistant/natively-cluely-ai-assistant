// electron/context-intelligence/debug/debug-types.ts
//
// Canonical Context Intelligence debug-event schema (schemaVersion 1).
//
// ONE schema, adapted FROM existing runtime objects — AnswerTrace
// (observability/answer-trace.ts), TurnDecision, the [V3] line's fields, the
// mode/profile port telemetry — never recomputed. The collector observes what
// production components decided; if a field is absent here it is because no
// production component produced it, and the honest value is undefined.
//
// PRIVACY INVARIANTS (enforced by the collector + redaction, asserted in tests):
//   - Standard level: full question + final answer, identity/counts/scores —
//     NEVER source chunk text, transcript text, prompt text.
//   - Verbose level: adds redacted, length-limited previews and query strings.
//   - Full content requires dev build + verbose + explicit env flag.

import type {
  Answerability, GroundingPolicy, RetrievalPath,
} from '../contracts/types';
import type { FallbackUsed } from '../observability/answer-trace';

export const CONTEXT_DEBUG_SCHEMA_VERSION = 1;

export type ContextDebugLevel = 'off' | 'standard' | 'verbose';

export interface ContextDebugIdentity {
  sessionId: string;
  meetingId?: string;
  turnId: string;
  requestId: string;
  conversationGeneration: number;
  modeId: string;
  modeUniqueId?: string;
  surface: string;
}

export interface ContextDebugSource {
  id: string;
  role: string;
  name?: string;
  mimeType?: string;
  status?: string;
  version?: string;
  pageCount?: number;
  chunkCount?: number;
  indexVersion?: string;
}

export interface ContextDebugRetrievalQuery {
  queryId: string;
  /** Verbose only — omitted at Standard. */
  query?: string;
  targetRoles: string[];
  searchType: 'exact' | 'lexical' | 'vector' | 'hybrid' | 'structured' | 'legacy_mode_hybrid' | 'profile_bm25' | 'meeting_rag' | 'retrieval_port';
  candidateCount: number;
  admittedCount?: number;
  rejectedCount?: number;
  durationMs?: number;
  failed?: string;
}

export interface ContextDebugEvidence {
  sourceId: string;
  sourceRole: string;
  sourceName?: string;
  chunkId?: string;
  page?: number | null;
  section?: string;
  lexicalScore?: number | null;
  vectorScore?: number | null;
  rerankScore?: number | null;
  answerabilityScore?: number | null;
  finalScore?: number | null;
  matchType?: 'exact' | 'lexical' | 'semantic' | 'structured' | 'mixed';
  contentLength?: number;
  /** Verbose: redacted + truncated. Unsafe content mode: full (secrets still redacted). */
  preview?: string;
  previewRedacted?: boolean;
}

export type ContextDebugRejectionStage =
  | 'authorization'
  | 'retrieval'
  | 'rerank'
  | 'confidence_gate'
  | 'source_role_gate'
  | 'claim_authority_gate'
  | 'answerability_gate'
  | 'scope_version_gate'
  | 'budget'
  | 'deduplication';

export interface ContextDebugRejectedEvidence extends ContextDebugEvidence {
  rejectionStage: ContextDebugRejectionStage;
  rejectionReason: string;
}

export interface ContextDebugPrecedenceSource {
  sourceId: string;
  sourceName?: string;
  status?: string;
  version?: string;
  reason: string;
}

export interface ContextDebugError {
  stage:
    | 'question_resolution'
    | 'mode_policy'
    | 'source_manifest'
    | 'source_planning'
    | 'retrieval'
    | 'reranking'
    | 'evidence_gate'
    | 'generation'
    | 'stream_commit'
    | 'logging';
  code?: string;
  message: string;
  recoverable: boolean;
}

export interface ContextDebugTurnComplete {
  schemaVersion: number;
  event: 'context_turn_complete';
  /** The level this record was built at — a reader must know what CAN be in it. */
  level: Exclude<ContextDebugLevel, 'off'>;

  identity: ContextDebugIdentity;

  timestamp: {
    startedAt: string;
    completedAt: string;
    durationMs: number;
  };

  mode: {
    canonicalId: string;
    uniqueId?: string;
    name?: string;
    type: 'default' | 'custom';
    /** The repo's GroundingPolicy vocabulary, verbatim — no second vocabulary. */
    knowledgePolicy: GroundingPolicy;
    policyVersion?: string;
    /** Attachment-derived source-type extensions in effect (custom modes). */
    extraAllowedSourceTypes?: string[];
  };

  question: {
    original: string;
    resolved: string;
    intent: string[];
    claimTypes?: string[];
    requestedEntity?: string | null;
    requestedProperty?: string | null;
    documentSpecific: boolean;
    followUpDetected: boolean;
  };

  conversationState?: {
    activePerson?: string | null;
    activeTopic?: string | null;
    previousQuestion?: string | null;
    referentApplied: boolean;
    referentReason?: string | null;
    referent?: string | null;
  };

  availableSources: {
    modeAttachmentCount: number;
    profileResumeCount: number;
    profileJobDescriptionCount: number;
    profileFactCount: number;
    transcriptSegmentCount?: number;
    otherSourceCount?: number;
  };

  sourcePlan: {
    path: RetrievalPath;
    shouldRetrieve: boolean;
    plannedRoles: string[];
    unsupportedInModeRoles?: string[];
    authorizedSources: ContextDebugSource[];
    planReason?: string;
  };

  retrieval: {
    queries: ContextDebugRetrievalQuery[];
    candidateCount: number;
    admittedCount: number;
    rejectedCount: number;
    selectedEvidence: ContextDebugEvidence[];
    /** Verbose only. */
    rejectedEvidence?: ContextDebugRejectedEvidence[];
  };

  evidenceCoverage: {
    propertyMatched: boolean;
    directEvidenceFound: boolean;
    documentSpecific: boolean;
    /** Superset of the spec's three values: the runtime also emits CONFLICTING. */
    answerability: Answerability;
    claimSupport?: Array<{ claimType: string; support: string; evidenceIds: string[] }>;
  };

  precedence?: {
    selectedSources: ContextDebugPrecedenceSource[];
    ignoredSources: ContextDebugPrecedenceSource[];
  };

  generation: {
    provider?: string;
    requestedModel?: string;
    serverModel?: string;
    fallback: FallbackUsed | string;
    fallbackUsed: boolean;
    tfftMs?: number;
    totalStreamMs?: number;
    outputCharacters: number;
    streamCommitted: boolean;
    commitRejectedReason?: string | null;
    promptTokenEstimate?: number;
  };

  answer: {
    final: string;
  };

  errors: ContextDebugError[];
}

export interface ContextDebugIngest {
  schemaVersion: number;
  event: 'context_ingest_complete';
  timestamp: string;

  document: {
    id: string;
    name: string;
    mimeType?: string;
    bytes?: number;
    role?: string;
    status?: string;
    modeId?: string;
  };

  parsing: {
    expectedPages?: number;
    parsedPages?: number;
    characters?: number;
    chunkCount: number;
  };

  indexes: {
    lexicalReady: boolean;
    vectorReady: boolean;
    embeddedChunkCount?: number;
    embeddingSpace?: string | null;
    indexState?: string;
  };

  timing: {
    totalMs?: number;
    embeddingMs?: number;
  };

  status: 'READY' | 'PARTIAL' | 'FAILED';
  errors: ContextDebugError[];
}

export type ContextDebugRecord = ContextDebugTurnComplete | ContextDebugIngest;
