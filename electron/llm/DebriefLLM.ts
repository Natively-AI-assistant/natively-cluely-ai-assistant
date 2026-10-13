import { LLMHelper } from '../LLMHelper';
import { DEBRIEF_MODE_PROMPT } from './prompts';

export interface DebriefInput {
    transcript: string;
    usageLog?: string;
    activeProblems?: string[];
    missedOpportunities?: string[];
}

export class DebriefLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    async generate(input: DebriefInput): Promise<string> {
        if (!input.transcript.trim()) return '';

        const parts = [input.transcript];
        if (input.usageLog?.trim()) {
            parts.push(`\n[COPILOT USAGE]\n${input.usageLog.trim()}`);
        }
        if (input.activeProblems?.length) {
            parts.push(`\n[PROBLEMS DISCUSSED]\n${input.activeProblems.join('\n---\n')}`);
        }
        if (input.missedOpportunities?.length) {
            parts.push(`\n[MISSED OPPORTUNITY HEURISTICS]\n${input.missedOpportunities.join('\n')}`);
        }

        try {
            const fitted = this.llmHelper.fitContextForCurrentModel(parts.join('\n\n'));
            const stream = this.llmHelper.streamChat(fitted, undefined, undefined, DEBRIEF_MODE_PROMPT);
            let full = '';
            for await (const chunk of stream) full += chunk;
            return full.trim();
        } catch (error) {
            console.error('[DebriefLLM] Generation failed:', error);
            return '';
        }
    }
}
