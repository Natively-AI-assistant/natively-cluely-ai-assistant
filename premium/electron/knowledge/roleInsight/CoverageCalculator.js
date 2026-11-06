// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.
import { MATCH_STATUSES } from "./types";
import { PRIORITY_WEIGHTS } from "./types";
import { STATUS_CONTRIBUTION } from "./types";
import { CATEGORY_GROUPS } from "./RequirementNormalizer";
import { GAP_SEVERITIES } from "./types";
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
// premium/electron/knowledge/roleInsight/CoverageCalculator.ts
function calculateCoverage(input) {
    const { requirements, assessments } = input;
    const byId = new Map(assessments.map((a) => [a.requirementId, a]));
    const active = requirements.filter((r) => !r.excluded);
    const explanation = [];
    const buckets = /* @__PURE__ */ new Map();
    for (const s of MATCH_STATUSES)
        buckets.set(s, { status: s, count: 0, weight: 0 });
    let countedWeight = 0;
    let earnedWeight = 0;
    let unresolvedWeight = 0;
    let unresolvedCount = 0;
    let preferredTotal = 0;
    let criticalTotal = 0, criticalProven = 0, criticalUnresolved = 0, criticalBlocked = 0;
    for (const req of active) {
        const a = byId.get(req.id);
        if (!a)
            continue;
        const weight = PRIORITY_WEIGHTS[req.priority];
        const bucket = buckets.get(a.status);
        bucket.count += 1;
        bucket.weight += weight;
        if (req.priority === "preferred" || a.status === "preferred") {
            preferredTotal += 1;
            continue;
        }
        if (req.hardGate)
            continue;
        if (req.priority === "critical")
            criticalTotal += 1;
        if (a.status === "needs_evidence") {
            unresolvedWeight += weight;
            unresolvedCount += 1;
            if (req.priority === "critical")
                criticalUnresolved += 1;
            continue;
        }
        const contribution = STATUS_CONTRIBUTION[a.status];
        if (contribution === void 0)
            continue;
        countedWeight += weight;
        earnedWeight += weight * contribution;
        if (req.priority === "critical") {
            if (a.status === "proven")
                criticalProven += 1;
            if (a.status === "confirmed_gap" || a.status === "requirement_not_met")
                criticalBlocked += 1;
        }
    }
    const weightedCoverage = countedWeight > 0 ? earnedWeight / countedWeight : null;
    const totalConsidered = countedWeight + unresolvedWeight;
    const unresolvedShare = totalConsidered > 0 ? unresolvedWeight / totalConsidered : 0;
    explanation.push(`Requirements are weighted by priority: critical \xD7${PRIORITY_WEIGHTS.critical}, important \xD7${PRIORITY_WEIGHTS.important}, supporting \xD7${PRIORITY_WEIGHTS.supporting}.`, `Proven contributes its full weight; transferable contributes half.`, `Requirements with no evidence found are excluded from this figure entirely \u2014 they measure what Natively could not find, not what you lack. ${unresolvedCount} requirement${unresolvedCount === 1 ? "" : "s"} (${Math.round(unresolvedShare * 100)}% of weight) ${unresolvedCount === 1 ? "is" : "are"} unresolved.`, `Preferred qualifications (${preferredTotal}) are shown separately and never counted here.`, `Mandatory eligibility conditions are checked separately and are never averaged into this figure.`);
    if (countedWeight === 0) {
        explanation.push("No requirement could be resolved from the available evidence, so no coverage figure is shown.");
    }
    const categories = [];
    for (const group of CATEGORY_GROUPS) {
        const inGroup = active.filter((r) => group.categories.includes(r.category));
        if (inGroup.length === 0)
            continue;
        let proven = 0, transferable = 0, needsEvidence = 0, confirmedGap = 0, notMet = 0, preferred = 0;
        let gCounted = 0, gEarned = 0;
        for (const req of inGroup) {
            const a = byId.get(req.id);
            if (!a)
                continue;
            const w = PRIORITY_WEIGHTS[req.priority] || 1;
            switch (a.status) {
                case "proven":
                    proven++;
                    gCounted += w;
                    gEarned += w;
                    break;
                case "transferable":
                    transferable++;
                    gCounted += w;
                    gEarned += w * 0.5;
                    break;
                case "needs_evidence":
                    needsEvidence++;
                    break;
                case "confirmed_gap":
                    confirmedGap++;
                    gCounted += w;
                    break;
                case "requirement_not_met":
                    notMet++;
                    gCounted += w;
                    break;
                case "preferred":
                    preferred++;
                    break;
            }
        }
        categories.push({
            category: group.categories[0],
            label: group.label,
            total: inGroup.length,
            proven,
            transferable,
            needsEvidence,
            confirmedGap,
            requirementNotMet: notMet,
            preferred,
            coverage: gCounted > 0 ? gEarned / gCounted : null
        });
    }
    const severityCounts = Object.fromEntries(GAP_SEVERITIES.map((s) => [s, 0]));
    for (const a of assessments) {
        const isGap = a.status === "needs_evidence" || a.status === "confirmed_gap" || a.status === "requirement_not_met";
        if (isGap && a.severity)
            severityCounts[a.severity] += 1;
    }
    return {
        weightedCoverage,
        countedWeight,
        unresolvedWeight,
        unresolvedCount,
        unresolvedShare,
        buckets: Array.from(buckets.values()),
        categories,
        severityCounts,
        criticalTotal,
        criticalProven,
        criticalUnresolved,
        criticalBlocked,
        preferredTotal,
        explanation
    };
}
function deriveAlignment(coverage) {
    if (coverage.weightedCoverage === null)
        return "insufficient_information";
    if (coverage.unresolvedShare > 0.5)
        return "insufficient_information";
    if (coverage.criticalBlocked > 0) {
        return coverage.criticalBlocked >= 2 ? "limited" : "mixed";
    }
    const c = coverage.weightedCoverage;
    let band = c >= 0.8 ? "strong" : c >= 0.6 ? "good" : c >= 0.35 ? "mixed" : "limited";
    if (coverage.unresolvedShare > 0.3) {
        if (band === "strong")
            band = "good";
        else if (band === "good")
            band = "mixed";
    }
    if (band === "strong" && coverage.criticalUnresolved > 0)
        band = "good";
    return band;
}
function deriveEvidenceConfidence(coverage, input) {
    const reasons = [];
    let score = 1;
    if (input.resumeHeuristic) {
        score -= 0.25;
        reasons.push("Your r\xE9sum\xE9 was parsed with the fallback text extractor, so some structure may be missing.");
    }
    if (input.extractionMode === "heuristic") {
        score -= 0.2;
        reasons.push("Requirements were extracted from the job description without the analysis model, so wording nuance may be lost.");
    }
    if (input.jdTruncated) {
        score -= 0.1;
        reasons.push("The job description was long and only the first portion was analysed.");
    }
    if (input.profileNodeCount === 0) {
        score -= 0.25;
        reasons.push("No searchable profile content is indexed, so only structured r\xE9sum\xE9 fields could be matched.");
    }
    else if (input.profileNodeCount < 8) {
        score -= 0.1;
        reasons.push("Your indexed profile is small, which limits how much supporting evidence can be found.");
    }
    if (input.failedStages.length > 0) {
        score -= 0.2;
        reasons.push(`Part of the analysis did not complete: ${input.failedStages.join(", ")}.`);
    }
    if (coverage.unresolvedShare > 0.5) {
        score -= 0.3;
        reasons.push(`Over half the weighted requirements (${coverage.unresolvedCount}) have no supporting evidence recorded.`);
    }
    else if (coverage.unresolvedShare > 0.25) {
        score -= 0.15;
        reasons.push(`${coverage.unresolvedCount} requirements have no supporting evidence recorded.`);
    }
    if (coverage.criticalUnresolved > 0) {
        score -= 0.1;
        reasons.push(`${coverage.criticalUnresolved} critical requirement${coverage.criticalUnresolved === 1 ? "" : "s"} could not be resolved from your profile.`);
    }
    if (reasons.length === 0) {
        reasons.push("Your r\xE9sum\xE9 parsed cleanly, the job description was fully analysed, and most requirements resolved against recorded evidence.");
    }
    const confidence = coverage.weightedCoverage === null ? "insufficient" : score >= 0.8 ? "high" : score >= 0.55 ? "moderate" : score >= 0.3 ? "low" : "insufficient";
    return { confidence, reasons };
}
function buildSummary(alignment, coverage, hardGateStatus, jdTitle) {
    const parts = [];
    const role = jdTitle ? `the ${jdTitle} role` : "this role";
    switch (alignment) {
        case "strong":
            parts.push(`Your recorded experience directly supports most of what ${role} asks for.`);
            break;
        case "good":
            parts.push(`Your recorded experience supports the majority of what ${role} asks for, with some areas resting on related rather than direct work.`);
            break;
        case "mixed":
            parts.push(`Your recorded experience supports part of ${role}, with several requirements met through related work rather than direct experience.`);
            break;
        case "limited":
            parts.push(`Little of your recorded experience directly addresses what ${role} asks for.`);
            break;
        case "insufficient_information":
            parts.push(`There is not enough recorded evidence to describe how your experience relates to ${role}.`);
            break;
    }
    if (coverage.unresolvedCount > 0) {
        parts.push(`${coverage.unresolvedCount} requirement${coverage.unresolvedCount === 1 ? "" : "s"} could not be matched to anything in your profile \u2014 confirming ${coverage.unresolvedCount === 1 ? "it" : "them"} would change this picture.`);
    }
    if (hardGateStatus === "not_met") {
        parts.push("One or more mandatory conditions are not met and need attention before anything else.");
    }
    else if (hardGateStatus === "needs_confirmation") {
        parts.push("Some mandatory conditions still need your confirmation.");
    }
    return parts.join(" ");
}
export { buildSummary, calculateCoverage, deriveAlignment, deriveEvidenceConfidence };
