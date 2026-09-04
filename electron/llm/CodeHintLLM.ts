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
                    // The advice has to match where the model actually runs. This
                    // said "The current local model (…) — switch to llava" for a
                    // cloud model reached through a LiteLLM proxy, which is both
                    // wrong and unactionable; the tier says which sentence applies.
                    const isLocal = caps.tier === 'local-small' || caps.tier === 'local-large';
                    yield isLocal
                        ? `The current local model (${caps.name}) doesn't support image input. Switch to a vision-capable model (e.g. llava, llama3.2-vision, gemma3) or use a cloud model.`
                        : `The current model (${caps.name}) doesn't support image input. Pick a vision-capable model in Settings — through a gateway, that means one whose upstream accepts images (e.g. a GPT-4o, Claude, or Gemini route).`;
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
