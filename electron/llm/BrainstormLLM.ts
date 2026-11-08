import { LLMHelper } from "../LLMHelper";
import { BRAINSTORM_MODE_PROMPT } from "./prompts";
import { TINY_BRAINSTORM_PROMPT } from "./tinyPrompts";
import { resolveV2SystemPrompt, v2TierForPromptTier, carriesV2Core } from "./promptSystemV2";
import { withDiagramContract, withDiagramTurnBlock, type DiagramTurn } from "./diagramPromptSignals";
import { buildQuickActionTurn, responseLanguageIsPinned } from "./quickActionTurn";

/**
 * The active mode's Real-time prompt and whether that mode is a custom one.
 * `text` is what the prompt carries (a custom mode's is headed "Mode: <name>").
 * `scoped` is the same instructions without that heading, for reading what
 * they ask for: a mode NAMED "30 second pitch" has not set a length.
 */
export type RealTimePromptReader = () => { text: string; scoped: string; customMode: boolean };

/**
 * The active mode's Real-time prompt ("Java only"), for the v2 prompt to carry
 * the way What to Answer's does.
 *
 * Brainstorm had it only while it borrowed the answer prompt. On its own
 * prompt no built-in mode delivered it: LLMHelper skips mode injection for a
 * v2 prompt and adds the user's instructions to answer turns alone.
 */
const activeModeRealTimePrompt: RealTimePromptReader = () => {
    try {
        const { ModesManager } = require('../services/ModesManager') as typeof import('../services/ModesManager');
        const modes = ModesManager.getInstance();
        return {
            // Scoped as LLMHelper scopes a call that has no answer plan
            // (streamContextPolicy modeAnswerType), so Brainstorm is told what
            // such a call is told and nothing more.
            text: modes.getActiveModePinnedInstructions?.('general_meeting_answer') || '',
            scoped: modes.getScopedInstructionText?.('general_meeting_answer') || '',
            customMode: modes.getActiveModeDocumentGroundingInfo?.()?.isCustom === true,
        };
    } catch {
        return { text: '', scoped: '', customMode: false };
    }
};

/** Shown when the provider call fails; it is not a brainstorm, so it is never recorded as one. */
export const BRAINSTORM_STREAM_FAILED = "I couldn't generate brainstorm approaches. Make sure your question is visible and try again.";

export class BrainstormLLM {
    private llmHelper: LLMHelper;
    private readRealTimePrompt: RealTimePromptReader;

    constructor(llmHelper: LLMHelper, readRealTimePrompt: RealTimePromptReader = activeModeRealTimePrompt) {
        this.llmHelper = llmHelper;
        this.readRealTimePrompt = readRealTimePrompt;
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
     * @param decisionEvidence What the decision layer retrieved for the
     *   question on the table, rendered: the mode's reference files and the
     *   profile. Empty, null or absent means there is none, and the call is
     *   then the one it was before evidence was passed in at all.
     */
    async *generateStream(context: string, imagePaths?: string[], diagramTurn?: DiagramTurn | null, problemStatement?: string | null, decisionEvidence?: string | null): AsyncGenerator<string> {
        const problem = problemStatement?.trim() || '';
        if (!context.trim() && !problem && !imagePaths?.length) return;
        try {
            const v2Tier = v2TierForPromptTier(this.llmHelper.getPromptTier());
            const evidence = decisionEvidence?.trim() || '';
            const realTime = this.readRealTimePrompt();
            const basePrompt = resolveV2SystemPrompt({
                action: 'brainstorm', tier: v2Tier, diagram: diagramTurn?.signals ?? null,
                // Left out in the one case LLMHelper adds them itself, or they
                // would be stated twice: a custom mode with no decision-layer
                // evidence goes through its mode injection, which carries the
                // instructions along with its own reference-file retrieval.
                customInstructions: (realTime.text && (evidence || !realTime.customMode)) ? realTime.text : undefined,
            })
                ?? (this.llmHelper.getPromptTier() === 'tiny' ? TINY_BRAINSTORM_PROMPT : BRAINSTORM_MODE_PROMPT);
            const promptOverride = withDiagramContract(basePrompt, diagramTurn, { tier: v2Tier, surface: 'live' });
            const fit = (text: string) => (text ? this.llmHelper.fitContextForCurrentModel(text) : text);
            // The request is the turn; the transcript, the problem and the
            // design on the table are its background (quickActionTurn.ts). A
            // legacy prompt keeps the message it was written for, byte for byte.
            const designBlock = withDiagramTurnBlock('', diagramTurn);
            const v2 = carriesV2Core(basePrompt);
            const message = v2
                ? buildQuickActionTurn(designBlock ? 'brainstorm_alternatives' : 'brainstorm', basePrompt, fit(context), {
                    evidence: problem ? [{ kind: 'other', source: 'problem statement', content: fit(problem) }] : undefined,
                    renderedEvidence: evidence || undefined,
                    standingInstructions: realTime.scoped || undefined,
                    beforeRequest: designBlock,
                    languagePinned: responseLanguageIsPinned(this.llmHelper),
                })
                : withDiagramTurnBlock(fit(problem ? `<problem_statement>\n${problem}\n</problem_statement>\n\n${context}` : context), diagramTurn);
            // ignoreKnowledgeMode=true — see ClarifyLLM.generate() for the full
            // rationale: the message carries the problem/transcript blob, not a
            // real question being asked of the candidate, so it must not go
            // through the knowledge-mode intent gate.
            //
            // With the decision layer's evidence in the turn, LLMHelper carries
            // the turn and adds nothing: no second retrieval beside the one
            // that was filtered for this mode, and no document-grounded
            // reshaping of the request into a question to answer.
            //
            // Only with evidence in hand. When the layer found nothing, or did
            // not run, LLMHelper's own handling of the mode is left exactly as
            // it was: in a custom or document-grounded mode that is where the
            // reference files still come from.
            if (v2 && evidence) {
                yield* this.llmHelper.streamChat(message, imagePaths, undefined, promptOverride, true,
                    true, [], undefined, undefined, { v3Owned: true });
                return;
            }
            yield* this.llmHelper.streamChat(message, imagePaths, undefined, promptOverride, true);
        } catch (error) {
            console.error("[BrainstormLLM] Stream failed:", error);
            yield BRAINSTORM_STREAM_FAILED;
        }
    }
}
