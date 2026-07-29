// electron/context-intelligence/orchestration/orchestrator.ts
//
// The single decision pipeline. ONE implementation per responsibility.
//
// This is the object that F2 says does not exist today: nine answer surfaces
// currently run five independent source-decision sites, and five of the nine
// construct no source authority at all. Everything below happens exactly once,
// in one order, and the result is frozen.
//
// Retrieval is INJECTED rather than imported. That keeps this module free of the
// legacy stack, lets the bake-off substitute strategies, and means a surface can
// adopt the decision layer before the retrieval layer is migrated.
//
// See docs/context-intelligence-v3/04_TARGET_ARCHITECTURE.md §2

import type {
  TurnDecision, AnswerSurface, EvidenceScope, EvidenceItem,
  RetrievalPlan, ClaimRequirement, SourceType, Answerability,
} from '../contracts/types';
import { freezeTurnDecision } from '../contracts/types';
import { resolveModePolicy, generalKnowledgeAllowed, type ModePolicy } from '../policies/mode-policy-registry';
import { CLAIM_AUTHORITY } from '../policies/source-authority-policy';
import { classifyTurn } from '../question/turn-classifier';
import type { AnswerTrace, RetrievalAttemptTrace } from '../observability/answer-trace';

export interface AnswerRequest {
  requestId: string;
  requestSequence: number;
  surface: AnswerSurface;
  modeId: string;
  scope: EvidenceScope;
  sessionId: string;

  /** Manual input ALWAYS wins over transcript extraction (§12.2). */
  manualQuestion?: string;
  transcriptQuestion?: string;
  isFollowUp?: boolean;
  hasScreenContext?: boolean;
}

export interface RetrievalPort {
  retrieve(input: {
    decision: Readonly<TurnDecision>;
  }): Promise<{ evidence: EvidenceItem[]; attempts: RetrievalAttemptTrace[] }>;
}

export interface OrchestratorResult {
  decision: Readonly<TurnDecision>;
  evidence: EvidenceItem[];
  answerability: Answerability;
  trace: AnswerTrace;
}

/** Manual > transcript. Resolution happens ONCE (§12.2). */
function resolveQuestion(req: AnswerRequest): { resolved: string; source: 'manual' | 'transcript'; confidence: number } {
  const manual = req.manualQuestion?.trim();
  if (manual) return { resolved: manual, source: 'manual', confidence: 1 };
  const t = req.transcriptQuestion?.trim() ?? '';
  return { resolved: t, source: 'transcript', confidence: t ? 0.7 : 0 };
}

function buildClaimRequirements(policy: ModePolicy, claimTypes: string[]): ClaimRequirement[] {
  return claimTypes.map((ct) => {
    const authority = CLAIM_AUTHORITY[ct as keyof typeof CLAIM_AUTHORITY];
    const isPrivate = authority.authoritative.length > 0;
    return {
      claimType: ct as ClaimRequirement['claimType'],
      authority: isPrivate ? 'PRIVATE_SOURCE_REQUIRED' : 'GENERAL_KNOWLEDGE_ALLOWED',
      authoritativeSources: authority.authoritative,
      prohibitedSources: authority.prohibited,
      // An unsupported personal claim is DISCLOSED, not silently omitted and not
      // fabricated. Over-refusal is explicitly forbidden (§27.2).
      fallback: isPrivate
        ? (policy.capabilityPolicy.unsupportedPersonalClaims === 'REFUSE' ? 'OMIT' : 'DISCLOSE_UNSUPPORTED')
        : 'GENERALIZE',
    };
  });
}

