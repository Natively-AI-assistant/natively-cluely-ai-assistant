import { LLMHelper } from "../LLMHelper";
import { CLARIFY_MODE_PROMPT } from "./prompts";
import { TINY_CLARIFY_PROMPT } from "./tinyPrompts";
import { resolveV2SystemPrompt, v2TierForPromptTier } from "./promptSystemV2";
import { buildQuickActionTurn, responseLanguageIsPinned, type QuickActionContextOptions } from "./quickActionTurn";

export class ClarifyLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    /**
     * The clarify prompt, always.
     *
     * This used to take a V3 composition and send THAT as the system prompt
     * whenever the engine had resolved a question out of the transcript. V3
     * composes an ANSWER prompt: it carries "Never ask the user to repeat,
     * rephrase or clarify" and puts the question under "# Question". Measured
     * 2026-10-09 on three models, 15 runs: Clarify answered the question every
     * time and asked nothing. V3 has no clarify surface, so there is nothing of
     * its to adopt here.
     */
    private resolvePrompt(): string {
        return resolveV2SystemPrompt({ action: 'clarify', tier: v2TierForPromptTier(this.llmHelper.getPromptTier()) })
            ?? (this.llmHelper.getPromptTier() === 'tiny' ? TINY_CLARIFY_PROMPT : CLARIFY_MODE_PROMPT);
    }

    private buildTurn(promptOverride: string, context: string, options?: QuickActionContextOptions): string {
        return buildQuickActionTurn('clarify', promptOverride, this.llmHelper.fitContextForCurrentModel(context), {
            languagePinned: responseLanguageIsPinned(this.llmHelper),
            contextIsRendered: options?.contextIsRendered,
        });
    }

    /**
     * Generate a clarification question
     */
    async generate(context: string, options?: QuickActionContextOptions): Promise<string> {
        if (!context.trim()) return "";
        try {
            const promptOverride = this.resolvePrompt();
            // The request is the turn; the transcript is its background (quickActionTurn.ts).
            const message = this.buildTurn(promptOverride, context, options);
            // ignoreKnowledgeMode=true: `context` is an internal conversation-context
            // blob (recent manual Q&A / transcript window), NOT a real question being
            // asked of the candidate. Without this, LLMHelper's knowledge-mode
            // intercept runs classifyIntent() over the WHOLE blob — and since the
            // blob echoes back the prior turn's raw question/answer text verbatim,
            // an identity-flavored prior turn ("what is my name") makes the intercept
            // misclassify this ENTIRE clarify call as an intro request and short-
            // circuit straight to "You are Evin John.", ignoring CLARIFY_MODE_PROMPT
            // and the actual clarifying-question task entirely (live bug report
            // 2026-07-04). Same fix applied to RecapLLM/FollowUpLLM/
            // FollowUpQuestionsLLM/BrainstormLLM, which have the identical shape.
            const stream = this.llmHelper.streamChat(message, undefined, undefined, promptOverride, true);
            let fullResponse = "";
            for await (const chunk of stream) fullResponse += chunk;
            return fullResponse.trim();
        } catch (error) {
            console.error("[ClarifyLLM] Generation failed:", error);
            return "";
        }
    }

    /**
     * Generate a clarification question (Streamed)
     */
    async *generateStream(context: string, options?: QuickActionContextOptions): AsyncGenerator<string> {
        if (!context.trim()) return;
        try {
            const promptOverride = this.resolvePrompt();
            const message = this.buildTurn(promptOverride, context, options);
            // See generate() above — ignoreKnowledgeMode=true prevents the context
            // blob from being misclassified by the knowledge-mode intent gate.
            yield* this.llmHelper.streamChat(message, undefined, undefined, promptOverride, true);
        } catch (error) {
            console.error("[ClarifyLLM] Streaming generation failed:", error);
        }
    }
}
