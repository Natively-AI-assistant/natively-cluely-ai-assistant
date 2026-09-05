// electron/llm/routing/IntentFrame.ts
//
// The interaction router's output type. Types only: no runtime behaviour, no
// imports with side effects, nothing wired. PR 6 builds the router that fills
// this in, behind a flag.
//
// WHY A FRAME RATHER THAN A LABEL
//
// The Phase 1 audit found that today's single `ConversationIntent` string
// carries several independent decisions at once, and that most of them already
// have owners elsewhere in the codebase which the classifier never consults.
// `turnSourceDecision.ts` calls itself the canonical authority for grounding.
// `visionPolicy.ts` calls itself the one decision for screen capability. The
// classifier decides none of that and cannot, because nothing in its eight
// labels is about any of it.
//
// So the frame's job is not to replace those owners. It is to make each
// decision explicit and attributable, so the TurnPlanner can feed the owners
// instead of every consumer re-deriving an answer from one overloaded string.
//
// `domain` is deliberately absent. The active mode carries it.

/**
 * What the speaker DID. Independent of whether anyone should reply.
 *
 * `ask` covers both questions and requests, which were separate values until
 * the Phase 5 error analysis showed the distinction was unlearnable: 27 of 54
 * overlapping-label failures on this axis were that one pair. "whats the status
 * on the q three report" is a question in grammatical form and a request in
 * conversational function, and nothing downstream treated the two differently.
 * The merged value is named `ask` rather than keeping either original, because
 * calling a direct instruction a question, or "how does this work" a request,
 * would each be wrong half the time.
 */
export type DialogueAct =
    | 'ask'
    | 'statement'
    | 'answer'
    | 'backchannel'
    | 'interruption';

/**
 * Whether Natively should respond at all.
 *
 * This is the axis the campaign turns on. Measured production telemetry shows
 * 6.1% of live generations end in a silence string, and 95.9% of those land on
 * a fallthrough answer type, meaning the system had already concluded it could
 * not identify the turn and then spent a full cloud generation confirming it.
 *
 * BINARY, deliberately. There was an `optional` value until the Phase 5 error
 * analysis showed nine of eleven overlapping-label failures on this axis were
 * `optional` against `yes`. Inspecting those rows showed what `optional` had
 * actually become: 70% arrived on the microphone channel and 80% were
 * statements, which is the user thinking aloud mid-sentence rather than a turn
 * that could go either way. A middle category that neither a human nor a model
 * separates reliably is not carrying information, and this is the axis where
 * that costs the most.
 */
export type NeedsResponse = 'yes' | 'no';

/**
 * Who speaks the output.
 *
 * DERIVED, not predicted. Two independent LLM labelling passes failed in
 * opposite directions on this axis before it was made deterministic, and the
 * second failure would have been actively harmful: it labelled 51 Recruiting
 * turns `first_person_script`, which hands the interviewer the candidate's
 * words. The Phase 1 audit had already established voice is fixed per mode by
 * the prompt with exactly two documented deviations, so the router computes it
 * from mode, mode_intent and needs_response rather than guessing.
 */
export type Voice = 'first_person_script' | 'advisor' | 'capture' | 'silent';

export type Task =
    | 'answer' | 'explain' | 'create' | 'debug' | 'summarize'
    | 'compare' | 'rewrite' | 'plan' | 'research' | 'extract' | 'none';

export type AnswerForm =
    | 'code' | 'fact' | 'explanation' | 'example' | 'recommendation'
    | 'summary' | 'rebuttal' | 'steps' | 'table' | 'none';

/**
 * Which source may ground the answer.
 *
 * `mode_files` is legal ONLY when the active mode actually has reference files
 * attached. That is not a style rule: the seeded source contract decides what a
 * mode may read, and emitting `mode_files` for a mode with none would ask the
 * Evidence Probe for a scope that does not exist. `hasReferenceFiles` is read
 * live from ModesManager at classification time, because users attach and
 * remove files mid-session.
 */
export type Grounding =
    | 'profile' | 'mode_files' | 'knowledge_base' | 'conversation_memory' | 'none';

