// electron/llm/TemporalContextBuilder.ts
// Temporal RAG context builder for "What should I say?" feature
// Builds enriched context to prevent repetition and maintain consistency

import { TYPED_TURN_LABEL } from './typedTurnLabel';

export interface AssistantResponse {
    text: string;
    timestamp: number;
    questionContext: string; // The question/context that triggered this
}

export interface ContextItem {
    role: 'interviewer' | 'user' | 'assistant';
    /** A user line that was typed to the assistant, not said (SessionTracker.ContextItem.typed). */
    typed?: boolean;
    text: string;
    timestamp: number;
}

export interface TemporalContext {
    recentTranscript: string;           // Formatted transcript window
    previousResponses: string[];        // Assistant's recent answers (for anti-repetition)
    roleContext: 'responding_to_interviewer' | 'responding_to_user' | 'general';
    toneSignals: ToneSignal[];          // Extracted tone indicators
    hasRecentResponses: boolean;        // Quick check if we have history
}

export interface ToneSignal {
    type: 'formal' | 'casual' | 'technical' | 'conversational';
    confidence: number; // 0-1
}

/**
 * Extract tone signals from previous responses
 */
function extractToneSignals(responses: AssistantResponse[]): ToneSignal[] {
    const signals: ToneSignal[] = [];

    if (responses.length === 0) return signals;

    // Combine recent responses for analysis
    const combinedText = responses.map(r => r.text).join(' ').toLowerCase();

    // Technical indicators
    const technicalPatterns = [
        /\b(implement|architecture|api|function|component|module|database|algorithm)\b/g,
        /```[\s\S]*?```/g, // Code blocks
        /\b(async|await|promise|callback)\b/g
    ];
    const technicalMatches = technicalPatterns.reduce((sum, p) =>
        sum + (combinedText.match(p)?.length || 0), 0);

    if (technicalMatches > 2) {
        signals.push({ type: 'technical', confidence: Math.min(technicalMatches / 5, 1) });
    }

    // Formal indicators
    const formalPatterns = [
        /\b(therefore|consequently|furthermore|moreover|regarding)\b/g,
        /\b(I would recommend|It is important to note|As mentioned previously)\b/gi
    ];
    const formalMatches = formalPatterns.reduce((sum, p) =>
        sum + (combinedText.match(p)?.length || 0), 0);

    if (formalMatches > 1) {
        signals.push({ type: 'formal', confidence: Math.min(formalMatches / 3, 1) });
    }

    // Casual indicators
    const casualPatterns = [
        /\b(so basically|you know|pretty much|kind of|sort of)\b/gi,
        /\b(honestly|actually|literally)\b/gi
    ];
    const casualMatches = casualPatterns.reduce((sum, p) =>
        sum + (combinedText.match(p)?.length || 0), 0);

    if (casualMatches > 1) {
        signals.push({ type: 'casual', confidence: Math.min(casualMatches / 3, 1) });
    }

    // Conversational indicators 
    const conversationalPatterns = [
        /\b(I think|In my experience|I've found|What I usually do)\b/gi,
        /\b(good question|let me|I'd say)\b/gi
    ];
    const conversationalMatches = conversationalPatterns.reduce((sum, p) =>
        sum + (combinedText.match(p)?.length || 0), 0);

    if (conversationalMatches > 1) {
        signals.push({ type: 'conversational', confidence: Math.min(conversationalMatches / 3, 1) });
    }

    return signals;
}

/**
 * Detect who the user is likely responding to
 */
function detectRoleContext(
    contextItems: ContextItem[]
): 'responding_to_interviewer' | 'responding_to_user' | 'general' {
    // Look at the last few items to determine context
    const recent = contextItems.slice(-5);

    if (recent.length === 0) return 'general';

    // Find the last non-assistant speaker
    for (let i = recent.length - 1; i >= 0; i--) {
        if (recent[i].role === 'interviewer') {
            return 'responding_to_interviewer';
        }
        if (recent[i].role === 'user') {
            return 'responding_to_user';
        }
    }

    return 'general';
}

/**
 * Format previous responses for inclusion in prompt
 * Extracts key phrases to avoid repetition without bloating context
 */
function formatPreviousResponses(responses: AssistantResponse[], maxResponses: number = 3): string[] {
    if (responses.length === 0) return [];

    // Take most recent responses
    const recent = responses.slice(-maxResponses);

    return recent.map(r => {
        // Truncate long responses but keep enough context
        const text = r.text.length > 200
            ? r.text.substring(0, 200) + '...'
            : r.text;
        return text;
    });
}

/**
 * Format context items into transcript string
 * INTERVIEWER turns are weighted more heavily for better intent detection
 */
function formatTranscript(items: ContextItem[]): string {
    return items.map(item => {
        if (item.role === 'interviewer') {
            // Weight interviewer turns more strongly - they define intent
            return `[INTERVIEWER – IMPORTANT]: ${item.text}`;
        } else if (item.role === 'user') {
            // A typed line is not something said in the meeting (same label the
            // rolling context uses — SessionTracker.TYPED_TURN_LABEL).
            return `[${item.typed ? TYPED_TURN_LABEL : 'ME'}]: ${item.text}`;
        } else {
            return `[ASSISTANT (MY PREVIOUS RESPONSE)]: ${item.text}`;
        }
    }).join('\n');
}

/**
 * Build enriched temporal context for "What should I say?" feature
 * 
 * @param contextItems - Recent transcript items from IntelligenceManager
 * @param assistantHistory - History of assistant responses in session
 * @param windowSeconds - How far back to look (default 180s = 3 min)
 */
export function buildTemporalContext(
    contextItems: ContextItem[],
    assistantHistory: AssistantResponse[],
    windowSeconds: number = 180
): TemporalContext {
    const now = Date.now();
    const cutoff = now - (windowSeconds * 1000);

    // Filter to window
    const recentItems = contextItems.filter(item => item.timestamp >= cutoff);
    const recentResponses = assistantHistory.filter(r => r.timestamp >= cutoff);

    return {
        recentTranscript: formatTranscript(recentItems),
        previousResponses: formatPreviousResponses(recentResponses),
        roleContext: detectRoleContext(recentItems),
        toneSignals: extractToneSignals(recentResponses),
        hasRecentResponses: recentResponses.length > 0
    };
}

/**
 * Format temporal context for injection into LLM prompt
 */
export function formatTemporalContextForPrompt(ctx: TemporalContext): string {
    const parts: string[] = [];

    // Add previous responses section if we have any
    if (ctx.previousResponses.length > 0) {
        parts.push(`<previous_responses_to_avoid_repeating>`);
        ctx.previousResponses.forEach((resp, i) => {
            parts.push(`Response ${i + 1}: "${resp}"`);
        });
        parts.push(`</previous_responses_to_avoid_repeating>`);
    }

    // Add tone guidance if we have signals
    if (ctx.toneSignals.length > 0) {
        const primary = ctx.toneSignals.sort((a, b) => b.confidence - a.confidence)[0];
        parts.push(`<tone_guidance>Maintain ${primary.type} tone to stay consistent with your previous responses.</tone_guidance>`);
    }

    // Add role context
    if (ctx.roleContext !== 'general') {
        const roleDesc = ctx.roleContext === 'responding_to_interviewer'
            ? 'You are responding to the interviewer\'s question.'
            : 'You are helping the user formulate their response.';
        parts.push(`<role_context>${roleDesc}</role_context>`);
    }

    return parts.join('\n');
}
