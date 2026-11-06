// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.
import { callWithTimeout } from "./llmUtils";
import { extractJSONArray } from "./llmUtils";
import { extractTags } from "./DocumentChunker";
import { embedTextsBatched } from "./DocumentChunker";
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
// premium/electron/knowledge/StarStoryGenerator.ts
var BATCH_SIZE = 5;
var BASE_TIMEOUT_MS = 15e3;
var TIMEOUT_PER_BULLET_MS = 8e3;
var defaultTimeoutForBatch = (bulletCount) => BASE_TIMEOUT_MS + TIMEOUT_PER_BULLET_MS * bulletCount;
var fallbackStory = (context) => ({
    original_bullet: context.bullet,
    situation: "",
    task: "",
    action: context.bullet,
    result: "",
    // Preserve the candidate's evidence verbatim rather than inventing a STAR
    // narrative when the provider is unavailable or a batch cannot be recovered.
    full_narrative: context.bullet,
    parent_role: context.role,
    parent_company: context.company,
    timeline: context.timeline,
    generation_mode: "fallback"
});
async function generateStarStoriesWithStats(resume, generateContentFn, options = {}) {
    if (!resume.experience || resume.experience.length === 0) {
        console.log("[StarStoryGenerator] No experience entries to expand");
        return { stories: [], requested: 0, llmGenerated: 0, fallbackGenerated: 0 };
    }
    const bulletContexts = [];
    for (const exp of resume.experience) {
        const timeline = `${exp.start_date}\u2013${exp.end_date || "Present"}`;
        for (const bullet of exp.bullets || []) {
            if (typeof bullet !== "string" || !bullet.trim())
                continue;
            bulletContexts.push({ bullet, role: exp.role, company: exp.company, timeline });
        }
    }
    console.log(`[StarStoryGenerator] Expanding ${bulletContexts.length} bullets into STAR stories (batches of ${BATCH_SIZE})...`);
    const timeoutForBatch = options.timeoutForBatch || defaultTimeoutForBatch;
    let llmGenerated = 0;
    let fallbackGenerated = 0;
    const recoverBatch = async (batch) => {
        try {
            const stories = await expandBatch(batch, generateContentFn, timeoutForBatch(batch.length));
            if (stories.length !== batch.length) {
                throw new Error(`LLM returned ${stories.length}/${batch.length} STAR stories`);
            }
            llmGenerated += stories.length;
            return stories;
        }
        catch (error) {
            if (batch.length === 1) {
                fallbackGenerated += 1;
                console.warn(`[StarStoryGenerator] STAR expansion failed for one bullet (${error.message}); preserving source bullet as fallback.`);
                return [fallbackStory(batch[0])];
            }
            const splitAt = Math.ceil(batch.length / 2);
            console.warn(`[StarStoryGenerator] STAR batch of ${batch.length} failed (${error.message}); recovering as ${splitAt}+${batch.length - splitAt} disjoint batches.`);
            const first = await recoverBatch(batch.slice(0, splitAt));
            const second = await recoverBatch(batch.slice(splitAt));
            return [...first, ...second];
        }
    };
    const allStories = [];
    for (let i = 0; i < bulletContexts.length; i += BATCH_SIZE) {
        const batch = bulletContexts.slice(i, i + BATCH_SIZE);
        const stories = await recoverBatch(batch);
        allStories.push(...stories);
        console.log(`[StarStoryGenerator] Expanded batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(bulletContexts.length / BATCH_SIZE)} (${stories.length}/${batch.length} stories)`);
        if (i + BATCH_SIZE < bulletContexts.length) {
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
    }
    console.log(`[StarStoryGenerator] \u2705 STAR coverage: requested=${bulletContexts.length}, llm=${llmGenerated}, fallback=${fallbackGenerated}, total=${allStories.length}`);
    return { stories: allStories, requested: bulletContexts.length, llmGenerated, fallbackGenerated };
}
async function generateStarStories(resume, generateContentFn, options) {
    return (await generateStarStoriesWithStats(resume, generateContentFn, options)).stories;
}
async function expandBatch(batch, generateContentFn, timeoutMs) {
    const bulletList = batch.map((b, i) => `${i + 1}. [${b.role} @ ${b.company}, ${b.timeline}] "${b.bullet}"`).join("\n");
    const prompt = `You are a career coach expanding resume bullets into STAR stories.

For each bullet below, generate a realistic, detailed STAR (Situation, Task, Action, Result) expansion.
IMPORTANT RULES:
- Base the story ONLY on what the bullet states. Do not fabricate technologies, companies, or outcomes not implied.
- The "full_narrative" should be a natural, first-person spoken answer (~80-120 words).
- Keep the tone confident and professional.
- If the bullet already contains metrics, preserve them exactly.

Bullets:
${bulletList}

Return a JSON array (no markdown fences, no explanation), one object per bullet:
[
  {
    "index": 1,
    "situation": "...",
    "task": "...",
    "action": "...",
    "result": "...",
    "full_narrative": "..."
  }
]

Return ONLY the JSON array.`;
    const response = await callWithTimeout(() => generateContentFn([{ text: prompt }]), timeoutMs);
    const parsed = extractJSONArray(response);
    if (parsed.length !== batch.length) {
        throw new Error(`LLM returned ${parsed.length}/${batch.length} STAR stories`);
    }
    return parsed.map((item, idx) => {
        const ctx = batch[idx];
        return {
            original_bullet: ctx.bullet,
            situation: item.situation || "",
            task: item.task || "",
            action: item.action || "",
            result: item.result || "",
            full_narrative: item.full_narrative || ctx.bullet,
            parent_role: ctx.role,
            parent_company: ctx.company,
            timeline: ctx.timeline,
            generation_mode: "llm"
        };
    });
}
function starStoriesToNodes(stories) {
    return stories.map((story) => {
        const contextPrefix = `[${story.parent_role} @ ${story.parent_company}, ${story.timeline}]`;
        const text = `${contextPrefix} ${story.full_narrative}`;
        return {
            source_type: "resume" /* RESUME */,
            category: "star_story",
            title: `STAR: ${story.parent_role} at ${story.parent_company}`,
            organization: story.parent_company,
            text_content: text,
            parent_context: contextPrefix,
            tags: extractTags(`${story.parent_role} ${story.parent_company} ${story.original_bullet} star behavioral ${story.generation_mode || "llm"}`)
        };
    });
}
async function generateStarStoryNodes(resume, generateContentFn, embedFn, embedBatchFn) {
    const stories = await generateStarStories(resume, generateContentFn);
    const rawNodes = starStoriesToNodes(stories);
    console.log(`[StarStoryGenerator] Embedding ${rawNodes.length} STAR story nodes (batched)...`);
    const nodesWithEmbeddings = [];
    const EMBED_BATCH = 10;
    for (let i = 0; i < rawNodes.length; i += EMBED_BATCH) {
        const batch = rawNodes.slice(i, i + EMBED_BATCH);
        const batched = await embedTextsBatched(batch.map((node) => node.text_content), embedBatchFn);
        if (batched) {
            batch.forEach((node, j) => nodesWithEmbeddings.push({ ...node, embedding: batched[j] }));
            continue;
        }
        const results = await Promise.allSettled(batch.map((node) => embedFn(node.text_content)));
        const failedIndices = [];
        for (let j = 0; j < batch.length; j++) {
            const result = results[j];
            if (result.status === "fulfilled")
                nodesWithEmbeddings.push({ ...batch[j], embedding: result.value });
            else
                failedIndices.push(j);
        }
        if (failedIndices.length > 0) {
            console.warn(`[StarStoryGenerator] ${failedIndices.length} embedding(s) failed, retrying...`);
            await new Promise((resolve) => setTimeout(resolve, 500));
            const retryResults = await Promise.allSettled(failedIndices.map((j) => embedFn(batch[j].text_content)));
            for (let k = 0; k < failedIndices.length; k++) {
                const j = failedIndices[k];
                const retryResult = retryResults[k];
                nodesWithEmbeddings.push({ ...batch[j], embedding: retryResult.status === "fulfilled" ? retryResult.value : void 0 });
                if (retryResult.status === "rejected") {
                    console.warn(`[StarStoryGenerator] Retry also failed for STAR story ${i + j}: ${retryResult.reason?.message}`);
                }
            }
        }
        if (i + EMBED_BATCH < rawNodes.length)
            await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return nodesWithEmbeddings;
}
export { generateStarStories, generateStarStoriesWithStats, generateStarStoryNodes, starStoriesToNodes };