export type Capability =
    | 'conversation_context' | 'screen' | 'files' | 'retrieval' | 'web' | 'tools';

/** Which tier produced the frame. Diagnostic, and load-bearing for the shadow run. */
export type Provenance = 'rules' | 'primary' | 'escalation' | 'timeout_fallback';

// ---------------------------------------------------------------------------
// What the router predicts, and what it inherits
// ---------------------------------------------------------------------------

/**
 * THE AXES THE ROUTER ACTUALLY OWNS.
 *
 * This split exists because the first version of this file declared eleven axes
 * as if the router decided all of them, and most of them already have an owner.
 *
 * Context Intelligence V3 is the main answer system, default on since
 * 2026-07-30, and `context-intelligence/question/turn-classifier.ts` describes
 * its own job as deciding "WHAT a turn is asking and WHETHER retrieval should
 * run at all". It carries QuestionType with 17 values, SourceType with 10,
 * GroundingPolicy, RetrievalPath and Answerability. So `grounding`,
 * `capabilities.retrieval` and most of `task` are already decided,
 * deterministically, in production.
 *
 * A router that re-decided them would ship a second opinion on settled
 * questions, which is the exact criticism the Phase 1 audit made of the system
 * it set out to replace.
 *
 * What V3 has no notion of is whether Natively should speak at all. That is
 * deliberate: `buildV3ForTranscriptSurface` returns null when no question
 * resolves, because "proactivity is the product feature". The turns it hands
 * back are the ambient live audio, and measured production telemetry puts 6.1%
 * of live generations ending in a silence string, 95.9% of them on a fallthrough
 * answer type. That is the gap, and it is what this predicts.
 *
 * `dialogue_act` rides along because it is cheap from the same forward pass and
 * is the strongest single feature for `needs_response`, not because anything
 * downstream consumes it yet.
 */
export interface RouterPrediction {
    needs_response: NeedsResponse;
    dialogue_act: DialogueAct;
    confidence: Partial<Record<'needs_response' | 'dialogue_act', number>>;
    alternatives: Partial<Record<'needs_response' | 'dialogue_act', Array<[string, number]>>>;
    provenance: Provenance;
}

/**
 * Where each field of a full frame comes from. Documentation with a type, so a
 * consumer can see at a glance whether a value was predicted or inherited.
 */
export const AXIS_OWNER = {
    needs_response: 'router',
    dialogue_act: 'router',
    voice: 'derived',          // deriveVoice(mode, mode_intent, needs_response)
    task: 'v3',                // QuestionType
    secondary_tasks: 'v3',
    mode_intent: 'v3',         // QuestionType, narrowed by the active mode
    answer_form: 'v3',
    grounding: 'v3',           // SourceType + GroundingPolicy
    capabilities: 'v3',        // RetrievalPath, plus visionPolicy for screen
    current_information: 'v3',
} as const satisfies Record<string, 'router' | 'v3' | 'derived'>;

export interface IntentFrame {
    dialogue_act: DialogueAct;
    needs_response: NeedsResponse;
    voice: Voice;
    task: Task;
    /** Additional tasks for a genuinely multi-intent turn. Empty is the norm. */
    secondary_tasks: Task[];
    /** One of the ACTIVE MODE's own labels. See MODE_INTENT_LABELS. */
    mode_intent: string;
    answer_form: AnswerForm;
    grounding: Grounding;
    capabilities: Capability[];
    current_information: boolean;
    /** Per axis. A missing axis means the router did not resolve it. */
    confidence: Partial<Record<keyof IntentFrameAxes, number>>;
    /** Per axis, ranked. Present so ConfidenceResolver can inspect the margin. */
    alternatives: Partial<Record<keyof IntentFrameAxes, Array<[string, number]>>>;
    provenance: Provenance;
}

/** The axes a classifier is scored on, as a type. `voice` is derived. */
export interface IntentFrameAxes {
    dialogue_act: DialogueAct;
    needs_response: NeedsResponse;
    task: Task;
    mode_intent: string;
    answer_form: AnswerForm;
    grounding: Grounding;
}

