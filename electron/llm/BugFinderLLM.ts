import { LLMHelper } from "../LLMHelper";
import { buildBugFinderMessage } from "./prompts";
import { getResolvedPromptBody } from "./promptResolver";

export class BugFinderLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    async *generateStream(
        imagePaths?: string[],
        questionContext?: string,
        questionSource?: 'screenshot' | 'transcript' | null,
        transcriptContext?: string
    ): AsyncGenerator<string> {
        try {
            const message = buildBugFinderMessage(
                questionContext ?? null,
                questionSource ?? null,
                transcriptContext ?? null
            );

            yield* this.llmHelper.streamChat(
                message,
                imagePaths,
                undefined,
                getResolvedPromptBody("bugFinder")
            );
        } catch (error) {
            console.error("[BugFinderLLM] Stream failed:", error);
            yield "I couldn't analyze the screenshot. Make sure your code is visible and try again.";
        }
    }
}
