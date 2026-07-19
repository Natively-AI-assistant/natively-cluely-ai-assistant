// electron/llm/TurnPlanner.ts
//
// Campaign-3 (fix/answer-policy-engine) — THE single, pure, deterministic
// per-turn decision site consumed by every answer surface (manual chat, WTA,
// phone mirror, recap/follow-up, meeting summary).
//
// Architecture (Campaign 3 §2):
//   1. ONE decision per turn — no more "dual brains". ProfileIntelligence's
//      answerType classifier and KnowledgeOrchestrator's intent classifier
//      are SIGNALS INTO the TurnPlanner; neither may independently gate
//      sources anymore.
//   2. The TurnPlanner emits a single TurnPlan containing:
//        - question_kind    (doc_question | profile_question | jd_question |
//                            coding_question | general | meta)
//        - evidence_sources_to_probe  (ordered: where to look)
//        - grounding_profile          (per-mode: strictness)
//        - answer_directives          (how to phrase, what to label)
//        - source_authority_signal    (from turnSourceDecision; the planner
//          does NOT re-derive authority — it consumes the canonical decision)
//   3. Source contracts / ContextOS contracts are GENERATED FROM the TurnPlan
//      (one writer). Contracts become enforced-but-graceful: evidence found
//      → must be used and attributed; evidence absent → general-knowledge
//      answer with a visible "General knowledge" label — never a refusal
//      outside `refuse` profiles; never an answerless response.
//
// PURE: no LLMHelper, no SessionTracker, no DB. No Date.now() / randomness.
// Identity is taken from inputs only. Fully testable.
//
// Build order (Campaign 3 §3): this module is build step 1. Wiring into
// each answer surface is incremental — until then, planTurn() is consulted
// as a signal that downstream code (planAnswer, ContextRouter, buildContextRoute)
// can opt into without changing their public shape.
//
// --- ANTI-THRASH LEDGER (do not re-litigate in future iterations) ---
//   - modeSourceContract.ts:169-171 `profile_only` default for interview-prep
//     modes is INTENTIONAL (interview-prep is profile-first by design per
//     the file's own comment). The Campaign-3 fix is NOT to delete it; it is
//     to make the TurnPlan route `question_kind` to evidence sources so that
//     even under `profile_only` the JD-summary / identity questions reach
//     their evidence. See "before" trace: C3M-003 (JD requirements) passes
//     while C3M-002 (JD summary) fails — same authority, different routing.
//   - turnSourceDecision.ts invariant #3 (strict-mode prison → clarify) is
//     CORRECT for compliance-type profiles; only the global safe-refusal
//     phrase "I could not find that in the retrieved sections" must be
//     leashed by `groundingProfile.on_no_evidence`.

import type { ModeSourceAuthority, ModeSourceContract } from '../services/modeSourceContract';
import type { TurnSourceDecision, TurnEvidenceKind } from './turnSourceDecision';

// ── Public types ─────────────────────────────────────────────────────────────

/** Domain of the question — drives evidence-probe ordering and answer shape. */
export type QuestionKind =
  | 'doc_question'        // asks about content of a reference document / deck
  | 'profile_question'    // asks about the candidate (name, history, skills)
  | 'jd_question'         // asks about the JD / target role
  | 'coding_question'     // write / debug / design code
  | 'general';            // none of the above; general-knowledge answer

/** Per-mode strictness profile (Campaign 3 §2.3). */
export type EvidencePreference = 'required' | 'preferred' | 'optional';
export type OnNoEvidence =
  | 'answer_general_labeled'         // default for 7 built-in modes
  | 'say_not_found_then_answer_general'  // Seminar Mode
  | 'refuse';                       // compliance-style custom modes only

export interface GroundingProfile {
  evidencePreference: EvidencePreference;
  onNoEvidence: OnNoEvidence;
  /** How to label sources in the overlay. */
  labelStyle: 'badge' | 'paragraph';
}