// ---------------------------------------------------------------------------
// Per-mode label sets
// ---------------------------------------------------------------------------

/**
 * `mode_intent` vocabularies, partitioned by mode.
 *
 * NOT YET MEASURABLE. There are 78 labels across nine modes, and a 377-row
 * held-out split leaves fewer than ten rows per label in every mode, so the
 * benchmark reports this axis as underpowered rather than giving it a number.
 * The brief's 5,000-row target exists partly for this.
 */
export const MODE_INTENT_LABELS = {
    'general': [
        'interview_answer', 'sales_objection', 'lecture_concept', 'meeting_capture',
        'coding_question', 'factual_question', 'small_talk',
    ],
    'technical-interview': [
        'dsa_problem', 'system_design', 'code_review_hint', 'optimization_probe',
        'complexity_probe', 'behavioral_in_tech_round', 'clarifying_answer_from_interviewer',
        'problem_restatement', 'interviewer_thinking_aloud',
    ],
    'looking-for-work': [
        'tell_me_about_yourself', 'behavioral_star', 'role_technical', 'jd_gap',
        'compensation', 'motivation_why_us', 'your_questions_for_us',
        'interviewer_explaining_role', 'small_talk',
    ],
    'sales': [
        'discovery_answer', 'objection_price', 'objection_timing', 'objection_competitor',
        'objection_trust', 'objection_status_quo', 'pricing_ask', 'feature_question',
        'buying_signal', 'next_step_moment', 'satisfied_customer', 'small_talk',
    ],
    'recruiting': [
        'candidate_answer_to_evaluate', 'candidate_question', 'red_flag',
        'probe_needed', 'scorecard_moment', 'interviewer_speaking',
    ],
    'team-meet': [
        'action_item', 'decision', 'risk_blocker', 'called_on_for_status',
        'question_to_me', 'discussion_noise',
    ],
    'lecture': [
        'new_concept', 'formula', 'worked_example', 'question_to_room',
        'admin_announcement', 'off_syllabus',
    ],
    'seminar': [
        'in_file_question', 'off_file_question', 'critique_challenge',
        'clarification_request', 'citation_check', 'transition_or_compliment',
    ],
    'call-center': [
        'issue_description', 'frustration_escalation', 'diagnostic_answer',
        'resolution_request', 'refund_or_credit_request', 'escalation_request', 'off_topic',
    ],
} as const satisfies Record<string, readonly string[]>;

export type RoutableMode = keyof typeof MODE_INTENT_LABELS;

/**
 * Intents the router can only guess at, and which the Evidence Probe upgrades.
 *
 * Seminar cannot know from the utterance alone whether a question is answered
 * by the uploaded document. Lecture cannot know whether a topic is off
 * syllabus. Both are properties of the FILES, not of the words, so a router
 * that claims certainty here is overclaiming. They are still labelled and
 * scored, to measure how often the utterance alone happens to be enough.
 */
export const PROVISIONAL_MODE_INTENTS: ReadonlySet<string> = new Set([
    'in_file_question', 'off_file_question', 'off_syllabus',
]);

// ---------------------------------------------------------------------------
// Per-mode routing config
// ---------------------------------------------------------------------------

/**
 * The per-mode fields the router needs, which do not exist anywhere today.
 *
 * `userChannel` and `userRole` are separate on purpose, and the distinction is
 * the one the audit found. The user is on the microphone in every audio mode,
 * so `userChannel` alone does not capture what varies. What varies is the ROLE:
 * in Recruiting the user is the one ASKING, so the system channel carries the
 * person being evaluated rather than the person to answer for.
 *
 * Today nothing carries either. `TranscriptTurn.role` is a three-value union
 * and `formatTranscriptForLLM` hardcodes [INTERVIEWER] and [ME] with no mode in
 * scope, so in Recruiting the candidate is labelled INTERVIEWER and the
 * recruiter is labelled ME. The classifier's own tier-3 heuristic then filters
 * on the literal '[INTERVIEWER' and measures the wrong person's turns.
 */
