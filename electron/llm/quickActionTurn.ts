import { buildAssembledTurnContentV2, buildTurnContentV2, carriesV2Core, type EvidenceBlockV2 } from "./promptSystemV2";

/**
 * The user turn for Recap, Follow-up questions, Clarify and Brainstorm.
 *
 * These used to send the transcript as the WHOLE user message. The newest
 * thing in a transcript is whatever was last asked, and the v2 prompt tells
 * the model to answer the newest question, so the model answered it again:
 * after "what is an api", Recap, Follow-up questions and Clarify each
 * explained what an API is (reported 2026-10-08 on claude-haiku-5-5, where
 * Follow-up questions did its job 1 time in 8). The action's own instruction
 * sat mid system prompt with nothing in the turn asking for it.
 *
 * The turn now says what was pressed: the transcript is background in
 * <recent_transcript>, and the request is the current turn and the task, the
 * last thing the model reads. Same builder and order as What to Answer and
 * FollowUpLLM. Measured on the reported model, 8 of 8 for each action, and
 * on a longer meeting the recap keeps its labelled shape.
 *
 * Brainstorm joined on 2026-10-09: with its own prompt but the bare
 * transcript it weighed two or more approaches in 20 replies of 90; with the
 * request in the turn, 90 of 90 (BrainstormOwnPrompt2026_10_09.test.mjs).
 */
export type QuickAction = 'recap' | 'follow_up_questions' | 'clarify' | 'brainstorm' | 'brainstorm_alternatives';

// Each ends by naming the conversation's language. LLMHelper's language line
// answers in the language of "the user's most recent message", and an English
// request closing a Spanish transcript reads as that message: without the
// clause 2 of 8 Spanish recaps came back in English, with it 0 of 18.
//
// Only on Auto. With a response language pinned, LLMHelper's override names
// that language ("even when the question is asked in another language") and
// this clause, the last thing the model reads, would name another.
const IN_CONVERSATION_LANGUAGE = ', in the language the conversation is in';
const REQUESTS: Record<QuickAction, string> = {
    recap: 'Recap the conversation so far',
    // "the other person": without it the questions came out as the ones an
    // interviewer asks a candidate, the reverse of what was pressed for
    // (reported 2026-10-09; FollowUpQuestionsDirection2026_10_09.test.mjs).
    follow_up_questions: 'Suggest three follow-up questions I could ask the other person next',
    clarify: 'Give me one clarifying question to ask',
    // Each part was measured (three models, five runs a case). "with me
    // before I answer" came back as advice TO the user ("ask the
    // interviewer...") in about half the replies; "out loud in my voice" is the
    // user thinking aloud, 45 of 45. "At most 120 words" left Haiku at a median
    // of 158 to 179; "Under 100" puts it at 126 to 132 and the others under 100.
    brainstorm: 'Brainstorm this out loud in my voice: two or three different approaches and what each one costs, then the one I would go with. Under 100 words',
    // Brainstorm pressed over a system design on the table: alternatives to it,
    // with the pick drawn. The request above, said "out loud", made Haiku leave
    // the diagram out 5 times in 5 even with the diagram contract in the system
    // prompt; asked for here, 15 of 15 on three models carry exactly one.
    brainstorm_alternatives: 'Brainstorm alternatives to this design out loud in my voice: two or three different designs and what each one costs, then the one I would go with, drawn as one diagram. Under 100 words outside the diagram',
};

/**
 * Whether the user pinned a response language (anything but Auto). Takes the
 * helper loosely: the classes that call this are constructed with stubs in
 * tests, and a helper that cannot say is treated as Auto.
 */
export function responseLanguageIsPinned(helper: { getAiResponseLanguage?: () => string } | null | undefined): boolean {
    try {
        const language = helper?.getAiResponseLanguage?.();
        return !!language && language !== 'auto';
    } catch {
        return false;
    }
}

export interface QuickActionTurnExtras {
    /** Ranked ahead of the transcript and escaped like it: Brainstorm's problem statement. */
    evidence?: readonly EvidenceBlockV2[];
    /**
     * An app-rendered block placed verbatim just before the request, so the
     * request is still what the model reads last: the design on the table when
     * Brainstorm is asked for alternatives to it.
     */
    beforeRequest?: string;
    /** A response language is pinned, so the request does not name the conversation's (responseLanguageIsPinned). */
    languagePinned?: boolean;
    /**
     * `context` is markup the app already rendered and escaped, not a raw
     * transcript: the engine's typed-turn fallback (<recent_manual_turn>).
     * It goes in as it is. Escaped a second time it reached the model as
     * "&amp;lt;user_question&amp;gt;what&amp;#39;s ..." (found in review,
     * 2026-10-10).
     */
    contextIsRendered?: boolean;
}

/** What the engine tells Clarify and Follow-up questions about the context it hands them. */
export type QuickActionContextOptions = Pick<QuickActionTurnExtras, 'contextIsRendered'>;

// The envelope's own tags. The block placed before the request is app-rendered
// but quotes the design's question and its diagram source, and neither is
// escaped there, so a question holding "<task>" would put a second task in the
// turn. It cannot move the real one, which is still last, but it should not be
// able to pose as one either.
const ENVELOPE_TAG_RE = /<(\/?)(task|current_turn|recent_transcript|evidence_set|evidence|assembled_context)\b/gi;
const neutraliseEnvelopeTags = (block: string): string => block.replace(ENVELOPE_TAG_RE, '&lt;$1$2');

/**
 * `systemPrompt` is the prompt the call will be sent with. A v2 prompt (also
 * one a caller has appended a rule to, hence the prefix test and not the exact
 * registry) gets the turn envelope; a legacy prompt keeps the bare context it
 * was written for, byte for byte.
 */
export function buildQuickActionTurn(action: QuickAction, systemPrompt: string, context: string, extras?: QuickActionTurnExtras): string {
    try {
        if (carriesV2Core(systemPrompt)) {
            const request = `${REQUESTS[action]}${extras?.languagePinned ? '' : IN_CONVERSATION_LANGUAGE}.`;
            if (extras?.contextIsRendered) {
                return buildAssembledTurnContentV2({ assembledContext: context, currentTurn: request, directRequest: request });
            }
            const turn = buildTurnContentV2({ evidence: extras?.evidence, recentTranscript: context, currentTurn: request, directRequest: request });
            const block = extras?.beforeRequest?.trim();
            if (!block) return turn;
            // Everything before the request is escaped, so the only literal
            // "<current_turn>" in the turn is the real one.
            const at = turn.lastIndexOf('<current_turn>');
            const safeBlock = neutraliseEnvelopeTags(block);
            return at >= 0 ? `${turn.slice(0, at)}${safeBlock}\n\n${turn.slice(at)}` : `${safeBlock}\n\n${turn}`;
        }
    } catch { /* legacy shape below */ }
    return context;
}
