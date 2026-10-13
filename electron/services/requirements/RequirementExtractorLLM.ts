import { LLMHelper } from '../../LLMHelper';
import type { ExtractedRequirementCandidate } from './LiveRequirement';

const EXTRACTOR_PROMPT = `You extract explicit interview REQUIREMENTS and CONSTRAINTS from technical interview transcript context.

Allowed requirement types (only extract if clearly stated or strongly implied by the interviewer):
- Input/output format (e.g. return indices vs values)
- Data constraints (sorted input, unique elements, value ranges)
- Scale (array size, QPS, user count)
- Complexity targets (time/space)
- Edge cases explicitly mentioned
- System design non-functionals (consistency, availability, latency)

Rules:
- Output ONLY a JSON array on one line. No markdown.
- Each item: {"text":"short speakable constraint","quote":"verbatim phrase from transcript","confidence":0.0-1.0}
- text: max 12 words, candidate-ready (e.g. "Input array is sorted")
- Do NOT invent requirements not supported by the transcript
- Do NOT re-output requirements already in the KNOWN list
- If nothing new, output []

Example: [{"text":"No duplicate values","quote":"you can assume there are no duplicates","confidence":0.9}]`;

export class RequirementExtractorLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    async extract(params: {
        recencyTranscript: string;
        activeProblemStatement: string | null;
        knownRequirements: string[];
    }): Promise<ExtractedRequirementCandidate[]> {
        const { recencyTranscript, activeProblemStatement, knownRequirements } = params;
        if (!recencyTranscript.trim()) return [];

        const parts: string[] = [];
        if (activeProblemStatement?.trim()) {
            parts.push(`ACTIVE PROBLEM:\n${activeProblemStatement.trim()}`);
        }
        if (knownRequirements.length > 0) {
            parts.push(`KNOWN REQUIREMENTS (do not repeat):\n${knownRequirements.map((r) => `- ${r}`).join('\n')}`);
        }
        parts.push(`RECENT TRANSCRIPT:\n${recencyTranscript.trim()}`);

        try {
            const fitted = this.llmHelper.fitContextForCurrentModel(parts.join('\n\n'), 800);
            const stream = this.llmHelper.streamChat(
                fitted,
                undefined,
                undefined,
                EXTRACTOR_PROMPT,
                true,
            );
            let raw = '';
            for await (const chunk of stream) raw += chunk;

            const match = raw.match(/\[[\s\S]*\]/);
            if (!match) return [];

            const parsed = JSON.parse(match[0]) as unknown;
            if (!Array.isArray(parsed)) return [];

            return parsed
                .filter((item): item is ExtractedRequirementCandidate =>
                    item != null
                    && typeof item === 'object'
                    && typeof (item as ExtractedRequirementCandidate).text === 'string'
                )
                .map((item) => ({
                    text: String(item.text).trim(),
                    quote: typeof item.quote === 'string' ? item.quote.trim() : String(item.text).trim(),
                    confidence: typeof item.confidence === 'number' ? item.confidence : 0.7,
                }))
                .filter((item) => item.text.length >= 3);
        } catch (err: any) {
            console.warn('[RequirementExtractorLLM] Extraction failed:', err?.message);
            return [];
        }
    }
}
