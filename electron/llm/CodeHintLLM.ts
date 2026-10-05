import { LLMHelper } from "../LLMHelper";
import { CODE_HINT_PROMPT, buildCodeHintMessage } from "./prompts";
import { TINY_CODE_HINT_PROMPT } from "./tinyPrompts";
import { resolveV2SystemPrompt, v2TierForPromptTier } from "./promptSystemV2";

export class CodeHintLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    /**
     * @param v3 A Context-Intelligence-V3 composed prompt, when the engine
     *   resolved one for this turn. Same shape and same substitution rule as
     *   AssistLLM, ClarifyLLM and BrainstormLLM.
     *
     *   This surface was in the V3 bridge's stated scope from the start — its
     *   header names "assist, clarify, brainstorm, code-hint and manual answer"
     *   — and was the one of the five never wired. So a coding question asked
     *   in a mode holding, say, a company coding-standards document got no
     *   source authority and no governed retrieval, while the same question
     *   asked through assist did.
     */
    async *generateStream(
        imagePaths?: string[],
        questionContext?: string,
        questionSource?: 'screenshot' | 'transcript' | null,
        transcriptContext?: string,
        v3?: { system: string; user: string }
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

            const promptOverride = v3?.system
                ?? resolveV2SystemPrompt({ action: 'code_hint', tier: v2TierForPromptTier(this.llmHelper.getPromptTier()) })
                ?? (this.llmHelper.getPromptTier() === 'tiny' ? TINY_CODE_HINT_PROMPT : CODE_HINT_PROMPT);
            // V3 composed the turn content too, evidence and all, so it must not
            // be re-fitted: fitContextForCurrentModel would truncate a governed
            // evidence block from the middle and leave a citation pointing at
            // text no longer present.
            const fittedMessage = v3?.user ?? this.llmHelper.fitContextForCurrentModel(message);

            yield* this.llmHelper.streamChat(
                fittedMessage,
                imagePaths,
                undefined,
                promptOverride,
                // Both flags are FALSE without v3, which is exactly what the four
                // positional arguments defaulted to before, so the legacy path is
                // byte-for-byte unchanged.
                Boolean(v3),   // ignoreKnowledgeMode — a V3-owned prompt must not be re-classified
                Boolean(v3),   // skipModeInjection — V3's prompt already carries the mode contract
                [],
                undefined,
                undefined,
                v3 ? { v3Owned: true } : undefined
            );
        } catch (error) {
            console.error("[CodeHintLLM] Stream failed:", error);
            yield "I couldn't analyze the screenshot. Make sure your code is visible and try again.";
        }
    }
}
