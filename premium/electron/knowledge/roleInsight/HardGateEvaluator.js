// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.
import { normalizeTerm } from "./skillOntology";
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
// premium/electron/knowledge/roleInsight/HardGateEvaluator.ts
var DEGREE_RANK = [
    { re: /\b(high school|secondary|ged)\b/i, rank: 1, label: "high school" },
    { re: /\b(associate|a\.?a\.?s?\.?)\b/i, rank: 2, label: "associate's" },
    { re: /\b(bachelor|b\.?s\.?c?\.?|b\.?a\.?|b\.?tech|b\.?e\.?|undergraduate)\b/i, rank: 3, label: "bachelor's" },
    { re: /\b(master|m\.?s\.?c?\.?|m\.?a\.?|m\.?tech|mba|postgraduate)\b/i, rank: 4, label: "master's" },
    { re: /\b(ph\.?d|doctora|dphil)\b/i, rank: 5, label: "doctorate" }
];
function degreeRank(text) {
    for (let i = DEGREE_RANK.length - 1; i >= 0; i--) {
        if (DEGREE_RANK[i].re.test(text))
            return { rank: DEGREE_RANK[i].rank, label: DEGREE_RANK[i].label };
    }
    return null;
}
var REMOTE_RE = /\b(fully remote|remote[- ]first|100% remote|work from home|wfh|remote)\b/i;
var ONSITE_RE = /\b(on-?site|in[- ]office|in person)\b/i;
var HYBRID_RE = /\bhybrid\b/i;
function labelFor(req) {
    switch (req.category) {
        case "authorization":
            return "Work authorization";
        case "clearance":
            return "Security clearance";
        case "location":
            return "Location";
        case "logistics":
            return "Logistics";
        case "education":
            return "Degree";
        case "certification":
            return "Certification";
        default:
            return "Requirement";
    }
}
function factEvidence(pool, categories) {
    return pool.items.filter((i) => categories.includes(i.category));
}
function evaluateHardGates(requirements, resume, pool, userConfirmations = /* @__PURE__ */ new Map()) {
    const checks = [];
    const gateRequirements = requirements.filter((r) => !r.excluded && (r.hardGate || (r.category === "education" || r.category === "certification") && r.mandatory));
    for (const req of gateRequirements) {
        const confirmed = userConfirmations.get(req.id);
        if (confirmed) {
            checks.push({
                requirementId: req.id,
                label: labelFor(req),
                state: confirmed.held ? "met" : "not_met",
                detail: confirmed.detail || (confirmed.held ? "You confirmed you meet this requirement." : "You confirmed you do not meet this requirement."),
                evidenceIds: []
            });
            continue;
        }
        checks.push(evaluateOne(req, resume, pool));
    }
    let status;
    if (checks.length === 0)
        status = "not_applicable";
    else if (checks.some((c) => c.state === "not_met"))
        status = "not_met";
    else if (checks.some((c) => c.state === "needs_confirmation"))
        status = "needs_confirmation";
    else
        status = "clear";
    return { checks, status };
}
function evaluateOne(req, resume, pool) {
    const text = `${req.originalText} ${req.normalizedText}`;
    const base = { requirementId: req.id, label: labelFor(req), evidenceIds: [] };
    switch (req.category) {
        case "authorization":
            return {
                ...base,
                state: "needs_confirmation",
                detail: "Natively does not hold your work-authorization status. Confirm it to complete this check."
            };
        case "clearance":
            return {
                ...base,
                state: "needs_confirmation",
                detail: "No clearance is recorded in your profile. Confirm whether you hold one."
            };
        case "location": {
            const candidateLocation = resume?.identity?.location?.trim();
            if (REMOTE_RE.test(text) && !HYBRID_RE.test(text) && !ONSITE_RE.test(text)) {
                return { ...base, state: "met", detail: "The role is remote, so location is not a constraint." };
            }
            if (!candidateLocation) {
                return {
                    ...base,
                    state: "needs_confirmation",
                    detail: "No location is recorded on your r\xE9sum\xE9, so this cannot be checked."
                };
            }
            const evidence = factEvidence(pool, ["logistics"]).filter((e) => e.claim.includes(candidateLocation));
            const reqLoc = normalizeTerm(text);
            const tokens = normalizeTerm(candidateLocation).split(/[\s,]+/).filter((t) => t.length > 3);
            const overlap = tokens.some((t) => reqLoc.includes(t));
            if (overlap) {
                return {
                    ...base,
                    state: "likely_met",
                    detail: `Your r\xE9sum\xE9 lists ${candidateLocation}, which matches the stated location. Confirm you can work from there on the required schedule.`,
                    evidenceIds: evidence.map((e) => e.id)
                };
            }
            return {
                ...base,
                state: "needs_confirmation",
                detail: `The role specifies a location that does not obviously match your r\xE9sum\xE9 location (${candidateLocation}). Confirm whether you can meet it.`,
                evidenceIds: evidence.map((e) => e.id)
            };
        }
        case "education": {
            const required = degreeRank(text);
            if (!required) {
                return { ...base, state: "not_specified", detail: "No specific degree level is stated." };
            }
            const held = (resume?.education ?? []).map((e) => degreeRank(`${e.degree} ${e.field}`)).filter((d) => d !== null).sort((a, b) => b.rank - a.rank)[0];
            if (!held) {
                return {
                    ...base,
                    state: "needs_confirmation",
                    detail: `The role requires a ${required.label} degree; no degree is recorded in your profile.`
                };
            }
            const evidence = factEvidence(pool, ["education"]).slice(0, 2).map((e) => e.id);
            if (held.rank >= required.rank) {
                return {
                    ...base,
                    state: "met",
                    detail: `Your ${held.label} degree meets the stated ${required.label} requirement.`,
                    evidenceIds: evidence
                };
            }
            return {
                ...base,
                state: "needs_confirmation",
                detail: `The role states a ${required.label} degree; your profile records a ${held.label}. Many employers accept equivalent experience \u2014 confirm how you want this treated.`,
                evidenceIds: evidence
            };
        }
        case "certification": {
            const certs = resume?.certifications ?? [];
            if (certs.length === 0) {
                return {
                    ...base,
                    state: "needs_confirmation",
                    detail: "The role names a required certification; none is recorded in your profile."
                };
            }
            const reqText = normalizeTerm(text);
            const match = certs.find((c) => {
                const tokens = normalizeTerm(c.name).split(/\s+/).filter((t) => t.length > 3);
                return tokens.length > 0 && tokens.every((t) => reqText.includes(t));
            });
            const evidence = factEvidence(pool, ["certification"]).slice(0, 3).map((e) => e.id);
            if (match) {
                return {
                    ...base,
                    state: "met",
                    detail: `Your profile records "${match.name}", which matches the stated requirement.`,
                    evidenceIds: evidence
                };
            }
            return {
                ...base,
                state: "needs_confirmation",
                detail: "The named certification does not match any recorded in your profile. Confirm whether you hold it.",
                evidenceIds: evidence
            };
        }
        case "logistics":
        default:
            return {
                ...base,
                state: "needs_confirmation",
                detail: "This is a logistical condition Natively cannot verify from your profile. Confirm whether you can meet it."
            };
    }
}
var HARD_GATE_STATE_ORDER = {
    not_met: 0,
    needs_confirmation: 1,
    likely_met: 2,
    met: 3,
    not_specified: 4
};
export { HARD_GATE_STATE_ORDER, evaluateHardGates };
