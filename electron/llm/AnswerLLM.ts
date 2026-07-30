import { LLMHelper } from "../LLMHelper";
import { UNIVERSAL_ANSWER_PROMPT } from "./prompts";
import { TINY_ANSWER_PROMPT } from "./tinyPrompts";
import { formatAnswerPlanForPrompt } from "./AnswerPlanner";
import type { AnswerPlan } from "./AnswerPlanner";
import { isCodeVerificationEnabled } from "./codeVerification/verificationEnabled";

export class AnswerLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    /**
     * Generate a spoken interview answer
     */
    /**
     * @param systemPromptOverride Context Intelligence V3: when supplied, the
     *   caller has already composed the complete system prompt (safety rules,
     *   source authority, mode, grounding, capabilities) and it REPLACES the
     *   universal prompt. Without this the V3 prompt would have to be smuggled
     *   in through `context`, where it would read as evidence rather than as
     *   policy — and evidence is explicitly untrusted data.
     */
    async generate(question: string, context?: string, answerPlan?: AnswerPlan, systemPromptOverride?: string): Promise<string> {
        try {
            const promptOverride = systemPromptOverride
                ?? (this.llmHelper.getPromptTier() === 'tiny' ? TINY_ANSWER_PROMPT : UNIVERSAL_ANSWER_PROMPT);
            const answerContract = answerPlan ? `\n\n${formatAnswerPlanForPrompt(answerPlan, isCodeVerificationEnabled())}` : '';
            const fittedContext = context ? this.llmHelper.fitContextForCurrentModel(`${context}${answerContract}`) : answerContract.trim() || context;
            // A V3-composed turn (systemPromptOverride supplied) owns its prompt
            // end-to-end: the knowledge intercept, mode injection, and the
            // doc-grounded reshaping in LLMHelper must all stand down, exactly
            // as on the wired manual-chat surface. Legacy calls (no override)
            // keep their original flags.
            const isV3Owned = Boolean(systemPromptOverride);
            const stream = this.llmHelper.streamChat(
                question,
                undefined,
                fittedContext,
                promptOverride,
                isV3Owned,   // ignoreKnowledgeMode
                isV3Owned,   // skipModeInjection
                [],
                undefined,
                undefined,
                {
                    ...(answerPlan ? { answerType: answerPlan.answerType, forbiddenContextLayers: answerPlan.forbiddenContextLayers } : {}),
                    ...(isV3Owned ? { v3Owned: true } : {}),
                },
            );

            let fullResponse = "";
            for await (const chunk of stream) {
                fullResponse += chunk;
            }
            return fullResponse.trim();

        } catch (error) {
            console.error("[AnswerLLM] Generation failed:", error);
            return "";
        }
    }
}
