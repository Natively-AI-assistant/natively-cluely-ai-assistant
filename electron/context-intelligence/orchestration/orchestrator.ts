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
  RetrievalPlan, ClaimRequirement, SourceType, Answerability, ClaimType,
} from '../contracts/types';
import { freezeTurnDecision } from '../contracts/types';
import { resolveModePolicy, generalKnowledgeAllowed, type ModePolicy } from '../policies/mode-policy-registry';
import { resolveAnswerPolicy, type AnswerPolicy } from '../policies/answer-policy';
import { CLAIM_AUTHORITY } from '../policies/source-authority-policy';
import { classifyTurn, isBareFollowUp } from '../question/turn-classifier';
import type { AnswerTrace, RetrievalAttemptTrace } from '../observability/answer-trace';

export interface AnswerRequest {
  requestId: string;
  requestSequence: number;
  surface: AnswerSurface;
  modeId: string;
  scope: EvidenceScope;
  sessionId: string;

  /**
   * The user's per-mode grounding choice (§6) — one of exactly two values, from
   * the Answer policy control. Optional: absent means the mode default applies.
   * This can TIGHTEN grounding (strict) or restore the default; it can never
   * authorize a source — resolveAnswerPolicy maps it onto GroundingPolicy and
   * nothing else.
   */
  userAnswerPolicy?: AnswerPolicy | null;

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
  const basePolicy = resolveModePolicy(req.modeId);   // THROWS on unknown id — fails closed

  // The user's Answer policy choice is applied ONCE, here, as an effective
  // policy — before classification, deliberately: choosing "Only answer from
  // references" makes a reference-holding mode document-centric, so factual
  // questions become document claims instead of general-knowledge escapes.
  // resolveAnswerPolicy can only move between the two exposed grounding values;
  // it cannot reach OPEN_KNOWLEDGE and it cannot touch allowedSourceTypes.
  const resolvedGrounding = resolveAnswerPolicy({
    modeId: req.modeId, userChoice: req.userAnswerPolicy ?? null,
  });
  const policy: ModePolicy = resolvedGrounding.source === 'user_choice'
    ? { ...basePolicy, groundingPolicy: resolvedGrounding.groundingPolicy }
    : basePolicy;

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
  'explain', 'describe', 'candidate', 'applicant', 'experience', 'project', 'projects', 'skills',

  // ── Source-scaffolding vocabulary ──────────────────────────────────────────
  //
  // Words that describe the ACT of consulting a source are not evidence of its
  // content, and treating them as salient produced confident answers from
  // unrelated documents. Measured on I-01, "What does the empty reference file
  // say about pricing?": the sales battlecard chunk reading "Cluely lacks
  // per-mode reference files" shares `reference` and `file` with the question and
  // was therefore accepted as supporting a DOCUMENT_FACT claim about pricing. The
  // turn reported FULL on three chunks, none of which mentioned pricing.
  //
  // Every entry here is a word a user says to point AT a source, never a fact a
  // source states. Content nouns are deliberately absent — 'pricing', 'outage'
  // and 'salary' stay salient.
  'file', 'files', 'document', 'documents', 'documentation', 'reference', 'references',
  'material', 'materials', 'provided', 'according', 'information', 'detail', 'details',
  'say', 'says', 'said', 'state', 'states', 'stated', 'mention', 'mentions', 'mentioned',
  'contain', 'contains', 'note', 'notes', 'text', 'page', 'pages', 'attached', 'upload',
  'uploaded', 'source', 'sources', 'anything', 'something', 'know', 'knows',
  // Summary/recap verbs describe the OPERATION requested, not a fact to find.
  // "Summarise the reference material" carried exactly one salient term after
  // scaffolding removal — the stem of "summarise" — which no document contains,
  // so a summary request over five perfectly good evidence items reported NONE
  // (measured regression J-01, introduced by the scaffolding stoplist itself).
  // With these removed the subject has NO content terms, which is correct: a
  // summary names no fact, so any authorized in-scope evidence supports it and
  // the existing "nothing to match on — do not block" rule carries the turn.
  'summarise', 'summarize', 'summary', 'summaries', 'overview', 'recap']);

/**
 * Fold a word to a light stem so inflections match.
 *
 * Exact token comparison made "graduate" and "graduated" different terms, so
 * "What year did the candidate graduate?" found no support in a résumé section
 * reading "Graduated **2017**" — the correct chunk, correctly retrieved, and the
 * version filter had already done its job. Measured on G-01.
 *
 * Deliberately crude and suffix-only. A real stemmer would also conflate words
 * this must keep apart, and the whole point of this check is to stop a chunk
 * about one topic evidencing a claim about another.
 */