export interface ModeRoutingConfig {
    /** Which channel carries the user. 'mic' for every audio mode today. */
    userChannel: 'mic' | 'system' | 'typed';
    /** What the user IS in this mode. This is what actually varies. */
    userRole: string;
    /** What the system channel carries. */
    systemCarries: string;
    defaultVoice: Voice;
    /**
     * Seeded grounding default.
     *
     * Corrected from code in Phase 1: SEVEN of nine built-ins seed
     * `reference_files_primary`, and only the two interview-prep modes seed
     * `profile_only`. The campaign brief's table had this inverted.
     */
    defaultGrounding: Grounding;
    /** Emitted directly when needs_response is 'no'. Null means stay silent. */
    silenceOutput: string | null;
    modeIntentLabels: readonly string[];
}

/**
 * Note deliberately NOT in this interface: `hasReferenceFiles`.
 *
 * It is read live from ModesManager at classification time, never stored here,
 * because users attach and remove files at any point in a session. A cached
 * copy would be wrong the moment they do, and the failure would be silent: the
 * router would emit `mode_files` for a mode whose files had just been removed.
 */
export const MODE_ROUTING: Record<RoutableMode, ModeRoutingConfig> = {
    'general': {
        userChannel: 'mic', userRole: 'participant', systemCarries: 'anyone',
        defaultVoice: 'advisor', defaultGrounding: 'mode_files',
        silenceOutput: 'Nothing actionable right now.',
        modeIntentLabels: MODE_INTENT_LABELS['general'],
    },
    'technical-interview': {
        userChannel: 'mic', userRole: 'candidate', systemCarries: 'interviewer',
        defaultVoice: 'first_person_script', defaultGrounding: 'profile',
        silenceOutput: null,
        modeIntentLabels: MODE_INTENT_LABELS['technical-interview'],
    },
    'looking-for-work': {
        userChannel: 'mic', userRole: 'candidate', systemCarries: 'interviewer',
        defaultVoice: 'first_person_script', defaultGrounding: 'profile',
        silenceOutput: null,
        modeIntentLabels: MODE_INTENT_LABELS['looking-for-work'],
    },
    'sales': {
        userChannel: 'mic', userRole: 'seller', systemCarries: 'prospect',
        defaultVoice: 'first_person_script', defaultGrounding: 'mode_files',
        silenceOutput: null,
        modeIntentLabels: MODE_INTENT_LABELS['sales'],
    },
    'recruiting': {
        // THE INVERSION. The user asks; the system channel carries the person
        // being evaluated. Output is advice ABOUT them, never words for the
        // user to say as them.
        userChannel: 'mic', userRole: 'interviewer', systemCarries: 'candidate',
        defaultVoice: 'advisor', defaultGrounding: 'mode_files',
        silenceOutput: null,
        modeIntentLabels: MODE_INTENT_LABELS['recruiting'],
    },
    'team-meet': {
        userChannel: 'mic', userRole: 'participant', systemCarries: 'colleagues',
        defaultVoice: 'capture', defaultGrounding: 'mode_files',
        silenceOutput: 'Nothing to capture right now.',
        modeIntentLabels: MODE_INTENT_LABELS['team-meet'],
    },
    'lecture': {
        userChannel: 'mic', userRole: 'student', systemCarries: 'professor',
        defaultVoice: 'advisor', defaultGrounding: 'mode_files',
        silenceOutput: null,
        modeIntentLabels: MODE_INTENT_LABELS['lecture'],
    },
    'seminar': {
        userChannel: 'mic', userRole: 'presenter', systemCarries: 'audience',
        defaultVoice: 'first_person_script', defaultGrounding: 'mode_files',
        silenceOutput: null,
        modeIntentLabels: MODE_INTENT_LABELS['seminar'],
    },
    'call-center': {
        userChannel: 'mic', userRole: 'agent', systemCarries: 'customer',
        defaultVoice: 'first_person_script', defaultGrounding: 'mode_files',
        silenceOutput: null,
        modeIntentLabels: MODE_INTENT_LABELS['call-center'],
    },
};