/** Decide ONCE. The result is deep-frozen; nothing downstream may reinterpret it. */
export function decide(req: AnswerRequest): Readonly<TurnDecision> {
  const policy = resolveModePolicy(req.modeId);   // THROWS on unknown id — fails closed
  const q = resolveQuestion(req);

  const cls = classifyTurn({
    resolvedQuestion: q.resolved,
    policy,
    isFollowUp: Boolean(req.isFollowUp),
    hasScreenContext: req.hasScreenContext,
  });

  const optional = policy.allowedSourceTypes.filter((s) => !cls.requiredSourceTypes.includes(s));

  const retrievalPlan: RetrievalPlan = {
    path: cls.path,
    shouldRetrieve: cls.shouldRetrieve,
    sourceTypes: cls.shouldRetrieve
      ? (cls.requiredSourceTypes.length ? cls.requiredSourceTypes : policy.allowedSourceTypes)
      : [],
    queries: [q.resolved],
    entities: [],
    useSemanticSearch: true,
    useKeywordSearch: true,
    useHeadingSearch: cls.questionTypes.includes('DOCUMENT_FACT'),
    useExactEntitySearch: cls.questionTypes.includes('DOCUMENT_FACT'),
    usePreviousSourceContinuity: cls.questionTypes.includes('FOLLOW_UP'),
    retrieveAdjacentContext: cls.path === 'VERIFICATION',
    maximumAttempts: 2,
    maximumCandidates: policy.retrievalPolicy.maximumCandidates,
    maximumAcceptedEvidence: policy.retrievalPolicy.maximumAcceptedEvidence,
    timeoutMs: 1200,
  };

  return freezeTurnDecision({
    requestId: req.requestId,
    requestSequence: req.requestSequence,
    sessionId: req.sessionId,
    meetingId: req.scope.meetingId,

    modeId: policy.id,
    modePolicyVersion: policy.version,

    rawQuestion: req.manualQuestion ?? req.transcriptQuestion ?? '',
    resolvedQuestion: q.resolved,
    isFollowUp: Boolean(req.isFollowUp) || cls.questionTypes.includes('FOLLOW_UP'),

    questionTypes: cls.questionTypes,
    claimRequirements: buildClaimRequirements(policy, cls.claimTypes),

    scope: req.scope,
    authorizedSources: [],            // populated by source authorization at retrieval time
    requiredSourceTypes: cls.requiredSourceTypes,
    optionalSourceTypes: optional as SourceType[],

    groundingPolicy: policy.groundingPolicy,
    generalKnowledgeAllowed: generalKnowledgeAllowed(policy),
    personalClaimsRequireEvidence: policy.personalClaimsRequireEvidence,
    documentClaimsRequireEvidence: policy.documentClaimsRequireEvidence,
    meetingClaimsRequireEvidence: policy.meetingClaimsRequireEvidence,
    jobClaimsRequireJdEvidence: policy.jobClaimsRequireJdEvidence,

    retrievalPlan,
    createdAt: 0,   // stamped by the caller; kept deterministic for tests
  });
}

/**
 * Evaluate answerability.
 *
 * Deliberately NOT a similarity threshold. Phase 2 proved the failure mode: the
 * superseded resume scored HIGHEST on similarity for questions it answered
 * wrongly. Similarity was maximal, correctness was zero. So answerability is
 * decided by whether required claims have authoritative evidence — not by score.
 */
export function evaluateAnswerability(
  decision: Readonly<TurnDecision>,
  evidence: EvidenceItem[],
): Answerability {
  const required = decision.claimRequirements.filter((c) => c.authority === 'PRIVATE_SOURCE_REQUIRED');
  if (required.length === 0) return 'FULL';           // general question — nothing to ground

  let supported = 0;
  for (const req of required) {
    if (evidence.some((e) => e.acceptedFor.includes(req.claimType))) supported++;
  }
  if (supported === 0) return 'NONE';
  if (supported < required.length) return 'PARTIAL';

  // Conflict: two ACTIVE-version items from the same source type disagreeing is
  // surfaced, never silently merged (§16.1).
  const bySource = new Map<string, Set<string>>();
  for (const e of evidence) {
    const k = e.sourceType;
    if (!bySource.has(k)) bySource.set(k, new Set());
    bySource.get(k)!.add(e.sourceId);
  }
  for (const ids of bySource.values()) if (ids.size > 1) return 'CONFLICTING';

  return 'FULL';
}

