// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.
import { coerceSkills } from "./skillsUtil";
import { SKILL_CATEGORIES } from "./types";
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
// premium/electron/knowledge/DocumentChunker.ts
var SKILL_CATEGORY_LABEL = {
    languages: "Programming Languages",
    frameworks: "Frameworks & Libraries",
    cloud: "Cloud & Platforms",
    databases: "Databases",
    ml: "AI / ML",
    devops: "DevOps & Infrastructure",
    tools: "Tools"
};
function calculateDurationMonths(startDate, endDate) {
    if (!startDate)
        return 0;
    try {
        const [startYear, startMonth] = startDate.split("-").map(Number);
        let endYear, endMonth;
        if (endDate) {
            [endYear, endMonth] = endDate.split("-").map(Number);
        }
        else {
            const now = /* @__PURE__ */ new Date();
            endYear = now.getFullYear();
            endMonth = now.getMonth() + 1;
        }
        const months = (endYear - startYear) * 12 + (endMonth - startMonth);
        return Math.max(0, months);
    }
    catch {
        return 0;
    }
}
function extractTags(text) {
    const words = text.toLowerCase().replace(/[^a-z0-9\s\-\.\/\+\#]/g, " ").split(/\s+/).filter((w) => w.length > 2);
    const bigrams = [];
    for (let i = 0; i < words.length - 1; i++) {
        bigrams.push(`${words[i]} ${words[i + 1]}`);
    }
    return [... /* @__PURE__ */new Set([...words, ...bigrams])];
}
function createDocumentNodes(structuredData, type) {
    const nodes = [];
    if (type === "resume" /* RESUME */) {
        const resume = structuredData;
        if (resume.experience) {
            for (const exp of resume.experience) {
                const duration = calculateDurationMonths(exp.start_date, exp.end_date);
                const contextPrefix = `[${exp.role} @ ${exp.company}, ${exp.start_date}\u2013${exp.end_date || "Present"}]`;
                for (const bullet of exp.bullets || []) {
                    nodes.push({
                        source_type: "resume" /* RESUME */,
                        category: "experience",
                        title: exp.role,
                        organization: exp.company,
                        start_date: exp.start_date,
                        end_date: exp.end_date,
                        duration_months: duration,
                        text_content: `${contextPrefix} ${bullet}`,
                        tags: extractTags(`${exp.role} ${exp.company} ${bullet}`)
                    });
                }
            }
        }
        if (resume.projects) {
            for (const project of resume.projects) {
                const technologies = (project.technologies || []).filter(Boolean);
                const highlights = (project.highlights || []).filter(Boolean);
                const text = [
                    `${project.name}: ${project.description}`,
                    technologies.length ? `Technologies: ${technologies.join(", ")}` : "",
                    highlights.length ? `Highlights:
${highlights.map((highlight) => `- ${highlight}`).join("\n")}` : ""
                ].filter(Boolean).join("\n");
                nodes.push({
                    source_type: "resume" /* RESUME */,
                    category: "project",
                    title: project.name,
                    text_content: text,
                    tags: extractTags(`${project.name} ${project.description} ${technologies.join(" ")} ${highlights.join(" ")}`)
                });
            }
        }
        if (resume.education) {
            for (const edu of resume.education) {
                const duration = calculateDurationMonths(edu.start_date, edu.end_date);
                const text = `${edu.degree} in ${edu.field} from ${edu.institution}${edu.gpa ? ` (GPA: ${edu.gpa})` : ""}`;
                nodes.push({
                    source_type: "resume" /* RESUME */,
                    category: "education",
                    title: `${edu.degree} in ${edu.field}`,
                    organization: edu.institution,
                    start_date: edu.start_date,
                    end_date: edu.end_date,
                    duration_months: duration,
                    text_content: text,
                    tags: extractTags(`${edu.degree} ${edu.field} ${edu.institution}`)
                });
            }
        }
        if (resume.achievements) {
            for (const achievement of resume.achievements) {
                nodes.push({
                    source_type: "resume" /* RESUME */,
                    category: "achievement",
                    title: achievement.title,
                    start_date: achievement.date || null,
                    text_content: `${achievement.title}: ${achievement.description}`,
                    tags: extractTags(`${achievement.title} ${achievement.description}`)
                });
            }
        }
        const skills = coerceSkills(resume.skills);
        for (const cat of SKILL_CATEGORIES) {
            const items = skills[cat];
            if (!items || items.length === 0)
                continue;
            const label = SKILL_CATEGORY_LABEL[cat] || cat;
            nodes.push({
                source_type: "resume" /* RESUME */,
                category: `skills_${cat}`,
                title: label,
                text_content: `${label}: ${items.join(", ")}`,
                tags: items.map((s) => s.toLowerCase())
            });
        }
    }
    else if (type === "job_description" /* JD */) {
        const jd = structuredData;
        const levelTag = jd.level ? `level:${jd.level}` : "";
        if (jd.requirements) {
            for (const req of jd.requirements) {
                nodes.push({
                    source_type: "job_description" /* JD */,
                    category: "requirement",
                    title: "Required Skill",
                    organization: jd.company,
                    text_content: req,
                    tags: [...extractTags(req), ...levelTag ? [levelTag] : []]
                });
            }
        }
        if (jd.nice_to_haves) {
            for (const nice of jd.nice_to_haves) {
                nodes.push({
                    source_type: "job_description" /* JD */,
                    category: "nice_to_have",
                    title: "Nice to Have",
                    organization: jd.company,
                    text_content: nice,
                    tags: extractTags(nice)
                });
            }
        }
        if (jd.responsibilities) {
            for (const resp of jd.responsibilities) {
                nodes.push({
                    source_type: "job_description" /* JD */,
                    category: "responsibility",
                    title: "Job Responsibility",
                    organization: jd.company,
                    text_content: resp,
                    tags: extractTags(resp)
                });
            }
        }
        if (jd.keywords) {
            for (const keyword of jd.keywords) {
                nodes.push({
                    source_type: "job_description" /* JD */,
                    category: "keyword",
                    title: "Job Keyword",
                    organization: jd.company,
                    text_content: keyword,
                    tags: [keyword.toLowerCase(), ...levelTag ? [levelTag] : []]
                });
            }
        }
    }
    console.log(`[DocumentChunker] Created ${nodes.length} atomic nodes for ${type}`);
    return nodes;
}
var BATCH_EMBED_RETRY_DELAY_MS = 1500;
function validVectors(vectors, expected) {
    if (!Array.isArray(vectors) || vectors.length !== expected)
        return null;
    let dim = 0;
    return vectors.map((v) => {
        if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === "number" && Number.isFinite(x)))
            return void 0;
        if (dim === 0)
            dim = v.length;
        return v.length === dim ? v : void 0;
    });
}
async function embedTextsBatched(texts, embedBatchFn) {
    if (!embedBatchFn || texts.length === 0)
        return null;
    let reason = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const checked = validVectors(await embedBatchFn(texts), texts.length);
            if (checked)
                return checked;
            reason = "the embedder returned a result of the wrong shape";
        }
        catch (err) {
            reason = String(err?.message ?? err);
        }
        if (attempt === 1)
            await new Promise((resolve) => setTimeout(resolve, BATCH_EMBED_RETRY_DELAY_MS));
    }
    console.warn(`[DocumentChunker] batch embed of ${texts.length} failed twice (${reason}); storing these nodes without embeddings rather than in another embedding space`);
    return texts.map(() => void 0);
}
async function chunkAndEmbedDocument(structuredData, type, embedFn, embedBatchFn) {
    const rawNodes = createDocumentNodes(structuredData, type);
    const nodesWithEmbeddings = [];
    console.log(`[DocumentChunker] Generating embeddings for ${rawNodes.length} nodes (batched)...`);
    const EMBED_BATCH_SIZE = 10;
    for (let i = 0; i < rawNodes.length; i += EMBED_BATCH_SIZE) {
        const batch = rawNodes.slice(i, i + EMBED_BATCH_SIZE);
        const batched = await embedTextsBatched(batch.map((node) => node.text_content), embedBatchFn);
        if (batched) {
            batch.forEach((node, j) => nodesWithEmbeddings.push({ ...node, embedding: batched[j] }));
            continue;
        }
        const results = await Promise.allSettled(batch.map((node) => embedFn(node.text_content)));
        const failedIndices = [];
        for (let j = 0; j < batch.length; j++) {
            const result = results[j];
            if (result.status === "fulfilled") {
                nodesWithEmbeddings.push({ ...batch[j], embedding: result.value });
            }
            else {
                failedIndices.push(j);
            }
        }
        if (failedIndices.length > 0) {
            console.warn(`[DocumentChunker] ${failedIndices.length} embedding(s) failed in batch ${Math.floor(i / EMBED_BATCH_SIZE) + 1}, retrying...`);
            await new Promise((resolve) => setTimeout(resolve, 500));
            const retryResults = await Promise.allSettled(failedIndices.map((j) => embedFn(batch[j].text_content)));
            for (let k = 0; k < failedIndices.length; k++) {
                const j = failedIndices[k];
                const retryResult = retryResults[k];
                nodesWithEmbeddings.push({
                    ...batch[j],
                    embedding: retryResult.status === "fulfilled" ? retryResult.value : void 0
                });
                if (retryResult.status === "rejected") {
                    console.warn(`[DocumentChunker] Retry also failed for node ${i + j}: ${retryResult.reason?.message}. Storing without embedding.`);
                }
            }
        }
        console.log(`[DocumentChunker] Embedded batch ${Math.floor(i / EMBED_BATCH_SIZE) + 1}/${Math.ceil(rawNodes.length / EMBED_BATCH_SIZE)} (${Math.min(i + EMBED_BATCH_SIZE, rawNodes.length)}/${rawNodes.length})`);
        if (i + EMBED_BATCH_SIZE < rawNodes.length) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    return nodesWithEmbeddings;
}
export { calculateDurationMonths, chunkAndEmbedDocument, createDocumentNodes, embedTextsBatched, extractTags };