export interface TurnPlanInput {
  question: string;
  /** From `planAnswer(...).answerType` (ProfileIntelligence's signal). */
  answerType?: string | null;
  /** From `IntentClassifier` (KnowledgeOrchestrator's signal). */
  intent?: string | null;
  /** From the canonical `resolveTurnSourceDecision(...)`. */
  turnSourceDecision?: TurnSourceDecision | null;
  /** Persisted mode source contract (carries `groundingProfile`). */
  sourceContract?: Pick<ModeSourceContract, 'sourceAuthority'> | null;
  availability: {
    hasReferenceFiles: boolean;
    hasProfileFacts: boolean;
    hasJobDescription: boolean;
    hasLiveTranscript: boolean;
  };
}

export interface TurnPlan {
  question: string;
  questionKind: QuestionKind;
  evidenceSourcesToProbe: TurnEvidenceKind[];
  groundingProfile: GroundingProfile;
  answerDirectives: {
    /** If set, the assembler MUST inject this literal phrase (the candidate's
     *  full name from the resume) immediately before the identity-answer
     *  template. Closes the C3M-001 live-trace failure: the model answered
     *  "I'm Natively, an AI assistant" instead of the candidate name because
     *  CORE_IDENTITY's identity-question rule took precedence over a buried
     *  resume-block mention. */
    candidateIdentityOverride?: string | null;
    /** Visible "General knowledge" label appended to the answer when the
     *  evidence probe returns NONE (or WEAK) and the policy allows general. */
    labelGeneral?: boolean;
    /** Visible "Not in your reference files — from general knowledge:"
     *  preamble used only by Seminar Mode (on_no_evidence =
     *  say_not_found_then_answer_general). */
    seminarNotFoundPreamble?: boolean;
    /** Seeder directive: only seed experience/background nodes when the
     *  question is about the candidate's own background OR the role —
     *  NEVER for salary/negotiation/unroutable asks. */
    seedCandidateBackground: boolean;
  };
  sourceAuthoritySignal: ModeSourceAuthority | null;
  reasonCode: string;
}

// ── Defaults ────────────────────────────────────────────────────────────────

/**
 * Default groundingProfile for the seven built-in modes. Every existing mode
 * (general / sales / recruiting / team-meet / lecture / looking-for-work /
 * technical-interview) gets evidence_preference=preferred and
 * on_no_evidence=answer_general_labeled. NO built-in mode uses `refuse`.
 *
 * Seminar Mode (8th built-in, Campaign 3 §3 step 3) overrides this with
 * `required` / `say_not_found_then_answer_general` via the `Seminar` template.
 */
export const DEFAULT_GROUNDING_PROFILE: GroundingProfile = {
  evidencePreference: 'preferred',
  onNoEvidence: 'answer_general_labeled',
  labelStyle: 'badge',
};

/** Seminar Mode's groundingProfile (Campaign 3 §3 step 3). */
export const SEMINAR_GROUNDING_PROFILE: GroundingProfile = {
  evidencePreference: 'required',
  onNoEvidence: 'say_not_found_then_answer_general',
  labelStyle: 'badge',
};

// ── Question-kind derivation (deterministic, regex/keyword-based) ───────────
//
// This intentionally mirrors the AnswerPlanner answerType taxonomy so a
// downstream consumer reading both fields sees the SAME routing. Mapping table:
//   identity_answer / profile_fact_answer / skills_answer /
//   skill_experience_answer / experience_answer /
//   behavioral_interview_answer          → profile_question
//   jd_summary_answer / jd_requirements_answer / jd_fact_answer /
//   jd_fit_answer / resume_jd_fit_answer /
//   resume_jd_gap_answer /
//   resume_jd_intro_answer              → jd_question
//   coding_question_answer /
//   dsa_question_answer /
//   technical_concept_answer /
//   system_design_answer /
//   debugging_question_answer           → coding_question (or general for
//                                          technical_concept)
//   lecture_answer / definitional_answer /
//   list_answer / document_*_answer      → doc_question
//   everything else                      → general
//
// If `answerType` is absent (legacy caller), the planner falls back to a
// lightweight regex probe against the question text — same shape, no LLM.

