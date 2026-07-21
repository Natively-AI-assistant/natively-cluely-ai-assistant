// electron/llm/ProfileIntelligenceRouter.ts
//
// Spec §3/§10: THE single deterministic decision layer. For any incoming live
// input X, compute one auditable ProfileIntelligenceDecision BEFORE the LLM call:
// whether to use the profile, from which perspective, which context types to
// include, which to exclude, and whether sensitive context is allowed.
//
// This is a thin, PURE facade that composes the modules that already exist —
// planAnswer (answer-type classifier) + buildContextRoute (context selector) +
// the answer-type → ProfileContextType projection — into the exact shape the spec
// names. No LLM, no I/O. It does not REPLACE the existing pipeline; it gives the
// three live entry points (manual chat, what-to-answer, knowledge intercept) and
// the eval one canonical decision object to converge on and assert against.

import { planAnswer } from './AnswerPlanner';
import type { AnswerType, AnswerSource, SpeakerPerspective, ContextLayer, ProfileContextPolicy } from './AnswerPlanner';
import type { ActiveModeInfo } from './modeProfiles';
import { buildContextRoute } from './contextRoute';

// The spec's ProfileContextType vocabulary (§3).
export type ProfileContextType =
  | 'identity'
  | 'resume_summary'
  | 'experience'
  | 'projects'
  | 'skills'
  | 'education'
  | 'achievements'
  | 'star_stories'
  | 'job_description'
  | 'company_context'
  | 'gap_analysis'
  | 'mock_questions'
  | 'negotiation_strategy'
  | 'salary_context'
  | 'custom_context_pinned'
  | 'custom_context_searchable'
  | 'custom_context_sensitive'
  | 'reference_files'
  | 'live_transcript'
  | 'screen_context'
  | 'ai_persona_style';

export type AnswerPerspective =
  | 'first_person_user'
  | 'assistant_coach'
  | 'third_person_summary'
  | 'generic_ai';

export interface ProfileIntelligenceDecision {
  shouldUseProfile: boolean;
  reason: string;
  answerType: AnswerType;
  answerPerspective: AnswerPerspective;
  /**
   * The plan's profile-context POLICY (Phase 2): required | allowed | forbidden.
   * Disambiguates `shouldUseProfile` for audits — e.g. negotiation is a
   * candidate-voice profile answer (shouldUseProfile may be true) but its policy
   * is `allowed`, not `required` (profile is leverage, not the subject).
   */
  profileContextPolicy: ProfileContextPolicy;
  profileContextTypes: ProfileContextType[];
  excludedContextTypes: ProfileContextType[];
  sensitiveContextAllowed: boolean;
  confidence: number;
  fallbackBehavior: string;
}

export interface DecideProfileInput {
  question: string;
  source: AnswerSource;
  speakerPerspective?: SpeakerPerspective;
  /**
   * Active mode TEMPLATE id (general | sales | team-meet | technical-interview |
   * lecture | recruiting | looking-for-work). PI v3 (W1): now a live routing
   * prior — threaded into planAnswer's mode fallback. A full ActiveModeInfo can
   * be passed via `activeModeInfo` for custom-mode awareness; this string form
   * is kept for backward compatibility with existing callers/evals.
   */
  activeMode?: string;
  /** Full active-mode info (preferred over `activeMode` when both are set). */
  activeModeInfo?: ActiveModeInfo | null;
  /** Whether a usable candidate profile (resume/identity) is loaded. */
  profileAvailable?: boolean;
  /** Whether a JD is loaded. */
  jdAvailable?: boolean;
}

const MODE_TEMPLATE_TYPES: ReadonlySet<string> = new Set([
  'general', 'looking-for-work', 'sales', 'recruiting', 'team-meet', 'lecture', 'technical-interview',
]);

