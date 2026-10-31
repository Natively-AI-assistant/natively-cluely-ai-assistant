import { buildAssembledTurnContentV2, buildTurnContentV2, carriesV2Core, type EvidenceBlockV2 } from "./promptSystemV2";
import { analyzeUserInstructions, removeGroundingOverrides, userInstructionsOverrideAppLength, type UserLengthBound } from "./userInstructionContract";

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
export type QuickAction = 'recap' | 'follow_up_questions' | 'clarify' | 'brainstorm' | 'brainstorm_alternatives'
    // The live helpers (2026-10-15, liveHelpers.ts): What did I miss?, Define, Sound smart.
    | 'catch_me_up' | 'define' | 'sound_smart'
    // A button the user made (2026-10-30, customButtons.ts): its contract is
    // in the system prompt, and the request names it (customButtonName).
    | 'custom_button';

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
    // (The length is in DEFAULT_LENGTH: a Real-time prompt can replace it.)
    brainstorm: 'Brainstorm this out loud in my voice: two or three different approaches and what each one costs, then the one I would go with',
    // Brainstorm pressed over a system design on the table: alternatives to it,
    // with the pick drawn. The request above, said "out loud", made Haiku leave
    // the diagram out 5 times in 5 even with the diagram contract in the system
    // prompt; asked for here, 15 of 15 on three models carry exactly one.
    brainstorm_alternatives: 'Brainstorm alternatives to this design out loud in my voice: two or three different designs and what each one costs, then the one I would go with, drawn as one diagram',
    // Pressed after looking away: the window is only what was said since
    // (IntelligenceEngine.runLiveHelper picks it), so the request names it.
    catch_me_up: 'I looked away for a few minutes. Tell me what I missed in this part of the conversation: the topic now, anything decided, anything asked of me',
    define: 'Explain the most recent term, acronym or name in the conversation that I might not know, and what it means here',
    // "my own words": like Brainstorm's "in my voice", so it comes back as a
    // line to say and not as advice about what to say.
    sound_smart: 'Give me one specific, insightful point or question I could say next, in my own words, built on what was just said',
    // With the button's name when there is one (requestFor).
    custom_button: 'Do what my button asks, as its instructions say',
};
// The request's own length, and what a length is measured outside of.
const DEFAULT_LENGTH: Partial<Record<QuickAction, { length: string; outside: string }>> = {
    catch_me_up: { length: 'At most four short lines', outside: '' },
    define: { length: 'Under 50 words', outside: '' },
    sound_smart: { length: 'Under 45 words', outside: '' },
    brainstorm: { length: 'Under 100 words', outside: '' },
    brainstorm_alternatives: { length: 'Under 100 words', outside: ' outside the diagram' },
};

// The Real-time prompt reaches Brainstorm in the system prompt, which says it
// outranks every default. The request is still the last thing read, and on
// claude-haiku-5-5 it won: with "Java only. Name the Java class you would use"
// 0 replies of 8 named one, and with "Keep it under 60 words" the median stayed
// at 109 (2026-10-10). So the request points at the instructions (7 of 8), and
// where they set a length it states that length and not its own (median 71,
// the same overshoot Haiku has on "Under 100").
const STANDING_INSTRUCTIONS_FIRST = ' My standing instructions come first where they differ.';
const BOUND_WORDS: Record<UserLengthBound, string> = { max: 'At most', min: 'At least', exact: 'Exactly', about: 'About' };
// Models count words far better than seconds (userInstructionContract renderLengthLine).
const WORDS_PER_SECOND = 2.5;

/**
 * The length the user's standing instructions set, as the request states it.
 * null: they say nothing about length, so the request keeps its own. '': they
 * speak about length with nothing to restate here (a list size, "be thorough"),
 * so the request names none and the system prompt's reading of them stands.
 */
function standingLength(deliveredInstructions: string): string | null {
    const analysis = analyzeUserInstructions(deliveredInstructions);
    if (!userInstructionsOverrideAppLength(analysis)) return null;
    const target = analysis.length;
    if (!target || target.unit === 'bullets') return '';
    const inWords = target.unit === 'seconds';
    const scale = (n: number) => (inWords ? Math.round(n * WORDS_PER_SECOND) : n);
    const count = scale(target.count);
    const unit = inWords ? 'words' : target.unit;
    const named = count === 1 ? unit.replace(/s$/, '') : unit;
    return target.min !== undefined
        ? `Between ${scale(target.min)} and ${count} ${named}`
        : `${BOUND_WORDS[target.bound]} ${count} ${named}`;
}

// A class sat through in General mode got a candidate's questions: the lecturer
// was asked how "your team" tunes a learning rate. General reads a conversation
// as an interview unless it plainly is something else, and a transcript whose
// only speaker is labelled [INTERVIEWER] is not plainly anything.
//
// Said in the General prompt for every press, it cost the interview cases (a
// typed question on Haiku went from 17 of 24 right to 8). So it is said here,
// and only when nobody but the other person has spoken (the engine decides):
// the shape a class has and an answered question has not. Three models, eight
// runs, three questions a run, questions about the material (2026-10-10):
//
//   a lecture on gradient descent          28 of 72 -> 67 of 72
//   the same with "any questions so far?"  25 of 72 -> 68 of 72
//   a history lecture                      58 of 72 -> 69 of 72
//   an interviewer's introduction and first question, unanswered:
//     still a candidate's questions        67 of 72 -> 66 of 72
//
// "none of it is a question for me to answer" is what keeps that last row:
// without it a lone "What is an API?" drew questions about APIs (49 of 72
// right, against 69 with no clause at all).
const IF_THEY_ARE_TEACHING = '. If they are giving a class or a talk and none of it is a question for me to answer, ask about the material itself and never about their team';