const JD_TYPE_SET = new Set([
  'jd_summary_answer',
  'jd_requirements_answer',
  'jd_fact_answer',
  'jd_fit_answer',
  'resume_jd_fit_answer',
  'resume_jd_gap_answer',
  'resume_jd_intro_answer',
]);

const PROFILE_TYPE_SET = new Set([
  'identity_answer',
  'profile_fact_answer',
  'skills_answer',
  'skill_experience_answer',
  'experience_answer',
  'behavioral_interview_answer',
  'project_answer',
  'project_followup_answer',
]);

const DOC_TYPE_SET = new Set([
  'lecture_answer',
  'definitional_answer',
  'list_answer',
  'document_followup_answer',
  'document_absent_fact_refusal',
  'document_list_answer',
  'document_definition_answer',
  'source_code_evidence_answer',
  'project_link_answer',
]);

const CODING_TYPE_SET = new Set([
  'coding_question_answer',
  'dsa_question_answer',
  'system_design_answer',
  'debugging_question_answer',
]);

// Lightweight regex fallback used when `answerType` is not provided. These
// MUST stay in sync with AnswerPlanner's IDENTITY_PATTERNS / JD_*_CUE_RE so
// a route through the planner is equivalent to a route through AnswerPlanner.
const RE_IDENTITY = /\b(what(?:'s| is)?\s+(my|your|his|her)\s+name\b|who\s+am\s+i\b|tell\s+me\s+about\s+yourself\b|introduce\s+(yourself|urself|myself|me)\b|walk\s+me\s+through\s+(your|my)\s+(background|experience|resume|cv|career|journey|profile)\b)/i;
const RE_JD_SUMMARY = /\b(this|the)\s+(job|role|position|posting|listing|opening)\b/i;
const RE_JD_REQUIREMENTS = /\b(require(?:d|ment|ments)?|responsibilit(?:y|ies)|qualifications?|must[- ]haves?|duties)\b/i;
const RE_CODING = /\b(write|implement|code|coding[- ]?interview|dsa|algorithm(?:ic)?|big[- ]?o|system[- ]?design|debug(ging)?)\b/i;
const RE_DOC = /\b(according\s+to\s+(the|this)\s+(doc|file|paper|deck|notes?|transcript)|in\s+(the|this)\s+(doc|file|paper|deck)|summar(?:i[sz]e|ise)\s+(the|this)\s+(doc|file|paper|deck))\b/i;

function deriveQuestionKind(input: TurnPlanInput): { kind: QuestionKind; reason: string } {
  const answerType = input.answerType || null;
  if (answerType) {
    if (PROFILE_TYPE_SET.has(answerType)) return { kind: 'profile_question', reason: `answerType=${answerType}` };
    if (JD_TYPE_SET.has(answerType)) return { kind: 'jd_question', reason: `answerType=${answerType}` };
    if (CODING_TYPE_SET.has(answerType)) return { kind: 'coding_question', reason: `answerType=${answerType}` };
    if (DOC_TYPE_SET.has(answerType)) return { kind: 'doc_question', reason: `answerType=${answerType}` };
    // general_meeting_answer / lecture_answer / sales_answer / etc. fall through to regex probe.
  }
  const q = (input.question || '').trim();
  if (!q) return { kind: 'general', reason: 'empty_question' };
  if (RE_IDENTITY.test(q)) return { kind: 'profile_question', reason: 'regex_identity' };
  if (RE_JD_REQUIREMENTS.test(q)) return { kind: 'jd_question', reason: 'regex_jd_requirements' };
  if (RE_JD_SUMMARY.test(q)) return { kind: 'jd_question', reason: 'regex_jd_summary' };
  if (RE_CODING.test(q)) return { kind: 'coding_question', reason: 'regex_coding' };
  if (RE_DOC.test(q)) return { kind: 'doc_question', reason: 'regex_doc' };
  return { kind: 'general', reason: 'regex_general' };
}

// ── Evidence-probe ordering (per question_kind, gated by availability) ──────

function probeOrderFor(
  kind: QuestionKind,
  availability: TurnPlanInput['availability'],
): TurnEvidenceKind[] {
  switch (kind) {
    case 'profile_question':
      return [
        ...(availability.hasProfileFacts ? ['profile_resume' as const, 'projects' as const] : []),
        ...(availability.hasJobDescription ? ['profile_jd' as const] : []),
      ];
    case 'jd_question':
      // JD evidence FIRST for jd_question, even if profile is loaded — the
      // question is about the role, not the candidate.
      return [
        ...(availability.hasJobDescription ? ['profile_jd' as const] : []),
        ...(availability.hasProfileFacts ? ['profile_resume' as const] : []),
      ];
    case 'doc_question':
      return [...(availability.hasReferenceFiles ? ['reference_files' as const] : [])];
    case 'coding_question':
      return [
        ...(availability.hasReferenceFiles ? ['reference_files' as const] : []),
        ...(availability.hasProfileFacts ? ['profile_resume' as const] : []),
      ];
    case 'general':
    default:
      // General: still allow a quick probe of whatever's loaded so a question
      // that happens to match profile/JD content gets grounded — but the
      // answer is allowed to fall back to general knowledge with a label.
      return [
        ...(availability.hasProfileFacts ? ['profile_resume' as const, 'projects' as const] : []),
        ...(availability.hasJobDescription ? ['profile_jd' as const] : []),
        ...(availability.hasReferenceFiles ? ['reference_files' as const] : []),
      ];
  }
}

// ── Grounding profile resolution ────────────────────────────────────────────

function groundingProfileFor(input: TurnPlanInput): GroundingProfile {
  // Future: read `sourceContract.groundingProfile` once the schema migration
  // (Campaign 3 §3 step 2) lands. Until then, fall back to the default for
  // every built-in mode. Seminar Mode is gated by an env flag (see
  // build step 3) which lets us flip it without a migration.
  const seminarEnabled =
    typeof process !== 'undefined'
    && process.env?.NATIVELY_SEMINAR_MODE === '1';
  if (seminarEnabled) return SEMINAR_GROUNDING_PROFILE;
  return DEFAULT_GROUNDING_PROFILE;
}

// ── Main planner ────────────────────────────────────────────────────────────

export function planTurn(input: TurnPlanInput): TurnPlan {
  const { kind, reason } = deriveQuestionKind(input);
  const probeOrder = probeOrderFor(kind, input.availability);
  const profile = groundingProfileFor(input);

  const answerDirectives: TurnPlan['answerDirectives'] = {
    candidateIdentityOverride: null,
    labelGeneral: profile.onNoEvidence === 'answer_general_labeled',
    seminarNotFoundPreamble: profile.onNoEvidence === 'say_not_found_then_answer_general',
    // Seed experience/background nodes only for profile/JD questions —
    // never for salary/negotiation/unroutable asks (Campaign 3 §2.5 seeder
    // leash). This closes the C3M-style failure: an unroutable salary
    // question used to fall through to an anti-fabrication seeder that
    // dumped a candidate bio.
    seedCandidateBackground: kind === 'profile_question' || kind === 'jd_question',
  };

  const sourceAuthoritySignal = input.turnSourceDecision?.sourceAuthority
    ?? input.sourceContract?.sourceAuthority
    ?? null;

  return {
    question: input.question || '',
    questionKind: kind,
    evidenceSourcesToProbe: probeOrder,
    groundingProfile: profile,
    answerDirectives,
    sourceAuthoritySignal,
    reasonCode: `turnPlanner:${reason}`,
  };
}
