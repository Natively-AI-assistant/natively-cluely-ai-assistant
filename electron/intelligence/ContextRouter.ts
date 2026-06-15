// electron/intelligence/ContextRouter.ts
//
// Spec Phase 8 — the single, queryable Context Router. The spec wants ONE router
// that takes {userQuery, mode, sessionId, …} and returns a structured decision:
//   { useProfileTree, useLiveTranscript, useHybridRag, useHindsightRecall,
//     useMeetingSummary, useBrowserDom, useReferenceFiles, answerContract,
//     maxLatencyMs, reason }.
//
// REALITY (from the Phase 0 audit): routing today is CORRECT but SCATTERED across
// planAnswer (AnswerPlanner), decideProfileIntelligence (ProfileIntelligenceRouter),
// streamContextPolicy, and premium KnowledgeOrchestrator. This module does NOT
// replace any of them. It COMPOSES the two deterministic, already-live deciders
// (planAnswer + decideProfileIntelligence) into the spec's output shape, so a caller
// has one consultable, testable decision object. Existing paths can adopt it
// incrementally; nothing is forced to.
//
// It is a PURE decision function (no IO, no LLM, no streaming) and emits an optional
// IntelligenceTrace row for the inclusion report. Hindsight/MeetingMemory are not
// built yet (deferred per plan), but the router still EMITS their decision +
// strict-timeout contract so the integration point is defined and testable.

import { planAnswer, isCodingAnswerType, type AnswerType, type AnswerSource } from '../llm/AnswerPlanner';
import { decideProfileIntelligence, type ProfileIntelligenceDecision } from '../llm/ProfileIntelligenceRouter';
import type { ActiveModeInfo } from '../llm/modeProfiles';
import { beginTrace, type IntelligenceTrace } from './IntelligenceTrace';

export type LatencyMode = 'fast' | 'balanced' | 'deep';

/** The spec's per-answer answer contract (Phase 9). */
export type AnswerContract =
  | 'interview_short'
  | 'interview_detailed'
  | 'coding_answer'
  | 'sales_reply'
  | 'lecture_notes'
  | 'lecture_revision'
  | 'lecture_diagram'
  | 'team_meeting_summary'
  | 'general_assistant';

export interface ContextRouterInput {
  userQuery: string;
  mode?: string;
  sessionId?: string;
  meetingId?: string;
  /** Whether a usable candidate profile is loaded. */
  profileAvailable?: boolean;
  /** Whether a JD is loaded. */
  jdAvailable?: boolean;
  /** Whether reference files are configured for the active mode. */
  referenceFilesAvailable?: boolean;
  /** Whether a live transcript exists for the session. */
  hasLiveTranscript?: boolean;
  /** Whether browser DOM page context is attached. */
  hasBrowserDom?: boolean;
  source?: AnswerSource;
  latencyMode?: LatencyMode;
}

export interface ContextRouterDecision {
  useProfileTree: boolean;
  useLiveTranscript: boolean;
  useHybridRag: boolean;
  useHindsightRecall: boolean;
  useMeetingSummary: boolean;
  useBrowserDom: boolean;
  useReferenceFiles: boolean;
  /** Phase 6/14 — pull cross-lecture / course memory (lecture mode recall asks). */
  useLectureMemory: boolean;
  /** Phase 6/15 — engage diagram generation for diagram-worthy lecture asks. */
  useDiagramIntelligence: boolean;
  answerContract: AnswerContract;
  maxLatencyMs: number;
  /** Strict timeout for any OPTIONAL long-term-memory recall (Hindsight), ms. The
   *  spec mandates 300–800ms in live mode so memory can never block a live answer. */
  hindsightRecallTimeoutMs: number;
  reason: string;
  // Pass-through of the underlying deterministic decisions for callers/audits.
  answerType: AnswerType;
  profileContextPolicy: ProfileIntelligenceDecision['profileContextPolicy'];
}

// Questions that look backward at prior meetings/conversations → long-term memory
// territory (Hindsight + MeetingMemory + GlobalSearch when they exist).
// Tightened 2026-06-14: bare tokens (`earlier`/`before`/`history`/`recurring`) used to
// over-trigger recall on unrelated prose ("explain BFS before recursion", "browser
// history"). They now require a meeting/conversation/discussion anchor nearby, so only a
// genuinely backward-looking ASK fires the (gated, timeout-bounded) Hindsight recall.
const RECALL_RE = /\b(last (time|meeting|call|session)|previous (meeting|call|session|conversation|discussion|time)|(earlier|before)\s+(meeting|call|session|conversation|we (?:discuss|talk|spoke|met|covered))|past (meetings?|calls?|sessions?|conversations?)|recurring (topic|theme|issue|question|pattern)|we (discuss|discussed|talked|spoke) (about|on)|did (we|they|i) (discuss|talk|cover|say|mention)|summari[sz]e (all|our|the|my)( (previous|past|recent|prior|last))? (meetings?|calls?|sessions?|conversations?)|what did .* (say|ask|mention) (about|last|before|earlier)|came up (in|before|earlier|previously)|prior (call|meeting|interview|session|conversation))\b/i;

