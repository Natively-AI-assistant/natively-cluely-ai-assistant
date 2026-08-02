// electron/context-intelligence/contracts/types.ts
//
// Canonical runtime contracts for Context Intelligence V3.
//
// Types only — no behaviour, no imports from the legacy stack. This file is the
// vocabulary every other module in context-intelligence/ speaks, and nothing
// outside this directory may redefine these shapes.
//
// See docs/context-intelligence-v3/04_TARGET_ARCHITECTURE.md

// ── Sources ─────────────────────────────────────────────────────────────────
//
// General model knowledge is deliberately NOT a member. It is a capability
// (CapabilityPolicy.useGeneralTechnicalKnowledge), not a retrievable private
// source. Conflating the two is what lets "the model knows Kubernetes" become
// "the candidate has used Kubernetes".
export type SourceType =
  | 'RESUME'
  | 'JOB_DESCRIPTION'
  | 'PROFILE_FACT'
  | 'REFERENCE_FILE'
  | 'PROJECT_FILE'
  | 'CODING_SAMPLE'
  | 'CANDIDATE_FILE'          // recruiting: a candidate's file, NOT the user's resume
  | 'MEETING_TRANSCRIPT'
  | 'CONVERSATION_STATE'
  | 'SCREEN_CONTEXT';

export type ClaimType =
  | 'USER_EMPLOYMENT' | 'USER_PROJECT' | 'USER_SKILL' | 'USER_EDUCATION'
  | 'USER_MOTIVATION'
  | 'JOB_RESPONSIBILITY' | 'JOB_REQUIRED_SKILL' | 'JOB_PREFERRED_SKILL'
  | 'DOCUMENT_FACT' | 'MEETING_STATEMENT' | 'MEETING_DECISION'
  | 'SCREEN_FACT'
  | 'GENERAL_TECHNICAL' | 'GENERAL_INDUSTRY'
  | 'RECOMMENDATION';

export type QuestionType =
  | 'PERSONAL_EXPERIENCE' | 'PERSONAL_PROJECT' | 'PERSONAL_SKILL'
  | 'JOB_REQUIREMENT' | 'ROLE_ALIGNMENT'
  | 'DOCUMENT_FACT' | 'DOCUMENT_EXPLANATION'
  | 'MEETING_FACT' | 'SCREEN_SPECIFIC'
  | 'GENERAL_TECHNICAL' | 'GENERAL_INDUSTRY'
  | 'CODING_TASK' | 'SYSTEM_DESIGN'
  | 'MIXED' | 'FOLLOW_UP' | 'AMBIGUOUS'
  /** A request to reveal or override the assistant's own instructions. Refused
   *  at the policy layer, before retrieval — see META_REQUEST_RE. */
  | 'META_REQUEST';

export type GroundingPolicy =
  | 'STRICT_SOURCE_ONLY' | 'SOURCE_FIRST' | 'OPEN_KNOWLEDGE' | 'ASK_BEFORE_FALLBACK';

export type AnswerSurface =
  | 'meeting-overlay' | 'manual-chat' | 'what-to-answer'
  | 'follow-up' | 'screenshot' | 'recap' | 'assist' | 'developer-test';

export type RetrievalPath = 'FAST' | 'GROUNDED' | 'VERIFICATION';

export type Answerability = 'FULL' | 'PARTIAL' | 'NONE' | 'CONFLICTING';

// ── Scope ───────────────────────────────────────────────────────────────────
//
// The single most load-bearing type here. Phase 2 measured a 54.8% stale-version
// retrieval rate on pure semantic search: resume v1 and v2 are near-identical
// prose, so their embeddings are correctly almost identical and NO ranking
// approach can separate them. Scope and version must therefore be applied as a
// pre-scoring FILTER. EvidenceItem carries scopeId so that filter is assertable.
export interface EvidenceScope {
  userId: string;
  profileId?: string;
  meetingId?: string;
  sessionId?: string;
  workspaceId?: string;
}

/** Stable string key for an EvidenceScope. Order is fixed so it is comparable. */
export function scopeKey(s: EvidenceScope): string {
  return [
    `u:${s.userId}`,
    s.profileId ? `p:${s.profileId}` : '',
    s.meetingId ? `m:${s.meetingId}` : '',
    s.sessionId ? `s:${s.sessionId}` : '',
    s.workspaceId ? `w:${s.workspaceId}` : '',
  ].filter(Boolean).join('|');
}

