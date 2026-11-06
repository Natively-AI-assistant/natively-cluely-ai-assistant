// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.

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
var GENERIC_PHRASES = [
    /\byour experience is relevant\b/i,
    /\bthis (skill )?aligns( well)?\b/i,
    /\byou (appear to be|seem to be|are) a (good|strong|great) (match|fit)\b/i,
    /\bstrong (candidate|match|fit)\b/i,
    /\bclosely (aligns|matches|related)\b/i,
    /\bhighly relevant\b/i,
    /\bdemonstrates? (strong|excellent|good) (skills|ability)\b/i,
    /\bwell[- ]suited\b/i
];
var UNSUPPORTED_ASSERTIONS = [
    /\byou (are|have been|remain)\b[^.]{0,40}\b(certified|authorized|eligible|cleared)\b/i,
    /\byou (hold|possess|have)\b[^.]{0,40}\b(visa|clearance|licence|license|certification|work authorization)\b/i,
    /\byou (live|reside|are based) in\b/i,
    /\byou managed \d+/i,
    /\byou (are|were) (a )?(us|u\.s\.|american|eu|uk) citizen\b/i
];
function isGeneric(text) {
    return GENERIC_PHRASES.some((re) => re.test(text));
}
function downgrade(a, req, reason, extraMissing) {
    return {
        ...a,
        status: "needs_evidence",
        // The original conclusion is preserved, never silently discarded — the
        // spec requires corrections be auditable and this is a correction.
        originalStatus: a.originalStatus ?? a.status,
        evidenceIds: [],
        explanation: reason,
        transferExplanation: void 0,
        limitations: [],
        missingInformation: Array.from(/* @__PURE__ */ new Set([...a.missingInformation, extraMissing])),
        confidence: Math.min(a.confidence, 0.4)
    };
}
function validateAssessments(requirements, assessments, pool, deterministicIds = /* @__PURE__ */ new Set()) {
    const reqById = new Map(requirements.map((r) => [r.id, r]));
    const violations = [];
    const out = [];
    for (const a of assessments) {
        const req = reqById.get(a.requirementId);
        if (!req) {
            violations.push(`Assessment for unknown requirement ${a.requirementId} dropped.`);
            continue;
        }
        if (a.userCorrected) {
            out.push(a);
            continue;
        }
        let current = a;
        if (deterministicIds.has(a.requirementId) || reqById.get(a.requirementId)?.hardGate) {
            const resolved = current.evidenceIds.filter((id) => pool.byId.has(id));
            if (resolved.length !== current.evidenceIds.length) {
                violations.push(`${a.requirementId}: dropped unresolvable hard-gate citation(s).`);
            }
            out.push({ ...current, evidenceIds: resolved });
            continue;
        }
        const known = current.evidenceIds.filter((id) => pool.byId.has(id));
        if (known.length !== current.evidenceIds.length) {
            violations.push(`${req.id}: dropped ${current.evidenceIds.length - known.length} citation(s) that do not resolve to stored evidence.`);
            current = { ...current, evidenceIds: known };
        }
        if ((current.status === "proven" || current.status === "transferable") && current.evidenceIds.length === 0) {
            violations.push(`${req.id}: "${current.status}" cited no stored evidence \u2014 downgraded to needs_evidence.`);
            out.push(downgrade(current, req, "Natively could not tie a conclusion here back to specific evidence in your profile, so this is left unresolved rather than assumed.", `Confirm whether you have experience with "${req.normalizedText}".`));
            continue;
        }
        if (current.status === "preferred" && (current.preferredSubStatus === "proven" || current.preferredSubStatus === "transferable") && current.evidenceIds.length === 0) {
            violations.push(`${req.id}: preferred sub-status claimed support with no citation \u2014 reset to unknown.`);
            current = { ...current, preferredSubStatus: "unknown" };
        }
        if (current.status === "transferable") {
            const hasTransfer = (current.transferExplanation ?? "").trim().length >= 20;
            const hasLimit = current.limitations.some((l) => l.trim().length >= 12);
            if (!hasTransfer || !hasLimit) {
                violations.push(`${req.id}: transferable without ${!hasTransfer ? "a transfer explanation" : "a stated limitation"} \u2014 downgraded.`);
                out.push(downgrade(current, req, "Related experience was found, but Natively could not state precisely what transfers and what it does not \u2014 so this is left unresolved rather than overclaimed.", `Describe how your experience relates to "${req.normalizedText}".`));
                continue;
            }
        }
        if (current.status === "proven" || current.status === "transferable") {
            const blob = `${current.explanation} ${current.transferExplanation ?? ""}`;
            if (isGeneric(blob) || current.explanation.trim().length < 25) {
                violations.push(`${req.id}: explanation was generic or empty \u2014 downgraded.`);
                out.push(downgrade(current, req, "Natively could not produce a specific, evidence-grounded explanation for this requirement, so it is left unresolved.", `Confirm whether you have experience with "${req.normalizedText}".`));
                continue;
            }
        }
        const assertion = UNSUPPORTED_ASSERTIONS.find((re) => re.test(current.explanation));
        if (assertion) {
            violations.push(`${req.id}: explanation asserted an unverifiable personal status \u2014 downgraded.`);
            out.push(downgrade(current, req, "The explanation for this requirement made a claim about your status that your profile does not establish, so it has been withheld.", `Confirm your status for "${req.normalizedText}".`));
            continue;
        }
        if (current.status === "confirmed_gap") {
            violations.push(`${req.id}: confirmed_gap without a user confirmation \u2014 downgraded.`);
            out.push(downgrade(current, req, "This is recorded as unresolved because it was never confirmed with you.", `Confirm whether you have experience with "${req.normalizedText}".`));
            continue;
        }
        if (current.status === "requirement_not_met" && !req.hardGate) {
            violations.push(`${req.id}: requirement_not_met on a non-gate requirement \u2014 downgraded.`);
            out.push(downgrade(current, req, "This is recorded as unresolved because it is not a verifiable eligibility condition.", `Confirm whether you have experience with "${req.normalizedText}".`));
            continue;
        }
        if (current.status === "needs_evidence" && current.missingInformation.length === 0) {
            current = {
                ...current,
                missingInformation: [
                    `Nothing in your profile addresses "${req.normalizedText}".`,
                    "This means Natively could not find it \u2014 not that you lack it."
                ]
            };
        }
        out.push(current);
    }
    const covered = new Set(out.map((a) => a.requirementId));
    for (const req of requirements) {
        if (req.excluded || covered.has(req.id))
            continue;
        violations.push(`${req.id}: no assessment produced \u2014 recorded as unresolved.`);
        out.push({
            requirementId: req.id,
            analysisId: req.analysisId,
            status: "needs_evidence",
            evidenceIds: [],
            explanation: "This requirement was not assessed in this run.",
            limitations: [],
            missingInformation: [`Re-run the analysis to assess "${req.normalizedText}".`],
            confidence: 0.3,
            userCorrected: false
        });
    }
    return { assessments: out, violations };
}
var MODEL_ORIGINABLE_STATUSES = /* @__PURE__ */ new Set(["proven", "transferable", "needs_evidence", "preferred"]);
export { MODEL_ORIGINABLE_STATUSES, validateAssessments };
