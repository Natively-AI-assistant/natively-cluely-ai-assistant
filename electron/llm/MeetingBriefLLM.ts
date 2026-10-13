import { LLMHelper } from '../LLMHelper';
import { MEETING_BRIEF_MODE_PROMPT } from './prompts';

export interface MeetingBriefInput {
    eventTitle?: string;
    eventStart?: string;
    attendees?: string[];
    prepNotes?: string;
    activeModeName?: string;
}

export class MeetingBriefLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    async generate(input: MeetingBriefInput): Promise<string> {
        const parts: string[] = [];
        if (input.eventTitle) parts.push(`Event: ${input.eventTitle}`);
        if (input.eventStart) parts.push(`Start: ${input.eventStart}`);
        if (input.attendees?.length) parts.push(`Attendees: ${input.attendees.join(', ')}`);
        if (input.activeModeName) parts.push(`Current mode: ${input.activeModeName}`);
        if (input.prepNotes?.trim()) parts.push(`Prep notes:\n${input.prepNotes.trim()}`);

        const context = parts.join('\n') || 'Upcoming technical interview — no calendar details available.';
        try {
            const fitted = this.llmHelper.fitContextForCurrentModel(context);
            const stream = this.llmHelper.streamChat(fitted, undefined, undefined, MEETING_BRIEF_MODE_PROMPT);
            let full = '';
            for await (const chunk of stream) full += chunk;
            return full.trim();
        } catch (error) {
            console.error('[MeetingBriefLLM] Generation failed:', error);
            return '';
        }
    }
}