const stem = (w: string): string => w
  .replace(/(?:ations|ation|ings|ing|edly|ed|es|s)$/, '')
  // Drop a trailing silent 'e' AFTER suffix stripping, or the two halves of the
  // same word still disagree: "graduated" strips to "graduat" while "graduate"
  // strips to nothing, and the pair that motivated this fix would still miss.
  .replace(/e$/, '')
  .replace(/i$/, 'y');

/**
 * Salient terms of a text: content words, stemmed, scaffolding removed.
 *
 * The stoplist is checked against BOTH the surface form and the stem. Checking
 * only the surface form let inflections slip past — `mentions` is listed but
 * `mentioning` was not, and after stemming both become `mention`, so the filter
 * has to run on the stem as well or the list silently has holes.
 */
const salientTerms = (text: string): Set<string> => {
  const out = new Set<string>();
  for (const raw of String(text).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)) {
    if (raw.length <= 2 || STOPWORDS.has(raw)) continue;
    const t = raw.length > 4 ? stem(raw) : raw;
    if (STOPWORDS.has(t)) continue;
    out.add(t);
  }
  return out;
};

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
  evidence: { acceptedFor: string[]; content: string; metadata?: Record<string, unknown> },
  claimType: string,
  question: string,
): boolean {
  if (!evidence.acceptedFor.includes(claimType)) return false;
  // AUTHORITATIVE ABSENCE: an item its port declares to be the COMPLETE
  // extracted record of a category (the whole skills inventory, the whole
  // employment list) supports any claim its source is authoritative for, term
  // overlap or not — the correct grounded answer may be that the asked-about
  // thing is NOT in it, and "Do I have Kubernetes experience?" shares no term
  // with a skills list that (correctly) lacks Kubernetes. Term matching would
  // report NONE for exactly the questions where the evidence proves the answer.
  // Authority is still enforced above: a JD's complete requirements list can
  // never support a USER_* claim.
  if (evidence.metadata?.completeInventory === true) return true;
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
  // A follow-up whose RESOLVED question is still bare has an unresolved
  // referent: nothing upstream expanded "Why?" or "Would that scale?" into a
  // question about something. Its subject cannot be supported by any evidence,
  // because there is no subject. Answering FULL here is what licensed a
  // confident, context-free answer to "Why?" over six unrelated evidence items
  // (measured on E-01/E-02, which ship no conversation state).
  //
  // The cap SELF-DISABLES once resolution is wired: a resolver that expands the
  // follow-up against conversation state produces a non-bare resolvedQuestion,
  // and this branch never fires. It deliberately does not try to answer from
  // the raw token — §12 says resolve or clarify, never guess.
  const referentUnresolved = decision.isFollowUp && isBareFollowUp(decision.resolvedQuestion);

  const required = decision.claimRequirements.filter((c) => c.authority === 'PRIVATE_SOURCE_REQUIRED');
  if (required.length === 0) {
    if (referentUnresolved) {
      // "Would that scale?" keeps a general-knowledge half — the scaling
      // judgement — so it is PARTIAL, not NONE. "Why?" has nothing but the
      // referent.
      return decision.claimRequirements.length ? 'PARTIAL' : 'NONE';
    }
    return 'FULL';           // general question — nothing to ground
  }
  if (referentUnresolved) return 'PARTIAL';

  // Satisfaction is judged per SUBJECT, not per claim requirement.
  //
  // A subject is one thing the user asked about — a clause. The classifier often
  // emits several claim types for a single clause because the MODE authorizes
  // several source types that could answer it: "Who owns the events table
  // migration?" in team-meet mode yields both MEETING_STATEMENT and
  // DOCUMENT_FACT. Those are ALTERNATIVES (either a transcript or a reference
  // document answers it), not a conjunction.
  //
  // Counting them as a conjunction made PARTIAL structurally unavoidable for that
  // whole class: the transcript supported MEETING_STATEMENT, no reference document
  // supported DOCUMENT_FACT, and a fully-answered question reported PARTIAL
  // (measured on H-02 and H-04). Grouping by subject keeps genuine multi-part
  // questions strict — "tell me about PriceX AND explain how WebRTC works" is two
  // distinct subjects and still requires both — while letting one clause be
  // satisfied by any authoritative route to it.
  // …with ONE refinement (2026-07-31): claims about the USER and claims about
  // the JOB on the SAME clause are a COMPARISON, not alternatives. "Do I meet
  // the two-year experience requirement?" emits USER_SKILL (the résumé side)
  // and JOB_REQUIRED_SKILL (the JD side) from one clause; the JD is PROHIBITED
  // from evidencing the user claim and vice versa, so neither can substitute
  // for the other — grouping them together let résumé evidence alone report
  // FULL with the requirement never retrieved (measured: the 2-year question
  // planned only JOB_DESCRIPTION and compared nothing). Claims within one
  // family remain alternatives, which is what H-02/H-04 established.
  const family = (c: ClaimType | string): string => String(c).startsWith('JOB_') ? 'job' : 'user';
  const bySubject = new Map<string, typeof required>();
  for (const req of required) {
    const subject = `${req.subject ?? decision.resolvedQuestion} ${family(req.claimType)}`;
    if (!bySubject.has(subject)) bySubject.set(subject, []);
    bySubject.get(subject)!.push(req);
  }

  let supported = 0;
  for (const [, reqs] of bySubject) {
    // Term-match against the CLEAN clause, not the grouping key — the family
    // suffix is a bucket label, and letting it into salientTerms would hand
    // every user-side group a free "user" term to match on.
    const ok = reqs.some((req) => evidence.some(
      (e) => evidenceSupportsClaim(e, req.claimType, req.subject ?? decision.resolvedQuestion),
    ));
    if (ok) supported++;
  }
  if (supported === 0) return 'NONE';
  if (supported < bySubject.size) return 'PARTIAL';

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

  // ── Conversation continuity (§12.3) ───────────────────────────────────────
  // Resolve a bare follow-up against this session's state BEFORE deciding.
  // conversation-state.ts existed with zero callers, so "Why not?" reached the
  // classifier bare, tripped the isBareFollowUp CLARIFICATION cap, and every
  // live follow-up became a disclosure instead of an answer. Resolution here
  // rewrites the question to carry its referent ("Why not? (referring to:
  // Kubernetes)"), which both retrieves against the right subject and
  // self-disables the bare-follow-up cap — exactly the design note on that cap.
  // resolveReference is deliberately conservative: no state or no pronoun →
  // question passes through untouched, and nothing below this line changes.
  let effectiveReq = req;
  try {
    const { resolveAgainstSession } = require('../question/conversation-state-store');
    const rawQ = (req.manualQuestion ?? req.transcriptQuestion ?? '').trim();
    if (rawQ) {
      const ref = resolveAgainstSession(req.sessionId, rawQ);
      if (ref.usedState && ref.resolved !== rawQ) {
        effectiveReq = req.manualQuestion
          ? { ...req, manualQuestion: ref.resolved, isFollowUp: true }
          : { ...req, transcriptQuestion: ref.resolved, isFollowUp: true };
      }
    }
  } catch { /* continuity must never break a turn */ }

  const decision = decide(effectiveReq);

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

  // An unresolved referent is a CLARIFICATION case, not a knowledge gap:
  // "Why?" with no antecedent cannot be answered from general knowledge either.
  const referentUnresolved = decision.isFollowUp && isBareFollowUp(decision.resolvedQuestion);

  const fallbackUsed =
    answerability === 'FULL' ? 'NONE'
      : answerability === 'CONFLICTING' ? 'CONFLICT'
        : referentUnresolved ? (answerability === 'PARTIAL' ? 'PARTIAL_SUPPORT' : 'CLARIFICATION')
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
    plannedSourceTypes: [...decision.retrievalPlan.sourceTypes],
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

  // Phase 10 §4: count the decision-layer signals. Derived from the trace

  // that already exists — no new instrumentation on the answer path, and

  // never throwing, so a metrics defect cannot degrade an answer.

  try {

    // eslint-disable-next-line @typescript-eslint/no-var-requires

    require('../observability/rollout-metrics').recordTurnMetrics(trace);

  } catch { /* observability only */ }

  // Advance conversation state so the NEXT turn's bare follow-up can resolve.
  // Question + evidence identity only; the transport appends the answer
  // summary after the stream completes (recordAnswerSummary).
  try {
    const { advanceConversationState } = require('../question/conversation-state-store');
    advanceConversationState({
      sessionId: req.sessionId,
      scope: decision.scope,
      question: decision.resolvedQuestion,
      evidenceIds: evidence.map((e) => e.evidenceId),
      sourceIds: [...new Set(evidence.map((e) => e.sourceId))],
    });
  } catch { /* continuity must never break a turn */ }

  return { decision, evidence, answerability, trace };
}
