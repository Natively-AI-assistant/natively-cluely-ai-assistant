import { LLMHelper } from '../LLMHelper';
import { RESTATE_MODE_PROMPT } from './prompts';
import { PromptAssembler } from '../services/context/PromptAssembler';
import type { InterviewContextBundle } from '../services/context/InterviewContextBuilder';

export class RestateLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    async *generateStream(
        interviewCtx: InterviewContextBundle,
    ): AsyncGenerator<string> {
        const transcript = interviewCtx.recencyTranscript.trim();
        if (!transcript && !interviewCtx.currentTurn?.trim()) {
            return;
        }

        try {
            const fittedTranscript = this.llmHelper.fitContextForCurrentModel(
                transcript || interviewCtx.currentTurn || '',
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
                tokenBudget: 4000,
                systemPrompt: RESTATE_MODE_PROMPT,
            });

            yield* this.llmHelper.streamChat(
                packet.userMessage,
                undefined,
                undefined,
                RESTATE_MODE_PROMPT,
            );
        } catch (error) {
            console.error('[RestateLLM] Streaming generation failed:', error);
        }
    }
}
