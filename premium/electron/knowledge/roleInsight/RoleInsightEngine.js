// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.
import { fingerprint } from "./RoleInsightDatabase";
import { resolveFromUrl } from "./JdSourceResolver";
import { verifyAgainstOfficialPosting } from "./JdSourceResolver";
import { extractRequirements } from "./RequirementExtractor";
import { normalizeRequirements } from "./RequirementNormalizer";
import { buildEvidencePool } from "./EvidenceRetriever";
import { retrieveForRequirement } from "./EvidenceRetriever";
import { assessRequirements } from "./RequirementAssessor";
import { evaluateHardGates } from "./HardGateEvaluator";
import { validateAssessments } from "./AssessmentValidator";
import { evidenceTerms } from "./EvidenceRetriever";
import { assignSeverity } from "./RequirementAssessor";
import { calculateCoverage } from "./CoverageCalculator";
import { deriveAlignment } from "./CoverageCalculator";
import { deriveEvidenceConfidence } from "./CoverageCalculator";
import { REQUIREMENT_EXTRACTOR_VERSION } from "./types";
import { REQUIREMENT_MATCHER_VERSION } from "./types";
import { buildSummary } from "./CoverageCalculator";
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
var import_node_crypto2 = require("node:crypto");
// premium/electron/knowledge/roleInsight/RoleInsightEngine.ts
var PROGRESS_STAGE_LABELS = {
    reading_job_description: "Reading job description",
    structuring_requirements: "Structuring requirements",
    finding_profile_evidence: "Finding profile evidence",
    evaluating_transferable_experience: "Evaluating transferable experience",
    validating_conclusions: "Validating conclusions",
    preparing_role_insight: "Preparing Role Insight"
};
var AnalysisCancelledError = class extends Error {
    constructor() {
        super("Role Insight analysis was cancelled");
        this.name = "AnalysisCancelledError";
    }
};
var MissingSourceError = class extends Error {
    constructor(missing) {
        super(`Missing required source: ${missing.join(", ")}`);
        this.missing = missing;
        this.name = "MissingSourceError";
    }
    missing;
};
function fingerprintResume(doc) {
    if (!doc)
        return "none";
    return fingerprint(doc.raw_text ?? "", JSON.stringify(doc.structured_data ?? {}));
}
function fingerprintJd(doc, overrideText) {
    if (overrideText)
        return fingerprint(overrideText);
    if (!doc)
        return "none";
    return fingerprint(doc.raw_text ?? "", JSON.stringify(doc.structured_data ?? {}));
}
function fingerprintProfile(nodes) {
    let maxId = 0;
    let space = "";
    for (const n of nodes) {
        if (n.id != null && n.id > maxId)
            maxId = n.id;
        if (!space && n.embedding_space)
            space = n.embedding_space;
    }
    return fingerprint(nodes.length, maxId, space);
}
var RoleInsightEngine = class {
    constructor(deps) {
        this.deps = deps;
    }
    deps;
    checkCancelled() {
        if (this.deps.isCancelled?.())
            throw new AnalysisCancelledError();
    }
    async stage(trace, failed, name, fn, fallback, detail) {
        this.checkCancelled();
        const traceId = (0, import_node_crypto2.randomUUID)().slice(0, 8);
        const started = Date.now();
        try {
            const result = await fn();
            trace.push({
                stage: name,
                status: "ok",
                durationMs: Date.now() - started,
                detail: detail?.(),
                traceId
            });
            return result;
        }
        catch (e) {
            if (e instanceof AnalysisCancelledError)
                throw e;
            console.error(`[RoleInsight] Stage "${name}" failed (trace ${traceId}):`, e?.message);
            trace.push({
                stage: name,
                status: "failed",
                durationMs: Date.now() - started,
                detail: e?.message ? String(e.message).slice(0, 300) : "unknown error",
                traceId
            });
            failed.push(name);
            return fallback;
        }
    }
    async run(options = {}) {
        const trace = [];
        const failedStages = [];
        const analysisId = `ri_${(0, import_node_crypto2.randomUUID)().replace(/-/g, "").slice(0, 20)}`;
        const resumeDoc = this.deps.getResumeDoc();
        const jdDoc = this.deps.getJdDoc();
        const missing = [];
        if (!resumeDoc)
            missing.push("resume");
        if (!jdDoc && !options.jobUrl)
            missing.push("job_description");
        if (missing.length > 0)
            throw new MissingSourceError(missing);
        const resume = resumeDoc?.structured_data ?? null;
        const jd = jdDoc?.structured_data ?? null;
        const nodes = this.deps.getNodes();
        const provider = safeCall(() => this.deps.getSearchProvider(), null);
        this.deps.onProgress?.("reading_job_description");
        let jdText = (jdDoc?.raw_text ?? "").trim();
        let jdOrigin = jdDoc?.source_uri ?? "";
        let jdSourceKind = jdDoc ? "uploaded_file" : "unknown";
        let externalSources = [];
        let unavailableVerifications = [];
        let officialVerified = false;
        if (options.jobUrl) {
            const resolved = await this.stage(trace, failedStages, "resolve_jd_from_url", () => resolveFromUrl(options.jobUrl, provider, jd?.company ?? ""), null);
            if (resolved) {
                jdText = resolved.text;
                jdOrigin = resolved.origin;
                jdSourceKind = resolved.sourceKind;
                externalSources = resolved.externalSources;
                officialVerified = resolved.officialVerified;
            }
            else {
                unavailableVerifications.push("The job URL could not be read. The analysis used the job description already stored in Profile Intelligence.");
            }
        }
        if (!jdText && jd) {
            jdText = reconstructJdText(jd);
            unavailableVerifications.push("The original job-description text was not stored, so requirements were read from the extracted summary. Re-upload the job description for exact wording.");
        }
        if (!jdText)
            throw new MissingSourceError(["job_description"]);
        if (!options.skipExternalVerification) {
            const verification = await this.stage(trace, failedStages, "verify_official_posting", () => verifyAgainstOfficialPosting({
                jdText,
                title: jd?.title ?? "",
                company: jd?.company ?? "",
                location: jd?.location && jd.location !== "Unknown Location" ? jd.location : "",
                provider,
                allowRecovery: jdSourceKind !== "job_url"
            }), { externalSources: [], unavailableVerifications: [], officialVerified: false, recoveredText: null });
            externalSources = [...externalSources, ...verification.externalSources];
            unavailableVerifications = [...unavailableVerifications, ...verification.unavailableVerifications];
            officialVerified = officialVerified || verification.officialVerified;
            if (verification.recoveredText)
                jdText = verification.recoveredText;
        }
        else {
            trace.push({ stage: "verify_official_posting", status: "skipped", durationMs: 0, traceId: (0, import_node_crypto2.randomUUID)().slice(0, 8) });
        }
        this.deps.onProgress?.("structuring_requirements");
        const extraction = await this.stage(trace, failedStages, "extract_requirements", () => extractRequirements(jdText, this.deps.generateContentFn), { requirements: [], mode: "heuristic", truncated: false, unanchoredCount: 0 });
        trace[trace.length - 1].detail = `${extraction.requirements.length} raw \xB7 mode=${extraction.mode}${extraction.truncated ? " \xB7 truncated" : ""}${extraction.unanchoredCount > 0 ? ` \xB7 ${extraction.unanchoredCount} unanchored` : ""}`;
        const normalized = await this.stage(trace, failedStages, "normalize_requirements", () => normalizeRequirements(extraction.requirements), { requirements: extraction.requirements, consolidatedCount: 0 });
        trace[trace.length - 1].detail = `${normalized.requirements.length} final \xB7 ${normalized.consolidatedCount} consolidated`;
        const requirements = normalized.requirements.map((r, i) => ({
            ...r,
            id: `rq_${analysisId.slice(3, 11)}_${i.toString(36)}`,
            analysisId
        }));
        this.deps.onProgress?.("finding_profile_evidence");
        const pool = await this.stage(trace, failedStages, "build_evidence_pool", () => buildEvidencePool(analysisId, resume, nodes), buildEvidencePool(analysisId, null, []));
        trace[trace.length - 1].detail = `${pool.items.length} evidence items \xB7 ${pool.allTerms.size} distinct capabilities`;
        const retrieved = /* @__PURE__ */ new Map();
        await this.stage(trace, failedStages, "retrieve_evidence", async () => {
            const queue = requirements.filter((r) => !r.hardGate);
            const CONCURRENCY = 4;
            let cursor = 0;
            await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
                for (;;) {
                    const i = cursor++;
                    if (i >= queue.length)
                        return;
                    this.checkCancelled();
                    const req = queue[i];
                    retrieved.set(req.id, await retrieveForRequirement(req, pool, nodes, this.deps.embedFn, this.deps.getEmbeddingSpaceKey?.() ?? null));
                }
            }));
            return true;
        }, false);
        trace[trace.length - 1].detail = `${retrieved.size} requirements searched`;
        this.deps.onProgress?.("evaluating_transferable_experience");
        const outcome = await this.stage(trace, failedStages, "assess_requirements", () => assessRequirements({
            requirements,
            retrieved,
            pool,
            generateContentFn: this.deps.generateContentFn
        }), { assessments: [], deterministicCount: 0, failedBatches: 0 });
        trace[trace.length - 1].detail = `${outcome.assessments.length} assessed \xB7 ${outcome.deterministicCount} without a model call${outcome.failedBatches > 0 ? ` \xB7 ${outcome.failedBatches} batch(es) failed` : ""}`;
        if (outcome.failedBatches > 0 && !failedStages.includes("assess_requirements")) {
            failedStages.push("assess_requirements");
        }
        const gates = await this.stage(trace, failedStages, "evaluate_hard_gates", () => evaluateHardGates(requirements, resume, pool), { checks: [], status: "not_applicable" });
        trace[trace.length - 1].detail = `${gates.checks.length} condition(s) \xB7 ${gates.status}`;
        const gateAssessments = gates.checks.map((check) => {
            const status = check.state === "not_met" ? "requirement_not_met" : check.state === "met" || check.state === "likely_met" ? "proven" : "needs_evidence";
            return {
                requirementId: check.requirementId,
                analysisId,
                status,
                evidenceIds: check.evidenceIds,
                explanation: check.detail,
                limitations: check.state === "likely_met" ? ["Natively inferred this from your r\xE9sum\xE9; it has not been confirmed by you."] : [],
                missingInformation: status === "needs_evidence" ? ["Confirm this condition so it can be resolved \u2014 Natively cannot verify it from your profile."] : [],
                confidence: check.state === "met" ? 0.9 : check.state === "likely_met" ? 0.6 : 0.5,
                userCorrected: false
            };
        });
        const gateById = new Map(gateAssessments.map((a) => [a.requirementId, a]));
        outcome.assessments = [
            ...outcome.assessments.filter((a) => !gateById.has(a.requirementId)),
            ...gateAssessments
        ];
        this.deps.onProgress?.("validating_conclusions");
        const validated = await this.stage(trace, failedStages, "validate_conclusions", () => validateAssessments(requirements, outcome.assessments, pool, new Set(gateById.keys())), { assessments: outcome.assessments, violations: [] });
        trace[trace.length - 1].detail = validated.violations.length > 0 ? `${validated.violations.length} conclusion(s) downgraded` : "all conclusions cite stored evidence";
        if (validated.violations.length > 0) {
            console.warn("[RoleInsight] Validator corrections:", validated.violations.slice(0, 10));
        }
        const reqById = new Map(requirements.map((r) => [r.id, r]));
        const assessments = validated.assessments.map((a) => {
            const req = reqById.get(a.requirementId);
            if (!req)
                return a;
            const isGap = a.status === "needs_evidence" || a.status === "confirmed_gap" || a.status === "requirement_not_met";
            if (!isGap)
                return a;
            const ret = retrieved.get(req.id);
            const hasAdjacent = !!ret && evidenceTerms(pool, ret.orderedIds).size > 0;
            const { severity, rationale } = assignSeverity(req, a, hasAdjacent);
            return { ...a, severity, severityRationale: rationale };
        });
        this.deps.onProgress?.("preparing_role_insight");
        const resumeHeuristic = resumeDoc?.structured_data?._extraction_mode === "heuristic";
        const coverageInput = {
            requirements,
            assessments,
            extractionMode: extraction.mode,
            jdTruncated: extraction.truncated,
            resumeHeuristic,
            profileNodeCount: nodes.filter((n) => n.source_type === "resume" /* RESUME */).length,
            failedStages
        };
        const coverage = calculateCoverage(coverageInput);
        const roleAlignment = deriveAlignment(coverage);
        const { confidence: evidenceConfidence, reasons: confidenceReasons } = deriveEvidenceConfidence(coverage, coverageInput);
        const sourceMeta = {
            resumeName: resume?.identity?.name ? `${resume.identity.name}'s r\xE9sum\xE9` : "Submitted r\xE9sum\xE9",
            resumeUpdatedAt: resumeDoc?.created_at ?? null,
            resumeOrigin: resumeDoc?.source_uri ?? "",
            resumeIsSubmitted: true,
            jdTitle: jd?.title ?? "",
            jdCompany: jd?.company ?? "",
            jdUpdatedAt: jdDoc?.created_at ?? null,
            jdOrigin,
            jdSourceKind,
            jdOfficialVerified: officialVerified,
            profileNodeCount: coverageInput.profileNodeCount,
            externalSources,
            unavailableVerifications
        };
        const analysis = {
            id: analysisId,
            resumeFingerprint: fingerprintResume(resumeDoc),
            // F6 (code review 2026-08-05): the override-text fingerprint is only
            // valid when the URL actually resolved. On a failed resolution
            // jdText falls back to the stored JD, and hashing that text alone
            // can never equal fingerprintJd(jdDoc)'s two-part hash — the report
            // was born "outdated", showed a spurious banner, and auto-refresh
            // immediately spent tokens replacing a seconds-old analysis.
            jdFingerprint: fingerprintJd(jdDoc, jdSourceKind === "job_url" ? jdText : void 0),
            profileFingerprint: fingerprintProfile(nodes),
            extractorVersion: REQUIREMENT_EXTRACTOR_VERSION,
            matcherVersion: REQUIREMENT_MATCHER_VERSION,
            roleAlignment,
            evidenceConfidence,
            hardGateStatus: gates.status,
            summary: buildSummary(roleAlignment, coverage, gates.status, jd?.title ?? ""),
            confidenceReasons,
            coverage,
            hardGates: gates.checks,
            sourceMeta,
            stageTrace: trace,
            status: failedStages.length === 0 ? "complete" : requirements.length > 0 ? "partial" : "failed",
            failedStages,
            createdAt: ( /* @__PURE__ */new Date()).toISOString()
        };
        const citedIds = new Set(assessments.flatMap((a) => a.evidenceIds));
        for (const g of gates.checks)
            g.evidenceIds.forEach((id) => citedIds.add(id));
        const citedEvidence = pool.items.filter((i) => citedIds.has(i.id));
        this.deps.db.saveAnalysis(analysis);
        this.deps.db.saveRequirements(requirements);
        this.deps.db.saveEvidence(citedEvidence);
        this.deps.db.saveAssessments(assessments);
        this.deps.db.pruneAnalyses(20);
        return {
            analysis,
            requirements,
            assessments,
            evidence: citedEvidence,
            clarifications: buildClarifications(requirements, assessments),
            outdated: false,
            outdatedReasons: []
        };
    }
};
var PRIORITY_LABEL = {
    critical: "Critical",
    important: "Important",
    supporting: "Supporting",
    preferred: "Preferred"
};
function buildClarifications(requirements, assessments) {
    const byId = new Map(assessments.map((a) => [a.requirementId, a]));
    const out = [];
    for (const req of requirements) {
        if (req.excluded)
            continue;
        const a = byId.get(req.id);
        if (!a || a.status !== "needs_evidence")
            continue;
        if (req.priority === "supporting" || req.priority === "preferred")
            continue;
        if (a.userCorrected)
            continue;
        const known = a.evidenceIds.length > 0 || a.missingInformation.length > 1 && a.limitations.length > 0 ? a.explanation : "Nothing in your profile addresses this yet.";
        const isCondition = req.hardGate || (req.category === "education" || req.category === "certification") && req.mandatory;
        const subject = req.normalizedText.replace(/\.$/, "");
        out.push({
            requirementId: req.id,
            question: isCondition ? `${subject} \u2014 can you confirm this?` : `${subject} \u2014 have you done this?`,
            knownContext: known,
            missingContext: a.missingInformation[0] ?? "No supporting evidence was found.",
            impactStatement: isCondition ? "Confirming this resolves one mandatory condition. Mandatory conditions are tracked separately and never affect requirement coverage." : `Answering this could change one ${PRIORITY_LABEL[req.priority]} requirement from Needs Evidence to Proven or Transferable.`,
            priority: req.priority,
            isCondition
        });
    }
    out.sort((a, b) => (a.priority === "critical" ? 0 : 1) - (b.priority === "critical" ? 0 : 1));
    return out.slice(0, 8);
}
function safeCall(fn, fallback) {
    try {
        return fn();
    }
    catch {
        return fallback;
    }
}
function reconstructJdText(jd) {
    const parts = [];
    if (jd.title)
        parts.push(`# ${jd.title}`);
    if (jd.company)
        parts.push(`Company: ${jd.company}`);
    if (jd.location)
        parts.push(`Location: ${jd.location}`);
    if (jd.description_summary)
        parts.push(`
## Overview
${jd.description_summary}`);
    if (jd.responsibilities?.length) {
        parts.push(`
## Responsibilities
${jd.responsibilities.map((r) => `- ${r}`).join("\n")}`);
    }
    if (jd.requirements?.length) {
        parts.push(`
## Requirements
${jd.requirements.map((r) => `- ${r}`).join("\n")}`);
    }
    if (jd.nice_to_haves?.length) {
        parts.push(`
## Nice to have
${jd.nice_to_haves.map((r) => `- ${r}`).join("\n")}`);
    }
    if (jd.technologies?.length) {
        parts.push(`
## Technologies
${jd.technologies.map((t) => `- ${t}`).join("\n")}`);
    }
    return parts.join("\n");
}
export { AnalysisCancelledError, MissingSourceError, PROGRESS_STAGE_LABELS, RoleInsightEngine, buildClarifications, fingerprintJd, fingerprintProfile, fingerprintResume, reconstructJdText };
