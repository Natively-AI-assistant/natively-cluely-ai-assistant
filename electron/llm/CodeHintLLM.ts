import { LLMHelper } from "../LLMHelper";
import { CODE_HINT_PROMPT, buildCodeHintMessage } from "./prompts";
import { TINY_CODE_HINT_PROMPT } from "./tinyPrompts";
import { resolveV2SystemPrompt, v2TierForPromptTier } from "./promptSystemV2";

export class CodeHintLLM {
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
            // Vision-required + small model lacking image support → fail loud, not malformed.
            if (imagePaths?.length) {
                const caps = this.llmHelper.getCapabilities();
                if (!caps.supportsImages) {
                    yield `The current local model (${caps.name}) doesn't support image input. Switch to a vision-capable model (e.g. llava, llama3.2-vision, gemma3) or use a cloud model.`;
                    return;
                }
            }

            const message = buildCodeHintMessage(
                questionContext ?? null,
                questionSource ?? null,
                transcriptContext ?? null
            );

            const promptOverride = resolveV2SystemPrompt({ action: 'code_hint', tier: v2TierForPromptTier(this.llmHelper.getPromptTier()) })
                ?? (this.llmHelper.getPromptTier() === 'tiny' ? TINY_CODE_HINT_PROMPT : CODE_HINT_PROMPT);
            const fittedMessage = this.llmHelper.fitContextForCurrentModel(message);

            yield* this.llmHelper.streamChat(
                fittedMessage,
                imagePaths,
                undefined,
                promptOverride
            );
        } catch (error) {
            console.error("[CodeHintLLM] Stream failed:", error);
            yield "I couldn't analyze the screenshot. Make sure your code is visible and try again.";
        }
    }
}
