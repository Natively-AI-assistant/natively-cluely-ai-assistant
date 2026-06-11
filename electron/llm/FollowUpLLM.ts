import { LLMHelper } from "../LLMHelper";
import { UNIVERSAL_FOLLOWUP_PROMPT } from "./prompts";

export class FollowUpLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    async generate(previousAnswer: string, refinementRequest: string, context?: string): Promise<string> {
        try {
            const message = `PREVIOUS ANSWER:\n${previousAnswer}\n\nREQUEST: ${refinementRequest}`;
            const stream = this.llmHelper.streamChat(message, undefined, context, UNIVERSAL_FOLLOWUP_PROMPT, true);
            let full = "";
            for await (const chunk of stream) full += chunk;
            return full;
        } catch (e) {
            console.error("[FollowUpLLM] Failed:", e);
            return "";
        }
    }

    async *generateStream(previousAnswer: string, refinementRequest: string, context?: string): AsyncGenerator<string> {
        try {
            const message = `PREVIOUS ANSWER:\n${previousAnswer}\n\nREQUEST: ${refinementRequest}`;
            yield* this.llmHelper.streamChat(message, undefined, context, UNIVERSAL_FOLLOWUP_PROMPT, true);
        } catch (e) {
            console.error("[FollowUpLLM] Stream Failed:", e);
        }
    }
}
