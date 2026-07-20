import { LLMHelper } from "../LLMHelper";
import { BRAINSTORM_MODE_PROMPT } from "./prompts";
import { TINY_BRAINSTORM_PROMPT } from "./tinyPrompts";

export class BrainstormLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    /**
     * Generate a "thinking out loud" spoken script (streamed)
     * Context is passed directly as the user message so the LLM sees the problem.
     */
    async *generateStream(context: string, imagePaths?: string[]): AsyncGenerator<string> {
        if (!context.trim() && !imagePaths?.length) return;
        try {
            const promptOverride = this.llmHelper.getPromptTier() === 'tiny' ? TINY_BRAINSTORM_PROMPT : BRAINSTORM_MODE_PROMPT;
            const fittedContext = context ? this.llmHelper.fitContextForCurrentModel(context) : context;
            yield* this.llmHelper.streamChat(fittedContext, imagePaths, undefined, promptOverride, false, false, [], undefined, 1024);
        } catch (error) {
            console.error("[BrainstormLLM] Stream failed:", error);
            yield "I couldn't generate brainstorm approaches. Make sure your question is visible and try again.";
        }
    }
}
