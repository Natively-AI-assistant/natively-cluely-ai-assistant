import { LLMHelper } from "../LLMHelper";
import { UNIVERSAL_WHAT_TO_ANSWER_PROMPT } from "./prompts";
import { TINY_WHAT_TO_ANSWER_PROMPT } from "./tinyPrompts";
import { estimateTokens } from "./modelCapabilities";
import { TemporalContext } from "./TemporalContextBuilder";
import { IntentResult } from "./IntentClassifier";

export interface ActiveSkillContext {
    id: string;
    name: string;
    promptBlock: string;
}

export class WhatToAnswerLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    // Deprecated non-streaming method (redirect to streaming or implement if needed)
    async generate(cleanedTranscript: string): Promise<string> {
        // Simple wrapper around stream
        const stream = this.generateStream(cleanedTranscript);
        let full = "";
        for await (const chunk of stream) full += chunk;
        return full;
    }

    async *generateStream(
        cleanedTranscript: string,
        temporalContext?: TemporalContext,
        intentResult?: IntentResult,
        imagePaths?: string[],
        activeSkill?: ActiveSkillContext
    ): AsyncGenerator<string> {
        try {
            // Build a rich message context
            // Note: We can't easily inject the complex temporal/intent logic into universal prompt *variables* 
            // but we can prepend it to the message.

            let contextParts: string[] = [];

            if (intentResult) {
                contextParts.push(`<intent_and_shape>
DETECTED INTENT: ${intentResult.intent}
ANSWER SHAPE: ${intentResult.answerShape}
</intent_and_shape>`);
            }

            if (temporalContext && temporalContext.hasRecentResponses) {
                // ... simplify temporal context injection for universal prompt ...
                // Just dump it in context if possible
                const history = temporalContext.previousResponses.map((r, i) => `${i + 1}. "${r}"`).join('\n');
                contextParts.push(`PREVIOUS RESPONSES (Avoid Repetition):\n${history}`);
            }

            const extraContext = contextParts.join('\n\n');
            // Reserve room for extraContext + output via fitContextForCurrentModel; cloud returns unchanged.
            const reservedForFit = (this.llmHelper.getCapabilities().outputBudgetTokens || 2000) + estimateTokens(extraContext);
            const workingTranscript = this.llmHelper.fitContextForCurrentModel(cleanedTranscript, reservedForFit);
            const fullMessage = extraContext
                ? `${extraContext}\n\nCONVERSATION:\n${workingTranscript}`
                : workingTranscript;

            const basePrompt = this.llmHelper.getPromptTier() === 'tiny' ? TINY_WHAT_TO_ANSWER_PROMPT : UNIVERSAL_WHAT_TO_ANSWER_PROMPT;
            const promptOverride = activeSkill
                ? `${basePrompt}\n\n## ACTIVE SKILL\n${activeSkill.promptBlock}`
                : basePrompt;

            yield* this.llmHelper.streamChat(fullMessage, imagePaths, undefined, promptOverride, !!activeSkill, true);

        } catch (error) {
            console.error("[WhatToAnswerLLM] Stream failed:", error);
            yield "Could you repeat that? I want to make sure I address your question properly.";
        }
    }
}
