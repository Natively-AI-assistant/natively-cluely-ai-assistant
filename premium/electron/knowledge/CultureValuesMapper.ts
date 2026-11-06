// electron/knowledge/CultureValuesMapper.ts
// Maps STAR stories to company core values / leadership principles
// Enables value-aligned answer injection during interviews

import { StarStory, CompanyDossier, ContextNode, DocType } from './types';
import { extractJSONArray } from './llmUtils';

const BATCH_SIZE = 5;

// Well-known company principle sets for enhanced matching
const KNOWN_FRAMEWORKS: Record<string, string[]> = {
    'amazon': [
        'Customer Obsession', 'Ownership', 'Invent and Simplify', 'Are Right, A Lot',
        'Learn and Be Curious', 'Hire and Develop the Best', 'Insist on the Highest Standards',
        'Think Big', 'Bias for Action', 'Frugality', 'Earn Trust', 'Dive Deep',
        'Have Backbone; Disagree and Commit', 'Deliver Results',
        'Strive to be Earth\'s Best Employer', 'Success and Scale Bring Broad Responsibility'
    ],
    'google': [
        'Focus on the user', 'Fast is better than slow', 'Democracy on the web works',
        'Great just isn\'t good enough', 'You can be serious without a suit',
        'You can make money without doing evil', 'There\'s always more information out there'
    ],
    'netflix': [
        'Judgment', 'Selflessness', 'Courage', 'Communication', 'Inclusion',
        'Integrity', 'Passion', 'Innovation', 'Curiosity'
    ],
    'meta': [
        'Move Fast', 'Focus on Long-Term Impact', 'Build Awesome Things',
        'Live in the Future', 'Be Direct and Respect Your Colleagues', 'Meta, Pair, Whole'
    ],
    'microsoft': [
        'Growth Mindset', 'Customer Obsession', 'Diversity and Inclusion',
        'One Microsoft', 'Making a Difference'
    ]
};

export interface ValueMapping {
    story_id: string;             // original_bullet hash or index
    original_bullet: string;
    parent_role: string;
    parent_company: string;
    value_name: string;           // The core value / leadership principle
    alignment_score: number;      // 0.0 – 1.0
    alignment_rationale: string;  // Why this story maps to this value
    speaking_tip: string;         // How to frame when answering
}

export interface CultureMappingResult {
    company: string;
    core_values: string[];
    mappings: ValueMapping[];
    unmapped_values: string[];    // Values with no matching STAR story
    mapped_at: string;
}

/**
 * Resolve the best core values list for a company.
 * Priority: known framework > dossier scraped > empty.
 */
export function resolveCompanyValues(companyName: string, dossier: CompanyDossier | null): string[] {
    const normalized = companyName.toLowerCase().trim();

    // Check known frameworks first (most reliable)
    for (const [key, values] of Object.entries(KNOWN_FRAMEWORKS)) {
        if (normalized.includes(key)) {
            return values;
        }
    }

    // Fall back to dossier-scraped values
    if (dossier?.core_values && dossier.core_values.length > 0) {
        return dossier.core_values;
    }

    return [];
}

/**
 * Map STAR stories to company core values using LLM.
 * Processes in batches to manage token usage.
 */
