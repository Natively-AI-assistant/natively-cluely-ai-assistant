// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.
import { extractCanonicalTerms } from "./skillOntology";
import { canonicalize } from "./skillOntology";
import { canonicalLabel } from "./skillOntology";
import { evidenceTerms } from "./EvidenceRetriever";
import { findTransferEdges } from "./skillOntology";
import { callWithTimeout } from "../llmUtils";
import { extractJSONArray } from "../llmUtils";
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
// premium/electron/knowledge/roleInsight/RequirementAssessor.ts
var ASSESS_TIMEOUT_MS = 6e4;
var BATCH_SIZE = 6;
var BATCH_CONCURRENCY = 3;
function tryDirectProven(req, ret, pool) {
    if (ret.directIds.length === 0)
        return null;
    if (req.canonicalTerms.length === 0)
        return null;
    const items = ret.directIds.map((id) => pool.byId.get(id)).filter(Boolean);
    const substantive = items.filter((i) => i.category !== "skill");
    const skillOnly = items.filter((i) => i.category === "skill");
    const covered = /* @__PURE__ */ new Set();
    for (const item of items) {
        for (const t of extractCanonicalTerms(item.claim))
            covered.add(t);
    }
    const required = req.canonicalTerms.map(canonicalize).filter(Boolean);
    const allCovered = required.length > 0 && required.every((t) => covered.has(t));
    if (!allCovered)
        return null;
    const needsDemonstration = req.category === "core_responsibility" || req.category === "experience" || req.category === "leadership";
    if (needsDemonstration && substantive.length === 0)
        return null;
    const cited = (substantive.length > 0 ? substantive : skillOnly).slice(0, 4);
    const label = required.map(canonicalLabel).join(", ");
    return {
        requirementId: req.id,
        analysisId: req.analysisId,
        status: "proven",
        evidenceIds: cited.map((i) => i.id),
        explanation: `${label} appears directly in your recorded experience: ` + cited.map((i) => `"${truncate(i.claim, 120)}" (${i.sourceLocation})`).join("; ") + ".",
        limitations: substantive.length === 0 ? ["Listed as a skill; the r\xE9sum\xE9 does not describe where it was applied."] : [],
        missingInformation: [],
        confidence: Math.min(0.95, 0.7 + 0.06 * cited.length + (substantive.length > 0 ? 0.1 : 0)),
        userCorrected: false
    };
}
function tryTransferEdge(req, ret, pool) {
    if (ret.orderedIds.length === 0)
        return null;
    const have = evidenceTerms(pool, ret.orderedIds);
    for (const term of req.canonicalTerms) {
        const edges = findTransferEdges(term, have);
        if (edges.length === 0)
            continue;
        const edge = edges[0];
        const cited = ret.orderedIds.map((id) => pool.byId.get(id)).filter(Boolean).filter((i) => extractCanonicalTerms(i.claim).some((t) => canonicalize(t) === edge.from)).slice(0, 3);
        if (cited.length === 0)
            continue;
        return {
            requirementId: req.id,
            analysisId: req.analysisId,
            status: "transferable",
            evidenceIds: cited.map((i) => i.id),
            explanation: `Your recorded ${canonicalLabel(edge.from)} work is related but not a direct match for ${canonicalLabel(edge.to)}: ` + cited.map((i) => `"${truncate(i.claim, 120)}" (${i.sourceLocation})`).join("; ") + ".",
            transferExplanation: `It transfers because the work involves ${edge.sharedCapability}.`,
            limitations: [capitalize(`${edge.limitation}.`)],
            missingInformation: [
                `Direct ${canonicalLabel(edge.to)} experience is not recorded in your profile.`
            ],
            confidence: Math.min(0.8, edge.strength),
            userCorrected: false
        };
    }
    return null;
}
function unresolved(req, reason) {
    return {
        requirementId: req.id,
        analysisId: req.analysisId,
        status: "needs_evidence",
        evidenceIds: [],
        explanation: reason,
        limitations: [],
        missingInformation: [
            `Nothing in your r\xE9sum\xE9 or Profile Intelligence data addresses "${truncate(req.normalizedText, 90)}".`,
            "This means Natively could not find it \u2014 not that you lack it."
        ],
        confidence: 0.5,
        userCorrected: false
    };
}
function buildBatchPrompt(batch, retrieved, pool) {
    const blocks = batch.map((req, i) => {
        const ret = retrieved.get(req.id);
        const items = (ret?.orderedIds ?? []).map((id) => pool.byId.get(id)).filter(Boolean);
        const evidenceLines = items.length > 0 ? items.map((e) => `  - [${e.id}] (${e.category}, from ${e.sourceLocation}) ${truncate(e.claim, 320)}`).join("\n") : "  (no candidate evidence was retrieved for this requirement)";
        return `REQUIREMENT ${i + 1}
id: ${req.id}
category: ${req.category}
priority: ${req.priority}
job description says: "${truncate(req.originalText, 400)}"
interpreted as: ${req.normalizedText}
CANDIDATE EVIDENCE AVAILABLE:
${evidenceLines}`;
    }).join("\n\n");
    return `You are assessing how a candidate's recorded experience relates to specific job requirements. The candidate has already been invited to interview.

For EACH requirement below, choose exactly one status:

- "proven": the listed evidence directly and clearly establishes the requirement.
- "transferable": the evidence demonstrates a related capability but is not a direct match. You MUST state what capability is genuinely shared AND what the evidence does not establish.
- "needs_evidence": the listed evidence does not establish the requirement.

ABSOLUTE RULES:
1. You may ONLY cite evidence ids that appear in the list for that requirement. Never invent an id.
2. Never assert anything about the candidate that is not in the listed evidence \u2014 no assumed skills, metrics, scale, seniority, leadership, certifications, employer names, or locations.
3. If the evidence does not establish the requirement, return "needs_evidence". Do NOT conclude the candidate lacks the skill \u2014 you are only reporting what the record shows.
4. Do not mark something "transferable" merely because the words are semantically similar. A generic soft skill is not transferable evidence for a specific technical requirement. If the connection is weak or generic, return "needs_evidence".
5. Explanations must be specific to THIS candidate's evidence. Never write "your experience is relevant", "this aligns well", or "you appear to be a good match".
6. "limitations" is REQUIRED and non-empty when status is "transferable".

Return a JSON array, one element per requirement, in the same order:
[
  {
    "id": "<the requirement id>",
    "status": "proven" | "transferable" | "needs_evidence",
    "evidence_ids": ["ev_..."],
    "explanation": "one or two precise sentences naming the specific evidence",
    "transfer_explanation": "only when transferable \u2014 what capability is genuinely shared",
    "limitations": ["what the evidence does NOT establish"],
    "missing_information": ["what the candidate could supply that would change this"],
    "confidence": 0.0-1.0
  }
]

${blocks}

Return ONLY the JSON array.`;
}
function truncate(s, n) {
    const t = String(s ?? "").replace(/\s+/g, " ").trim();
    return t.length <= n ? t : `${t.slice(0, n - 1)}\u2026`;
}
function capitalize(s) {
    return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
function coerceStatusFromLlm(raw) {
    const s = String(raw ?? "").toLowerCase().trim();
    if (s === "proven" || s === "transferable" || s === "needs_evidence")
        return s;
    return null;
}
async function assessBatch(batch, ctx) {
    const out = /* @__PURE__ */ new Map();
    if (!ctx.generateContentFn)
        return out;
    const raw = await callWithTimeout(() => ctx.generateContentFn([{ text: buildBatchPrompt(batch, ctx.retrieved, ctx.pool) }]), ASSESS_TIMEOUT_MS);
    const parsed = extractJSONArray(raw);
    for (const item of Array.isArray(parsed) ? parsed : []) {
        const id = String(item?.id ?? "").trim();
        const req = batch.find((r) => r.id === id);
        if (!req)
            continue;
        const status = coerceStatusFromLlm(item?.status);
        if (!status)
            continue;
        const allowed = new Set(ctx.retrieved.get(req.id)?.orderedIds ?? []);
        const evidenceIds = (Array.isArray(item?.evidence_ids) ? item.evidence_ids : []).map((x) => String(x ?? "").trim()).filter((x) => allowed.has(x));
        const limitations = (Array.isArray(item?.limitations) ? item.limitations : []).map((x) => String(x ?? "").trim()).filter(Boolean);
        const missing = (Array.isArray(item?.missing_information) ? item.missing_information : []).map((x) => String(x ?? "").trim()).filter(Boolean);
        const confidence = Number.isFinite(Number(item?.confidence)) ? Math.min(1, Math.max(0, Number(item.confidence))) : 0.5;
        out.set(req.id, {
            requirementId: req.id,
            analysisId: req.analysisId,
            status,
            evidenceIds,
            explanation: String(item?.explanation ?? "").trim(),
            transferExplanation: String(item?.transfer_explanation ?? "").trim() || void 0,
            limitations,
            missingInformation: missing,
            confidence,
            userCorrected: false
        });
    }
    return out;
}
async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length).fill(null);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        for (;;) {
            const i = cursor++;
            if (i >= items.length)
                return;
            try {
                results[i] = await fn(items[i]);
            }
            catch (e) {
                console.warn("[RoleInsight/Assessor] Batch failed:", e?.message);
                results[i] = null;
            }
        }
    });
    await Promise.all(workers);
    return results;
}
async function assessRequirements(ctx) {
    const assessments = /* @__PURE__ */ new Map();
    const needsLlm = [];
    let deterministic = 0;
    for (const req of ctx.requirements) {
        if (req.excluded)
            continue;
        if (req.hardGate)
            continue;
        const ret = ctx.retrieved.get(req.id);
        if (!ret || ret.orderedIds.length === 0) {
            assessments.set(req.id, unresolved(req, "No supporting evidence was found in your r\xE9sum\xE9 or Profile Intelligence data."));
            deterministic++;
            continue;
        }
        const direct = tryDirectProven(req, ret, ctx.pool);
        if (direct) {
            assessments.set(req.id, direct);
            deterministic++;
            continue;
        }
        const transfer = tryTransferEdge(req, ret, ctx.pool);
        if (transfer) {
            assessments.set(req.id, transfer);
            deterministic++;
            continue;
        }
        needsLlm.push(req);
    }
    const batches = [];
    for (let i = 0; i < needsLlm.length; i += BATCH_SIZE) {
        batches.push(needsLlm.slice(i, i + BATCH_SIZE));
    }
    let failedBatches = 0;
    if (batches.length > 0 && ctx.generateContentFn) {
        const results = await mapWithConcurrency(batches, BATCH_CONCURRENCY, (b) => assessBatch(b, ctx));
        results.forEach((res, i) => {
            if (!res) {
                failedBatches++;
                return;
            }
            for (const [id, a] of res)
                assessments.set(id, a);
            for (const req of batches[i]) {
                if (!assessments.has(req.id)) {
                    assessments.set(req.id, unresolved(req, "This requirement could not be assessed against your evidence in this run."));
                }
            }
        });
    }
    for (const req of needsLlm) {
        if (assessments.has(req.id))
            continue;
        assessments.set(req.id, unresolved(req, "Evidence was retrieved but could not be evaluated \u2014 the analysis model was unavailable."));
    }
    const finalized = [];
    for (const req of ctx.requirements) {
        const a = assessments.get(req.id);
        if (!a)
            continue;
        if (req.priority === "preferred") {
            finalized.push({
                ...a,
                status: "preferred",
                preferredSubStatus: a.status === "proven" ? "proven" : a.status === "transferable" ? "transferable" : "unknown"
            });
        }
        else {
            finalized.push(a);
        }
    }
    return { assessments: finalized, deterministicCount: deterministic, failedBatches };
}
function assignSeverity(req, assessment, hasAdjacentEvidence) {
    const reasons = [];
    if (req.priority === "preferred") {
        return {
            severity: "preferred",
            rationale: "Listed as a preferred qualification, not a requirement."
        };
    }
    let level;
    if (req.mandatory && req.priority === "critical") {
        level = "critical";
        reasons.push("Stated as a mandatory qualification.");
    }
    else if (req.priority === "critical") {
        level = "critical";
        reasons.push("Central to multiple core responsibilities.");
    }
    else if (req.priority === "important") {
        level = "important";
        reasons.push("Appears in the role's core requirements.");
    }
    else {
        level = "minor";
        reasons.push("Mentioned once and not tied to a core responsibility.");
    }
    if (req.mandatory && level !== "critical") {
        reasons.push("The job description states it as required.");
    }
    else if (!req.mandatory) {
        reasons.push("Not stated as a mandatory qualification.");
    }
    if (hasAdjacentEvidence) {
        reasons.push("Adjacent experience exists in your profile.");
        if (level === "important")
            level = "minor";
        else if (level === "critical" && !req.mandatory)
            level = "important";
    }
    if (assessment.status === "needs_evidence") {
        reasons.push("No direct evidence found \u2014 this may be a recording gap rather than a skill gap.");
    }
    return { severity: level, rationale: reasons.join(" ") };
}
export { assessRequirements, assignSeverity };