/** The request for one press: what was asked, how long, in which language. */
function requestFor(action: QuickAction, extras: QuickActionTurnExtras | undefined): string {
    // What the prompt will actually carry: sentences that try to lift the
    // grounding rules are removed on every carrier (promptSystemV2
    // cleanCustomInstructions), and instructions that were nothing else leave
    // no block to point at.
    const standing = extras?.standingInstructions ? removeGroundingOverrides(extras.standingInstructions).text.trim() : '';
    const own = DEFAULT_LENGTH[action];
    const userLength = standing && own ? standingLength(standing) : null;
    const length = own ? (userLength ?? own.length) : '';
    const listening = action === 'follow_up_questions' && extras?.otherPersonSpokeAlone ? IF_THEY_ARE_TEACHING : '';
    const name = action === 'custom_button' ? extras?.customButtonName?.replace(/["<>]/g, '').trim() : '';
    const asked = name ? `Do what my ${name} button asks, as its instructions say` : REQUESTS[action];
    return `${asked}${listening}${length ? `. ${length}${own?.outside ?? ''}` : ''}${extras?.languagePinned ? '' : IN_CONVERSATION_LANGUAGE}.${standing ? STANDING_INSTRUCTIONS_FIRST : ''}`;
}

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
    /**
     * Evidence the decision layer already retrieved, filtered and rendered for
     * the question on the table (context-packer's <evidence> elements, content
     * escaped there): the reference files and profile Brainstorm reads from.
     * It joins the evidence set as it is, after the problem statement.
     */
    renderedEvidence?: string;
    /**
     * The mode's Real-time prompt, when the system prompt this turn is sent
     * with carries one. The request then defers to it (requestFor).
     */
    standingInstructions?: string;
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
    /**
     * Nobody but the other person has spoken in the window: no words from the
     * user and no answer shown to them. That is what a class or a talk looks
     * like, so Follow-up questions is told what to ask if it is one
     * (IF_THEY_ARE_TEACHING).
     */
    otherPersonSpokeAlone?: boolean;
    /** The pressed custom button's name, for its request. */
    customButtonName?: string;
}

/** What the engine tells Clarify and Follow-up questions about the context it hands them. */
export type QuickActionContextOptions = Pick<QuickActionTurnExtras, 'contextIsRendered' | 'otherPersonSpokeAlone'>;

// The envelope's own tags. The block placed before the request is app-rendered
// but quotes the design's question and its diagram source, and neither is
// escaped there, so a question holding "<task>" would put a second task in the
// turn. It cannot move the real one, which is still last, but it should not be
// able to pose as one either.
const ENVELOPE_TAG_RE = /<(\/?)(task|current_turn|recent_transcript|evidence_set|evidence|assembled_context)\b/gi;
const neutraliseEnvelopeTags = (block: string): string => block.replace(ENVELOPE_TAG_RE, '&lt;$1$2');
// Rendered evidence is made of <evidence> elements, so those stay; nothing in
// it may open or close the set or any other part of the envelope.
const EVIDENCE_SET_OPEN = '<evidence_set>\n';
const EVIDENCE_SET_CLOSE = '\n</evidence_set>';
const ENVELOPE_TAG_BAR_EVIDENCE_RE = /<(\/?)(task|current_turn|recent_transcript|evidence_set|assembled_context)\b/gi;

/** Adds decision-layer evidence to the turn's evidence set, opening one when the turn has none. */
function withRenderedEvidence(turn: string, renderedEvidence: string | undefined): string {
    const rendered = renderedEvidence?.trim().replace(ENVELOPE_TAG_BAR_EVIDENCE_RE, '&lt;$1$2');
    if (!rendered) return turn;
    // The set, when there is one, opens the turn and its content is escaped,
    // so the first closing tag is its own.
    const close = turn.startsWith(EVIDENCE_SET_OPEN) ? turn.indexOf(EVIDENCE_SET_CLOSE) : -1;
    return close >= 0
        ? `${turn.slice(0, close)}\n${rendered}${turn.slice(close)}`
        : `${EVIDENCE_SET_OPEN}${rendered}${EVIDENCE_SET_CLOSE}\n\n${turn}`;
}

/**
 * `systemPrompt` is the prompt the call will be sent with. A v2 prompt (also
 * one a caller has appended a rule to, hence the prefix test and not the exact
 * registry) gets the turn envelope; a legacy prompt keeps the bare context it
 * was written for, byte for byte.
 */
export function buildQuickActionTurn(action: QuickAction, systemPrompt: string, context: string, extras?: QuickActionTurnExtras): string {
    try {
        if (carriesV2Core(systemPrompt)) {
            const request = requestFor(action, extras);
            if (extras?.contextIsRendered) {
                return buildAssembledTurnContentV2({ assembledContext: context, currentTurn: request, directRequest: request });
            }
            const turn = withRenderedEvidence(
                buildTurnContentV2({ evidence: extras?.evidence, recentTranscript: context, currentTurn: request, directRequest: request }),
                extras?.renderedEvidence,
            );
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
