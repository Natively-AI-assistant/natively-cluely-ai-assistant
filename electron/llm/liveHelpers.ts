import type { LLMHelper } from "../LLMHelper";
import { resolveV2SystemPrompt, v2TierForPromptTier } from "./promptSystemV2";
import { buildQuickActionTurn, responseLanguageIsPinned, type QuickActionContextOptions } from "./quickActionTurn";

/**
 * The overlay's live helpers (2026-10-15), pressed mid-meeting:
 *
 *   catch_me_up  "What did I miss?": what was said since the user last
 *                touched the overlay (at least the last 3 minutes, at most
 *                the last 20), as two or three plain bullets (Granola's
 *                shape, 2026-10-31)
 *   define       "Define": the last term, acronym or name that may be
 *                unfamiliar, explained in a sentence or two
 *   sound_smart  "Sound smart": one specific point or question the user could
 *                say now, built on what was just said
 *
 * Each is a quick action like Recap and Clarify: same turn envelope
 * (quickActionTurn.ts), same streaming path (IntelligenceEngine.runLiveHelper),
 * same provider routing, no reasoning mode (streamChat, the live answer path's
 * settings), and a press is superseded by any answer that starts after it.
 *
 * The system prompt is the v2 action prompt when the v2 prompt system is on
 * (promptSystemV2 ACTIONS: catch_me_up, define, sound_smart); otherwise the
 * short prompts below, written for this feature.
 */
export type LiveHelperAction = 'catch_me_up' | 'define' | 'sound_smart' | 'follow_up_questions';

export const LIVE_HELPER_ACTIONS: readonly LiveHelperAction[] = ['catch_me_up', 'define', 'sound_smart', 'follow_up_questions'];

export function isLiveHelperAction(value: unknown): value is LiveHelperAction {
    return typeof value === 'string' && (LIVE_HELPER_ACTIONS as readonly string[]).includes(value);
}

/** "What did I miss?" looks back at least this far, even right after the last press. */
export const CATCH_UP_MIN_WINDOW_MS = 3 * 60 * 1000;
/** And never further than this: past it, Recap is the better button. */
export const CATCH_UP_MAX_WINDOW_MS = 20 * 60 * 1000;

/**
 * The window "What did I miss?" covers, in seconds: from the user's last
 * interaction with the overlay before this press (when the renderer knows it),
 * held between 3 and 20 minutes.
 */
export function catchUpWindowSeconds(nowMs: number, lastInteractionMs?: number | null): number {
    const since = typeof lastInteractionMs === 'number' && Number.isFinite(lastInteractionMs) && lastInteractionMs <= nowMs
        ? nowMs - lastInteractionMs
        : CATCH_UP_MIN_WINDOW_MS;
    const ms = Math.min(CATCH_UP_MAX_WINDOW_MS, Math.max(CATCH_UP_MIN_WINDOW_MS, since));
    return Math.round(ms / 1000);
}

/** How far back Define and Sound smart read, in seconds. */
export const LIVE_HELPER_WINDOW_SECONDS: Record<Exclude<LiveHelperAction, 'catch_me_up'>, number> = {
    define: 120,
    sound_smart: 180,
    follow_up_questions: 240,
};

/** Where each helper's words appear in the overlay: Recap's card or Clarify's line. */
export function liveHelperDisplayKind(action: LiveHelperAction): 'recap' | 'clarify' {
    return action === 'sound_smart' || action === 'follow_up_questions' ? 'clarify' : 'recap';
}

/** What the overlay says when there is nothing to work from. */
export const LIVE_HELPER_EMPTY: Record<LiveHelperAction, string> = {
    catch_me_up: "Nothing was said in the last few minutes, so you haven't missed anything.",
    define: 'There is nothing in the conversation yet to explain.',
    sound_smart: 'There is no conversation yet to build on. Try again once people are talking.',
    follow_up_questions: 'There is no conversation yet to ask about. Try again once people are talking.',
};

