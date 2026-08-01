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
  /** True when the turn has real documents (mode attachments or hydrated
   *  profile sources) — see ClassificationInput.hasAttachedDocuments. */
  hasAttachedDocuments?: boolean;
  /** Attached file names — filename-role routing (glossary/formula). */
  attachedFileNames?: readonly string[];

  /**
   * Source types the TURN adds to the mode's allowlist because of what is
   * actually attached (deep-test D10, 2026-08-01). A custom mode is coerced to
   * the `general` policy, whose allowlist has no CANDIDATE_FILE/JOB_DESCRIPTION
   * — so a custom mode with a candidate résumé and a JD attached planned []
   * for every job question and refused with STRICT_NOT_FOUND. The call sites
   * derive these from the attached files' detected document shapes
   * (attachmentSourceTypeExtensions); this can only ever ADD types for
   * documents the mode itself holds — it cannot reach profile pools or another
   * mode's files, so source isolation is unchanged.
   */
  extraAllowedSourceTypes?: SourceType[];
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
  let policy: ModePolicy = resolvedGrounding.source === 'user_choice'
    ? { ...basePolicy, groundingPolicy: resolvedGrounding.groundingPolicy }
    : basePolicy;

  // Attachment-derived source types (deep-test D10). Additive and LOW priority:
  // extras never displace the mode's primary source, they only make the claim →
  // source intersection non-empty for documents the mode actually holds.
  const extra = (req.extraAllowedSourceTypes ?? [])
    .filter((s) => !policy.allowedSourceTypes.includes(s));
  if (extra.length) {
    policy = { ...policy, allowedSourceTypes: [...policy.allowedSourceTypes, ...extra] };
  }

  const q = resolveQuestion(req);

  const cls = classifyTurn({
    resolvedQuestion: q.resolved,
    policy,
    isFollowUp: Boolean(req.isFollowUp),
    hasScreenContext: req.hasScreenContext,
    hasAttachedDocuments: req.hasAttachedDocuments,
    attachedFileNames: req.attachedFileNames,
  });

  const optional = policy.allowedSourceTypes.filter((s) => !cls.requiredSourceTypes.includes(s));

  const retrievalPlan: RetrievalPlan = {
    path: cls.path,
    shouldRetrieve: cls.shouldRetrieve,
    // When no claim named a source, retrieval used to fan out to EVERY allowed
    // type — "Reverse a linked list in Python" retrieved six résumé/JD chunks
    // (deep-run 2, issue 5). An unclaimed retrieval consults document pools
    // only; identity pools (résumé/JD/profile) are reachable solely through
    // claims that name them.
    sourceTypes: cls.shouldRetrieve
      ? (cls.requiredSourceTypes.length
        ? cls.requiredSourceTypes
        : policy.allowedSourceTypes.filter((s) =>
          s === 'REFERENCE_FILE' || s === 'PROJECT_FILE' || s === 'CODING_SAMPLE' || s === 'MEETING_TRANSCRIPT'))
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
/** Which complete-record category may term-free-support each claim class.
 *  Absent entries (USER_MOTIVATION, MEETING_*, DOCUMENT_FACT…) get no
 *  shortcut at all — only term overlap. */
const INVENTORY_CATEGORY_FOR_CLAIM: Record<string, string> = {
  USER_SKILL: 'skills',
  USER_EMPLOYMENT: 'experience',
  USER_PROJECT: 'projects',
  USER_EDUCATION: 'education',
  JOB_REQUIRED_SKILL: 'requirements',
  JOB_PREFERRED_SKILL: 'nice_to_haves',
};

/**
 * Ordered variant of salientTerms — the property extractor needs POSITION
 * (English noun phrases are head-final), which a Set cannot give it.
 */
const salientTermList = (text: string): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of String(text).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)) {
    if (raw.length <= 2 || STOPWORDS.has(raw)) continue;
    const t = raw.length > 4 ? stem(raw) : raw;
    if (STOPWORDS.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
};

/**
 * The PROPERTY a clause requests — its head noun(s) (deep-test D6, 2026-08-01).
 *
 * "What backend framework is explicitly documented?" requests a FRAMEWORK.
 * Single-shared-term support let any chunk containing "backend" report FULL
 * while the answer claimed nothing was documented — a confident trace over
 * unsupporting evidence. English noun phrases are head-final, so after
 * stripping the locative tail ("…in the dossier") and the trailing
 * verb phrase ("…is explicitly documented"), the last salient term is the
 * property, and coordinated siblings ("the RTO and RPO") are alternatives.
 */
export function propertyHeadTerms(clause: string): string[] {
  let q = String(clause).toLowerCase().replace(/[?!.]+\s*$/, '');
  q = q.replace(/\s*\((?:referring to|follow-up to|rephrasing request)[^)]*\)\s*$/, '');
  // trailing locatives: "in the dossier", "written in this resume", "from the file"
  let prev;
  do {
    prev = q;
    q = q.replace(/\s+(?:written|stated|listed|recorded|documented|mentioned)?\s*\b(?:in|from|per|inside|within|on)\s+(?:the|this|that|our|its|my|your)\s+[\w-]+\s*$/, '');
  } while (q !== prev);
  // trailing predicate: "is explicitly documented", "are configured", "was used"
  q = q.replace(/\s+(?:is|are|was|were)\s+(?:\w+ly\s+)?(?:documented|used|configured|listed|stated|mentioned|recorded|defined|specified|required|described)\s*$/, '');
  const terms = salientTermList(q);
  if (!terms.length) return [];
  const heads = [terms[terms.length - 1]];
  // Coordination at the tail: "the RTO and RPO" — both are requested; evidence
  // for either is evidence for the property.
  const m = q.match(/([\w-]+)(?:\s*,\s*|\s+and\s+|\s+or\s+)([\w-]+)\s*$/);
  if (m) {
    for (const w of [m[1], m[2]]) {
      const t = w.length > 4 ? stem(w) : w;
      if (t.length > 2 && !STOPWORDS.has(t) && !heads.includes(t)) heads.push(t);
    }
  }
  return heads;
}