/**
 * Is this question backward-looking — i.e. asking about PRIOR meetings/conversations
 * ("what did we discuss last time", "did we cover X before", "previous call")? Used to
 * gate long-term-memory (Hindsight) recall so it ONLY fires for genuinely backward asks
 * and adds zero latency to normal/coding/identity questions. Independent of any flag, so
 * the live-recall path can use it without depending on contextRouterV2. Never throws.
 */
export function isBackwardLookingQuery(query: string): boolean {
  try {
    RECALL_RE.lastIndex = 0;
    return typeof query === 'string' && RECALL_RE.test(query);
  } catch {
    return false;
  }
}

// In-meeting "search current meeting for X" — local-first, not long-term memory.
const IN_MEETING_SEARCH_RE = /\b(search (this|the current|current) (meeting|call|transcript)|find (where|when) .* (mention|said|asked)|in this (meeting|call|transcript))\b/i;

// Diagram-worthy asks ("generate/draw/create a diagram/flowchart/sequence/…").
const DIAGRAM_RE = /\b(diagram|flow ?chart|sequence diagram|state (machine|diagram)|class diagram|mind ?map|concept map|er diagram|architecture diagram|draw (me )?(a|the)|visuali[sz]e|sketch (a|the))\b/i;

// Cross-lecture / course recall ("which lecture mentioned…", "revision plan", "last lecture").
const LECTURE_RECALL_RE = /\b(which lecture|last lecture|previous lecture|across (all )?lectures|course (memory|so far)|revision (plan|notes|checklist)|flash ?cards?|exam questions?|what did we cover|weak (concepts?|topics?))\b/i;

// Mode template ids planAnswer/decideProfileIntelligence accept as a routing prior.
const MODE_TEMPLATE_TYPES = new Set([
  'general', 'looking-for-work', 'sales', 'recruiting', 'team-meet', 'lecture', 'technical-interview',
]);

/** Normalize a mode-id string into the ActiveModeInfo planAnswer expects (or null). */
function toActiveModeInfo(mode?: string): ActiveModeInfo | null {
  const id = (mode || '').trim();
  if (!id || !MODE_TEMPLATE_TYPES.has(id)) return null;
  return { id, templateType: id as ActiveModeInfo['templateType'], name: id, isCustom: false };
}

// `templateType` is the NORMALIZED mode template id (from activeModeInfo), not the
// raw input.mode string — so the contract decision can't disagree with the planner
// over what "team-meet" means (code-review 2026-06-12 MEDIUM: a raw 'Team-Meet' /
// 'team_meet' would silently miss the team_meeting_summary contract).
function answerContractFor(answerType: AnswerType, templateType?: string): AnswerContract {
  // All technical types are coding-shaped (Approach/DS/Code/Dry-run/Complexity/
  // Edge-cases). isCodingAnswerType only covers coding/dsa, so cover the rest here.
  if (
    isCodingAnswerType(answerType) ||
    answerType === 'technical_concept_answer' ||
    answerType === 'system_design_answer' ||
    answerType === 'debugging_question_answer' ||
    answerType === 'source_code_evidence_answer'
  ) {
    return 'coding_answer';
  }
  switch (answerType) {
    case 'sales_answer':
    case 'product_candidate_mix_answer':
      return 'sales_reply';
    case 'lecture_answer':
      return 'lecture_notes';
    case 'general_meeting_answer':
      return templateType === 'team-meet' ? 'team_meeting_summary' : 'general_assistant';
    case 'identity_answer':
    case 'profile_fact_answer':
    case 'skills_answer':
    case 'skill_experience_answer':
      return 'interview_short';
    // A follow-up to a profile/interview answer inherits the detailed-interview
    // contract; a follow-up in a non-interview mode falls to general below.
    case 'follow_up_answer':
      return templateType === 'technical-interview' || templateType === 'looking-for-work'
        ? 'interview_detailed' : 'general_assistant';
    case 'project_answer':
    case 'project_followup_answer':
    case 'experience_answer':
    case 'jd_fit_answer':
    case 'behavioral_interview_answer':
    case 'gap_analysis_answer':
    case 'negotiation_answer':
      return 'interview_detailed';
    default:
      return 'general_assistant';
  }
}

