import { LLMHelper } from "../LLMHelper";
import { UNIVERSAL_FOLLOW_UP_QUESTIONS_PROMPT } from "./prompts";
import { TINY_FOLLOW_UP_QUESTIONS_PROMPT } from "./tinyPrompts";

export class FollowUpQuestionsLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    private resolvePrompt(): string {
        return this.llmHelper.getPromptTier() === 'tiny' ? TINY_FOLLOW_UP_QUESTIONS_PROMPT : UNIVERSAL_FOLLOW_UP_QUESTIONS_PROMPT;
    }

    async generate(context: string): Promise<string> {
        try {
            const fittedContext = this.llmHelper.fitContextForCurrentModel(context);
            // ignoreKnowledgeMode=true — see ClarifyLLM.generate() for the full
            // rationale: `context` is a conversation-context blob (recent manual
            // Q&A / transcript), not a real question, and the knowledge-mode
            // intent classifier can misfire on it (e.g. an identity-flavored prior
            // turn short-circuits this ENTIRE call to the canned intro response).
            const stream = this.llmHelper.streamChat(fittedContext, undefined, undefined, this.resolvePrompt(), true);
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
            const fittedContext = this.llmHelper.fitContextForCurrentModel(context);
            // See generate() above — ignoreKnowledgeMode=true.
            yield* this.llmHelper.streamChat(fittedContext, undefined, undefined, this.resolvePrompt(), true);
        } catch (e) {
            console.error("[FollowUpQuestionsLLM] Stream Failed:", e);
        }
    }
}
