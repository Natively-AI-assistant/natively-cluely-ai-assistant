// scripts/intent-benchmark/lib/modeSpecs.mjs
//
// Per-mode generation specs: who is who, what the label set is, and what the
// mode's grounding default actually is.
//
// The `mode_intent` label sets come from the campaign brief. The channel,
// voice and grounding columns come from the Phase 1 audit, which corrected the
// brief in two places that matter here:
//
//   1. GROUNDING. The brief's table says General grounds on nothing by default.
//      The code disagrees. defaultSourceContractForNewMode (modeSourceContract
//      .ts:275) seeds EVERY template except looking-for-work and
//      technical-interview with `reference_files_primary`. Seven of nine
//      built-ins default to files; exactly two default to the profile. Those
//      two also only gained `reference_files` in their allowed explicit
//      switches in August 2026, on the principle that an upload is not consent
//      and a switch is.
//
//   2. USER CHANNEL. The brief asks for a per-mode `user_channel` so the router
//      does not assume mic = user, citing Recruiting. The audit found the real
//      asymmetry is ROLE, not channel: the user is on the microphone in every
//      audio mode, but in Recruiting they are the one ASKING, so the system
//      channel carries the person being evaluated rather than the person to
//      answer for. `user_channel` is kept because the schema specifies it, and
//      `user_role` carries the distinction that actually varies.
//
//      This matters because today NOTHING carries either. TranscriptTurn.role is
//      a three-value union and formatTranscriptForLLM hardcodes [INTERVIEWER]
//      and [ME] with no mode in scope, so in Recruiting the candidate is
//      labelled INTERVIEWER and the recruiter is labelled ME.

export const MODE_SPECS = {
  general: {
    abbrev: 'gen',
    userRole: 'participant',
    userChannel: 'mic',
    systemCarries: 'anyone',
    defaultVoice: 'advisor',
    defaultGrounding: 'mode_files',
    silenceOutput: 'Nothing actionable right now.',
    // General's mode_intent IS the sensed scenario. Nothing in code senses it;
    // the <context_sensing> block in the prompt asks the model to infer it.
    modeIntents: [
      'interview_answer', 'sales_objection', 'lecture_concept', 'meeting_capture',
      'coding_question', 'factual_question', 'small_talk',
    ],
    scenario: 'A general-purpose live session. The other party could be anyone: an interviewer, a prospect, a lecturer, a teammate.',
  },

  'technical-interview': {
    abbrev: 'ti',
    userRole: 'candidate',
    userChannel: 'mic',
    systemCarries: 'interviewer',
    defaultVoice: 'first_person_script',
    defaultGrounding: 'profile',
    silenceOutput: null,
    modeIntents: [
      'dsa_problem', 'system_design', 'code_review_hint', 'optimization_probe',
      'complexity_probe', 'behavioral_in_tech_round', 'clarifying_answer_from_interviewer',
      'problem_restatement', 'interviewer_thinking_aloud',
    ],
    scenario: 'A live technical interview. The user is the candidate; the system channel carries the interviewer.',
  },

  'looking-for-work': {
    abbrev: 'lfw',
    userRole: 'candidate',
    userChannel: 'mic',
    systemCarries: 'interviewer',
    defaultVoice: 'first_person_script',
    defaultGrounding: 'profile',
    silenceOutput: null,
    modeIntents: [
      'tell_me_about_yourself', 'behavioral_star', 'role_technical', 'jd_gap',
      'compensation', 'motivation_why_us', 'your_questions_for_us',
      'interviewer_explaining_role', 'small_talk',
    ],
    scenario: 'A live non-technical job interview. The user is the candidate; the system channel carries the interviewer.',
  },

  sales: {
    abbrev: 'sal',
    userRole: 'seller',
    userChannel: 'mic',
    systemCarries: 'prospect',
    defaultVoice: 'first_person_script',
    defaultGrounding: 'mode_files',
    silenceOutput: null,
    modeIntents: [
      'discovery_answer', 'objection_price', 'objection_timing', 'objection_competitor',
      'objection_trust', 'objection_status_quo', 'pricing_ask', 'feature_question',
      'buying_signal', 'next_step_moment', 'satisfied_customer', 'small_talk',
    ],
    scenario: 'A live sales call. The user is the seller; the system channel carries the prospect.',
  },

  recruiting: {
    abbrev: 'rec',
    // THE INVERSION. The user asks; the system channel carries the person being
    // evaluated. Rows here must not be labelled as if the user should answer.
    userRole: 'interviewer',
    userChannel: 'mic',
    systemCarries: 'candidate',
    defaultVoice: 'advisor',
    defaultGrounding: 'mode_files',
    silenceOutput: null,
    modeIntents: [
      'candidate_answer_to_evaluate', 'candidate_question', 'red_flag',
      'probe_needed', 'scorecard_moment', 'interviewer_speaking',
    ],
    scenario: 'A live interview where the USER IS THE INTERVIEWER. The system channel carries the candidate being evaluated. The user never answers as the candidate; output is third-person advice to the user.',
  },

  'team-meet': {
    abbrev: 'tm',
    userRole: 'participant',
    userChannel: 'mic',
    systemCarries: 'colleagues',
    defaultVoice: 'capture',
    defaultGrounding: 'mode_files',
    silenceOutput: 'Nothing to capture right now.',
    modeIntents: [
      'action_item', 'decision', 'risk_blocker', 'called_on_for_status',
      'question_to_me', 'discussion_noise',
    ],
    scenario: 'A live team meeting. The user is one participant among several; the system channel carries colleagues, who are often talking to each other rather than to the user.',
  },

  lecture: {
    abbrev: 'lec',
    userRole: 'student',
    userChannel: 'mic',
    systemCarries: 'professor',
    defaultVoice: 'advisor',
    defaultGrounding: 'mode_files',
    silenceOutput: null,
    modeIntents: [
      'new_concept', 'formula', 'worked_example', 'question_to_room',
      'admin_announcement', 'off_syllabus',
    ],
    scenario: 'A live lecture. The user is a student; the system channel carries the lecturer, who is mostly presenting rather than addressing the user.',
  },

  seminar: {
    abbrev: 'sem',
    userRole: 'presenter',
    userChannel: 'mic',
    systemCarries: 'audience',
    defaultVoice: 'first_person_script',
    defaultGrounding: 'mode_files',
    silenceOutput: null,
    modeIntents: [
      'in_file_question', 'off_file_question', 'critique_challenge',
      'clarification_request', 'citation_check', 'transition_or_compliment',
    ],
    scenario: 'The user is PRESENTING and the system channel carries audience or panel questions about their uploaded document.',
    // in_file vs off_file cannot be resolved from the utterance alone. Labelled
    // anyway so the benchmark measures how often the utterance is enough; the
    // Evidence Probe is what upgrades it later.
    provisionalIntents: ['in_file_question', 'off_file_question'],
  },

  'call-center': {
    abbrev: 'cc',
    userRole: 'agent',
    userChannel: 'mic',
    systemCarries: 'customer',
    defaultVoice: 'first_person_script',
    defaultGrounding: 'mode_files',
    silenceOutput: null,
    modeIntents: [
      'issue_description', 'frustration_escalation', 'diagnostic_answer',
      'resolution_request', 'refund_or_credit_request', 'escalation_request', 'off_topic',
    ],
    scenario: 'A live customer support call. The user is the agent; the system channel carries the customer.',
  },
};