/** Weak topical overlap — ANY shared salient term. Enough to say the evidence
 *  is about the right neighbourhood, never enough to report FULL (D6). */
function evidenceTopicallyRelated(
  evidence: { content: string },
  question: string,
): boolean {
  const qTerms = salientTerms(question);
  if (qTerms.size === 0) return true;
  const eTerms = salientTerms(evidence.content);
  for (const t of qTerms) if (eTerms.has(t)) return true;
  return false;
}

export function evidenceSupportsClaim(
  evidence: { acceptedFor: string[]; content: string; metadata?: Record<string, unknown> },
  claimType: string,
  question: string,
): boolean {
  if (!evidence.acceptedFor.includes(claimType)) return false;
  // AUTHORITATIVE ABSENCE: an item its port declares to be the COMPLETE
  // extracted record of a category (the whole skills inventory, the whole
  // employment list) supports the MATCHING claim class, term overlap or not —
  // the correct grounded answer may be that the asked-about thing is NOT in
  // it, and "Do I have Kubernetes experience?" shares no term with a skills
  // list that (correctly) lacks Kubernetes. Term matching would report NONE
  // for exactly the questions where the evidence proves the answer.
  //
  // CATEGORY-MATCHED, not merely authority-matched (review finding,
  // 2026-07-31): acceptedFor covers every claim the SOURCE TYPE is
  // authoritative for, so a category-blind shortcut let the complete
  // employment list "support" a certifications question and the JD keyword
  // list "support" a requirements question — manufacturing confidently-wrong
  // grounded negatives, the exact failure class this feature exists to remove.
  // Authority is still enforced above: a JD list can never support USER_*.
  if (evidence.metadata?.completeInventory === true
      && evidence.metadata?.inventoryCategory === INVENTORY_CATEGORY_FOR_CLAIM[claimType]) {
    return true;
  }
  // PROPERTY-SPECIFIC support (deep-test D6, 2026-08-01): the requested head
  // noun must appear in the evidence, not merely ANY shared word. One generic
  // shared term ("backend") let a chunk about on-call rotations fully support
  // a framework question — FULL answerability while the model rightly said
  // nothing was documented, i.e. a telemetry lie in the confident direction.
  const heads = propertyHeadTerms(question);
  if (heads.length === 0) return true;         // nothing to match on — do not block
  const eTerms = salientTerms(evidence.content);
  const headMatched = heads.some((t) => eTerms.has(t));
  if (!headMatched) return false;

  // QUALIFIED value heads (deep-run 2, issue 7): "the CSV canary" matched the
  // security canary — the bare head satisfied every sibling value of the same
  // kind. For countable/config-like value nouns (canary, limit, price, …) a
  // qualifier the question states must also appear, in the evidence text or
  // its source identity ("05_competitor_matrix.csv" satisfies "csv").
  // Descriptive heads ("framework", "process") keep head-only matching —
  // their qualifiers ("backend framework") are often absent from a correct
  // answer chunk ("Frameworks: FastAPI").
  if (VALUE_HEAD_RE.test(heads[0])) {
    const quals = propertyQualifierTerms(question);
    if (quals.length > 0) {
      const identity = salientTerms(
        `${(evidence as { documentTitle?: string }).documentTitle ?? ''} ${(evidence as { section?: string }).section ?? ''}`,
      );
      const qualMatched = quals.some((t) => eTerms.has(t) || identity.has(t));
      if (!qualMatched) return false;
    }
  }
  return true;
}

