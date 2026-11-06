// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.
import { fingerprintResume } from "./RoleInsightEngine";
import { fingerprintJd } from "./RoleInsightEngine";
import { fingerprintProfile } from "./RoleInsightEngine";
import { REQUIREMENT_EXTRACTOR_VERSION } from "./types";
import { REQUIREMENT_MATCHER_VERSION } from "./types";
import { buildClarifications } from "./RoleInsightEngine";
import { extractCanonicalTerms } from "./skillOntology";
import { canonicalize } from "./skillOntology";
import { RoleInsightEngine } from "./RoleInsightEngine";
import { AnalysisCancelledError } from "./RoleInsightEngine";
import { MissingSourceError } from "./RoleInsightEngine";
import { calculateCoverage } from "./CoverageCalculator";
import { deriveAlignment } from "./CoverageCalculator";
import { deriveEvidenceConfidence } from "./CoverageCalculator";
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
var import_node_crypto3 = require("node:crypto");
// premium/electron/knowledge/roleInsight/RoleInsightService.ts
var RoleInsightService = class {
    constructor(deps) {
        this.deps = deps;
    }
    deps;
    analysing = false;
    stage = null;
    cancelled = false;
    runToken = 0;
    lastError = null;
    // ── Status / outdated detection ──────────────────────────────────────────
    /**
     * Compare the stored analysis's fingerprints against the live sources.
     * Returns the specific drifts, because "outdated" alone is not actionable —
     * the user needs to know WHICH source changed.
     */
    detectOutdated(analysis) {
        if (!analysis)
            return { outdated: false, reasons: [] };
        const reasons = [];
        if (fingerprintResume(this.deps.getResumeDoc()) !== analysis.resumeFingerprint) {
            reasons.push("Your r\xE9sum\xE9 has changed since this analysis ran.");
        }
        if (analysis.sourceMeta?.jdSourceKind !== "job_url" && fingerprintJd(this.deps.getJdDoc()) !== analysis.jdFingerprint) {
            reasons.push("The job description has changed since this analysis ran.");
        }
        if (fingerprintProfile(this.deps.getNodes()) !== analysis.profileFingerprint) {
            reasons.push("Your Profile Intelligence data has changed since this analysis ran.");
        }
        if (analysis.extractorVersion !== REQUIREMENT_EXTRACTOR_VERSION || analysis.matcherVersion !== REQUIREMENT_MATCHER_VERSION) {
            reasons.push("Natively's analysis method has been updated since this analysis ran.");
        }
        return { outdated: reasons.length > 0, reasons };
    }
    getStatus() {
        const resumeDoc = this.deps.getResumeDoc();
        const jdDoc = this.deps.getJdDoc();
        const analysis = safe(() => this.deps.db.getLatestAnalysis(), null);
        const { outdated, reasons } = this.detectOutdated(analysis);
        const jd = jdDoc?.structured_data ?? {};
        const resume = resumeDoc?.structured_data ?? {};
        return {
            hasResume: !!resumeDoc,
            hasJobDescription: !!jdDoc,
            hasAnalysis: !!analysis,
            analysing: this.analysing,
            stage: this.stage,
            outdated,
            outdatedReasons: reasons,
            resumeName: resume?.identity?.name ? `${resume.identity.name}'s r\xE9sum\xE9` : "Submitted r\xE9sum\xE9",
            jdTitle: jd?.title ?? "",
            jdCompany: jd?.company ?? ""
        };
    }
    getLastError() {
        return this.lastError;
    }
    // ── Report loading ───────────────────────────────────────────────────────
    getReport(analysisId) {
        const analysis = analysisId ? this.deps.db.getAnalysis(analysisId) : this.deps.db.getLatestAnalysis();
        if (!analysis)
            return null;
        const { outdated, reasons } = this.detectOutdated(analysis);
        const requirements = this.deps.db.getRequirements(analysis.id);
        const assessments = this.deps.db.getAssessments(analysis.id);
        return {
            analysis,
            requirements,
            assessments,
            evidence: this.deps.db.getEvidence(analysis.id),
            clarifications: buildClarifications(requirements, assessments),
            outdated,
            outdatedReasons: reasons
        };
    }
    listHistory(limit = 20) {
        return this.deps.db.listAnalyses(limit).map((a) => ({
            id: a.id,
            createdAt: a.createdAt,
            roleAlignment: a.roleAlignment,
            evidenceConfidence: a.evidenceConfidence,
            status: a.status,
            jdTitle: a.sourceMeta?.jdTitle ?? "",
            jdCompany: a.sourceMeta?.jdCompany ?? ""
        }));
    }
    // ── Live-answer evidence ─────────────────────────────────────────────────
    /**
     * Evidence-grounded context for the LIVE interview answer path.
     *
     * Replaces GapAnalysisEngine's keyword pivots as the preferred source when a
     * fit/gap/behavioral question touches an at-risk requirement: instead of a
     * canned pivot_script, the model receives the assessed explanation, why the
     * adjacent experience transfers, and — critically — what it does NOT
     * establish, so a live answer inherits "never claim beyond the evidence".
     *
     * Deliberate gates, in order:
     *  · null when there is no analysis, or the analysis is OUTDATED — stale
     *    claims must never feed a live answer; the caller falls back.
     *  · matching is exact canonical-term intersection, or a full spaced-form
     *    substring. Nothing looser: the 2026-06-12 pivot regression came from
     *    injecting on any token overlap, bloating unrelated prompts.
     *  · only non-proven statuses. Proven experience is already injected by
     *    normal retrieval; the unique value here is the honesty layer.
     *  · capped at 2 requirements, fields truncated — prompt-size gate.
     */
    getLiveEvidence(question) {
        const analysis = safe(() => this.deps.db.getLatestAnalysis(), null);
        if (!analysis)
            return null;
        if (this.detectOutdated(analysis).outdated)
            return null;
        if (analysis.jdFingerprint !== fingerprintJd(this.deps.getJdDoc()))
            return null;
        const GENERIC = /* @__PURE__ */ new Set([
            "work",
            "team",
            "role",
            "company",
            "position",
            "job",
            "time",
            "tell",
            "skill",
            "skills",
            "build",
            "make",
            "handle",
            "good",
            "best",
            "help"
        ]);
        const qTerms = new Set(extractCanonicalTerms(question).map((t) => canonicalize(t)).filter((t) => !GENERIC.has(t)));
        const qLower = ` ${question.toLowerCase()} `;
        if (qTerms.size === 0)
            return null;
        const assessments = new Map(this.deps.db.getAssessments(analysis.id).map((a) => [a.requirementId, a]));
        const AT_RISK = /* @__PURE__ */ new Set(["transferable", "needs_evidence", "confirmed_gap", "requirement_not_met"]);
        const matched = [];
        for (const req of this.deps.db.getRequirements(analysis.id)) {
            if (req.excluded)
                continue;
            const a = assessments.get(req.id);
            if (!a || !AT_RISK.has(a.status))
                continue;
            const terms = (req.canonicalTerms ?? []).map((t) => canonicalize(t)).filter((t) => t && !GENERIC.has(t));
            const hit = terms.some((t) => qTerms.has(t) || t.includes("_") && qLower.includes(` ${t.replace(/_/g, " ")} `));
            if (!hit)
                continue;
            const rank = a.status === "requirement_not_met" ? 0 : a.status === "confirmed_gap" ? 1 : a.status === "needs_evidence" ? 2 : 3;
            matched.push({ req, a, rank });
        }
        if (matched.length === 0)
            return null;
        matched.sort((x, y) => x.rank - y.rank);
        const clip = (t, n) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, n);
        const STATE_LABEL = {
            transferable: "related experience only",
            needs_evidence: "no recorded evidence",
            confirmed_gap: "confirmed no direct experience",
            requirement_not_met: "condition not met"
        };
        const lines = [
            "Ground any claim about these topics in the evidence below. Never assert experience beyond it; acknowledge honestly and pivot to the adjacent evidence."
        ];
        for (const { req, a } of matched.slice(0, 2)) {
            lines.push(`[${clip(req.normalizedText, 90)} \u2014 ${STATE_LABEL[a.status]}]`);
            if (a.explanation)
                lines.push(`Evidence: ${clip(a.explanation, 280)}`);
            if (a.transferExplanation)
                lines.push(`Transfers because: ${clip(a.transferExplanation, 200)}`);
            if (a.limitations?.length)
                lines.push(`Not established: ${clip(a.limitations.join(" "), 220)}`);
        }
        return `<role_fit_evidence>
${lines.join("\n")}
</role_fit_evidence>`;
    }
    // ── Auto-refresh ─────────────────────────────────────────────────────────
    /**
     * When the stored analysis no longer matches the live sources, re-run it in
     * the background instead of parking an "Out of date" banner on the user.
     *
     * Single-flight (isAnalysing guard) and at most ONE attempt per source
     * state: `lastAutoKey` remembers the fingerprint triple that was attempted,
     * so a failing analysis cannot loop — the next attempt happens only after
     * the sources change again or the user re-analyses by hand.
     */
    lastAutoKey = null;
    maybeAutoRefresh() {
        if (this.analysing)
            return false;
        const resumeDoc = this.deps.getResumeDoc();
        const jdDoc = this.deps.getJdDoc();
        if (!resumeDoc || !jdDoc)
            return false;
        const analysis = safe(() => this.deps.db.getLatestAnalysis(), null);
        if (!analysis)
            return false;
        if (!this.detectOutdated(analysis).outdated)
            return false;
        if (analysis.sourceMeta?.jdSourceKind === "job_url")
            return false;
        const key = [
            fingerprintResume(resumeDoc),
            fingerprintJd(jdDoc),
            fingerprintProfile(this.deps.getNodes())
        ].join("|");
        if (this.lastAutoKey === key)
            return false;
        this.lastAutoKey = key;
        console.log("[RoleInsight] Sources changed \u2014 refreshing analysis in the background");
        void this.analyse({}).catch(() => {
        });
        return true;
    }
    // ── Run ──────────────────────────────────────────────────────────────────
    isAnalysing() {
        return this.analysing;
    }
    /** Cooperative cancel: the in-flight run stops at its next stage boundary. */
    cancel() {
        if (!this.analysing)
            return;
        this.cancelled = true;
        console.log("[RoleInsight] Cancellation requested");
    }
    async analyse(options = {}) {
        if (this.analysing)
            this.cancel();
        const token = ++this.runToken;
        this.analysing = true;
        this.cancelled = false;
        this.stage = "reading_job_description";
        this.lastError = null;
        const engine = new RoleInsightEngine({
            ...this.deps,
            onProgress: (s) => {
                if (token === this.runToken)
                    this.stage = s;
            },
            isCancelled: () => this.cancelled || token !== this.runToken
        });
        try {
            const report = await engine.run(options);
            return report;
        }
        catch (e) {
            if (e instanceof AnalysisCancelledError)
                throw e;
            if (e instanceof MissingSourceError)
                throw e;
            const diagnosticId = (0, import_node_crypto3.randomUUID)().slice(0, 8);
            console.error(`[RoleInsight] Analysis failed (diagnostic ${diagnosticId}):`, e);
            this.lastError = { message: e?.message ?? "Unknown error", diagnosticId };
            throw e;
        }
        finally {
            if (token === this.runToken) {
                this.analysing = false;
                this.stage = null;
            }
        }
    }
    // ── Corrections ──────────────────────────────────────────────────────────
    /**
     * Apply a user correction. The model's original conclusion is preserved on
     * the assessment (`originalStatus`) and the correction itself is appended to
     * an audit table — nothing is silently rewritten.
     */
    applyCorrection(args) {
        const { analysisId, requirementId, kind } = args;
        const analysis = this.deps.db.getAnalysis(analysisId);
        if (!analysis)
            return null;
        const assessments = this.deps.db.getAssessments(analysisId);
        const current = requirementId ? assessments.find((a) => a.requirementId === requirementId) ?? null : null;
        this.deps.db.addCorrection({
            id: `rc_${(0, import_node_crypto3.randomUUID)().replace(/-/g, "").slice(0, 16)}`,
            analysisId,
            requirementId,
            kind,
            detail: args.detail ?? args.evidenceText ?? "",
            previousStatus: current?.status ?? null,
            savedToProfile: false,
            createdAt: ( /* @__PURE__ */new Date()).toISOString()
        });
        switch (kind) {
            case "requirement_irrelevant":
                if (requirementId)
                    this.deps.db.setRequirementExcluded(requirementId, true);
                break;
            case "requirement_restored":
                if (requirementId)
                    this.deps.db.setRequirementExcluded(requirementId, false);
                break;
            case "reclassify_priority":
                if (requirementId && args.priority) {
                    this.deps.db.setRequirementPriority(requirementId, args.priority, args.mandatory ?? false);
                }
                break;
            case "confirm_experience": {
                if (!current || !requirementId)
                    break;
                const evidenceText = (args.evidenceText ?? "").trim();
                const confirmedReq = this.deps.db.getRequirements(analysisId).find((r) => r.id === requirementId);
                const isCondition = !!confirmedReq && (confirmedReq.hardGate || (confirmedReq.category === "education" || confirmedReq.category === "certification") && confirmedReq.mandatory);
                if (isCondition) {
                    this.deps.db.saveAssessments([{
                            ...current,
                            status: "proven",
                            originalStatus: current.originalStatus ?? current.status,
                            userCorrected: true,
                            explanation: evidenceText.length > 0 ? `You confirmed you meet this requirement: "${evidenceText}"` : "You confirmed you meet this requirement.",
                            transferExplanation: void 0,
                            limitations: [],
                            missingInformation: [],
                            confidence: 0.95,
                            evidenceIds: current.evidenceIds
                        }]);
                    break;
                }
                const updated = {
                    ...current,
                    // A user-supplied narrative is direct evidence → proven.
                    // A bare "yes" with no detail establishes that they have it
                    // but not how, so it lands as transferable with the gap named.
                    status: evidenceText.length >= 40 ? "proven" : "transferable",
                    originalStatus: current.originalStatus ?? current.status,
                    userCorrected: true,
                    explanation: evidenceText.length >= 40 ? `You confirmed this and described it: "${evidenceText}"` : "You confirmed you have this experience.",
                    transferExplanation: evidenceText.length >= 40 ? void 0 : "You confirmed the experience exists, so it counts as supported.",
                    limitations: evidenceText.length >= 40 ? [] : ["You have not yet described the work, so its depth and scope are unrecorded."],
                    missingInformation: evidenceText.length >= 40 ? [] : ["Add what happened, what you did, and the result to make this fully evidenced."],
                    confidence: evidenceText.length >= 40 ? 0.9 : 0.7,
                    evidenceIds: current.evidenceIds
                };
                this.deps.db.saveAssessments([updated]);
                break;
            }
            case "confirm_gap": {
                if (!current || !requirementId)
                    break;
                this.deps.db.saveAssessments([{
                        ...current,
                        status: "confirmed_gap",
                        originalStatus: current.originalStatus ?? current.status,
                        userCorrected: true,
                        explanation: "You confirmed you do not have this experience.",
                        transferExplanation: void 0,
                        limitations: [],
                        missingInformation: [],
                        confidence: 0.95
                    }]);
                break;
            }
            case "evidence_unrelated": {
                if (!current || !args.evidenceId)
                    break;
                const remaining = current.evidenceIds.filter((id) => id !== args.evidenceId);
                this.deps.db.saveAssessments([{
                        ...current,
                        evidenceIds: remaining,
                        originalStatus: current.originalStatus ?? current.status,
                        userCorrected: true,
                        status: remaining.length === 0 ? "needs_evidence" : current.status,
                        explanation: remaining.length === 0 ? "You marked the supporting evidence as unrelated, so this is unresolved again." : current.explanation,
                        missingInformation: remaining.length === 0 ? ["Confirm whether you have this experience."] : current.missingInformation
                    }]);
                break;
            }
            case "jd_misparsed":
            case "private_note":
                break;
        }
        this.recomputeSummary(analysisId);
        return this.getReport(analysisId);
    }
    /** Map a clarification answer onto the correction it implies. */
    answerClarification(args) {
        const { analysisId, requirementId, answer, detail } = args;
        switch (answer) {
            case "yes":
            case "partially":
                return this.applyCorrection({
                    analysisId,
                    requirementId,
                    kind: "confirm_experience",
                    evidenceText: detail,
                    detail
                });
            case "no":
                return this.applyCorrection({ analysisId, requirementId, kind: "confirm_gap", detail });
            case "unsure":
            case "decline":
            default:
                this.deps.db.addCorrection({
                    id: `rc_${(0, import_node_crypto3.randomUUID)().replace(/-/g, "").slice(0, 16)}`,
                    analysisId,
                    requirementId,
                    kind: "private_note",
                    detail: answer === "decline" ? "User declined to add this to their profile." : "User was unsure whether their experience qualifies.",
                    previousStatus: null,
                    savedToProfile: false,
                    createdAt: ( /* @__PURE__ */new Date()).toISOString()
                });
                return this.getReport(analysisId);
        }
    }
    /**
     * Persist a confirmed claim as reusable Profile Intelligence evidence.
     *
     * SEPARATE from applyCorrection on purpose. Confirming experience inside
     * Role Insight must never write to the permanent profile — this call is the
     * only route, and it exists so the UI can require an explicit second action.
     */
    async saveToProfile(args) {
        const claim = args.claim.trim();
        if (claim.length < 10) {
            return { success: false, error: "Add a little more detail before saving this to your profile." };
        }
        if (!this.deps.appendProfileEvidence) {
            return { success: false, error: "Saving to Profile Intelligence is not available in this build." };
        }
        const requirement = this.deps.db.getRequirements(args.analysisId).find((r) => r.id === args.requirementId);
        const label = requirement ? `Confirmed for: ${requirement.normalizedText}` : "Confirmed experience";
        const ok = await this.deps.appendProfileEvidence(claim, label);
        if (!ok)
            return { success: false, error: "Could not write to Profile Intelligence." };
        this.deps.db.updateProfileFingerprint(args.analysisId, fingerprintProfile(this.deps.getNodes()));
        this.deps.db.addCorrection({
            id: `rc_${(0, import_node_crypto3.randomUUID)().replace(/-/g, "").slice(0, 16)}`,
            analysisId: args.analysisId,
            requirementId: args.requirementId,
            kind: "confirm_experience",
            detail: claim,
            previousStatus: null,
            savedToProfile: true,
            createdAt: ( /* @__PURE__ */new Date()).toISOString()
        });
        return { success: true };
    }
    // ── Recomputation after a correction ─────────────────────────────────────
    /**
     * Corrections change statuses and exclusions, so every summary metric must be
     * recomputed. This is deterministic and cheap — no LLM, no retrieval — which
     * is why a correction updates the whole picture instantly.
     */
    recomputeSummary(analysisId) {
        const analysis = this.deps.db.getAnalysis(analysisId);
        if (!analysis)
            return;
        const requirements = this.deps.db.getRequirements(analysisId);
        const assessments = this.deps.db.getAssessments(analysisId);
        const coverageInput = {
            requirements,
            assessments,
            extractionMode: (analysis.stageTrace.find((s) => s.stage === "extract_requirements")?.detail ?? "").includes("mode=llm") ? "llm" : "heuristic",
            jdTruncated: (analysis.stageTrace.find((s) => s.stage === "extract_requirements")?.detail ?? "").includes("truncated"),
            resumeHeuristic: false,
            profileNodeCount: analysis.sourceMeta?.profileNodeCount ?? 0,
            failedStages: analysis.failedStages
        };
        const coverage = calculateCoverage(coverageInput);
        const roleAlignment = deriveAlignment(coverage);
        const { confidence, reasons } = deriveEvidenceConfidence(coverage, coverageInput);
        const gateConfirmations = /* @__PURE__ */ new Map();
        for (const c of this.deps.db.getCorrections(analysisId)) {
            if (!c.requirementId)
                continue;
            if (c.kind === "confirm_experience") {
                gateConfirmations.set(c.requirementId, { held: true, detail: c.detail || "You confirmed you meet this requirement." });
            }
            else if (c.kind === "confirm_gap") {
                gateConfirmations.set(c.requirementId, { held: false, detail: c.detail || "You confirmed you do not meet this requirement." });
            }
        }
        const gateChecks = (analysis.hardGates ?? []).map((g) => {
            const conf = gateConfirmations.get(g.requirementId);
            if (!conf)
                return g;
            return {
                ...g,
                state: conf.held ? "met" : "not_met",
                detail: conf.detail
                // Stored citations only — never ids from a rebuilt pool.
            };
        });
        const hardGateStatus = gateChecks.length === 0 ? "not_applicable" : gateChecks.some((g) => g.state === "not_met") ? "not_met" : gateChecks.some((g) => g.state === "needs_confirmation") ? "needs_confirmation" : "clear";
        this.deps.db.updateAnalysisSummary(analysisId, {
            roleAlignment,
            evidenceConfidence: confidence,
            hardGateStatus,
            summary: buildSummary(roleAlignment, coverage, hardGateStatus, analysis.sourceMeta?.jdTitle ?? ""),
            coverage,
            hardGates: gateChecks,
            confidenceReasons: reasons
        });
    }
};
function safe(fn, fallback) {
    try {
        return fn();
    }
    catch (e) {
        console.warn("[RoleInsight] guarded call failed:", e?.message);
        return fallback;
    }
}
export { AnalysisCancelledError, MissingSourceError, RoleInsightService };
