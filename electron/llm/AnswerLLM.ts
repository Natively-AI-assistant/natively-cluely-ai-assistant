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
    async generate(question: string, context?: string, answerPlan?: AnswerPlan): Promise<string> {
        try {
            const promptOverride = this.llmHelper.getPromptTier() === 'tiny' ? TINY_ANSWER_PROMPT : UNIVERSAL_ANSWER_PROMPT;
            const answerContract = answerPlan ? `\n\n${formatAnswerPlanForPrompt(answerPlan, isCodeVerificationEnabled())}` : '';
            const fittedContext = context ? this.llmHelper.fitContextForCurrentModel(`${context}${answerContract}`) : answerContract.trim() || context;
            const stream = this.llmHelper.streamChat(
                question,
                undefined,
                fittedContext,
                promptOverride,
                false,
                false,
                [],
                undefined,
                undefined,
                answerPlan ? { answerType: answerPlan.answerType, forbiddenContextLayers: answerPlan.forbiddenContextLayers } : undefined,
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