/**
 * A custom mode is NOT a separate template. ModesManager.isCustomMode is
 * `templateType === 'general' && name !== 'General'`, so a custom mode inherits
 * General's prompt, General's neutral routing prior, General's decision
 * hierarchy and General's silence string. Routing it as General is what the
 * product already does, not a simplification.
 */
export function routingConfigFor(templateType: string): ModeRoutingConfig {
    return MODE_ROUTING[templateType as RoutableMode] ?? MODE_ROUTING['general'];
}

/**
 * Resolve `voice` from the axes that determine it.
 *
 * Mirrors scripts/intent-benchmark/lib/deriveVoice.mjs, which is how the
 * benchmark corpus is labelled, so the router computes the label the same way
 * the corpus defines it. Divergence between the two would make every voice
 * figure in the benchmark meaningless.
 */
export function deriveVoice(
    templateType: string,
    modeIntent: string | null | undefined,
    needsResponse: NeedsResponse,
): Voice {
    if (needsResponse === 'no') return 'silent';

    if (templateType === 'team-meet') {
        return modeIntent === 'called_on_for_status' || modeIntent === 'question_to_me'
            ? 'first_person_script'
            : 'capture';
    }
    if (templateType === 'lecture') {
        return modeIntent === 'question_to_room' ? 'first_person_script' : 'advisor';
    }
    if (templateType === 'general') {
        switch (modeIntent) {
            case 'interview_answer':
            case 'sales_objection': return 'first_person_script';
            case 'meeting_capture': return 'capture';
            default: return 'advisor';
        }
    }
    return routingConfigFor(templateType).defaultVoice;
}

/**
 * May this frame emit `mode_files`?
 *
 * The brief's rule, enforced in one place: files attached to the active mode
 * are a grounding source for that mode regardless of its default, and
 * `mode_files` is never legal when none are attached.
 */
export function groundingIsLegal(grounding: Grounding, hasReferenceFiles: boolean): boolean {
    return grounding !== 'mode_files' || hasReferenceFiles === true;
}

/**
 * Assemble a full frame from what the router predicted and what V3 decided.
 *
 * The router NEVER overwrites a V3 decision. When V3 owned the turn its values
 * win outright; the router contributes the two axes V3 does not model. When V3
 * returned null — the proactive case, which is most of live audio — the V3
 * fields are simply absent and the caller gets a frame that says so rather than
 * one carrying invented values.
 *
 * `needs_response = 'no'` collapses the answer-shaped fields, the same
 * invariant the benchmark corpus enforces: a turn nobody answers has no voice,
 * no task, no answer form and no grounding source. The founder's hand check
 * found that missing from the corpus, where it showed up as 10.3% disagreement
 * on `answer_form`; it is written here so the router cannot reintroduce it.
 */
export function assembleIntentFrame(
    prediction: RouterPrediction,
    v3: Partial<Pick<IntentFrame,
        'task' | 'secondary_tasks' | 'mode_intent' | 'answer_form' | 'grounding'
        | 'capabilities' | 'current_information'>> | null,
    templateType: string,
): IntentFrame {
    const silent = prediction.needs_response === 'no';
    const modeIntent = v3?.mode_intent ?? 'unknown';

    return {
        needs_response: prediction.needs_response,
        dialogue_act: prediction.dialogue_act,
        voice: deriveVoice(templateType, modeIntent, prediction.needs_response),
        task: silent ? 'none' : (v3?.task ?? 'none'),
        secondary_tasks: silent ? [] : (v3?.secondary_tasks ?? []),
        mode_intent: modeIntent,
        answer_form: silent ? 'none' : (v3?.answer_form ?? 'none'),
        grounding: silent ? 'none' : (v3?.grounding ?? 'none'),
        capabilities: silent ? [] : (v3?.capabilities ?? []),
        current_information: silent ? false : (v3?.current_information ?? false),
        confidence: { ...prediction.confidence },
        alternatives: { ...prediction.alternatives },
        provenance: prediction.provenance,
    };
}
