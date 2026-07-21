// electron/llm/AssistLLM.ts
// MODE: Assist - Passive observation (low priority)
// Provides brief observational insights, NEVER suggests what to say
// Uses LLMHelper for centralized routing and universal prompts

import { LLMHelper } from "../LLMHelper";
import { UNIVERSAL_ASSIST_PROMPT } from "./prompts";
import { TINY_ASSIST_PROMPT } from "./tinyPrompts";

export class AssistLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    /**
     * Generate passive observational insight
     * @param context - Current conversation context
     * @returns Insight (no post-clamp; prompt enforces brevity)
     */
    async generate(context: string, abortSignal?: AbortSignal): Promise<string> {
        try {
            if (!context.trim()) {
                return "";
            }

            // Centralized LLM logic
            // providing a specific instruction as message, using UNIVERSAL_ASSIST_PROMPT as system prompt
            const instruction = "Briefly summarize what is happening right now in 1-2 sentences. Do not give advice, just observation.";

            const promptOverride = this.llmHelper.getPromptTier() === 'tiny' ? TINY_ASSIST_PROMPT : UNIVERSAL_ASSIST_PROMPT;
            const fittedContext = this.llmHelper.fitContextForCurrentModel(context);
            let result = "";
            for await (const chunk of this.llmHelper.streamChat(
                instruction,
                undefined,
                fittedContext,
                promptOverride,
                false,
                true,
                [],
                abortSignal,
            )) {
                if (abortSignal?.aborted) return "";
                result += chunk;
            }
            return result;

        } catch (error) {
            console.error("[AssistLLM] Generation failed:", error);
            return "";
        }
    }
}
