// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.
import { extractJSONArray } from "./llmUtils";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
// premium/electron/knowledge/CultureValuesMapper.ts
var BATCH_SIZE = 5;
var KNOWN_FRAMEWORKS = {
    "amazon": [
        "Customer Obsession",
        "Ownership",
        "Invent and Simplify",
        "Are Right, A Lot",
        "Learn and Be Curious",
        "Hire and Develop the Best",
        "Insist on the Highest Standards",
        "Think Big",
        "Bias for Action",
        "Frugality",
        "Earn Trust",
        "Dive Deep",
        "Have Backbone; Disagree and Commit",
        "Deliver Results",
        "Strive to be Earth's Best Employer",
        "Success and Scale Bring Broad Responsibility"
    ],
    "google": [
        "Focus on the user",
        "Fast is better than slow",
        "Democracy on the web works",
        "Great just isn't good enough",
        "You can be serious without a suit",
        "You can make money without doing evil",
        "There's always more information out there"
    ],
    "netflix": [
        "Judgment",
        "Selflessness",
        "Courage",
        "Communication",
        "Inclusion",
        "Integrity",
        "Passion",
        "Innovation",
        "Curiosity"
    ],
    "meta": [
        "Move Fast",
        "Focus on Long-Term Impact",
        "Build Awesome Things",
        "Live in the Future",
        "Be Direct and Respect Your Colleagues",
        "Meta, Pair, Whole"
    ],
    "microsoft": [
        "Growth Mindset",
        "Customer Obsession",
        "Diversity and Inclusion",
        "One Microsoft",
        "Making a Difference"
    ]
};
function resolveCompanyValues(companyName, dossier) {
    const normalized = companyName.toLowerCase().trim();
    for (const [key, values] of Object.entries(KNOWN_FRAMEWORKS)) {
        if (normalized.includes(key)) {
            return values;
        }
    }
    if (dossier?.core_values && dossier.core_values.length > 0) {
        return dossier.core_values;
    }
    return [];
}
async function mapStoriesToValues(stories, coreValues, companyName, generateContentFn) {
    if (coreValues.length === 0 || stories.length === 0) {
        return {
            company: companyName,
            core_values: coreValues,
            mappings: [],
            unmapped_values: coreValues,
            mapped_at: ( /* @__PURE__ */new Date()).toISOString()
        };
    }
    console.log(`[CultureValuesMapper] Mapping ${stories.length} STAR stories to ${coreValues.length} core values for ${companyName}...`);
    const allMappings = [];
    for (let i = 0; i < stories.length; i += BATCH_SIZE) {
        const batch = stories.slice(i, i + BATCH_SIZE);
        const storySummaries = batch.map((story, idx) => {
            return `Story ${i + idx + 1}: [${story.parent_role} @ ${story.parent_company}] ${story.original_bullet}
Narrative: ${story.full_narrative}`;
        }).join("\n\n");
        const prompt = `You are an expert career coach specializing in behavioral interviews and company culture fit.

COMPANY: ${companyName}
CORE VALUES / LEADERSHIP PRINCIPLES:
${coreValues.map((v, idx) => `${idx + 1}. ${v}`).join("\n")}

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
- alignment_score is 0.0 to 1.0 \u2014 be honest, don't inflate
- speaking_tip should be a concrete, 1-sentence coaching tip on HOW to frame the answer
- Use the EXACT value names from the list above
- If a story doesn't strongly align with any value, skip it
- Return ONLY the JSON array`;
        try {
            const response = await generateContentFn([{ text: prompt }]);
            const mappings = extractJSONArray(response);
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
                    alignment_rationale: m.alignment_rationale || "",
                    speaking_tip: m.speaking_tip || ""
                });
            }
        }
        catch (error) {
            console.error(`[CultureValuesMapper] Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, error.message);
        }
    }
    const mappedValueNames = new Set(allMappings.map((m) => m.value_name.toLowerCase()));
    const unmappedValues = coreValues.filter((v) => !mappedValueNames.has(v.toLowerCase()));
    console.log(`[CultureValuesMapper] \u2705 Created ${allMappings.length} mappings. ${unmappedValues.length} values unmapped.`);
    return {
        company: companyName,
        core_values: coreValues,
        mappings: allMappings,
        unmapped_values: unmappedValues,
        mapped_at: ( /* @__PURE__ */new Date()).toISOString()
    };
}
function findRelevantValueAlignments(question, mappings, coreValues, topK = 2) {
    if (mappings.length === 0 && coreValues.length === 0)
        return [];
    const questionLower = question.toLowerCase();
    const directMatches = coreValues.filter((value) => questionLower.includes(value.toLowerCase()));
    const scored = mappings.map((m) => {
        let score = m.alignment_score;
        if (directMatches.some((d) => d.toLowerCase() === m.value_name.toLowerCase())) {
            score += 0.5;
        }
        const storyWords = new Set(`${m.original_bullet} ${m.alignment_rationale}`.toLowerCase().split(/\s+/));
        const questionWords = questionLower.split(/\s+/).filter((w) => w.length > 3);
        const overlap = questionWords.filter((w) => storyWords.has(w)).length;
        score += overlap * 0.05;
        return { mapping: m, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const topMappings = scored.slice(0, topK);
    return topMappings.map((s) => ({
        value: s.mapping.value_name,
        mapping: s.mapping
    }));
}
function formatValueAlignmentBlock(alignments, companyName) {
    if (alignments.length === 0)
        return "";
    const lines = alignments.map((a) => {
        if (a.mapping) {
            return `\u2022 Value: "${a.value}" \u2014 ${a.mapping.speaking_tip}
  Evidence: [${a.mapping.parent_role} @ ${a.mapping.parent_company}] ${a.mapping.original_bullet}`;
        }
        return `\u2022 Value: "${a.value}" \u2014 Align your answer with this ${companyName} core value.`;
    });
    return `<culture_alignment company="${companyName}">
When answering, naturally weave in alignment with these ${companyName} values:
${lines.join("\n")}
Do NOT explicitly name the values \u2014 demonstrate them through your answer's framing and emphasis.
</culture_alignment>`;
}
export { findRelevantValueAlignments, formatValueAlignmentBlock, mapStoriesToValues, resolveCompanyValues };
