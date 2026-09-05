// ── Legacy intent, reduced to a constant (2026-09-05) ──────────────────────
//
// The eight-label classifier (ten regexes, then MobileBERT zero-shot in a worker,
// then a context heuristic) is removed. Measured on the real engine with Context
// Intelligence V3 default ON, its output reached ZERO dispatched prompts: the
// <intent_and_shape> block only ever entered the v2/v1 carriers, both discarded
// when V3 composes the turn. Its one surviving effect here, the planner gate
// below, passed on seven of eight labels and matched a hardcoded `general` on
// 98.3% of 1,011 held-out rows. So `general` is what it now returns, and the
// types stay only because three consumers still carry an IntentResult.
// docs/natively-router-final-answer-2026-09-05.md has the evidence.

export type ConversationIntent =
    | 'coding' | 'clarification' | 'follow_up' | 'deep_dive'
    | 'behavioral' | 'example_request' | 'summary_probe' | 'general';

export interface IntentResult {
    intent: ConversationIntent;
    confidence: number;
}

/** Same three-argument signature the classifier had, so call sites did not move. */
export async function classifyIntent(
    _lastInterviewerTurn: string | null,
    _recentTranscript: string,
    _assistantMessageCount: number,
): Promise<IntentResult> {
    return { intent: 'general', confidence: 0.5 };
}
import { speculativeQuestionSimilarity } from './speculativeSimilarity';

/**
 * Jaccard above which two trigger questions are treated as the SAME utterance
 * for cooldown purposes. Deliberately LOW: the higher this is, the more turns
 * bypass the cooldown, so a low value keeps the throttle close to its original
 * behaviour and only lets CLEARLY different questions through. Restated
 * fragments of one question score well above this; two different questions
 * ("how many engineers" vs "which datastore") score near zero.
 */
const SAME_UTTERANCE_SIMILARITY = 0.5;

export type PlannerDecisionKind = 'silent' | 'answer' | 'clarify' | 'recap' | 'follow_up_questions' | 'brainstorm';

export interface PlannerInput {
    triggerQuestion?: string;
    confidence: number;
    transcriptContext?: string;
    intentResult?: IntentResult;
    hasRecentAssistantResponse?: boolean;
    hasDetectedCodingQuestion?: boolean;
    hasImages?: boolean;
    now?: number;
    lastTriggerTime?: number;
    cooldownMs?: number;
    /**
     * The question that stamped `lastTriggerTime`. Lets the cooldown tell a
     * restated fragment of the same utterance (throttle it) from a genuinely new
     * question (answer it). Absent ⇒ the cooldown behaves exactly as before.
     */
    lastTriggerQuestion?: string;
}

export interface PlannerDecision {
    kind: PlannerDecisionKind;
    reason: string;
    confidence: number;
}

// ── Question signal, for unpunctuated STT ───────────────────────────────────
//
// The local STT emits no punctuation, so `endsWith('?')` never fires live and the
// old single regex (WH-words plus a few "can you / tell me" forms) caught 38.0%
// of held-out turns that needed a response. What it missed was mostly auxiliary
// inversion with no question mark: "is that", "do you", "would it", "can we".
// Tuned on the TRAIN split of the router corpus against needs_response labels
// and reported on HOLDOUT: recall 38.0% -> 51.4%, false-positive 10.0% -> 14.0%.
// A tag-question rule ("... right", "... okay") was tried and dropped: two turns
// of recall for twenty-one backchannel false positives.
//
// This signal gates SPECULATION (IntelligenceEngine.maybeSpeculate), where a
// false positive costs one prefetch and a miss costs a slow answer to a real
// question. It does NOT gate whether to answer: 404 of the turns it still
// misses are labelled statements that need a response (a sales objection, a
// customer's complaint), which no question regex can see. That is the router's
// needs_response axis, and the planner below answers by default.
const QUESTION_LEAD = String.raw`(^|\b(?:so|and|but|ok|okay|uh|um|now|then|yeah|alright|right|well|also|just)\s+)`;
const QUESTION_WH = /\b(what|how|why|where|when|which|who|whose|whom)\b/i;
const QUESTION_AUX_INVERSION = new RegExp(QUESTION_LEAD
    + String.raw`(is|are|was|were|do|does|did|can|could|would|should|will|shall|have|has|had|am|isn't|aren't|don't|doesn't|didn't|can't|couldn't|wouldn't|shouldn't|won't|haven't|hasn't)\s+(you|it|that|this|there|we|they|he|she|i|your|the|a|an|any|anyone|anything|something|someone|everyone|all|each)\b`, 'i');
const QUESTION_REQUEST = new RegExp(QUESTION_LEAD
    + String.raw`(tell me|explain|describe|walk (?:me|us) through|talk (?:me|us) through|show me|give me|let me know|help me|can you|could you|would you|will you|i'd like to (?:know|hear|see|understand)|i want to (?:know|hear|see|understand)|i'm curious|im curious|i wonder|wondering|any (?:thoughts|ideas|idea|questions|question)|what about|how about|remind me|clarify|elaborate|implement|write (?:a|an|the|some|me)|code (?:up|this|it)|optimi[sz]e|refactor|debug|fix (?:this|that|it|the)|summari[sz]e|recap|go over|run (?:me|us) through)\b`, 'i');
