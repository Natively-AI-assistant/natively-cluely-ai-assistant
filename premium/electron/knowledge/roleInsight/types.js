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
var REQUIREMENT_EXTRACTOR_VERSION = 1;
var REQUIREMENT_MATCHER_VERSION = 1;
var REQUIREMENT_CATEGORIES = [
    "core_responsibility",
    "technical_skill",
    "functional_skill",
    "experience",
    "domain",
    "leadership",
    "communication",
    "education",
    "certification",
    "location",
    "authorization",
    "clearance",
    "logistics",
    "preferred"
];
var REQUIREMENT_PRIORITIES = ["critical", "important", "supporting", "preferred"];
var HARD_GATE_CATEGORIES = /* @__PURE__ */ new Set([
    "location",
    "authorization",
    "clearance",
    "logistics"
]);
var EVIDENCE_CATEGORIES = [
    "experience",
    "project",
    "skill",
    "achievement",
    "education",
    "certification",
    "logistics"
];
var EVIDENCE_SOURCE_TYPES = [
    "submitted_resume",
    "other_resume",
    "profile_intelligence",
    "reference_file",
    "user_confirmation"
];
var MATCH_STATUSES = [
    "proven",
    "transferable",
    "needs_evidence",
    "confirmed_gap",
    "requirement_not_met",
    "preferred"
];
var GAP_SEVERITIES = ["critical", "important", "minor", "preferred"];
var HARD_GATE_STATES = ["met", "likely_met", "needs_confirmation", "not_met", "not_specified"];
var PRIORITY_WEIGHTS = {
    critical: 4,
    important: 2,
    supporting: 1,
    preferred: 0
};
var STATUS_CONTRIBUTION = {
    proven: 1,
    transferable: 0.5,
    confirmed_gap: 0,
    requirement_not_met: 0
};
var ROLE_ALIGNMENTS = ["strong", "good", "mixed", "limited", "insufficient_information"];
var EVIDENCE_CONFIDENCES = ["high", "moderate", "low", "insufficient"];
var HARD_GATE_STATUSES = ["clear", "needs_confirmation", "not_met", "not_applicable"];
var CORRECTION_KINDS = [
    "confirm_experience",
    "confirm_gap",
    "evidence_unrelated",
    "requirement_irrelevant",
    "requirement_restored",
    "reclassify_priority",
    "jd_misparsed",
    "private_note"
];
export { CORRECTION_KINDS, EVIDENCE_CATEGORIES, EVIDENCE_CONFIDENCES, EVIDENCE_SOURCE_TYPES, GAP_SEVERITIES, HARD_GATE_CATEGORIES, HARD_GATE_STATES, HARD_GATE_STATUSES, MATCH_STATUSES, PRIORITY_WEIGHTS, REQUIREMENT_CATEGORIES, REQUIREMENT_EXTRACTOR_VERSION, REQUIREMENT_MATCHER_VERSION, REQUIREMENT_PRIORITIES, ROLE_ALIGNMENTS, STATUS_CONTRIBUTION };
