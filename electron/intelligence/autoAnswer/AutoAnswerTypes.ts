/**
 * Auto Answer subsystem types (spec V2 §4 verbatim, plus the V3 additions:
 * TranscriptEndpointEvent.confidence, the user_answering / user_barge_in skip
 * reasons, and the ternary dispatch action 'offer').
 *
 * Nothing in this file has behaviour. Every threshold lives next to the code
 * that applies it, as a named constant, commented as unfitted.
 */

import type { TranscriptSegment } from '../../SessionTracker';

export type AutoAnswerState =
    | 'idle'
    | 'listening'
    | 'possible_question'
    | 'question_complete'
    | 'speculating'
    | 'queued'
    | 'answering';

export type AutoAnswerDialogueAct =
    | 'answerable_question'
    | 'follow_up_question'
    | 'coding_question'
    | 'behavioral_question'
    | 'technical_question'
    | 'general_question'
    | 'statement'
    | 'backchannel'
    | 'social'
    | 'rhetorical'
    | 'pause_request'
    | 'confirmation'
    | 'incomplete';

export type AutoAnswerEndpointSource =
    | 'provider'
    | 'speech_final'
    | 'utterance_end'
    | 'vad'
    | 'quiet_window'
    | 'semantic';

export type AutoAnswerPace = 'fast' | 'balanced' | 'relaxed';

export interface AutoAnswerQuestion {
    /** Meeting-local identity: `${meetingGeneration}-q${sequence}` (V2 §20). Never the text. */
    id: string;
    text: string;

    /** 0..1 that the text is a real interviewer question (extractor scale). */
    confidence: number;
    /** 0..1 composite: question shape + completion + directedness − negatives (V2 §12). */
    answerability: number;
    /** 0..1 that the utterance is finished (endpoint source + incompleteness cues). */
    completionConfidence: number;

    dialogueAct: AutoAnswerDialogueAct;

    isFollowUp: boolean;
    followUpTarget: string;

    startedAt: number;
    lastUpdatedAt: number;
    committedAt?: number;

    endpointSource?: AutoAnswerEndpointSource;

    /** Indices (timestamps) of the finalized segments that built the text. */
    sourceSegments: number[];

    /** Generation counters for the stale-answer guards (V2 §28/§46). */
    candidateGeneration: number;
    meetingGeneration: number;
}

/** The detector's verdict on a candidate (V2 §4, §9). */
export interface AutoAnswerDecision {
    action: 'ignore' | 'wait' | 'speculate' | 'answer' | 'queue';
    reason: string;
    question?: AutoAnswerQuestion;
}

/** Provider-independent endpoint signal (V2 §6; V3 Amendment 3 adds confidence). */
export interface TranscriptEndpointEvent {
    type:
        | 'segment_final'
        | 'speech_final'
        | 'utterance_end'
        | 'speech_started'
        | 'partial';
    timestamp: number;
    /** Provider's own end-of-turn confidence where it has one (Flux eot, AssemblyAI end_of_turn_confidence). */
    confidence?: number;
}

export type AutoAnswerSkipReason =
    | 'disabled'
    | 'meeting_inactive'
    | 'not_interviewer'
    | 'incomplete'
    | 'not_question'
    | 'social'
    | 'backchannel'
    | 'rhetorical'
    | 'pause_request'
    | 'low_answerability'
    | 'duplicate'
    | 'manual_answer_active'
    | 'cooldown'
    | 'stale_generation'
    | 'queue_full'
    // V3 Amendment 1
    | 'user_answering'
    | 'user_barge_in'
    // Lifecycle reasons carried over from the PR #497 gate and the Phase 1 pending slot
    | 'no_question'
    | 'already_answered'
    | 'engine_busy_or_cooling'
    | 'pending_expired'
    | 'pending_superseded';

/** The ternary policy output (V3 Amendment 4) plus the orthogonal V2 actions. */
export type AutoAnswerPolicyAction = 'auto' | 'offer' | 'silent' | 'wait' | 'speculate' | 'queue';

export interface AutoAnswerPolicyDecision {
    action: AutoAnswerPolicyAction;
    reason: AutoAnswerSkipReason | 'ok';
    question?: AutoAnswerQuestion;
}

/** What the TurnManager hands downstream when a quiet window or endpoint commits. */
export interface AutoAnswerCandidate {
    text: string;
    segments: TranscriptSegment[];
    startedAt: number;
    lastUpdatedAt: number;
    /** Bumped on every meaningful revision of the text (V2 §5). */
    generation: number;
    endpointSource: AutoAnswerEndpointSource;
    /** From the provider endpoint that committed this candidate, if any. */
    endpointConfidence?: number;
    punctuationSource?: string;
    sttProvider?: string;
    /** `_meetingGeneration` when the accumulation STARTED (the stale-meeting guard compares against now). */
    meetingGeneration?: number;
}

/** Structured telemetry (V2 §29). NO transcript text, by construction. */
export type AutoAnswerTelemetryEventName =
    | 'auto_answer_candidate'
    | 'auto_answer_endpoint'
    | 'auto_answer_decision'
    | 'auto_answer_ignored'
    | 'auto_answer_speculative'
    | 'auto_answer_committed'
    | 'auto_answer_queued'
    | 'auto_answer_deduplicated'
    | 'auto_answer_cancelled'
    | 'auto_answer_completed'
    | 'auto_answer_offered';

export interface AutoAnswerTelemetryEvent {
    name: AutoAnswerTelemetryEventName;
    meetingGeneration: number;
    questionId?: string;
    provider?: string;
    questionType?: string;
    dialogueAct?: AutoAnswerDialogueAct;
    questionConfidence?: number;
    completionConfidence?: number;
    answerability?: number;
    endpointSource?: AutoAnswerEndpointSource;
    candidateWordCount?: number;
    msFromLastSpeechToDecision?: number;
    msFromDecisionToFirstToken?: number;
    queueDepth?: number;
    skipReason?: AutoAnswerSkipReason;
    state?: AutoAnswerState;
    action?: AutoAnswerPolicyAction;
}