export interface AuthorizedSource {
  sourceType: SourceType;
  sourceId: string;
  /** Active version only. A superseded version is not authorized at all. */
  versionId: string;
  scopeId: string;
  authorityFor: ClaimType[];
  priority: number;
  metadataFilters: Record<string, string | number | boolean>;
}

// ── Evidence ────────────────────────────────────────────────────────────────

export type EvidenceRejectionReason =
  | 'OUT_OF_SCOPE'
  | 'SUPERSEDED_VERSION'
  | 'UNAUTHORIZED_SOURCE'
  | 'NOT_AUTHORITATIVE'
  | 'BELOW_THRESHOLD'
  | 'KEYWORD_OVERLAP_ONLY'
  | 'DUPLICATE'
  | 'CONTRADICTED';

/**
 * WHERE evidence text physically came from (deep-run 2 issue 10 / Pattern D).
 * Distinct from SourceType (what KIND of source the mode sees): a reference
 * file named "standup-transcript.md" is MODE_REFERENCE_FILE provenance no
 * matter what its name implies, and an injected test transcript is
 * TEST_TRANSCRIPT, never LIVE_STT. Stamped by each retrieval PORT — the one
 * layer that knows which store it read — and never inferred from filename,
 * title, content, or model output. Optional because legacy stores predate it;
 * enforcement must therefore only ever fire on evidence that carries it.
 */
export type EvidenceProvenance =
  | 'PROFILE_RESUME'
  | 'PROFILE_JOB_DESCRIPTION'
  | 'PROFILE_FACT'
  | 'MODE_REFERENCE_FILE'
  | 'LIVE_STT'
  | 'IMPORTED_TRANSCRIPT'
  | 'TEST_TRANSCRIPT'
  | 'MEETING_NOTE'
  | 'MANUAL_CHAT'
  | 'PRIOR_ASSISTANT_MESSAGE';

export interface RetrievalCandidate {
  evidenceId: string;
  sourceType: SourceType;
  sourceId: string;
  versionId: string;
  /**
   * The version this chunk ACTUALLY came from, as distinct from `versionId`,
   * which records the source's active version.
   *
   * They are normally equal — the filter rejects mismatches. Recording the
   * retrieved version separately is what makes the mismatch check meaningful:
   * while every admitted item was stamped with the ACTIVE version, a
   * version-collision assertion could not fire even in principle, because two
   * items from one source were guaranteed to carry identical values.
   */
  retrievedVersionId?: string;
  scopeId: string;

  documentTitle?: string;
  section?: string;
  headingPath?: string[];
  page?: number;
  chunkIndex?: number;

  content: string;

  /** See EvidenceProvenance. Port-stamped; absent on legacy stores. */
  provenance?: EvidenceProvenance;

  semanticScore?: number;
  keywordScore?: number;
  headingScore?: number;
  entityScore?: number;
  continuityScore?: number;
  rerankerScore?: number;
  /** Structural/answerability signal. Computed by the legacy retriever today and
   *  then DROPPED at the ModeRetrievedChunk boundary — carried through here. */
  answerabilityScore?: number;
  finalScore: number;

  authorityFor: ClaimType[];
  isDirectFact: boolean;
  isInferred: boolean;
  metadata: Record<string, unknown>;
}

export interface EvidenceItem extends RetrievalCandidate {
  /** Untrusted by construction: retrieved text is DATA, never instructions. */
  trustLevel: 'untrusted_reference';
  acceptedFor: ClaimType[];
}

export interface RejectedEvidence {
  candidate: RetrievalCandidate;
  reason: EvidenceRejectionReason;
  detail?: string;
}

// ── Claims ──────────────────────────────────────────────────────────────────

export interface ClaimRequirement {
  claimType: ClaimType;
  authority:
    | 'PRIVATE_SOURCE_REQUIRED'
    | 'PRIVATE_SOURCE_PREFERRED'
    | 'GENERAL_KNOWLEDGE_ALLOWED'
    | 'GENERATED_REASONING_ALLOWED';
  authoritativeSources: SourceType[];
  prohibitedSources?: SourceType[];
  fallback: 'OMIT' | 'DISCLOSE_UNSUPPORTED' | 'GENERALIZE' | 'LABEL_AS_INFERENCE' | 'ASK_CLARIFICATION';
  /** The clause this claim came from. Evidence is matched against THIS, not the
   *  whole question — otherwise one clause's subject satisfies another's claim. */
  subject?: string;
}

