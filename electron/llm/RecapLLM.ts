import { LLMHelper } from "../LLMHelper";
import { UNIVERSAL_EPOCH_SUMMARY_PROMPT, UNIVERSAL_SYSTEM_DESIGN_PROMPT } from "./prompts";

export class RecapLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    /**
     * Generate a neutral conversation summary
     */
    async generate(context: string): Promise<string> {
        if (!context.trim()) return "";
        try {
            const stream = this.llmHelper.streamChat(context, undefined, undefined, UNIVERSAL_EPOCH_SUMMARY_PROMPT);
            let fullResponse = "";
            for await (const chunk of stream) fullResponse += chunk;
            return this.clampEpochSummary(fullResponse);
        } catch (error) {
            console.error("[RecapLLM] Generation failed:", error);
            return "";
        }
    }

    /**
     * Generate a neutral conversation summary (Streamed)
     */
    async *generateStream(context: string, imagePaths?: string[]): AsyncGenerator<string> {
        if (!context.trim() && !imagePaths?.length) return;
        try {
            yield* this.llmHelper.streamChat(context, imagePaths, undefined, UNIVERSAL_SYSTEM_DESIGN_PROMPT);
        } catch (error) {
            console.error("[RecapLLM] Streaming generation failed:", error);
        }
    }

    private clampEpochSummary(text: string): string {
        if (!text) return "";
        return text.split('\n').filter(l => l.trim()).slice(0, 5).join('\n');
    }
}
