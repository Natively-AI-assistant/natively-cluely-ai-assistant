import { ConversationIntent, IntentResult } from './IntentClassifier';

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
}

export interface PlannerDecision {
    kind: PlannerDecisionKind;
    reason: string;
    confidence: number;
}

const QUESTION_PATTERN = /\b(what|how|why|where|when|which|who|can you|could you|tell me|explain|describe|walk me through|talk me through|should i|would you)\b/i;
const BRAINSTORM_PATTERN = /\b(brainstorm|options|strategy|ways to solve|possible solutions)\b/i;
const CLARIFY_PATTERN = /\b(clarify|not clear|ambiguous|what do they mean|ask a follow|scope|constraints?)\b/i;
const RESTATEMENT_PATTERN = /\b(sorry[,\s]+let me (?:restate|restart|say that again)|let me (?:restate|restart|say that again)|i(?:'| a)?m going to restate|that came out wrong|not what i meant)\b/i;
const INCOMPLETE_TECHNICAL_PATTERN = /\b(the thing|unclear|not clear|missing|incomplete|ambiguous|contradictory|constraints? (?:are )?unclear|input unclear|output unclear|not sure|audio cut|didn(?:'|o)?t catch|garbled)\b/i;
const RECAP_PATTERN = /\b(recap|summari[sz]e|catch me up|what happened|key points|takeaways)\b/i;
const FOLLOW_UP_PATTERN = /\b(follow[- ]?up questions?|questions should i ask|what should i ask|ask next)\b/i;

function normalize(text?: string): string {
    return (text ?? '').trim();
}

function hasQuestionSignal(text: string): boolean {
    return text.endsWith('?') || QUESTION_PATTERN.test(text);
}

function intentSupportsAnswer(intent?: ConversationIntent): boolean {
    return intent === 'coding'
        || intent === 'behavioral'
        || intent === 'deep_dive'
        || intent === 'example_request'
        || intent === 'follow_up'
        || intent === 'clarification'
        || intent === 'general';
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
        return { kind: 'silent', reason: 'cooldown', confidence };
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

    if (intentSupportsAnswer(input.intentResult?.intent) || hasQuestionSignal(text)) {
        return { kind: 'answer', reason: 'answerable_question', confidence };
    }

    return { kind: 'silent', reason: 'no_actionable_question', confidence };
}
