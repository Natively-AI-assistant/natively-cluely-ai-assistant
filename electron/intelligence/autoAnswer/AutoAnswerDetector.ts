/**
 * AutoAnswerDetector — "what did the interviewer just ask, is it an answer
 * opportunity, how sure are we, should we wait?" (V2 §9-§17).
 *
 * It does NOT call any LLM (V2 §36) and it does NOT re-implement question
 * detection: `extractLatestQuestion` is the canonical interpretation layer
 * (V2 §10) and the shared shapes in questionShapes.ts are reused. What this
 * adds on top is exactly what the extractor was never asked to judge:
 * completion (is the utterance finished?), dialogue act (pause request,
 * confirmation, rhetorical, backchannel), interviewer-directedness, and the
 * composite answerability score.
 *
 * Scale note (V3 Amendment 5): every number below lives on the EXTRACTOR's
 * confidence scale, measured on clean main (2026-08-23) for the V2 §32 lists:
 * interrogatives 0.95, imperative asks 0.80, social/backchannel <= 0.30, pause
 * request 0.50, "One more question — tell me about…" 0.40, rhetorical
 * "Wouldn't that be nice?" 0.80, incomplete "How would you" 0.95. The last
 * three are why the dialogue-act caps exist. All constants are placeholders
 * until the replay harness and the audio corpus fit them.
 */

import { extractLatestQuestion, type ExtractedQuestion, type ExtractedQuestionType } from '../../llm/transcriptQuestionExtractor';
import type { TranscriptTurn } from '../../llm/transcriptCleaner';
import { IMPERATIVE_ASK, TASK_DIRECTIVE, WAIT_IDIOM, AUX_SECOND_PERSON } from '../../llm/questionShapes';
import type {
    AutoAnswerCandidate, AutoAnswerDecision, AutoAnswerDialogueAct, AutoAnswerEndpointSource, AutoAnswerQuestion,
} from './AutoAnswerTypes';

// ── Thresholds (V2 §12 / §19, per-source; unfitted placeholders) ──────────
/** Commit threshold on the answerability composite (V2 §19 ANSWER_THRESHOLD). */
export const ANSWER_THRESHOLD = 0.88;
/** Speculative preparation threshold (V2 §19). */
export const SPECULATION_THRESHOLD = 0.82;
/** Below this the candidate is ignored outright; between here and ANSWER it waits / offers (V2 §12). */
export const WAIT_THRESHOLD = 0.65;

// ── Composite weights (unfitted placeholders) ──────────────────────────────
/** Floor for an imperative interviewer ask the extractor under-scores ("One more question — tell me…" = 0.40). */
export const IMPERATIVE_ASK_FLOOR = 0.80;
/** Second-person / candidate-directed bonus (V2 §17). */
export const DIRECTED_BONUS = 0.08;
/** Follow-up relationship bonus ("And why?" after a question). */
export const FOLLOW_UP_BONUS = 0.06;
/** Per-source endpoint bonus: a provider EOT is stronger evidence of completion than a quiet window. */
export const ENDPOINT_BONUS: Record<AutoAnswerEndpointSource, number> = {
    provider: 0.08,
    speech_final: 0.06,
    utterance_end: 0.05,
    vad: 0.04,
    quiet_window: 0.02,
    semantic: 0.0,
};
/** Per-source completion confidence baseline. */
export const ENDPOINT_COMPLETION: Record<AutoAnswerEndpointSource, number> = {
    provider: 0.92,
    speech_final: 0.88,
    utterance_end: 0.85,
    vad: 0.75,
    quiet_window: 0.70,
    semantic: 0.60,
};
/** Caps applied by dialogue act (a negative act can never reach the answer band). */
export const ACT_CAP: Partial<Record<AutoAnswerDialogueAct, number>> = {
    incomplete: 0.30,
    rhetorical: 0.30,
    pause_request: 0.20,
    confirmation: 0.20,
    backchannel: 0.10,
    social: 0.40,
    statement: 0.45,
};
/** Exposition that is not directed at the candidate (V2 §17 "Companies often use Kafka when…"). */
export const EXPOSITION_PENALTY = 0.25;

