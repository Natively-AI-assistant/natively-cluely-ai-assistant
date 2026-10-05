import { LLMHelper } from "../LLMHelper";
import { UNIVERSAL_ANSWER_PROMPT } from "./prompts";
import { TINY_ANSWER_PROMPT } from "./tinyPrompts";
import { formatAnswerPlanForPrompt, isCodingAnswerType } from "./AnswerPlanner";
import { resolveCodingPromptSignals } from "./codingPromptSignals";
import type { AnswerPlan } from "./AnswerPlanner";
import { isCodeVerificationEnabled } from "./codeVerification/verificationEnabled";
import { resolveV2SystemPrompt, v2TierForPromptTier } from "./promptSystemV2";
import { withDiagramContract, withDiagramTurnBlock, type DiagramTurn } from "./diagramPromptSignals";

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
     * @param diagramTurn The caller's diagram decision for this turn
     *   (diagramPromptSignals.ts). The contract is put on whichever system
     *   prompt is used — a V3 system has no persona on this surface, so this is
     *   its only carrier — and the design on the table joins the context on the
     *   non-V3 path (the V3 composer already rendered it into `question`).
     */
    async generate(question: string, context?: string, answerPlan?: AnswerPlan, systemPromptOverride?: string, diagramTurn?: DiagramTurn | null): Promise<string> {
        try {
            // One resolution for both the system contract and the planner
            // template below, so they ask for the same coding shape.
            const codingSignals = resolveCodingPromptSignals({ answerType: answerPlan?.answerType, question: answerPlan?.question || question });
            const v2Tier = v2TierForPromptTier(this.llmHelper.getPromptTier());
            const promptOverride = withDiagramContract(
                systemPromptOverride
                    ?? resolveV2SystemPrompt({ action: 'answer', tier: v2Tier, ...codingSignals, diagram: diagramTurn?.signals ?? null })
                    ?? (this.llmHelper.getPromptTier() === 'tiny' ? TINY_ANSWER_PROMPT : UNIVERSAL_ANSWER_PROMPT),
                diagramTurn,
                { tier: v2Tier, surface: 'live' },
            );
            const answerContract = answerPlan ? `\n\n${formatAnswerPlanForPrompt(answerPlan, isCodeVerificationEnabled(), codingSignals.codingShape)}` : '';
            const designBlock = systemPromptOverride ? '' : withDiagramTurnBlock('', diagramTurn);
            const contextWithDesign = designBlock ? (context ? `${context}\n\n${designBlock}` : designBlock) : context;
            const fittedContext = contextWithDesign ? this.llmHelper.fitContextForCurrentModel(`${contextWithDesign}${answerContract}`) : answerContract.trim() || contextWithDesign;
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