/** Normalize the legacy string form into ActiveModeInfo (unknown ids → null). */
function toActiveModeInfo(input: DecideProfileInput): ActiveModeInfo | null {
  if (input.activeModeInfo) return input.activeModeInfo;
  const id = (input.activeMode || '').trim();
  if (!id || !MODE_TEMPLATE_TYPES.has(id)) return null;
  return { id, templateType: id as ActiveModeInfo['templateType'], name: id, isCustom: false };
}

// Answer types that speak as the candidate in first person when interviewer-asked.
//
// resume_jd_fit_answer / resume_jd_gap_answer / resume_jd_intro_answer
// (2026-07-07, AnswerPlanner JD/Resume JIT pipeline) were missing here —
// AnswerPlanner's own CANDIDATE_VOICE_TYPES and profileContextPolicyFor()
// both treat these three as candidate-voice, profile-required answers (same
// as jd_fit_answer), but this set had drifted out of sync, so
// decideProfileIntelligence's shouldUseProfile fell back to false for them.
// Added 2026-07-11 (Context OS ownership audit). The JD-only shapes
// (jd_summary_answer / jd_requirements_answer / jd_fact_answer) are
// deliberately NOT added — those describe the target role, not the
// candidate, and AnswerPlanner marks them profileContextPolicy:'allowed'
// (not 'required'), consistent with CANDIDATE_VOICE_TYPES excluding them too.
const PROFILE_ANSWER_TYPES: ReadonlySet<AnswerType> = new Set<AnswerType>([
  'identity_answer', 'profile_fact_answer', 'project_answer', 'project_followup_answer',
  'skills_answer', 'skill_experience_answer', 'experience_answer', 'jd_fit_answer',
  'behavioral_interview_answer', 'negotiation_answer',
  'resume_jd_fit_answer', 'resume_jd_gap_answer', 'resume_jd_intro_answer',
]);

// Map the planner's ContextLayer vocabulary onto the spec's richer
// ProfileContextType vocabulary. A single layer can expand to several types
// (e.g. resume → resume_summary/experience/projects/skills/education).
const LAYER_TO_TYPES: Record<ContextLayer, ProfileContextType[]> = {
  stable_identity: ['identity'],
  resume: ['resume_summary', 'experience', 'projects', 'skills', 'education', 'achievements'],
  jd: ['job_description'],
  custom_context: ['custom_context_pinned', 'custom_context_searchable'],
  ai_persona: ['ai_persona_style'],
  negotiation: ['negotiation_strategy', 'salary_context'],
  reference_files: ['reference_files'],
  live_transcript: ['live_transcript'],
  prior_assistant_responses: [],
  active_mode: [],
  screen_context: ['screen_context'],
  preferred_language: [],
};

const ALL_PROFILE_CONTEXT_TYPES: ProfileContextType[] = [
  'identity', 'resume_summary', 'experience', 'projects', 'skills', 'education',
  'achievements', 'star_stories', 'job_description', 'company_context',
  'gap_analysis', 'mock_questions', 'negotiation_strategy', 'salary_context',
  'custom_context_pinned', 'custom_context_searchable', 'custom_context_sensitive',
  'reference_files', 'live_transcript', 'screen_context', 'ai_persona_style',
];

function expandLayers(layers: ContextLayer[]): Set<ProfileContextType> {
  const out = new Set<ProfileContextType>();
  for (const layer of layers) {
    for (const t of LAYER_TO_TYPES[layer] || []) out.add(t);
  }
  return out;
}

