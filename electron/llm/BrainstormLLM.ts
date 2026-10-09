import { LLMHelper } from "../LLMHelper";
import { BRAINSTORM_MODE_PROMPT } from "./prompts";
import { TINY_BRAINSTORM_PROMPT } from "./tinyPrompts";
import { resolveV2SystemPrompt, v2TierForPromptTier, carriesV2Core } from "./promptSystemV2";
import { withDiagramContract, withDiagramTurnBlock, type DiagramTurn } from "./diagramPromptSignals";
import { buildQuickActionTurn, responseLanguageIsPinned } from "./quickActionTurn";

export class BrainstormLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    /**
     * Generate a "thinking out loud" spoken script (streamed).
     *
     * Always with the brainstorm prompt. This used to take a V3 composition
     * and send THAT whenever the engine had resolved a question out of the
     * transcript, which is nearly every press. V3 composes an ANSWER prompt
     * and has no brainstorm action in it, so the button was a second Answer:
     * measured 2026-10-09 on three models, 23 replies of 90 weighed two or more
     * approaches (Answer itself: 6 of 90). See ClarifyLLM.resolvePrompt, which
     * left the same contract for the same reason.
     *
     * @param diagramTurn Set by the engine when the active task is a system
     *   design: brainstorm then proposes alternatives to that design and draws
     *   the one it would pick (diagramPromptSignals.alternativeDesignTurn).
     * @param problemStatement The coding question on screen or detected in the
     *   conversation, when there is one.
     */
    async *generateStream(context: string, imagePaths?: string[], diagramTurn?: DiagramTurn | null, problemStatement?: string | null): AsyncGenerator<string> {
        const problem = problemStatement?.trim() || '';
        if (!context.trim() && !problem && !imagePaths?.length) return;
        try {
            const v2Tier = v2TierForPromptTier(this.llmHelper.getPromptTier());
            const basePrompt = resolveV2SystemPrompt({ action: 'brainstorm', tier: v2Tier, diagram: diagramTurn?.signals ?? null })
                ?? (this.llmHelper.getPromptTier() === 'tiny' ? TINY_BRAINSTORM_PROMPT : BRAINSTORM_MODE_PROMPT);
            const promptOverride = withDiagramContract(basePrompt, diagramTurn, { tier: v2Tier, surface: 'live' });
            const fit = (text: string) => (text ? this.llmHelper.fitContextForCurrentModel(text) : text);
            // The request is the turn; the transcript, the problem and the
            // design on the table are its background (quickActionTurn.ts). A
            // legacy prompt keeps the message it was written for, byte for byte.
            const designBlock = withDiagramTurnBlock('', diagramTurn);
            const message = carriesV2Core(basePrompt)
                ? buildQuickActionTurn(designBlock ? 'brainstorm_alternatives' : 'brainstorm', basePrompt, fit(context), {
                    evidence: problem ? [{ kind: 'other', source: 'problem statement', content: fit(problem) }] : undefined,
                    beforeRequest: designBlock,
                    languagePinned: responseLanguageIsPinned(this.llmHelper),
                })
                : withDiagramTurnBlock(fit(problem ? `<problem_statement>\n${problem}\n</problem_statement>\n\n${context}` : context), diagramTurn);
            // ignoreKnowledgeMode=true — see ClarifyLLM.generate() for the full
            // rationale: the message carries the problem/transcript blob, not a
            // real question being asked of the candidate, so it must not go
            // through the knowledge-mode intent gate.
            yield* this.llmHelper.streamChat(message, imagePaths, undefined, promptOverride, true);
        } catch (error) {
            console.error("[BrainstormLLM] Stream failed:", error);
            yield "I couldn't generate brainstorm approaches. Make sure your question is visible and try again.";
        }
    }
}