export interface PlannedClaim {
  claimId: string;
  description: string;
  claimType: ClaimType;
  support: 'DIRECT_EVIDENCE' | 'PARTIAL_EVIDENCE' | 'GENERAL_KNOWLEDGE' | 'GENERATED_REASONING' | 'UNSUPPORTED';
  evidenceIds: string[];
  disclosure: 'NONE' | 'SOURCE_GAP' | 'INFERENCE' | 'EXTERNAL_SUGGESTION';
  action: 'INCLUDE' | 'INCLUDE_WITH_LABEL' | 'OMIT' | 'ASK_CLARIFICATION';
}

// ── Retrieval plan ──────────────────────────────────────────────────────────

export interface RetrievalPlan {
  path: RetrievalPath;
  shouldRetrieve: boolean;
  sourceTypes: SourceType[];
  queries: string[];
  entities: string[];

  useSemanticSearch: boolean;
  useKeywordSearch: boolean;
  useHeadingSearch: boolean;
  useExactEntitySearch: boolean;
  usePreviousSourceContinuity: boolean;

  retrieveAdjacentContext: boolean;
  /** Hard cap. Latency is a correctness property in a live meeting. */
  maximumAttempts: 2;
  maximumCandidates: number;
  maximumAcceptedEvidence: number;
  timeoutMs: number;
}

// ── The turn decision ───────────────────────────────────────────────────────

/**
 * The prior turn's source-precedence outcome, persisted so a follow-up like
 * "Why did you ignore the other values?" answers from the RECORDED decision
 * instead of confabulating one (live turns 18/92, 2026-08-01: one answer
 * invented a rationale, the other refused with "no access to source material"
 * — both because the precedence decision existed only inside the turn that
 * made it).
 */
export interface PriorSourceDecision {
  sourceId: string;
  sourceName?: string;
  status?: string;
  reason?: string;
}

export interface PriorTurnDecision {
  question: string;
  selectedSources: PriorSourceDecision[];
  ignoredSources: PriorSourceDecision[];
  precedenceReason?: string;
}

export interface TurnDecision {
  requestId: string;
  requestSequence: number;
  sessionId: string;
  meetingId?: string;

  modeId: string;
  modePolicyVersion: string;

  rawQuestion: string;
  resolvedQuestion: string;
  isFollowUp: boolean;
  followUpTarget?: string;

  questionTypes: QuestionType[];
  claimRequirements: ClaimRequirement[];

  scope: EvidenceScope;
  authorizedSources: AuthorizedSource[];
  requiredSourceTypes: SourceType[];
  optionalSourceTypes: SourceType[];

  groundingPolicy: GroundingPolicy;
  generalKnowledgeAllowed: boolean;
  personalClaimsRequireEvidence: boolean;
  documentClaimsRequireEvidence: boolean;
  meetingClaimsRequireEvidence: boolean;
  jobClaimsRequireJdEvidence: boolean;

  retrievalPlan: RetrievalPlan;
  createdAt: number;

  /** Attached by the orchestrator (never by decide()) when the question is a
   *  precedence follow-up and the session recorded a prior source decision. */
  precedenceHistory?: PriorTurnDecision;
}

/**
 * Deep-freeze a TurnDecision.
 *
 * Immutability is the entire point of this object: F2 found five independent
 * source-decision sites across nine answer surfaces, and the failures traced to
 * downstream components reinterpreting the turn. Freezing makes that a runtime
 * error instead of a silent divergence.
 */
export function freezeTurnDecision(d: TurnDecision): Readonly<TurnDecision> {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): void => {
    if (v === null || typeof v !== 'object') return;
    if (seen.has(v as object)) return;
    seen.add(v as object);
    Object.freeze(v);
    for (const k of Object.getOwnPropertyNames(v)) walk((v as Record<string, unknown>)[k]);
  };
  walk(d);
  return d as Readonly<TurnDecision>;
}
