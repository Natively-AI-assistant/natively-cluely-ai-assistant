// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.
import { flattenSkills } from "../skillsUtil";
import { extractCanonicalTerms } from "./skillOntology";
import { normalizeTerm } from "./skillOntology";
import { canonicalize } from "./skillOntology";
import { getRelevantNodes } from "../HybridSearchEngine";
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
// premium/electron/knowledge/roleInsight/EvidenceRetriever.ts
var RETRIEVAL_THRESHOLD = 0.42;
var MAX_NODES_PER_REQUIREMENT = 6;
var MAX_EVIDENCE_PER_REQUIREMENT = 8;
var evidenceCounter = 0;
function evidenceId(analysisId) {
    evidenceCounter += 1;
    return `ev_${analysisId.slice(3, 11)}_${evidenceCounter.toString(36)}`;
}
function push(items, analysisId, claim, category, sourceLocation, confidence, nodeId = null, sourceType = "submitted_resume") {
    const trimmed = String(claim ?? "").trim();
    if (trimmed.length < 3)
        return;
    items.push({
        id: evidenceId(analysisId),
        analysisId,
        claim: trimmed,
        category,
        sourceType,
        nodeId,
        sourceLocation,
        userConfirmed: sourceType === "user_confirmation",
        confidence
    });
}
function buildEvidencePool(analysisId, resume, nodes, userConfirmed = []) {
    const items = [];
    if (resume) {
        const skills = resume.skills_flat ?? flattenSkills(resume.skills);
        for (const skill of skills ?? []) {
            push(items, analysisId, skill, "skill", "Skills \xB7 Submitted r\xE9sum\xE9", 0.75);
        }
        for (const exp of resume.experience ?? []) {
            const where = `${exp.role} at ${exp.company}`;
            const period = exp.start_date ? ` (${exp.start_date} \u2013 ${exp.end_date ?? "Present"})` : "";
            push(items, analysisId, `${where}${period}`, "experience", `${exp.company} experience \xB7 Submitted r\xE9sum\xE9`, 0.8);
            (exp.bullets ?? []).forEach((bullet, i) => {
                push(items, analysisId, bullet, "experience", `${exp.company} experience \xB7 Submitted r\xE9sum\xE9 \xB7 Bullet ${i + 1}`, 0.85);
            });
        }
        for (const proj of resume.projects ?? []) {
            const loc = `Project: ${proj.name} \xB7 Submitted r\xE9sum\xE9`;
            push(items, analysisId, `${proj.name} \u2014 ${proj.description}`, "project", loc, 0.75);
            for (const tech of proj.technologies ?? []) {
                push(items, analysisId, `${tech} (used in ${proj.name})`, "skill", loc, 0.7);
            }
            (proj.highlights ?? []).forEach((h, i) => {
                push(items, analysisId, h, "project", `${loc} \xB7 Highlight ${i + 1}`, 0.8);
            });
        }
        for (const edu of resume.education ?? []) {
            push(items, analysisId, `${edu.degree}${edu.field ? ` in ${edu.field}` : ""}, ${edu.institution}`, "education", "Education \xB7 Submitted r\xE9sum\xE9", 0.9);
        }
        for (const cert of resume.certifications ?? []) {
            push(items, analysisId, `${cert.name}${cert.issuer ? ` (${cert.issuer})` : ""}`, "certification", "Certifications \xB7 Submitted r\xE9sum\xE9", 0.9);
        }
        for (const ach of resume.achievements ?? []) {
            push(items, analysisId, `${ach.title}${ach.description ? ` \u2014 ${ach.description}` : ""}`, "achievement", "Achievements \xB7 Submitted r\xE9sum\xE9", 0.7);
        }
        for (const lead of resume.leadership ?? []) {
            push(items, analysisId, `${lead.role}${lead.organization ? ` at ${lead.organization}` : ""}${lead.description ? ` \u2014 ${lead.description}` : ""}`, "experience", "Leadership \xB7 Submitted r\xE9sum\xE9", 0.8);
        }
        if (resume.identity?.location) {
            push(items, analysisId, `Location on r\xE9sum\xE9: ${resume.identity.location}`, "logistics", "Identity \xB7 Submitted r\xE9sum\xE9", 0.6);
        }
    }
    const byNodeId = /* @__PURE__ */ new Map();
    for (const node of nodes) {
        if (node.source_type !== "resume" /* RESUME */)
            continue;
        if (node.id == null)
            continue;
        const where = node.organization ? `${node.title} at ${node.organization} \xB7 Profile Intelligence` : `${node.title} \xB7 Profile Intelligence`;
        const before = items.length;
        push(items, analysisId, node.text_content, mapNodeCategory(node.category), where, 0.7, node.id, "profile_intelligence");
        if (items.length > before)
            byNodeId.set(node.id, items[items.length - 1].id);
    }
    for (const c of userConfirmed) {
        push(items, analysisId, c.claim, "experience", c.sourceLocation, 0.95, null, "user_confirmation");
    }
    const byId = /* @__PURE__ */ new Map();
    const byTerm = /* @__PURE__ */ new Map();
    const allTerms = /* @__PURE__ */ new Set();
    for (const item of items) {
        byId.set(item.id, item);
        for (const term of extractCanonicalTerms(item.claim)) {
            allTerms.add(term);
            const list = byTerm.get(term) ?? [];
            list.push(item.id);
            byTerm.set(term, list);
        }
    }
    return { items, byTerm, byId, byNodeId, allTerms };
}
function mapNodeCategory(category) {
    switch (category) {
        case "project":
            return "project";
        case "education":
            return "education";
        case "certification":
            return "certification";
        case "achievement":
            return "achievement";
        case "skill":
            return "skill";
        default:
            return "experience";
    }
}
function retrievalQuery(req) {
    const terms = req.canonicalTerms.map((t) => t.replace(/_/g, " ")).join(" ");
    return `${req.normalizedText} ${terms}`.trim();
}
function claimMentions(claim, canonicalTerm) {
    const claimTerms = extractCanonicalTerms(claim);
    if (claimTerms.some((t) => t === canonicalTerm))
        return true;
    const spaced = canonicalTerm.replace(/_/g, " ");
    if (spaced.includes(" ") && normalizeTerm(claim).includes(spaced))
        return true;
    return false;
}
async function retrieveForRequirement(req, pool, nodes, embedFn, embeddingSpaceKey) {
    const directIds = [];
    const seen = /* @__PURE__ */ new Set();
    for (const term of req.canonicalTerms) {
        const canonical = canonicalize(term);
        for (const id of pool.byTerm.get(canonical) ?? []) {
            const item = pool.byId.get(id);
            if (!item || seen.has(id))
                continue;
            if (!claimMentions(item.claim, canonical))
                continue;
            seen.add(id);
            directIds.push(id);
        }
    }
    const semanticIds = [];
    if (embedFn && nodes.length > 0) {
        try {
            const scored = await getRelevantNodes(retrievalQuery(req), nodes, embedFn, {
                sourceTypes: ["resume" /* RESUME */],
                threshold: RETRIEVAL_THRESHOLD,
                maxNodes: MAX_NODES_PER_REQUIREMENT,
                categoryHintKeywords: categoryHintsFor(req),
                embeddingSpaceKey
            });
            for (const { node } of scored) {
                if (node.id == null)
                    continue;
                const evId = pool.byNodeId.get(node.id);
                if (!evId || seen.has(evId))
                    continue;
                seen.add(evId);
                semanticIds.push(evId);
            }
        }
        catch (e) {
            console.warn(`[RoleInsight/Retrieval] Semantic pass failed for ${req.id}:`, e?.message);
        }
    }
    const orderedIds = [...directIds, ...semanticIds].slice(0, MAX_EVIDENCE_PER_REQUIREMENT);
    return { requirementId: req.id, directIds, semanticIds, orderedIds };
}
function categoryHintsFor(req) {
    switch (req.category) {
        case "education":
            return ["education"];
        case "certification":
            return ["certification"];
        case "leadership":
            return ["leadership", "experience"];
        case "core_responsibility":
            return ["experience", "project"];
        case "technical_skill":
            return ["experience", "project"];
        case "experience":
            return ["experience"];
        default:
            return [];
    }
}
function evidenceTerms(pool, evidenceIds) {
    const terms = /* @__PURE__ */ new Set();
    for (const id of evidenceIds) {
        const item = pool.byId.get(id);
        if (!item)
            continue;
        for (const t of extractCanonicalTerms(item.claim))
            terms.add(t);
    }
    return terms;
}
export { buildEvidencePool, evidenceTerms, retrieveForRequirement };
