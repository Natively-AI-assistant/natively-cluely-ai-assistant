// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.
import { canonicalize } from "./skillOntology";
import { inferPriority } from "./RequirementExtractor";
import { HARD_GATE_CATEGORIES } from "./types";
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
// premium/electron/knowledge/roleInsight/RequirementNormalizer.ts
function termOverlap(a, b) {
    if (a.length === 0 || b.length === 0)
        return 0;
    const sa = new Set(a.map(canonicalize));
    const sb = new Set(b.map(canonicalize));
    let inter = 0;
    for (const t of sa)
        if (sb.has(t))
            inter++;
    const union = sa.size + sb.size - inter;
    return union === 0 ? 0 : inter / union;
}
function textSimilarity(a, b) {
    const wa = new Set(a.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
    const wb = new Set(b.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
    if (wa.size === 0 || wb.size === 0)
        return 0;
    let inter = 0;
    for (const w of wa)
        if (wb.has(w))
            inter++;
    return inter / Math.min(wa.size, wb.size);
}
function isDuplicate(a, b) {
    if (a.category !== b.category)
        return false;
    if (a.hardGate || b.hardGate) {
        return a.originalText.trim().toLowerCase() === b.originalText.trim().toLowerCase();
    }
    const aPreferred = a.priority === "preferred" || a.category === "preferred";
    const bPreferred = b.priority === "preferred" || b.category === "preferred";
    if (aPreferred !== bPreferred)
        return false;
    const overlap = termOverlap(a.canonicalTerms, b.canonicalTerms);
    const textual = textSimilarity(a.normalizedText, b.normalizedText);
    return textual >= 0.8 || overlap >= 0.34 && textual >= 0.45;
}
function countResponsibilityLinks(target, all) {
    if (target.category === "core_responsibility")
        return 0;
    const terms = new Set(target.canonicalTerms.map(canonicalize).filter(Boolean));
    if (terms.size === 0)
        return 0;
    let links = 0;
    for (const r of all) {
        if (r === target || r.category !== "core_responsibility")
            continue;
        const rTerms = new Set(r.canonicalTerms.map(canonicalize));
        for (const t of terms) {
            if (rTerms.has(t)) {
                links++;
                break;
            }
        }
    }
    return links;
}
function normalizeRequirements(drafts) {
    const merged = [];
    let consolidated = 0;
    for (const draft of drafts) {
        const target = merged.find((m) => isDuplicate(m, draft));
        if (!target) {
            merged.push({ ...draft, supportingPassages: [...draft.supportingPassages] });
            continue;
        }
        consolidated++;
        const allQuotes = new Set([
            target.originalText,
            ...target.supportingPassages,
            draft.originalText,
            ...draft.supportingPassages
        ].filter(Boolean));
        const draftIsCanonical = draft.sourceCharStart !== null && target.sourceCharStart === null || draft.explicit && !target.explicit || draft.explicit === target.explicit && draft.sourceCharStart !== null === (target.sourceCharStart !== null) && draft.originalText.length > target.originalText.length * 1.3;
        const ordinal = Math.min(target.ordinal, draft.ordinal);
        const mandatory = target.mandatory || draft.mandatory;
        const explicit = target.explicit || draft.explicit;
        const confidence = Math.max(target.extractionConfidence, draft.extractionConfidence);
        const canonicalTerms = Array.from(/* @__PURE__ */ new Set([...target.canonicalTerms, ...draft.canonicalTerms]));
        if (draftIsCanonical)
            Object.assign(target, draft);
        allQuotes.delete(target.originalText);
        target.supportingPassages = Array.from(allQuotes);
        target.ordinal = ordinal;
        target.mandatory = mandatory;
        target.explicit = explicit;
        target.extractionConfidence = confidence;
        target.canonicalTerms = canonicalTerms;
    }
    const finalized = merged.map((r) => {
        const preferred = r.priority === "preferred";
        const priority = preferred ? "preferred" : inferPriority({
            text: `${r.originalText} ${r.supportingPassages.join(" ")}`,
            section: r.sourceSection,
            mandatory: r.mandatory,
            preferred: false,
            category: r.category,
            passageCount: 1 + r.supportingPassages.length,
            responsibilityLinks: countResponsibilityLinks(r, merged)
        });
        return { ...r, priority, hardGate: HARD_GATE_CATEGORIES.has(r.category) };
    });
    finalized.sort((a, b) => {
        const ax = a.sourceCharStart ?? Number.MAX_SAFE_INTEGER;
        const bx = b.sourceCharStart ?? Number.MAX_SAFE_INTEGER;
        if (ax !== bx)
            return ax - bx;
        return a.ordinal - b.ordinal;
    });
    finalized.forEach((r, i) => {
        r.ordinal = i;
    });
    return { requirements: finalized, consolidatedCount: consolidated };
}
var CATEGORY_LABELS = {
    core_responsibility: "Core responsibilities",
    technical_skill: "Technical skills",
    functional_skill: "Functional skills",
    experience: "Experience and seniority",
    domain: "Domain knowledge",
    leadership: "Leadership",
    communication: "Communication",
    education: "Education",
    certification: "Certifications",
    location: "Location",
    authorization: "Work authorization",
    clearance: "Clearance",
    logistics: "Logistics",
    preferred: "Preferred qualifications"
};
var CATEGORY_GROUPS = [
    { label: "Core responsibilities", categories: ["core_responsibility"] },
    { label: "Technical skills", categories: ["technical_skill"] },
    { label: "Experience and seniority", categories: ["experience", "functional_skill"] },
    { label: "Domain knowledge", categories: ["domain"] },
    { label: "Leadership and communication", categories: ["leadership", "communication"] },
    { label: "Education and certifications", categories: ["education", "certification"] },
    { label: "Logistics and hard requirements", categories: ["location", "authorization", "clearance", "logistics"] }
];
export { CATEGORY_GROUPS, CATEGORY_LABELS, isDuplicate, normalizeRequirements };
