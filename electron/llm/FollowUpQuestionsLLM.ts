import { LLMHelper } from "../LLMHelper";
import { getResolvedPromptBody } from "./promptResolver";

export class FollowUpQuestionsLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    async generate(context: string): Promise<string> {
        try {
            const stream = this.llmHelper.streamChat(context, undefined, undefined, getResolvedPromptBody("aiDesign"));
            let full = "";
            for await (const chunk of stream) full += chunk;
            return full;
        } catch (e) {
            console.error("[FollowUpQuestionsLLM] Failed:", e);
            return "";
        }
    }

    async *generateStream(context: string, imagePaths?: string[]): AsyncGenerator<string> {
        if (!context.trim() && !imagePaths?.length) return;
        try {
            yield* this.llmHelper.streamChat(context, imagePaths, undefined, getResolvedPromptBody("aiDesign"));
        } catch (e) {
            console.error("[FollowUpQuestionsLLM] Stream Failed:", e);
        }
    }
}