/** Countable/config-like value nouns where sibling values abound and a bare
 *  head match is meaningless without its qualifier. Generic vocabulary — not
 *  fixture-derived. */
const VALUE_HEAD_RE = /^(canar\w*|limits?|prices?|pricing|costs?|ids?|keys?|tokens?|thresholds?|weights?|counts?|sizes?|rates?|seats?|quotas?|budgets?|versions?|values?|numbers?|totals?|c?gpas?|scores?)$/;

/** Temporal/deictic modifiers are not distinguishing qualifiers. */
const NON_QUALIFIER = new Set(['current', 'activ', 'latest', 'default', 'exact', 'effectiv', 'today', 'new', 'the']);

/**
 * The distinguishing modifiers preceding the requested head noun — "CSV" in
 * "the CSV canary", "business plan" in "the Business plan seat limit".
 */
export function propertyQualifierTerms(clause: string): string[] {
  const heads = propertyHeadTerms(clause);
  if (!heads.length) return [];
  let q = String(clause).toLowerCase().replace(/[?!.]+\s*$/, '');
  q = q.replace(/\s*\((?:referring to|follow-up to|rephrasing request)[^)]*\)\s*$/, '');
  let prev;
  do {
    prev = q;
    q = q.replace(/\s+(?:written|stated|listed|recorded|documented|mentioned)?\s*\b(?:in|from|per|inside|within|on)\s+(?:the|this|that|our|its|my|your)\s+[\w-]+\s*$/, '');
  } while (q !== prev);
  const terms = salientTermList(q);
  const headIdx = terms.lastIndexOf(heads[0]);
  if (headIdx <= 0) return [];
  return terms.slice(Math.max(0, headIdx - 2), headIdx)
    .filter((t) => !NON_QUALIFIER.has(t) && !heads.includes(t));
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
    // IMPOSSIBLE-STATE invariant (deep-run 2, issue 6): a turn that produced
    // NO claims at all, was NOT recognised as a general/coding question, and
    // holds zero evidence must not report FULL — that exact combination
    // ("Give one tailored interview question", "How long did the incident
    // last?") is what licensed confident fabrication with a clean trace.
    // Genuine general questions carry a GENERAL/CODING/SYSTEM_DESIGN type and
    // keep FULL.
    const generalish = decision.questionTypes.some((t) =>
      t === 'GENERAL_TECHNICAL' || t === 'CODING_TASK' || t === 'SYSTEM_DESIGN' || t === 'META_REQUEST');
    if (!generalish && decision.claimRequirements.length === 0 && evidence.length === 0
        && decision.retrievalPlan.path !== 'FAST') {
      return 'NONE';
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
  //
  // The conjunction applies ONLY to claims whose authoritative source the turn
  // actually PLANS. A claim no planned source can ever satisfy (JOB vocabulary
  // in team-meet, which authorizes no JD at all) folds back into the base
  // family as an alternative — otherwise a fully-answered meeting question
  // that merely contains the word "required" reports structural PARTIAL
  // forever (review finding, 2026-07-31). Disclosure for genuinely
  // unreachable sources belongs to the unsupported-in-mode machinery, not to
  // answerability.
  const plannedTypes = new Set<string>(decision.retrievalPlan.sourceTypes as readonly string[]);
  const plannable = (req: ClaimRequirement): boolean =>
    (req.authoritativeSources ?? []).some((s) => plannedTypes.has(s));
  const family = (req: ClaimRequirement): string =>
    plannable(req) && String(req.claimType).startsWith('JOB_') ? 'job' : 'user';
  const bySubject = new Map<string, typeof required>();
  for (const req of required) {
    const subject = `${req.subject ?? decision.resolvedQuestion} ${family(req)}`;
    if (!bySubject.has(subject)) bySubject.set(subject, []);
    bySubject.get(subject)!.push(req);
  }

  let supported = 0;
  let weaklySupported = 0;
  for (const [, reqs] of bySubject) {
    // Term-match against the CLEAN clause, not the grouping key — the family
    // suffix is a bucket label, and letting it into salientTerms would hand
    // every user-side group a free "user" term to match on.
    const ok = reqs.some((req) => evidence.some(
      (e) => evidenceSupportsClaim(e, req.claimType, req.subject ?? decision.resolvedQuestion),
    ));
    if (ok) { supported++; continue; }
    // Topically-related-but-property-missing evidence (deep-test D6): the right
    // document neighbourhood was retrieved but the requested value is not
    // provably in it. That is PARTIAL — never FULL (the old single-shared-term
    // rule), and not NONE either (the evidence may still contain the answer
    // under different vocabulary; the composer directs an honest answer).
    const weak = reqs.some((req) => evidence.some(
      (e) => e.acceptedFor.includes(req.claimType)
        && evidenceTopicallyRelated(e, req.subject ?? decision.resolvedQuestion),
    ));
    if (weak) weaklySupported++;
  }
  if (supported === 0 && weaklySupported === 0) return 'NONE';
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
  let referentWasResolved = false;
  // Observability snapshot of the resolver's decision + the state it saw
  // (context-debug logging). Captured BEFORE this turn advances the state.
  let referentResolution: AnswerTrace['referentResolution'];
  // The PRE-resolution question. decision.rawQuestion is derived from
  // effectiveReq, which the rewrite below may have already changed — logging
  // that as "original" hid every resolver decision from the telemetry.
  const originalQuestion = (req.manualQuestion ?? req.transcriptQuestion ?? '').trim();
  let priorDecision: import('../contracts/types').PriorTurnDecision | undefined;
  try {
    const { resolveAgainstSession, getConversationState } = require('../question/conversation-state-store');
    const rawQ = originalQuestion;
    if (rawQ) {
      const priorState = getConversationState(req.sessionId);
      priorDecision = priorState?.previousDecision;
      const ref = resolveAgainstSession(req.sessionId, rawQ);
      referentResolution = {
        applied: Boolean(ref.usedState && ref.resolved !== rawQ),
        ...(ref.referent ? { referent: ref.referent } : {}),
        ...(ref.reason ? { reason: ref.reason } : {}),
        ...(priorState?.activePerson ? { activePerson: priorState.activePerson } : {}),
        ...(priorState?.activeTopic ? { activeTopic: priorState.activeTopic } : {}),
        ...(priorState?.previousQuestion ? { previousQuestion: priorState.previousQuestion } : {}),
      };
      if (ref.usedState && ref.resolved !== rawQ) {
        referentWasResolved = true;
        effectiveReq = req.manualQuestion
          ? { ...req, manualQuestion: ref.resolved, isFollowUp: true }
          : { ...req, transcriptQuestion: ref.resolved, isFollowUp: true };
      }
    }
  } catch { /* continuity must never break a turn */ }

  let decision = decide(effectiveReq);

  // Precedence follow-up (live turns 18/92, 2026-08-01): "Why did you ignore
  // the other values?" / "Why are the lower values not current?" ask about the
  // PREVIOUS turn's source decision, which this turn's own retrieval cannot
  // reproduce — one live answer confabulated a rationale, the other refused.
  // Deterministic detection, no LLM: a why/explain shape naming displaced
  // values or the precedence mechanism itself, gated on a recorded decision
  // actually existing for this session. The record is attached for the
  // COMPOSER to render; routing and retrieval are unchanged by it.
  const PRECEDENCE_WHY_RE = /\b(?:why\b[\s\S]*\b(?:ignor\w+|other|lower|higher|old(?:er)?|previous|earlier|retired|archived|superseded|legacy|outdated|not\s+current)\b|source[-\s]?precedence)\b/i;
  if (priorDecision && PRECEDENCE_WHY_RE.test(originalQuestion)) {
    decision = Object.freeze({ ...decision, precedenceHistory: priorDecision });
  }

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
  // `!referentWasResolved` added 2026-08-01 (Defect D): resolution appends only
  // three tokens ("(referring to: X)"), so a two-word follow-up stays under the
  // bare-follow-up word cap even after a SUCCESSFUL resolution — the cap's
  // "self-disables once resolution is wired" note was false for exactly the
  // short follow-ups the cap exists for. Success is now tracked explicitly.
  const referentUnresolved = decision.isFollowUp && !referentWasResolved
    && isBareFollowUp(decision.resolvedQuestion);

  // Label accuracy (deep-run 2, issue 14): a DOCUMENT-SPECIFIC question whose
  // evidence came back empty/unsupporting is a document retrieval miss, not a
  // general-knowledge answer — labelling it GENERAL_KNOWLEDGE hid every
  // retrieval failure behind the healthy-looking label.
  const documentSpecificTurn = decision.claimRequirements
    .some((c) => c.authority === 'PRIVATE_SOURCE_REQUIRED');
  const fallbackUsed =
    answerability === 'FULL' ? 'NONE'
      : answerability === 'CONFLICTING' ? 'CONFLICT'
        : referentUnresolved ? (answerability === 'PARTIAL' ? 'PARTIAL_SUPPORT' : 'CLARIFICATION')
          : answerability === 'PARTIAL' ? 'PARTIAL_SUPPORT'
            : unsupportedInMode ? 'STRICT_NOT_FOUND'
              : documentSpecificTurn && decision.generalKnowledgeAllowed ? 'DOCUMENT_FACT_NOT_FOUND'
                : decision.generalKnowledgeAllowed ? 'GENERAL_KNOWLEDGE' : 'STRICT_NOT_FOUND';

  const trace: AnswerTrace = {
    requestId: decision.requestId,
    requestSequence: decision.requestSequence,
    scope: decision.scope,
    surface: req.surface,
    originalQuestion: originalQuestion || decision.rawQuestion,
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
      // Same support definition answerability uses (deep-test D6): the trace
      // used to carry a SECOND, authority-only notion here, so one object could
      // say DIRECT_EVIDENCE and NONE about the same claim.
      support: evidence.some((e) => evidenceSupportsClaim(e, c.claimType, c.subject ?? decision.resolvedQuestion))
        ? 'DIRECT_EVIDENCE'
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
    ...(referentResolution ? { referentResolution } : {}),
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

    // Record this turn's source-precedence outcome (Pattern F). Derived from
    // NON-debug-gated inputs only — evidence metadata and the port's rejection
    // records — never from the debug collector, whose inputs are level-gated
    // and must not influence answers. Only turns that actually retrieved
    // produce a record; FAST turns preserve the previous one.
    let turnDecision: import('../contracts/types').PriorTurnDecision | undefined;
    if (evidence.length > 0 || attempts.some((a) => (a.rejections?.length ?? 0) > 0)) {
      const statusOf = (m: unknown) => {
        const s = (m as Record<string, unknown> | undefined)?.documentStatus;
        return typeof s === 'string' ? s : undefined;
      };
      const selected = new Map<string, import('../contracts/types').PriorSourceDecision>();
      for (const e of evidence) {
        if (selected.has(e.sourceId)) continue;
        selected.set(e.sourceId, {
          sourceId: e.sourceId,
          ...(e.documentTitle ? { sourceName: e.documentTitle } : {}),
          ...(statusOf(e.metadata) ? { status: statusOf(e.metadata) } : {}),
        });
      }
      const ignored = new Map<string, import('../contracts/types').PriorSourceDecision>();
      for (const a of attempts) {
        for (const r of a.rejections ?? []) {
          if (selected.has(r.sourceId) || ignored.has(r.sourceId)) continue;
          ignored.set(r.sourceId, {
            sourceId: r.sourceId,
            ...(r.documentTitle ? { sourceName: r.documentTitle } : {}),
            ...(r.documentStatus ? { status: r.documentStatus } : {}),
            reason: r.reason,
          });
        }
      }
      const RETIRED_CLASS = new Set(['retired', 'deprecated', 'archived', 'superseded', 'legacy', 'obsolete']);
      const selectedRetired = [...selected.values()].some((s) => s.status && RETIRED_CLASS.has(s.status));
      const ignoredRetired = [...ignored.values()].some((s) => s.status && RETIRED_CLASS.has(s.status));
      turnDecision = {
        question: originalQuestion || decision.resolvedQuestion,
        selectedSources: [...selected.values()],
        ignoredSources: [...ignored.values()],
        ...(ignoredRetired && !selectedRetired
          ? { precedenceReason: 'RETIRED_SOURCES_RANKED_BELOW_CURRENT' }
          : selectedRetired
            ? { precedenceReason: 'HISTORICAL_SOURCE_EXPLICITLY_REQUESTED' }
            : {}),
      };
    }

    advanceConversationState({
      sessionId: req.sessionId,
      scope: decision.scope,
      // The ORIGINAL question, never the referent-rewritten one (deep-test D9):
      // advancing with "… (referring to: X)" re-ingested X as an entity every
      // turn, so one wrong referent outranked every fresh entity and the drift
      // was self-reinforcing.
      question: originalQuestion || decision.resolvedQuestion,
      evidenceIds: evidence.map((e) => e.evidenceId),
      sourceIds: [...new Set(evidence.map((e) => e.sourceId))],
      decision: turnDecision,
    });
  } catch { /* continuity must never break a turn */ }

  return { decision, evidence, answerability, trace };
}