export async function mapStoriesToValues(
    stories: StarStory[],
    coreValues: string[],
    companyName: string,
    generateContentFn: (contents: any[]) => Promise<string>
): Promise<CultureMappingResult> {
    if (coreValues.length === 0 || stories.length === 0) {
        return {
            company: companyName,
            core_values: coreValues,
            mappings: [],
            unmapped_values: coreValues,
            mapped_at: new Date().toISOString()
        };
    }

    console.log(`[CultureValuesMapper] Mapping ${stories.length} STAR stories to ${coreValues.length} core values for ${companyName}...`);

    const allMappings: ValueMapping[] = [];

    // Process stories in batches
    for (let i = 0; i < stories.length; i += BATCH_SIZE) {
        const batch = stories.slice(i, i + BATCH_SIZE);

        const storySummaries = batch.map((story, idx) => {
            return `Story ${i + idx + 1}: [${story.parent_role} @ ${story.parent_company}] ${story.original_bullet}\nNarrative: ${story.full_narrative}`;
        }).join('\n\n');

        const prompt = `You are an expert career coach specializing in behavioral interviews and company culture fit.

COMPANY: ${companyName}
CORE VALUES / LEADERSHIP PRINCIPLES:
${coreValues.map((v, idx) => `${idx + 1}. ${v}`).join('\n')}

CANDIDATE'S STAR STORIES:
${storySummaries}

For each STAR story, identify which core value(s) it best demonstrates. Return a JSON array of mappings:

[
  {
    "story_index": 0,
    "original_bullet": "the original bullet text",
    "value_name": "the exact core value name from the list above",
    "alignment_score": 0.85,
    "alignment_rationale": "Why this story demonstrates this value",
    "speaking_tip": "When asked about this value, frame your answer by emphasizing..."
  }
]

RULES:
- Each story can map to 1-3 values (pick only strong alignments, score > 0.6)
- alignment_score is 0.0 to 1.0 — be honest, don't inflate
- speaking_tip should be a concrete, 1-sentence coaching tip on HOW to frame the answer
- Use the EXACT value names from the list above
- If a story doesn't strongly align with any value, skip it
- Return ONLY the JSON array`;

        try {
            const response = await generateContentFn([{ text: prompt }]);
            const mappings = extractJSONArray<any>(response);

            for (const m of mappings) {
                const storyIdx = m.story_index ?? 0;
                const story = batch[storyIdx] || batch[0];
                allMappings.push({
                    story_id: `${story.parent_company}_${story.parent_role}_${i + storyIdx}`,
                    original_bullet: m.original_bullet || story.original_bullet,
                    parent_role: story.parent_role,
                    parent_company: story.parent_company,
                    value_name: m.value_name,
                    alignment_score: Math.min(1, Math.max(0, m.alignment_score || 0)),
                    alignment_rationale: m.alignment_rationale || '',
                    speaking_tip: m.speaking_tip || ''
                });
            }
        } catch (error: any) {
            console.error(`[CultureValuesMapper] Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, error.message);
        }
    }

    // Identify unmapped values
    const mappedValueNames = new Set(allMappings.map(m => m.value_name.toLowerCase()));
    const unmappedValues = coreValues.filter(v => !mappedValueNames.has(v.toLowerCase()));

    console.log(`[CultureValuesMapper] ✅ Created ${allMappings.length} mappings. ${unmappedValues.length} values unmapped.`);

    return {
        company: companyName,
        core_values: coreValues,
        mappings: allMappings,
        unmapped_values: unmappedValues,
        mapped_at: new Date().toISOString()
    };
}

/**
 * Given a question and mappings, find the most relevant value alignment.
 * Uses keyword matching against value names and story content.
 */
export function findRelevantValueAlignments(
    question: string,
    mappings: ValueMapping[],
    coreValues: string[],
    topK: number = 2
): { value: string; mapping: ValueMapping | null; }[] {
    if (mappings.length === 0 && coreValues.length === 0) return [];

    const questionLower = question.toLowerCase();

    // 1. Direct value mention in question (highest priority)
    const directMatches = coreValues.filter(value =>
        questionLower.includes(value.toLowerCase())
    );

    // 2. Score all mappings by relevance to the question
    const scored = mappings.map(m => {
        let score = m.alignment_score;

        // Boost if the value is directly mentioned
        if (directMatches.some(d => d.toLowerCase() === m.value_name.toLowerCase())) {
            score += 0.5;
        }

        // Boost if question keywords overlap with the story
        const storyWords = new Set(
            `${m.original_bullet} ${m.alignment_rationale}`.toLowerCase().split(/\s+/)
        );
        const questionWords = questionLower.split(/\s+/).filter(w => w.length > 3);
        const overlap = questionWords.filter(w => storyWords.has(w)).length;
        score += overlap * 0.05;

        return { mapping: m, score };
    });

    // Sort by score descending, take top K
    scored.sort((a, b) => b.score - a.score);
    const topMappings = scored.slice(0, topK);

    return topMappings.map(s => ({
        value: s.mapping.value_name,
        mapping: s.mapping
    }));
}

/**
 * Format value alignment as an injectable prompt block.
 */
export function formatValueAlignmentBlock(
    alignments: { value: string; mapping: ValueMapping | null }[],
    companyName: string
): string {
    if (alignments.length === 0) return '';

    const lines = alignments.map(a => {
        if (a.mapping) {
            return `• Value: "${a.value}" — ${a.mapping.speaking_tip}\n  Evidence: [${a.mapping.parent_role} @ ${a.mapping.parent_company}] ${a.mapping.original_bullet}`;
        }
        return `• Value: "${a.value}" — Align your answer with this ${companyName} core value.`;
    });

    return `<culture_alignment company="${companyName}">
When answering, naturally weave in alignment with these ${companyName} values:
${lines.join('\n')}
Do NOT explicitly name the values — demonstrate them through your answer's framing and emphasis.
</culture_alignment>`;
}
