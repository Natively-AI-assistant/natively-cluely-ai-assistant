import { LLMHelper } from "../LLMHelper";
import { UNIVERSAL_FOLLOWUP_PROMPT } from "./prompts";
import { TINY_FOLLOWUP_PROMPT } from "./tinyPrompts";
import { resolveV2SystemPrompt, v2TierForPromptTier, isV2ComposedPrompt, buildTurnContentV2 } from "./promptSystemV2";

export class FollowUpLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    private resolvePrompt(): string {
        return resolveV2SystemPrompt({ action: 'followup', tier: v2TierForPromptTier(this.llmHelper.getPromptTier()) })
            ?? (this.llmHelper.getPromptTier() === 'tiny' ? TINY_FOLLOWUP_PROMPT : UNIVERSAL_FOLLOWUP_PROMPT);
    }

    /** v2 turn envelope for a refinement: the prior answer is evidence, the
     *  refinement request is the newest turn AND the task (typed request last).
     *  Only when the resolved prompt is a v2 composition; else the legacy
     *  PREVIOUS ANSWER/REQUEST shape, byte-for-byte. */
    private buildMessage(prompt: string, previousAnswer: string, refinementRequest: string): string {
        try {
            if (isV2ComposedPrompt(prompt)) {
                return buildTurnContentV2({
                    evidence: [{ kind: 'other', content: previousAnswer, source: 'previous_answer' }],
                    currentTurn: refinementRequest,
                    directRequest: refinementRequest,
                });
            }
        } catch { /* legacy shape below */ }
        return `PREVIOUS ANSWER:\n${previousAnswer}\n\nREQUEST: ${refinementRequest}`;
    }

    async generate(previousAnswer: string, refinementRequest: string, context?: string): Promise<string> {
        try {
            const prompt = this.resolvePrompt();
            const message = this.buildMessage(prompt, previousAnswer, refinementRequest);
            const fittedContext = context ? this.llmHelper.fitContextForCurrentModel(context) : context;
            // ignoreKnowledgeMode=true — `message` is a synthesized meta-message
            // ("PREVIOUS ANSWER:...\nREQUEST:...") that embeds the prior answer
            // verbatim, not a real question. Letting it through the knowledge-mode
            // intent classifier risks misclassifying this refinement call as an
            // intro/identity request whenever the previous answer happened to
            // discuss the candidate's name/background (see ClarifyLLM.generate()).
            const stream = this.llmHelper.streamChat(message, undefined, fittedContext, prompt, true);
            let full = "";
            for await (const chunk of stream) full += chunk;
            return full;
        } catch (e) {
            console.error("[FollowUpLLM] Failed:", e);
            return "";
        }
    }

    async *generateStream(previousAnswer: string, refinementRequest: string, context?: string, options?: { contractRule?: string }): AsyncGenerator<string> {
        try {
            let prompt = this.resolvePrompt();
            // Envelope decision uses the UNMODIFIED resolved prompt — appending
            // the contract rule below changes its identity, and registry lookup
            // would then miss.
            const message = this.buildMessage(prompt, previousAnswer, refinementRequest);
            const fittedContext = context ? this.llmHelper.fitContextForCurrentModel(context) : context;
            // CONTEXT OS (Phase 11): a refinement INHERITS the original turn's
            // source ownership — "make it shorter" after a doc-grounded answer
            // must not introduce profile/memory facts. The caller passes the
            // rule built from the active mode's contract. Additive: absent →
            // legacy prompt byte-for-byte.
            if (options?.contractRule) {
                prompt = `${prompt}\n\n${options.contractRule}`;
            }
            // See generate() above — ignoreKnowledgeMode=true.
            yield* this.llmHelper.streamChat(message, undefined, fittedContext, prompt, true);
        } catch (e) {
            console.error("[FollowUpLLM] Stream Failed:", e);
        }
    }
}
