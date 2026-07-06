import { LLMHelper } from "../LLMHelper";
import { CLARIFY_MODE_PROMPT } from "./prompts";
import { TINY_CLARIFY_PROMPT } from "./tinyPrompts";

export class ClarifyLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    /**
     * Generate a clarification question
     */
    async generate(context: string): Promise<string> {
        if (!context.trim()) return "";
        try {
            const promptOverride = this.llmHelper.getPromptTier() === 'tiny' ? TINY_CLARIFY_PROMPT : CLARIFY_MODE_PROMPT;
            const fittedContext = this.llmHelper.fitContextForCurrentModel(context);
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
            const stream = this.llmHelper.streamChat(fittedContext, undefined, undefined, promptOverride, true);
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
    async *generateStream(context: string): AsyncGenerator<string> {
        if (!context.trim()) return;
        try {
            const promptOverride = this.llmHelper.getPromptTier() === 'tiny' ? TINY_CLARIFY_PROMPT : CLARIFY_MODE_PROMPT;
            const fittedContext = this.llmHelper.fitContextForCurrentModel(context);
            // See generate() above — ignoreKnowledgeMode=true prevents the context
            // blob from being misclassified by the knowledge-mode intent gate.
            yield* this.llmHelper.streamChat(fittedContext, undefined, undefined, promptOverride, true);
        } catch (error) {
            console.error("[ClarifyLLM] Streaming generation failed:", error);
        }
    }
}
