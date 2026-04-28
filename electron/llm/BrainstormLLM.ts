import { LLMHelper } from "../LLMHelper";
import { getResolvedPromptBody } from "./promptResolver";

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
            yield* this.llmHelper.streamChat(context, imagePaths, undefined, getResolvedPromptBody("codingBrainstorm"));
        } catch (error) {
            console.error("[BrainstormLLM] Stream failed:", error);
            yield "Could not generate approaches from this context. Try a screenshot (attach or capture), more transcript, or use System Design (Ctrl+M / ⌘M) if you meant architecture.";
        }
    }
}