export async function orchestrate(
  req: AnswerRequest,
  retrieval?: RetrievalPort,
): Promise<OrchestratorResult> {
  const t0 = 0;
  const decision = decide(req);

  let evidence: EvidenceItem[] = [];
  let attempts: RetrievalAttemptTrace[] = [];

  if (decision.retrievalPlan.shouldRetrieve && retrieval) {
    const r = await retrieval.retrieve({ decision });
    evidence = r.evidence;
    attempts = r.attempts;
  }

  const answerability = evaluateAnswerability(decision, evidence);

  // A question whose required source the MODE forbids is not answerable from
  // model knowledge — that would answer a meeting question out of thin air. It
  // is disclosed as an unsupported gap regardless of generalKnowledgeAllowed.
  const unsupportedInMode = (decision.retrievalPlan.shouldRetrieve === false
    && decision.retrievalPlan.path === 'GROUNDED'
    && decision.requiredSourceTypes.length === 0
    && decision.claimRequirements.some((c) => c.authority === 'PRIVATE_SOURCE_REQUIRED'));

  const fallbackUsed =
    answerability === 'FULL' ? 'NONE'
      : answerability === 'CONFLICTING' ? 'CONFLICT'
        : answerability === 'PARTIAL' ? 'PARTIAL_SUPPORT'
          : unsupportedInMode ? 'STRICT_NOT_FOUND'
            : decision.generalKnowledgeAllowed ? 'GENERAL_KNOWLEDGE' : 'STRICT_NOT_FOUND';

  const trace: AnswerTrace = {
    requestId: decision.requestId,
    requestSequence: decision.requestSequence,
    scope: decision.scope,
    surface: req.surface,
    originalQuestion: decision.rawQuestion,
    resolvedQuestion: decision.resolvedQuestion,
    resolutionConfidence: req.manualQuestion ? 1 : 0.7,
    modeId: decision.modeId,
    modePolicyVersion: decision.modePolicyVersion,
    questionTypes: decision.questionTypes,
    groundingPolicy: decision.groundingPolicy,
    authorizedSources: evidence.map((e) => ({
      sourceType: e.sourceType, sourceId: e.sourceId, versionId: e.versionId, scopeId: e.scopeId,
    })),
    prohibitedSources: [],
    retrievalPath: decision.retrievalPlan.path,
    retrievalAttempts: attempts,
    acceptedEvidence: evidence.map((e) => ({
      evidenceId: e.evidenceId, sourceType: e.sourceType, sourceId: e.sourceId,
      versionId: e.versionId, scopeId: e.scopeId, finalScore: e.finalScore,
      semanticScore: e.semanticScore, keywordScore: e.keywordScore,
      answerabilityScore: e.answerabilityScore, contentLength: e.content.length,
    })),
    rejectedEvidence: [],
    answerability,
    claimPlan: decision.claimRequirements.map((c, i) => ({
      claimId: `c${i}`, claimType: c.claimType,
      support: evidence.some((e) => e.acceptedFor.includes(c.claimType)) ? 'DIRECT_EVIDENCE'
        : c.authority === 'PRIVATE_SOURCE_REQUIRED' ? 'UNSUPPORTED' : 'GENERAL_KNOWLEDGE',
      evidenceIds: evidence.filter((e) => e.acceptedFor.includes(c.claimType)).map((e) => e.evidenceId),
      disclosure: 'NONE', action: 'INCLUDE',
    })),
    fallbackUsed,
    promptTokenEstimate: 0,
    latency: {
      normalizationMs: 0, questionResolutionMs: 0, policyResolutionMs: 0, classificationMs: 0,
      retrievalMs: 0, rerankingMs: 0, evidenceEvaluationMs: 0, promptCompositionMs: 0,
      providerTtfbMs: 0, totalMs: t0,
    },
    providerAttempts: [],
    status: 'COMPLETED',
    errorCodes: [],
    engine: 'v3',
  };

  return { decision, evidence, answerability, trace };
}
