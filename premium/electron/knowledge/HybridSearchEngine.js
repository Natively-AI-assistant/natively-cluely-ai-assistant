// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.
import { isSemanticAdmissionGateEnabled } from "../../../electron/llm/semanticAdmissionGate";
import { resolveSemanticFloor } from "../../../electron/llm/semanticAdmissionGate";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
// premium/electron/knowledge/HybridSearchEngine.ts
var RELEVANCE_THRESHOLD = 0.55;
var MAX_NODES = 8;
function isRecent(endDate) {
    if (!endDate)
        return true;
    try {
        const [year, month] = endDate.split("-").map(Number);
        const endMs = new Date(year, month - 1).getTime();
        const twoYearsAgo = Date.now() - 2 * 365.25 * 24 * 60 * 60 * 1e3;
        return endMs >= twoYearsAgo;
    }
    catch {
        return false;
    }
}
function cosineSimilarity(a, b) {
    if (a.length !== b.length || a.length === 0)
        return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
}
function extractKeywords(question) {
    return question.toLowerCase().replace(/[^a-z0-9\s\-\.\/\+\#]/g, " ").split(/\s+/).filter((w) => w.length > 2);
}
var CATEGORY_KEYWORD_MAP = {
    "project": ["project"],
    "projects": ["project"],
    "built": ["project"],
    "build": ["project"],
    "education": ["education"],
    "degree": ["education"],
    "university": ["education"],
    "college": ["education"],
    "school": ["education"],
    "certification": ["certification"],
    "certifications": ["certification"],
    "certified": ["certification"],
    "achievement": ["achievement"],
    "achievements": ["achievement"],
    "award": ["achievement"],
    "awards": ["achievement"],
    "leadership": ["leadership"],
    "led": ["leadership", "experience"],
    "managed": ["leadership", "experience"],
    "skill": ["experience", "project"],
    "skills": ["experience", "project"],
    "experience": ["experience"],
    // Grounding-campaign2 fix (2026-07-17): "expertise" was missing from this
    // map entirely, so a question phrased with it ("deep Go or Java expertise
    // — how do you stack up there?") got ZERO category hints and
    // buildStructuredCategoryPack returned an empty node list — live-confirmed
    // on the real backend (test/harness-longsession script-a press A9):
    // candidateProfileChars:0 reached the prompt despite the question being a
    // clear experience-level lookup. "Expertise" and "experience" are
    // synonyms for this classifier's purpose; both map to the same category.
    "expertise": ["experience"],
    "worked": ["experience"],
    "role": ["experience"],
    "roles": ["experience"],
    "job": ["experience"],
    "jobs": ["experience"],
    "company": ["experience"],
    "companies": ["experience"]
};
function detectCategoryHints(question) {
    const qLower = question.toLowerCase();
    const boostedCategories = /* @__PURE__ */ new Set();
    for (const [keyword, categories] of Object.entries(CATEGORY_KEYWORD_MAP)) {
        if (qLower.includes(keyword)) {
            categories.forEach((c) => boostedCategories.add(c));
        }
    }
    return Array.from(boostedCategories);
}
function scoreNode(node, cosine, keywords, rawQuestion, jdRequiredSkills, categoryHintKeywords) {
    let score = 0;
    score += cosine * 0.6;
    if (keywords.some((k) => node.tags.some((t) => t.includes(k)))) {
        score += 0.2;
    }
    if (node.duration_months && node.duration_months > 12) {
        score += 0.1;
    }
    if (isRecent(node.end_date || null)) {
        score += 0.1;
    }
    if (jdRequiredSkills && jdRequiredSkills.length > 0 && node.source_type === "resume" /* RESUME */) {
        const nodeText = node.text_content.toLowerCase();
        const nodeTags = node.tags.map((t) => t.toLowerCase());
        for (const skill of jdRequiredSkills) {
            const skillLower = skill.toLowerCase();
            if (nodeText.includes(skillLower) || nodeTags.some((t) => t.includes(skillLower))) {
                score += 0.15;
                break;
            }
        }
    }
    if (categoryHintKeywords && categoryHintKeywords.length > 0 && node.source_type === "resume" /* RESUME */) {
        if (categoryHintKeywords.includes(node.category)) {
            score += 0.25;
        }
    }
    if (node.title && node.source_type === "resume" /* RESUME */) {
        const questionLower = rawQuestion.toLowerCase();
        const titleLower = node.title.toLowerCase();
        const orgLower = (node.organization || "").toLowerCase();
        const titleWords = titleLower.split(/[\s,\-:@]+/).filter((w) => w.length > 3);
        const matchingWords = titleWords.filter((w) => questionLower.includes(w));
        if (matchingWords.length >= 2 || titleWords.length === 1 && matchingWords.length === 1) {
            score += 0.35;
        }
        if (orgLower.length > 3 && questionLower.includes(orgLower)) {
            score += 0.2;
        }
    }
    return score;
}
async function getRelevantNodes(question, allNodes, embedFn, options = {}) {
    const threshold = options.threshold || RELEVANCE_THRESHOLD;
    const maxNodes = options.maxNodes || MAX_NODES;
    let targetNodes = allNodes;
    if (options.sourceTypes && options.sourceTypes.length > 0) {
        targetNodes = allNodes.filter((n) => options.sourceTypes.includes(n.source_type));
    }
    if (targetNodes.length === 0) {
        return [];
    }
    let questionEmbedding = [];
    try {
        questionEmbedding = await embedFn(question);
    }
    catch (error) {
        console.warn("[HybridSearchEngine] Failed to embed question, falling back to keyword-only:", error.message);
    }
    const keywords = extractKeywords(question);
    const semanticFloor = isSemanticAdmissionGateEnabled() && questionEmbedding.length > 0 ? resolveSemanticFloor(options.embeddingSpaceKey) : null;
    const candidates = targetNodes.map((node) => {
        const cosine = node.embedding && questionEmbedding.length > 0 ? cosineSimilarity(node.embedding, questionEmbedding) : 0;
        return {
            node,
            cosine,
            score: scoreNode(node, cosine, keywords, question, options.jdRequiredSkills, options.categoryHintKeywords)
        };
    });
    const admitsCandidate = (c) => semanticFloor != null ? c.cosine >= semanticFloor : c.score > threshold;
    const scored = candidates.filter(admitsCandidate).sort((a, b) => b.score - a.score).slice(0, maxNodes).map(({ node, score }) => ({ node, score }));
    try {
        console.log("[SemanticAdmission] " + JSON.stringify({
            spaceKey: options.embeddingSpaceKey ?? null,
            floor: semanticFloor,
            enforced: semanticFloor != null,
            questionEmbedded: questionEmbedding.length > 0,
            legacyThreshold: threshold,
            candidateCount: candidates.length,
            candidates: candidates.slice(0, 50).map((c) => ({
                cosine: Number(c.cosine.toFixed(4)),
                boostSum: Number((c.score - c.cosine * 0.6).toFixed(4)),
                admitted: admitsCandidate(c)
            }))
        }));
    }
    catch {
    }
    if (scored.length > 0) {
        console.log(`[HybridSearchEngine] Found ${scored.length} relevant nodes (top score: ${scored[0].score.toFixed(3)})${semanticFloor != null ? ` [semantic-admission floor ${semanticFloor} @ ${options.embeddingSpaceKey}]` : ""}`);
    }
    else if (semanticFloor != null) {
        console.log(`[HybridSearchEngine] No nodes at or above the semantic-admission floor (${semanticFloor} @ ${options.embeddingSpaceKey}) \u2014 no injection`);
    }
    else {
        console.log(`[HybridSearchEngine] No nodes above relevance threshold (${threshold}) \u2014 no injection`);
    }
    return scored;
}
function formatContextBlock(scoredNodes) {
    if (scoredNodes.length === 0)
        return "";
    const jdNodes = scoredNodes.filter((sn) => sn.node.source_type === "job_description" /* JD */);
    const categoryGroups = {};
    for (const sn of scoredNodes) {
        if (sn.node.source_type !== "resume" /* RESUME */)
            continue;
        const cat = sn.node.category;
        if (!categoryGroups[cat])
            categoryGroups[cat] = [];
        categoryGroups[cat].push(sn);
    }
    const categoryConfig = {
        "experience": {
            tag: "candidate_experience",
            prefix: (sn) => `[${sn.node.title} at ${sn.node.organization}]`
        },
        "star_story": {
            tag: "candidate_experience",
            prefix: (sn) => `[STAR Story: ${sn.node.title}]`
        },
        "project": {
            tag: "candidate_projects",
            prefix: (sn) => `[Project: ${sn.node.title}]`
        },
        "education": {
            tag: "candidate_education",
            prefix: (sn) => `[Education: ${sn.node.title}]`
        },
        "achievement": {
            tag: "candidate_achievements",
            prefix: (sn) => `[Achievement: ${sn.node.title}]`
        },
        "certification": {
            tag: "candidate_certifications",
            prefix: (sn) => `[Certification: ${sn.node.title}]`
        },
        "leadership": {
            tag: "candidate_leadership",
            prefix: (sn) => `[Leadership: ${sn.node.title}]`
        }
    };
    let blocks = [];
    const tagGroups = {};
    for (const [cat, nodes] of Object.entries(categoryGroups)) {
        const config = categoryConfig[cat] || {
            tag: `candidate_${cat}`,
            prefix: (sn) => `[${sn.node.category}: ${sn.node.title}]`
        };
        if (!tagGroups[config.tag])
            tagGroups[config.tag] = [];
        tagGroups[config.tag].push({ nodes, getPrefix: config.prefix });
    }
    for (const [tag, groups] of Object.entries(tagGroups)) {
        const allNodes = groups.flatMap((g) => g.nodes);
        const lines = allNodes.map((sn, i) => {
            const group = groups.find((g) => g.nodes.includes(sn));
            return `${i + 1}. ${group.getPrefix(sn)} ${sn.node.text_content}`;
        });
        blocks.push(`<${tag}>
${lines.join("\n")}
</${tag}>`);
    }
    if (jdNodes.length > 0) {
        const jdLines = jdNodes.map((sn, i) => {
            return `${i + 1}. [${sn.node.category}] ${sn.node.text_content}`;
        });
        blocks.push(`<target_job_context>
${jdLines.join("\n")}
</target_job_context>`);
    }
    return blocks.join("\n\n");
}
function formatDossierBlock(dossier) {
    if (!dossier)
        return "";
    const lines = [];
    lines.push(`Company: ${dossier.company}`);
    if (dossier.hiring_strategy) {
        lines.push(`Hiring Strategy: ${dossier.hiring_strategy}`);
    }
    if (dossier.interview_focus) {
        const diffTag = dossier.interview_difficulty ? ` [Difficulty: ${dossier.interview_difficulty.replace("_", " ")}]` : "";
        lines.push(`Interview Focus${diffTag}: ${dossier.interview_focus}`);
    }
    if (dossier.salary_estimates && dossier.salary_estimates.length > 0) {
        const salaryLines = dossier.salary_estimates.map((s) => `  - ${s.title} in ${s.location}: ${s.currency} ${s.min.toLocaleString()}-${s.max.toLocaleString()} (confidence: ${s.confidence}, source: ${s.source || "general knowledge"})`);
        lines.push(`Salary Estimates:
${salaryLines.join("\n")}`);
    }
    if (dossier.culture_ratings) {
        const cr = dossier.culture_ratings;
        const sourcesTag = cr.data_sources?.length > 0 ? ` (${cr.data_sources.join(", ")})` : "";
        const reviewCountTag = cr.review_count ? `, ${cr.review_count}` : "";
        lines.push(`Work Culture \u2014 Overall: ${cr.overall.toFixed(1)}/5${sourcesTag}${reviewCountTag}`);
        const subs = [];
        if (cr.work_life_balance > 0)
            subs.push(`Work-Life Balance: ${cr.work_life_balance.toFixed(1)}`);
        if (cr.career_growth > 0)
            subs.push(`Career Growth: ${cr.career_growth.toFixed(1)}`);
        if (cr.compensation > 0)
            subs.push(`Compensation: ${cr.compensation.toFixed(1)}`);
        if (cr.management > 0)
            subs.push(`Management: ${cr.management.toFixed(1)}`);
        if (cr.diversity > 0)
            subs.push(`Diversity & Inclusion: ${cr.diversity.toFixed(1)}`);
        if (subs.length > 0)
            lines.push(`  ${subs.join(" | ")}`);
    }
    if (dossier.employee_reviews && dossier.employee_reviews.length > 0) {
        const reviewLines = dossier.employee_reviews.map((r) => {
            const role = r.role ? ` (${r.role})` : "";
            return `  - [${r.sentiment.toUpperCase()}${role} via ${r.source}] "${r.quote}"`;
        });
        lines.push(`Employee Reviews:
${reviewLines.join("\n")}`);
    }
    if (dossier.critics && dossier.critics.length > 0) {
        const criticLines = dossier.critics.map((c) => `  - [${c.frequency.toUpperCase()}] ${c.category}: ${c.complaint}`);
        lines.push(`Common Employee Complaints:
${criticLines.join("\n")}`);
    }
    if (dossier.benefits && dossier.benefits.length > 0) {
        lines.push(`Benefits & Perks: ${dossier.benefits.join(", ")}`);
    }
    if (dossier.core_values && dossier.core_values.length > 0) {
        lines.push(`Core Values: ${dossier.core_values.join(", ")}`);
    }
    if (dossier.competitors && dossier.competitors.length > 0) {
        lines.push(`Competitors: ${dossier.competitors.join(", ")}`);
    }
    if (dossier.recent_news) {
        lines.push(`Recent News: ${dossier.recent_news}`);
    }
    if (dossier.sources && dossier.sources.length > 0) {
        lines.push(`Sources: ${dossier.sources.filter(Boolean).join(", ")}`);
    }
    return `<company_research>
${lines.join("\n")}
</company_research>`;
}
export { detectCategoryHints, formatContextBlock, formatDossierBlock, getRelevantNodes };