/**
 * Compute the consolidated context-routing decision. Pure + deterministic. When the
 * `trace` flag is on, records the decision + an inclusion report row per source.
 */
/**
 * Conservative decision used only when a decider throws (should never happen with
 * the current pure deciders): a general-assistant answer that pulls nothing except
 * the live transcript on a live surface. Safe by construction — no profile, no RAG,
 * no Hindsight, generous latency budget.
 */
function fallbackDecision(
  input: ContextRouterInput,
  source: AnswerSource,
  t: IntelligenceTrace,
): ContextRouterDecision {
  const liveSurface = source === 'what_to_answer' || source === 'transcript';
  const decision: ContextRouterDecision = {
    useProfileTree: false,
    useLiveTranscript: Boolean(input.hasLiveTranscript) && liveSurface,
    useHybridRag: false,
    useHindsightRecall: false,
    useMeetingSummary: false,
    useBrowserDom: false,
    useReferenceFiles: false,
    useLectureMemory: false,
    useDiagramIntelligence: false,
    answerContract: 'general_assistant',
    maxLatencyMs: 2500,
    hindsightRecallTimeoutMs: 800,
    reason: 'fallback:decider_error',
    answerType: 'general_meeting_answer',
    profileContextPolicy: 'forbidden',
  };
  try { t.setRouting({ source, answerType: decision.answerType, answerContract: decision.answerContract, routerDecision: { fallback: true } }); } catch { /* ignore */ }
  return decision;
}

