import { LLMHelper } from "../LLMHelper";
import { UNIVERSAL_FOLLOW_UP_QUESTIONS_PROMPT } from "./prompts";
import { TINY_FOLLOW_UP_QUESTIONS_PROMPT } from "./tinyPrompts";
import { resolveV2SystemPrompt, v2TierForPromptTier } from "./promptSystemV2";
import { buildQuickActionTurn, responseLanguageIsPinned, type QuickActionContextOptions } from "./quickActionTurn";

export class FollowUpQuestionsLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    private resolvePrompt(): string {
        return resolveV2SystemPrompt({ action: 'follow_up_questions', tier: v2TierForPromptTier(this.llmHelper.getPromptTier()) })
            ?? (this.llmHelper.getPromptTier() === 'tiny' ? TINY_FOLLOW_UP_QUESTIONS_PROMPT : UNIVERSAL_FOLLOW_UP_QUESTIONS_PROMPT);
    }

    private buildTurn(prompt: string, context: string, options?: QuickActionContextOptions): string {
        return buildQuickActionTurn('follow_up_questions', prompt, this.llmHelper.fitContextForCurrentModel(context), {
            languagePinned: responseLanguageIsPinned(this.llmHelper),
            contextIsRendered: options?.contextIsRendered,
        });
    }

    async generate(context: string, options?: QuickActionContextOptions): Promise<string> {
        try {
            const prompt = this.resolvePrompt();
            // The request is the turn; the transcript is its background (quickActionTurn.ts).
            const message = this.buildTurn(prompt, context, options);
            // ignoreKnowledgeMode=true — see ClarifyLLM.generate() for the full
            // rationale: `context` is a conversation-context blob (recent manual
            // Q&A / transcript), not a real question, and the knowledge-mode
            // intent classifier can misfire on it (e.g. an identity-flavored prior
            // turn short-circuits this ENTIRE call to the canned intro response).
            const stream = this.llmHelper.streamChat(message, undefined, undefined, prompt, true);
            let full = "";
            for await (const chunk of stream) full += chunk;
            return full;
        } catch (e) {
            console.error("[FollowUpQuestionsLLM] Failed:", e);
            return "";
        }
    }

    async *generateStream(context: string, options?: QuickActionContextOptions): AsyncGenerator<string> {
        try {
            const prompt = this.resolvePrompt();
            const message = this.buildTurn(prompt, context, options);
            // See generate() above — ignoreKnowledgeMode=true.
            yield* this.llmHelper.streamChat(message, undefined, undefined, prompt, true);
        } catch (e) {
            console.error("[FollowUpQuestionsLLM] Stream Failed:", e);
        }
    }
}