function perspectiveFor(answerType: AnswerType, speakerPerspective: SpeakerPerspective, source: AnswerSource): AnswerPerspective {
  // Generic technical / coding / sales / lecture / meeting → generic_ai voice.
  const genericTypes: AnswerType[] = [
    'coding_question_answer', 'dsa_question_answer', 'technical_concept_answer',
    'system_design_answer', 'debugging_question_answer', 'sales_answer',
    'lecture_answer', 'general_meeting_answer',
  ];
  if (genericTypes.includes(answerType)) return 'generic_ai';

  // Negotiation in a live setting is coach-style guidance; elsewhere first person.
  if (answerType === 'negotiation_answer' && source === 'what_to_answer') {
    return 'assistant_coach';
  }

  // Profile answers: first person when the candidate is being asked (interviewer
  // or a live what-to-answer turn); otherwise the assistant explains in second
  // person to the user (manual chat "your name is ...").
  if (PROFILE_ANSWER_TYPES.has(answerType)) {
    if (speakerPerspective === 'interviewer' || source === 'what_to_answer' || source === 'transcript') {
      return 'first_person_user';
    }
    // Manual chat about the user's own facts → answer factually (the assistant
    // tells the user about themselves). Treated as first_person_user for the
    // candidate-voice live use, but assistant_coach when the user asks "me".
    return 'first_person_user';
  }

  return 'generic_ai';
}

/**
 * The single decision function. Pure, deterministic, cheap. Returns the spec's
 * ProfileIntelligenceDecision so any caller (or eval) can see exactly what
 * profile context will and will not be used, and why.
 */
export function decideProfileIntelligence(input: DecideProfileInput): ProfileIntelligenceDecision {
  const plan = planAnswer({
    question: input.question,
    source: input.source,
    speakerPerspective: input.speakerPerspective,
    hasCandidateProfile: input.profileAvailable,
    hasJobDescription: input.jdAvailable,
    activeMode: toActiveModeInfo(input),
  });
  const route = buildContextRoute(plan);

  const answerType = plan.answerType;
  const isProfileType = PROFILE_ANSWER_TYPES.has(answerType);

  // shouldUseProfile: a profile answer type AND the resume layer is not forbidden.
  // Coding/technical/sales/lecture forbid resume → false. Honest about availability.
  const resumeForbidden = plan.forbiddenContextLayers.includes('resume');
  const shouldUseProfile = isProfileType && !resumeForbidden;

  // Sensitive (salary/negotiation) context only for negotiation answers (spec §8).
  const sensitiveContextAllowed = answerType === 'negotiation_answer';

  // Build the included / excluded ProfileContextType sets from the route.
  const included = expandLayers(route.selectedLayers);
  // Custom context sensitive is allowed only for negotiation; reflect that.
  if (sensitiveContextAllowed && route.selectedLayers.includes('custom_context')) {
    included.add('custom_context_sensitive');
  }
  // Negotiation answers also surface company + gap + salary intelligence.
  if (answerType === 'negotiation_answer') {
    included.add('company_context');
    included.add('salary_context');
  }
  // Behavioral answers surface STAR stories.
  if (answerType === 'behavioral_interview_answer') {
    included.add('star_stories');
  }
  // jd_fit surfaces company context + gap analysis.
  if (answerType === 'jd_fit_answer') {
    included.add('company_context');
    included.add('gap_analysis');
  }

  const profileContextTypes = ALL_PROFILE_CONTEXT_TYPES.filter(t => included.has(t));
  const excludedContextTypes = ALL_PROFILE_CONTEXT_TYPES.filter(t => !included.has(t));

  const answerPerspective = perspectiveFor(answerType, plan.speakerPerspective, input.source);

  const reason = shouldUseProfile
    ? `${answerType}: profile used (${profileContextTypes.length} context types)`
    : `${answerType}: profile NOT used (${resumeForbidden ? 'resume forbidden for this answer type' : 'non-profile answer type'})`;

  const fallbackBehavior = input.profileAvailable === false && isProfileType
    ? 'profile_missing_admit_no_data'
    : shouldUseProfile
      ? 'ground_in_profile'
      : 'answer_without_profile';

  return {
    shouldUseProfile,
    reason,
    answerType,
    answerPerspective,
    profileContextPolicy: plan.profileContextPolicy,
    profileContextTypes,
    excludedContextTypes,
    sensitiveContextAllowed,
    confidence: plan.confidence,
    fallbackBehavior,
  };
}