// ── Shapes this layer owns (the extractor has no opinion on these) ─────────
/** Ends on a dangling function word / conjunction: the thought is not finished. */
const DANGLING_TAIL = /\b(and|or|but|so|if|the|a|an|to|of|for|with|about|because|when|where|which|while|that|than|then|as|at|in|on|by|from|into|whether|versus|vs)\s*$/i;
/** Interrogative lead with nothing (or one token) after "you" and no terminal mark: "How would you", "How would you design". */
const BARE_INTERROGATIVE = /^(?:and\s+|so\s+|but\s+)?(how|what|why|when|where|which|who)\s+(would|do|did|could|can|should|will|have|are|were|is)\s+you(?:\s+[\w'-]+)?\s*$/i;
const TRAILING_ELLIPSIS = /(\.\.\.|…)\s*$/;
const RHETORICAL = /^(wouldn't|isn't|doesn't|don't you think|who wouldn't|wouldn't it be|isn't it|right\?)\b|,\s*(right|isn't it|don't you think|no)\?\s*$/i;
const CONFIRMATION = /\b(can you (hear|see) me|are you (there|still there)|am i audible|can you see my screen|is my (audio|screen) (ok|okay|working)|do you see (my|the) screen)\b/i;
const BACKCHANNEL = /^(ok(ay)?|yeah|yes|yep|right|sure|got it|i see|mm-?hmm|uh-?huh|alright|cool|great|nice|perfect|exactly|interesting|makes sense|that makes sense|sounds good|fair enough|good|fine)(\s*[,.!]?\s*(ok(ay)?|yeah|exactly|right|got it|sure|cool|good|nice|i see))*[.!]?\s*$/i;
const SELF_NARRATION = /^(let me|i('m| am) (going to|gonna)|i think|i guess|i believe|we usually|we typically|we tend to|in my experience|personally)\b/i;
const EXPOSITION = /^(companies|teams|people|engineers|organizations|most (companies|teams|people))\s+(often|usually|typically|tend|generally)\b/i;
const SECOND_PERSON = /\b(you|your|you're|you've|yourself)\b/i;
/** A short interrogative that leans on the previous exchange: "And why?", "So what about latency?", "Why not?". */
const SHORT_FOLLOW_UP = /^(and|so|but|what about|how about|why|why not|and why|and how|and then|okay and|ok and)\b/i;
/** The interviewer answered their own question in the same breath: "Why do we shard by user id? Because hot keys." */
const SELF_ANSWERED = /\?\s+(because|since|well,?|so,?|it'?s|that'?s|the (reason|answer)|we (do|did|use)|obviously|of course|mainly|mostly)\b/i;
/** The question was set aside before it was finished: "How would you scale this if... Actually, before that, let me…" */
const DEFERRAL = /(\.\.\.|…)\s+\S|\b(actually,? (before|first|hold|wait|let me)|before that,? let me|first,? let me|let me (give you|set|provide|first)|hold that thought|one sec(ond)?,? first)\b/i;
const CODING_ASK = /\b(implement|write (a|the|some)? ?(function|code|program|class|method)|solve|code (up|this)|algorithm|time complexity|big[- ]?o|data structure|hash ?map|linked list|binary tree|two pointers|dynamic programming)\b/i;

export interface DetectParams {
    candidate: AutoAnswerCandidate;
    /** Recent turns from LiveTranscriptBrain.getHotWindow(); the candidate is appended as the last interviewer turn. */
    recentTurns: TranscriptTurn[];
    endpointSource?: AutoAnswerEndpointSource;
    punctuationSource?: string;
    /** Identity fields the controller owns. */
    questionId: string;
    candidateGeneration: number;
    meetingGeneration: number;
    now: number;
}

export interface DetectorScores {
    questionConfidence: number;
    completionConfidence: number;
    directedness: number;
    answerability: number;
    dialogueAct: AutoAnswerDialogueAct;
    extracted: ExtractedQuestion;
}

/** The pure scoring half, exported for the harness and calibration report. */
export function scoreCandidate(params: DetectParams): DetectorScores {
    const text = params.candidate.text.trim();
    const source = params.endpointSource ?? params.candidate.endpointSource ?? 'quiet_window';
    const punctuationSource = params.punctuationSource ?? params.candidate.punctuationSource;

    const turns: TranscriptTurn[] = [
        ...params.recentTurns,
        {
            role: 'interviewer',
            text,
            timestamp: params.candidate.lastUpdatedAt,
            ...(punctuationSource ? { punctuationSource: punctuationSource as TranscriptTurn['punctuationSource'] } : {}),
        },
    ];
    const extracted = extractLatestQuestion(turns);
    // Follow-up relationship (V2 §16/§17): a short interrogative after a prior
    // interviewer question + candidate reply refers back to it.
    const priorExchange = params.recentTurns.some(t => t.role === 'interviewer') && params.recentTurns.some(t => t.role === 'user');
    const shortFollowUp = priorExchange && SHORT_FOLLOW_UP.test(text) && text.split(/\s+/).length <= 5;
    if (shortFollowUp && !extracted.isFollowUp) extracted.isFollowUp = true;
    // The extractor may pick an OLDER turn as the latest question (e.g. the
    // new candidate is a statement). Auto Answer only ever answers the
    // candidate itself, so a mismatch means "this candidate is not the question".
    const keyedOnCandidate = sameUtterance(extracted.latestQuestion, text);
    let questionConfidence = keyedOnCandidate ? extracted.confidence : 0;

    const hasImperative = IMPERATIVE_ASK.test(text) || TASK_DIRECTIVE.test(text);
    if (keyedOnCandidate && hasImperative) questionConfidence = Math.max(questionConfidence, IMPERATIVE_ASK_FLOOR);

    const act = classifyAct(text, extracted, keyedOnCandidate, punctuationSource);

    // Completion: per-source baseline, then the textual incompleteness cues.
    let completionConfidence = ENDPOINT_COMPLETION[source];
    if (act === 'incomplete') completionConfidence = Math.min(completionConfidence, 0.3);

    // Directedness (V2 §17).
    let directedness = 0.5;
    if (SECOND_PERSON.test(text) || AUX_SECOND_PERSON.test(text) || hasImperative) directedness = 1.0;
    if (EXPOSITION.test(text) || SELF_NARRATION.test(text)) directedness = Math.min(directedness, 0.2);

    // Composite on the extractor scale.
    let answerability = questionConfidence;
    if (directedness >= 1.0) answerability += DIRECTED_BONUS;
    if (directedness <= 0.2) answerability -= EXPOSITION_PENALTY;
    if (extracted.isFollowUp && keyedOnCandidate) answerability += FOLLOW_UP_BONUS;
    answerability += ENDPOINT_BONUS[source];
    const cap = ACT_CAP[act];
    if (cap !== undefined) answerability = Math.min(answerability, cap);
    answerability = clamp01(answerability);

    return { questionConfidence, completionConfidence, directedness, answerability, dialogueAct: act, extracted };
}

export class AutoAnswerDetector {
    detect(params: DetectParams): AutoAnswerDecision {
        const scores = scoreCandidate(params);
        const question = buildQuestion(params, scores);

        if (scores.dialogueAct === 'incomplete') return { action: 'wait', reason: 'incomplete', question };
        if (scores.answerability < WAIT_THRESHOLD) {
            return { action: 'ignore', reason: ignoreReasonFor(scores), question };
        }
        if (scores.answerability >= ANSWER_THRESHOLD) return { action: 'answer', reason: 'answerable', question };
        if (scores.answerability >= SPECULATION_THRESHOLD) return { action: 'speculate', reason: 'likely_question', question };
        return { action: 'wait', reason: 'low_answerability', question };
    }
}

// ── helpers ────────────────────────────────────────────────────────────────

function buildQuestion(params: DetectParams, s: DetectorScores): AutoAnswerQuestion {
    return {
        id: params.questionId,
        text: params.candidate.text.trim(),
        confidence: s.questionConfidence,
        answerability: s.answerability,
        completionConfidence: s.completionConfidence,
        dialogueAct: s.dialogueAct,
        isFollowUp: Boolean(s.extracted.isFollowUp),
        followUpTarget: s.extracted.followUpTarget ?? '',
        startedAt: params.candidate.startedAt,
        lastUpdatedAt: params.candidate.lastUpdatedAt,
        endpointSource: params.endpointSource ?? params.candidate.endpointSource,
        sourceSegments: params.candidate.segments.map(seg => seg.timestamp),
        candidateGeneration: params.candidateGeneration,
        meetingGeneration: params.meetingGeneration,
    };
}

function ignoreReasonFor(s: DetectorScores): string {
    switch (s.dialogueAct) {
        case 'social': return 'social';
        case 'backchannel': return 'backchannel';
        case 'rhetorical': return 'rhetorical';
        case 'pause_request': return 'pause_request';
        case 'confirmation': return 'not_question';
        case 'statement': return 'not_question';
        default: return 'low_answerability';
    }
}

function classifyAct(
    text: string,
    extracted: ExtractedQuestion,
    keyedOnCandidate: boolean,
    punctuationSource: string | undefined,
): AutoAnswerDialogueAct {
    const words = text.split(/\s+/).filter(Boolean);
    const endsWithMark = /[?.!]$/.test(text);
    // The interrogative-lead stub "How would you" is incomplete regardless of
    // punctuation; a dangling conjunction is incomplete only when the provider
    // would have punctuated a finished sentence and did not.
    if (TRAILING_ELLIPSIS.test(text) || BARE_INTERROGATIVE.test(text)) return 'incomplete';
    if (!endsWithMark && DANGLING_TAIL.test(text) && punctuationSource !== 'unavailable') return 'incomplete';
    if (WAIT_IDIOM.test(text) || /^(let me think|one (sec|moment)|hold on|bear with me)\b/i.test(text)) return 'pause_request';
    if (SELF_ANSWERED.test(text)) return 'rhetorical';
    if (DEFERRAL.test(text)) return 'pause_request';
    if (CONFIRMATION.test(text)) return 'confirmation';
    if (RHETORICAL.test(text)) return 'rhetorical';
    if (BACKCHANNEL.test(text) && words.length <= 4) return 'backchannel';
    if (!keyedOnCandidate || extracted.confidence <= 0.3) {
        if (words.length <= 4 && !endsWithMark) return 'backchannel';
        return 'statement';
    }
    // Social pleasantries are capped by the extractor (<= 0.5) — see SOCIAL_PLEASANTRY.
    if (extracted.confidence <= 0.5 && !IMPERATIVE_ASK.test(text) && !TASK_DIRECTIVE.test(text)) {
        return WAIT_IDIOM.test(text) ? 'pause_request' : 'social';
    }
    if (CODING_ASK.test(text)) return 'coding_question';
    return mapType(extracted.questionType, extracted.isFollowUp);
}

function mapType(type: ExtractedQuestionType, isFollowUp: boolean): AutoAnswerDialogueAct {
    if (isFollowUp || type === 'follow_up') return 'follow_up_question';
    switch (type) {
        case 'behavioral': return 'behavioral_question';
        case 'technical': return 'technical_question';
        case 'identity':
        case 'profile_detail':
        case 'jd_alignment':
        case 'negotiation':
            return 'answerable_question';
        default: return 'general_question';
    }
}

function sameUtterance(a: string, b: string): boolean {
    const na = normalizeForCompare(a);
    const nb = normalizeForCompare(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    // The extractor cleans filler and may trim a leading clause; accept when
    // one is a suffix/prefix of the other covering most of it.
    const shorter = na.length < nb.length ? na : nb;
    const longer = na.length < nb.length ? nb : na;
    return longer.includes(shorter) && shorter.length >= longer.length * 0.6;
}

export function normalizeForCompare(s: string): string {
    return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function clamp01(n: number): number {
    return Math.max(0, Math.min(1, n));
}
