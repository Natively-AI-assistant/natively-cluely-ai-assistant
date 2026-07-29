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

function buildClaimRequirements(
  policy: ModePolicy,
  claimTypes: string[],
  clauses: Partial<Record<string, string>> = {},
): ClaimRequirement[] {
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
      subject: clauses[ct],
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
    claimRequirements: buildClaimRequirements(policy, cls.claimTypes, cls.claimClauses),

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

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'was',
  'were', 'you', 'your', 'our', 'their', 'about', 'what', 'how', 'why', 'when', 'did', 'does', 'can',
  'could', 'would', 'should', 'they', 'them', 'been', 'into', 'more', 'than', 'then', 'tell', 'give',
  'explain', 'describe', 'candidate', 'applicant', 'experience', 'project', 'projects', 'skills']);

const salientTerms = (text: string): Set<string> => new Set(
  String(text).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
);

/**
 * Does this item actually support THIS claim?
 *
 * `acceptedFor` answers a different question: whether the SOURCE TYPE is
 * authoritative for the claim. A resume is authoritative for user skills — but a
 * resume chunk about WebRTC does not evidence a Kubernetes skill claim.
 *
 * Conflating the two made PARTIAL unreachable and let a single chunk satisfy
 * every user claim at once: "Do you have Kubernetes experience?" plus any resume
 * chunk returned FULL, i.e. a confident answer with no supporting evidence. That
 * is §16's "high similarity = complete answer" error wearing different clothes.
 *
 * Relevance is approximated by shared salient terms. A paraphrase with no shared
 * term is scored as unsupported — a FALSE NEGATIVE that discloses a gap, which
 * is the safe direction. The alternative false positive fabricates.
 */
export function evidenceSupportsClaim(
  evidence: { acceptedFor: string[]; content: string },
  claimType: string,
  question: string,
): boolean {
  if (!evidence.acceptedFor.includes(claimType)) return false;
  const qTerms = salientTerms(question);
  if (qTerms.size === 0) return true;          // nothing to match on — do not block
  const eTerms = salientTerms(evidence.content);
  for (const t of qTerms) if (eTerms.has(t)) return true;
  return false;
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
    // Match against the CLAIM'S OWN subject when known; fall back to the
    // whole question only when the classifier could not attribute a clause.
    const subject = req.subject ?? decision.resolvedQuestion;
    if (evidence.some((e) => evidenceSupportsClaim(e, req.claimType, subject))) supported++;
  }
  if (supported === 0) return 'NONE';
  if (supported < required.length) return 'PARTIAL';

  // Conflict detection (§16.1).
  //
  // An earlier version returned CONFLICTING whenever two DIFFERENT documents of
  // the same source type were accepted. That is not a conflict — it is ordinary
  // multi-document retrieval, and the live run showed it firing on 8 of 42
  // questions, which would have told users their references disagreed every time
  // an answer drew on two files.
  //
  // A real conflict is the SAME source appearing at two different versions.
  // Scope/version filtering should already make that unreachable, so this is an
  // assertion surface: if it ever fires, the filter has a hole.
  //
  // This compares `retrievedVersionId` — the version each chunk actually came
  // from — NOT `versionId`, which is the source's ACTIVE version. Comparing the
  // latter made the check dead code: the adapter stamps every admitted item with
  // the active version, so two items from one source could not differ, and the
  // "assertion surface" above could never fire no matter how broken the filter
  // was. The one hole that does exist — an unknown chunk version being assumed
  // current — is now an opt-in (`assumeCurrentWhenVersionUnknown`), and it is
  // exactly the configuration in which this check earns its place.
  //
  // NOT IMPLEMENTED: content-level contradiction ("v1 says 4 engineers, v2 says
  // 11") between two CURRENT sources. That needs value extraction and comparison
  // per claim. Reporting a conflict we cannot actually detect would be worse than
  // reporting none — §16.1 requires identifying the conflicting VALUES, not
  // merely asserting one exists. So version conflicts are resolved by the filter
  // (06_SOURCE_AUTHORITY_SPEC §3.2, newer wins) and CONFLICTING is reserved for a
  // filter hole. Corpus questions G-01..G-03 are therefore §3.2 cases expecting
  // FULL from the active revision, not §5 cases expecting CONFLICTING.
  const versionsBySource = new Map<string, Set<string>>();
  for (const e of evidence) {
    if (!versionsBySource.has(e.sourceId)) versionsBySource.set(e.sourceId, new Set());
    versionsBySource.get(e.sourceId)!.add(e.retrievedVersionId ?? e.versionId);
  }
  for (const versions of versionsBySource.values()) if (versions.size > 1) return 'CONFLICTING';

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
    try {
      const r = await retrieval.retrieve({ decision });
      evidence = r.evidence;
      attempts = r.attempts;
    } catch (e) {
      // §22.1: a retrieval dependency failure is RECORDED and the turn
      // continues with no evidence — it must NOT abort the turn back to a
      // legacy path that would inject a raw context blob instead. Answerability
      // then correctly reports NONE rather than a confident ungrounded answer.
      attempts = [{
        attempt: 1,
        strategy: 'retrieval_port',
        queries: decision.retrievalPlan.queries,
        candidateCount: 0,
        admittedAfterScopeFilter: 0,
        rejectedByScopeFilter: 0,
        durationMs: 0,
        failed: e instanceof Error ? e.message : String(e),
      }];
    }
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
