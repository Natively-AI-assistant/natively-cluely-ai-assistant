import { LLMHelper } from "../LLMHelper";
import { UNIVERSAL_FOLLOWUP_PROMPT } from "./prompts";
import { TINY_FOLLOWUP_PROMPT } from "./tinyPrompts";

export class FollowUpLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    private resolvePrompt(): string {
        return this.llmHelper.getPromptTier() === 'tiny' ? TINY_FOLLOWUP_PROMPT : UNIVERSAL_FOLLOWUP_PROMPT;
    }

    async generate(previousAnswer: string, refinementRequest: string, context?: string): Promise<string> {
        try {
            const message = `PREVIOUS ANSWER:\n${previousAnswer}\n\nREQUEST: ${refinementRequest}`;
            const fittedContext = context ? this.llmHelper.fitContextForCurrentModel(context) : context;
            // ignoreKnowledgeMode=true — `message` is a synthesized meta-message
            // ("PREVIOUS ANSWER:...\nREQUEST:...") that embeds the prior answer
            // verbatim, not a real question. Letting it through the knowledge-mode
            // intent classifier risks misclassifying this refinement call as an
            // intro/identity request whenever the previous answer happened to
            // discuss the candidate's name/background (see ClarifyLLM.generate()).
            const stream = this.llmHelper.streamChat(message, undefined, fittedContext, this.resolvePrompt(), true);
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
            const fittedContext = context ? this.llmHelper.fitContextForCurrentModel(context) : context;
            // See generate() above — ignoreKnowledgeMode=true.
            yield* this.llmHelper.streamChat(message, undefined, fittedContext, this.resolvePrompt(), true);
        } catch (e) {
            console.error("[FollowUpLLM] Stream Failed:", e);
        }
    }
}
