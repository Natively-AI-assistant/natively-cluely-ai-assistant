import { LLMHelper } from "../LLMHelper";
import { UNIVERSAL_FOLLOW_UP_QUESTIONS_PROMPT } from "./prompts";

export class FollowUpQuestionsLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    async generate(context: string): Promise<string> {
        try {
            const stream = this.llmHelper.streamChat(context, undefined, undefined, UNIVERSAL_FOLLOW_UP_QUESTIONS_PROMPT, true);
            let full = "";
            for await (const chunk of stream) full += chunk;
            return full;
        } catch (e) {
            console.error("[FollowUpQuestionsLLM] Failed:", e);
            return "";
        }
    }

    async *generateStream(context: string): AsyncGenerator<string> {
        try {
            yield* this.llmHelper.streamChat(context, undefined, undefined, UNIVERSAL_FOLLOW_UP_QUESTIONS_PROMPT, true);
        } catch (e) {
            console.error("[FollowUpQuestionsLLM] Stream Failed:", e);
        }
    }
}