/**
 * Three representative custom modes. A custom mode is NOT a separate template:
 * ModesManager.isCustomMode is `templateType === 'general' && name !== 'General'`.
 * So a custom mode inherits General's prompt, General's neutral routing prior,
 * General's decision hierarchy and General's silence string. These three exist
 * to check that a router does not treat a renamed General as something exotic.
 */
export const CUSTOM_MODE_SPECS = {
  'custom-therapy-supervision': {
    abbrev: 'cus-ther',
    userRole: 'supervisee',
    userChannel: 'mic',
    systemCarries: 'supervisor',
    defaultVoice: 'advisor',
    defaultGrounding: 'mode_files',
    modeIntents: ['case_question', 'technique_probe', 'ethics_check', 'admin', 'small_talk'],
    scenario: 'A clinical supervision session, built by the user as a custom mode on the General template.',
  },
  'custom-investor-update': {
    abbrev: 'cus-inv',
    userRole: 'founder',
    userChannel: 'mic',
    systemCarries: 'investor',
    defaultVoice: 'first_person_script',
    defaultGrounding: 'mode_files',
    modeIntents: ['metric_question', 'runway_probe', 'strategy_challenge', 'intro_request', 'small_talk'],
    scenario: 'A founder updating an investor, built as a custom mode on the General template.',
  },
  'custom-code-review': {
    abbrev: 'cus-cr',
    userRole: 'author',
    userChannel: 'mic',
    systemCarries: 'reviewer',
    defaultVoice: 'first_person_script',
    defaultGrounding: 'mode_files',
    modeIntents: ['design_challenge', 'style_nit', 'correctness_question', 'scope_question', 'approval'],
    scenario: 'A live code review walkthrough, built as a custom mode on the General template.',
  },
};

export const ALL_SPECS = { ...MODE_SPECS, ...CUSTOM_MODE_SPECS };

/** Modes whose row `mode` field is literally 'custom'. */
export const CUSTOM_MODE_KEYS = new Set(Object.keys(CUSTOM_MODE_SPECS));