// Used when the v2 prompt system is off. Natively's own wording.
const LEGACY_PROMPTS: Record<LiveHelperAction, string> = {
    follow_up_questions: `You suggest follow-up questions during a live conversation.
Read the last few minutes of the transcript and give the four or five most useful questions the user could ask next: ones that clear up something vague, pin down an owner or a date, test a claim against its own numbers, or surface a risk nobody has named. Start with one short line naming the setting ("Questions that would sharpen the plan:", "For your conversation with Lina, I'd ask:"), then one "- " bullet per question: a one- or two-word topic, a colon, then the question in the words the user would actually say, naming the specific detail it is about ("- Renewal: What does Lars need to see before approving the extension?"). At most one short line after the list on which to ask first. Nothing invented.`,
    catch_me_up: `You help someone who looked away from a live conversation for a few minutes and wants to rejoin it.
Read only the transcript you are given. Tell them what was said, as two or three "- " bullets in the order it happened, the newest last: one or two plain sentences each, carrying the exact figures, names, dates and terms said. Name people as the transcript names them, or "they"; never "the interviewer" or "the speaker". No labels, headings or bold. Include what was decided and anything asked of them. If the last line breaks off mid-thought, end with a bullet saying someone had just started to raise another point. If nothing of substance was said, say that in one line.
Never add anything the transcript does not say.`,
    define: `You explain an unfamiliar word during a live conversation.
Find the most recent term, acronym, product or name in the transcript that a listener might not know. Start with the term, then explain in at most two short sentences what it is and what it means in this conversation.
If the transcript says what it means, use that. Otherwise give its standard meaning and never invent a company-specific one.`,
    sound_smart: `You give someone in a live conversation one thing worth saying next.
Write one short lead line ("You could say:", "Here's a sharper way to say it:"), then one specific, insightful point that builds on the figures, names and terms just said, as a "> " quote in their own voice, ready to say aloud: two to four sentences (it may end with a question). At most one short line after it on how to use it. Nothing else.
Never generic praise, never a summary of the conversation, and nothing the transcript does not support.`,
};

/** The system prompt for one helper: v2 when on, the prompts above otherwise. */
export function liveHelperSystemPrompt(action: LiveHelperAction, promptTier: string | undefined): string {
    // The v2 prompt system has no action for follow-up questions; its own prompt applies on every tier.
    if (action === 'follow_up_questions') return LEGACY_PROMPTS[action];
    return resolveV2SystemPrompt({ action, tier: v2TierForPromptTier(promptTier) }) ?? LEGACY_PROMPTS[action];
}

export class LiveHelperLLM {
    constructor(private readonly llmHelper: LLMHelper) {}

    /** The system prompt and the turn one press sends. Exposed for tests. */
    buildRequest(action: LiveHelperAction, context: string, options?: QuickActionContextOptions): { systemPrompt: string; message: string } {
        const systemPrompt = liveHelperSystemPrompt(action, this.llmHelper.getPromptTier());
        const fitted = this.llmHelper.fitContextForCurrentModel(context);
        const message = buildQuickActionTurn(action, systemPrompt, fitted, {
            languagePinned: responseLanguageIsPinned(this.llmHelper),
            contextIsRendered: options?.contextIsRendered,
        });
        // A legacy prompt gets the bare context back from the builder; the
        // task is added so the model is told which helper was pressed.
        return { systemPrompt, message: message === fitted ? `${message}\n\n${LEGACY_TASK_LINE[action]}` : message };
    }

    async *generateStream(action: LiveHelperAction, context: string, options?: QuickActionContextOptions): AsyncGenerator<string> {
        if (!context.trim()) return;
        const { systemPrompt, message } = this.buildRequest(action, context, options);
        // ignoreKnowledgeMode=true: the context is a transcript blob, not a
        // question (see ClarifyLLM.generate). Failures are thrown on: the
        // engine reports them with the provider's reason.
        yield* this.llmHelper.streamChat(message, undefined, undefined, systemPrompt, true);
    }
}

const LEGACY_TASK_LINE: Record<LiveHelperAction, string> = {
    catch_me_up: 'Task: tell me what I missed in the transcript above.',
    define: 'Task: explain the most recent unfamiliar term in the transcript above.',
    sound_smart: 'Task: give me one specific point or question I could say next.',
    follow_up_questions: 'Task: give me the four or five most useful follow-up questions I could ask now.',
};