const QUESTION_SHOULD = /\b(should (?:i|we|you|they|it)|shall (?:i|we))\b/i;
const BRAINSTORM_PATTERN = /\b(brainstorm|options|strategy|ways to solve|possible solutions)\b/i;
const CLARIFY_PATTERN = /\b(clarify|not clear|ambiguous|what do they mean|ask a follow|scope|constraints?)\b/i;
const RESTATEMENT_PATTERN = /\b(sorry[,\s]+let me (?:restate|restart|say that again)|let me (?:restate|restart|say that again)|i(?:'| a)?m going to restate|that came out wrong|not what i meant)\b/i;
const INCOMPLETE_TECHNICAL_PATTERN = /\b(the thing|unclear|not clear|missing|incomplete|ambiguous|contradictory|constraints? (?:are )?unclear|input unclear|output unclear|not sure|audio cut|didn(?:'|o)?t catch|garbled)\b/i;
const RECAP_PATTERN = /\b(recap|summari[sz]e|catch me up|what happened|key points|takeaways)\b/i;
const FOLLOW_UP_PATTERN = /\b(follow[- ]?up questions?|questions should i ask|what should i ask|ask next)\b/i;

function normalize(text?: string): string {
    return (text ?? '').trim();
}

export function hasQuestionSignal(text: string): boolean {
    const t = (text ?? '').trim();
    if (!t) return false;
    return t.endsWith('?')
        || QUESTION_WH.test(t)
        || QUESTION_AUX_INVERSION.test(t)
        || QUESTION_REQUEST.test(t)
        || QUESTION_SHOULD.test(t);
}

export function planNextAssistantAction(input: PlannerInput): PlannerDecision {
    const text = normalize(input.triggerQuestion || input.transcriptContext);
    const confidence = input.confidence || input.intentResult?.confidence || 0;
    const now = input.now ?? Date.now();
    const cooldownMs = input.cooldownMs ?? 3000;
    const lastTriggerTime = input.lastTriggerTime ?? 0;

    if (!text && !input.hasImages) {
        return { kind: 'silent', reason: 'no_context', confidence };
    }

    if (!input.hasImages && now - lastTriggerTime < cooldownMs) {
        // The cooldown exists to stop re-triggering on FRAGMENTS of the SAME
        // utterance as STT finalizes it — not to rate-limit the conversation.
        // Silencing a substantively DIFFERENT question loses a real turn with no
        // signal to the user: measured through the real app, a second question
        // asked inside the window simply produced nothing, no pipeline ran, and
        // nothing was shown. This throttle has caused a user-facing P0 once
        // already (TriggerGate.test.mjs — it swallowed manual presses until
        // skipCooldown was added); a silently dropped follow-up is the same
        // class of failure.
        //
        // Conservative by construction: with no previous question recorded, or
        // no current one, behaviour is UNCHANGED (still silent).
        const prevQ = (input.lastTriggerQuestion ?? '').trim();
        const currQ = (input.triggerQuestion ?? '').trim();
        const sameUtterance = !prevQ || !currQ
            || speculativeQuestionSimilarity(prevQ, currQ) >= SAME_UTTERANCE_SIMILARITY;
        if (sameUtterance) {
            return { kind: 'silent', reason: 'cooldown', confidence };
        }
    }

    if (confidence < 0.5 && !input.hasImages) {
        return { kind: 'silent', reason: 'low_confidence', confidence };
    }

    if (RESTATEMENT_PATTERN.test(text) && INCOMPLETE_TECHNICAL_PATTERN.test(text)) {
        return { kind: 'clarify', reason: 'incomplete_technical_restatement', confidence };
    }

    if (RECAP_PATTERN.test(text)) {
        return { kind: 'recap', reason: 'recap_request', confidence };
    }

    if (FOLLOW_UP_PATTERN.test(text)) {
        return { kind: 'follow_up_questions', reason: 'follow_up_questions_request', confidence };
    }

    if (CLARIFY_PATTERN.test(text)) {
        return { kind: 'clarify', reason: 'clarify_request', confidence };
    }

    if (BRAINSTORM_PATTERN.test(text) || input.hasImages || input.hasDetectedCodingQuestion) {
        return { kind: 'brainstorm', reason: input.hasImages ? 'visual_problem_context' : 'strategy_request', confidence };
    }

    // ANSWER IS THE DEFAULT. The old gate was `intentSupportsAnswer(intent) ||
    // hasQuestionSignal(text)`, and intentSupportsAnswer passed on seven of the
    // eight labels the classifier could produce, with its terminal tier unable to
    // return anything outside them. It was constant-true wearing a classifier's
    // clothes, and the `silent` branch below it was reachable only via
    // `summary_probe`, 1.7% of held-out rows. Gating on the question signal alone
    // would silence 48.6% of turns that need a response, because most of those
    // are not syntactic questions. Whether to speak is the interaction router's
    // needs_response axis (electron/llm/routing), gated and flagged separately.
    void hasQuestionSignal;
    return { kind: 'answer', reason: 'answerable_question', confidence };
}