export function routeContext(
  input: ContextRouterInput,
  trace?: IntelligenceTrace | null,
): ContextRouterDecision {
  const t = trace ?? beginTrace(input.userQuery);

  const source: AnswerSource = input.source ?? 'manual_input';
  const activeModeInfo = toActiveModeInfo(input.mode);

  // The two deciders are pure today, but they're large and outside this slice's
  // control. Wrap them so a future regression in either can NEVER throw out of a
  // facade and break a consulting caller — the never-break-a-caller contract holds
  // even if a decider regresses. On failure, return the conservative fallback
  // decision (general assistant; nothing pulled but the live transcript on a live
  // surface) and record the error on the trace. (code-review 2026-06-12 MEDIUM)
  let plan: ReturnType<typeof planAnswer>;
  let profileDecision: ProfileIntelligenceDecision;
  try {
    plan = planAnswer({
      question: input.userQuery,
      source,
      activeMode: activeModeInfo,
      hasCandidateProfile: input.profileAvailable,
      hasJobDescription: input.jdAvailable,
    });
    profileDecision = decideProfileIntelligence({
      question: input.userQuery,
      source,
      activeMode: input.mode,
      activeModeInfo,
      profileAvailable: input.profileAvailable,
      jdAvailable: input.jdAvailable,
    });
  } catch (e) {
    try { t.noteError(`router_decider_threw:${e instanceof Error ? e.name : 'unknown'}`); } catch { /* ignore */ }
    return fallbackDecision(input, source, t);
  }

  const answerType = plan.answerType;
  const required = new Set(plan.requiredContextLayers);
  const forbidden = new Set(plan.forbiddenContextLayers);

  // PROFILE TREE: use when the deterministic profile decider says so AND the plan's
  // hard policy isn't `forbidden` (coding/technical/sales/lecture get NO profile).
  const useProfileTree =
    profileDecision.profileContextPolicy !== 'forbidden' &&
    profileDecision.shouldUseProfile &&
    Boolean(input.profileAvailable);

  // LIVE TRANSCRIPT: required layer, or any live-surface source, when a transcript exists.
  const liveSurface = source === 'what_to_answer' || source === 'transcript';
  const useLiveTranscript =
    Boolean(input.hasLiveTranscript) &&
    !forbidden.has('live_transcript') &&
    (required.has('live_transcript') || liveSurface);

  // REFERENCE FILES: allowed unless the plan forbids them, and only if available.
  const useReferenceFiles =
    Boolean(input.referenceFilesAvailable) &&
    !forbidden.has('reference_files') &&
    (required.has('reference_files') || (!isCodingAnswerType(answerType) && answerType !== 'identity_answer'));

  // BROWSER DOM: only when explicitly attached (it's untrusted, never auto-pulled).
  const useBrowserDom = Boolean(input.hasBrowserDom) && !isCodingAnswerType(answerType);

  // Backward-looking recall → long-term memory + meeting summaries + (future) Hindsight.
  const isRecallQuery = RECALL_RE.test(input.userQuery);
  const isInMeetingSearch = IN_MEETING_SEARCH_RE.test(input.userQuery);

  const useMeetingSummary = isRecallQuery;
  // Hindsight is for cross-meeting recall — never for identity/profile/coding (the
  // spec's "do not use Hindsight first for" list). It's a DECISION only here; no
  // client is built yet (deferred), but the integration point is defined.
  const useHindsightRecall =
    isRecallQuery &&
    !isInMeetingSearch &&
    profileDecision.profileContextPolicy !== 'required' &&
    !isCodingAnswerType(answerType);

  // HYBRID RAG: in-meeting search, JD-fit evidence, or backward recall. Not for a
  // pure identity/name ask (ProfileTree answers those deterministically).
  const useHybridRag =
    isInMeetingSearch ||
    isRecallQuery ||
    answerType === 'jd_fit_answer' ||
    answerType === 'source_code_evidence_answer';

  // LECTURE / DIAGRAM (Phase 6 V2): only meaningful in lecture mode.
  const lectureMode = activeModeInfo?.templateType === 'lecture' || answerType === 'lecture_answer';
  // Diagram intelligence: an explicit diagram-worthy ask in a lecture context.
  const useDiagramIntelligence = DIAGRAM_RE.test(input.userQuery) && lectureMode;
  // Lecture memory: cross-lecture/course recall asks ("which lecture mentioned X",
  // "revision plan", "last lecture") in lecture mode.
  const useLectureMemory = lectureMode && LECTURE_RECALL_RE.test(input.userQuery);

  // Latency budget — the plan already computes a first-useful budget; widen for
  // explicit deep recall, tighten for fast mode.
  let maxLatencyMs = plan.maxFirstUsefulTokenMs || 1800;
  if (isRecallQuery || isInMeetingSearch || useLectureMemory) maxLatencyMs = Math.max(maxLatencyMs, 3000);
  if (input.latencyMode === 'fast') maxLatencyMs = Math.min(maxLatencyMs, 1200);
  if (input.latencyMode === 'deep') maxLatencyMs = Math.max(maxLatencyMs, 5000);

  const answerContract = answerContractFor(answerType, activeModeInfo?.templateType);

  const reasonParts: string[] = [`answerType=${answerType}`, `policy=${profileDecision.profileContextPolicy}`];
  if (useProfileTree) reasonParts.push('profileTree');
  if (useLiveTranscript) reasonParts.push('liveTranscript');
  if (useHybridRag) reasonParts.push('hybridRag');
  if (useHindsightRecall) reasonParts.push('hindsight');
  if (useMeetingSummary) reasonParts.push('meetingSummary');
  if (useReferenceFiles) reasonParts.push('referenceFiles');
  if (useBrowserDom) reasonParts.push('browserDom');
  if (useLectureMemory) reasonParts.push('lectureMemory');
  if (useDiagramIntelligence) reasonParts.push('diagram');
  const reason = reasonParts.join(' ');

  const decision: ContextRouterDecision = {
    useProfileTree,
    useLiveTranscript,
    useHybridRag,
    useHindsightRecall,
    useMeetingSummary,
    useBrowserDom,
    useReferenceFiles,
    useLectureMemory,
    useDiagramIntelligence,
    answerContract,
    maxLatencyMs,
    // Strict live recall timeout (spec: 300–800ms live). Deep mode allows the
    // global-search budget (up to 5s) since it's an explicit slow path.
    hindsightRecallTimeoutMs: input.latencyMode === 'deep' ? 3000 : 800,
    reason,
    answerType,
    profileContextPolicy: profileDecision.profileContextPolicy,
  };

  // Trace: router decision + one inclusion-report row per source.
  try {
    t.setRouting({
      mode: input.mode,
      source,
      answerType,
      answerContract,
      routerDecision: {
        useProfileTree, useLiveTranscript, useHybridRag, useHindsightRecall,
        useMeetingSummary, useBrowserDom, useReferenceFiles, useLectureMemory,
        useDiagramIntelligence, maxLatencyMs,
      },
    });
    const rows: Array<[string, boolean, string]> = [
      ['profile_tree', useProfileTree, 'high'],
      ['live_transcript', useLiveTranscript, 'low'],
      ['hybrid_rag', useHybridRag, 'medium'],
      ['hindsight_memory', useHindsightRecall, 'medium'],
      ['meeting_summary', useMeetingSummary, 'medium'],
      ['reference_files', useReferenceFiles, 'low'],
      ['browser_dom', useBrowserDom, 'low'],
      ['lecture_memory', useLectureMemory, 'medium'],
      ['diagram_intelligence', useDiagramIntelligence, 'medium'],
    ];
    for (const [src, requested, trust] of rows) {
      t.noteContext({ source: src, trustLevel: trust, requested, retrieved: requested, included: requested, reason });
    }
  } catch { /* trace must never break routing */ }

  return decision;
}
