import { LLMHelper } from '../../LLMHelper';

export type InterviewPhase =
    | 'behavioral'
    | 'coding'
    | 'system_design'
    | 'candidate_qa'
    | 'unknown';

const VALID_PHASES = new Set<InterviewPhase>([
    'behavioral',
    'coding',
    'system_design',
    'candidate_qa',
    'unknown',
]);

const PHASE_CLASSIFIER_PROMPT = `You classify the current phase of a live technical interview.
Given recent transcript context, respond with ONLY one JSON object on a single line:
{"phase":"behavioral"|"coding"|"system_design"|"candidate_qa"|"unknown","confidence":0.0-1.0}

Phase definitions:
- behavioral: past experience, teamwork, leadership stories
- coding: algorithms, data structures, live coding, debugging
- system_design: architecture, scalability, tradeoffs, diagrams
- candidate_qa: candidate asking questions about role/company
- unknown: insufficient signal

Do not include any other text.`;

/**
 * LLM-based interview phase classifier (no regex on user free text).
 */
export async function classifyInterviewPhase(
    llmHelper: LLMHelper,
    transcriptContext: string,
): Promise<{ phase: InterviewPhase; confidence: number }> {
    if (!transcriptContext.trim()) {
        return { phase: 'unknown', confidence: 0 };
    }

    try {
        const fitted = llmHelper.fitContextForCurrentModel(transcriptContext, 500);
        const stream = llmHelper.streamChat(
            fitted,
            undefined,
            undefined,
            PHASE_CLASSIFIER_PROMPT,
            true,
        );
        let raw = '';
        for await (const chunk of stream) raw += chunk;

        const match = raw.match(/\{[\s\S]*?\}/);
        if (!match) return { phase: 'unknown', confidence: 0 };

        const parsed = JSON.parse(match[0]) as { phase?: string; confidence?: number };
        const phase = VALID_PHASES.has(parsed.phase as InterviewPhase)
            ? (parsed.phase as InterviewPhase)
            : 'unknown';
        const confidence = typeof parsed.confidence === 'number'
            ? Math.max(0, Math.min(1, parsed.confidence))
            : 0.5;

        return { phase, confidence };
    } catch (err: any) {
        console.warn('[InterviewPhaseClassifier] Classification failed:', err?.message);
        return { phase: 'unknown', confidence: 0 };
    }
}
