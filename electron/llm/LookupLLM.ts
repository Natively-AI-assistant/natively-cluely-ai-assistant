import { LLMHelper } from '../LLMHelper';
import { LOOKUP_MODE_PROMPT } from './prompts';
import { PromptAssembler } from '../services/context/PromptAssembler';
import type { InterviewContextBundle } from '../services/context/InterviewContextBuilder';

export class LookupLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    async *generateStream(
        interviewCtx: InterviewContextBundle,
        retrievedContext?: string,
        focusTerm?: string,
    ): AsyncGenerator<string> {
        const transcript = interviewCtx.recencyTranscript.trim();
        if (!transcript && !focusTerm?.trim()) {
            return;
        }

        try {
            const intentContext = focusTerm?.trim()
                ? `<lookup_focus>\nExplain: ${focusTerm.trim()}\n</lookup_focus>`
                : undefined;

            const fittedTranscript = this.llmHelper.fitContextForCurrentModel(
                transcript || focusTerm || '',
            );

            const assembler = new PromptAssembler();
            const packet = assembler.assemble({
                transcript: fittedTranscript,
                modeTemplateType: 'technical-interview',
                sessionSpine: interviewCtx.spine || undefined,
                currentTurn: interviewCtx.currentTurn ?? undefined,
                activeProblem: interviewCtx.activeProblemStatement ?? undefined,
                acceptedConstraints: interviewCtx.acceptedRequirements?.length
                    ? interviewCtx.acceptedRequirements
                    : undefined,
                priorResponses: interviewCtx.priorCopilotResponses.length > 0
                    ? interviewCtx.priorCopilotResponses
                    : undefined,
                intentContext,
                retrievedModeContext: retrievedContext || undefined,
                tokenBudget: 3000,
                systemPrompt: LOOKUP_MODE_PROMPT,
            });

            yield* this.llmHelper.streamChat(
                packet.userMessage,
                undefined,
                undefined,
                LOOKUP_MODE_PROMPT,
            );
        } catch (error) {
            console.error('[LookupLLM] Streaming generation failed:', error);
        }
    }
}
