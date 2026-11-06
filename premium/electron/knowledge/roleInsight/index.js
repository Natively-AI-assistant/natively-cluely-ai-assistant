// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.
import { AnalysisCancelledError } from "./RoleInsightEngine";
import { CATEGORY_GROUPS } from "./RequirementNormalizer";
import { CATEGORY_LABELS } from "./RequirementNormalizer";
import { CORRECTION_KINDS } from "./types";
import { EVIDENCE_CATEGORIES } from "./types";
import { EVIDENCE_CONFIDENCES } from "./types";
import { EVIDENCE_SOURCE_TYPES } from "./types";
import { GAP_SEVERITIES } from "./types";
import { HARD_GATE_CATEGORIES } from "./types";
import { HARD_GATE_STATES } from "./types";
import { HARD_GATE_STATE_ORDER } from "./HardGateEvaluator";
import { HARD_GATE_STATUSES } from "./types";
import { MATCH_STATUSES } from "./types";
import { MODEL_ORIGINABLE_STATUSES } from "./AssessmentValidator";
import { MissingSourceError } from "./RoleInsightEngine";
import { PRIORITY_WEIGHTS } from "./types";
import { PROGRESS_STAGE_LABELS } from "./RoleInsightEngine";
import { REQUIREMENT_CATEGORIES } from "./types";
import { REQUIREMENT_EXTRACTOR_VERSION } from "./types";
import { REQUIREMENT_MATCHER_VERSION } from "./types";
import { REQUIREMENT_PRIORITIES } from "./types";
import { ROLE_ALIGNMENTS } from "./types";
import { ROLE_INSIGHT_SCHEMA_VERSION } from "./RoleInsightDatabase";
import { RoleInsightDatabase } from "./RoleInsightDatabase";
import { RoleInsightEngine } from "./RoleInsightEngine";
import { RoleInsightService } from "./RoleInsightService";
import { STATUS_CONTRIBUTION } from "./types";
import { TRANSFER_EDGES } from "./skillOntology";
import { assessRequirements } from "./RequirementAssessor";
import { assignSeverity } from "./RequirementAssessor";
import { buildClarifications } from "./RoleInsightEngine";
import { buildEvidencePool } from "./EvidenceRetriever";
import { buildSummary } from "./CoverageCalculator";
import { calculateCoverage } from "./CoverageCalculator";
import { canonicalLabel } from "./skillOntology";
import { canonicalize } from "./skillOntology";
import { classifyAuthority } from "./JdSourceResolver";
import { deriveAlignment } from "./CoverageCalculator";
import { deriveEvidenceConfidence } from "./CoverageCalculator";
import { evaluateHardGates } from "./HardGateEvaluator";
import { evidenceTerms } from "./EvidenceRetriever";
import { extractCanonicalTerms } from "./skillOntology";
import { extractRequirements } from "./RequirementExtractor";
import { findTransferEdges } from "./skillOntology";
import { fingerprint } from "./RoleInsightDatabase";
import { fingerprintJd } from "./RoleInsightEngine";
import { fingerprintProfile } from "./RoleInsightEngine";
import { fingerprintResume } from "./RoleInsightEngine";
import { heuristicExtract } from "./RequirementExtractor";
import { inferCategory } from "./RequirementExtractor";
import { inferMandatory } from "./RequirementExtractor";
import { inferPreferred } from "./RequirementExtractor";
import { inferPriority } from "./RequirementExtractor";
import { isBoilerplate } from "./RequirementExtractor";
import { isDuplicate } from "./RequirementNormalizer";
import { isHttpUrl } from "./JdSourceResolver";
import { locateQuote } from "./RequirementExtractor";
import { normalizeRequirements } from "./RequirementNormalizer";
import { normalizeTerm } from "./skillOntology";
import { reconstructJdText } from "./RoleInsightEngine";
import { resolveFromUrl } from "./JdSourceResolver";
import { retrieveForRequirement } from "./EvidenceRetriever";
import { sectionAt } from "./RequirementExtractor";
import { termsEquivalent } from "./skillOntology";
import { validateAssessments } from "./AssessmentValidator";
import { verifyAgainstOfficialPosting } from "./JdSourceResolver";
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

export { AnalysisCancelledError, CATEGORY_GROUPS, CATEGORY_LABELS, CORRECTION_KINDS, EVIDENCE_CATEGORIES, EVIDENCE_CONFIDENCES, EVIDENCE_SOURCE_TYPES, GAP_SEVERITIES, HARD_GATE_CATEGORIES, HARD_GATE_STATES, HARD_GATE_STATE_ORDER, HARD_GATE_STATUSES, MATCH_STATUSES, MODEL_ORIGINABLE_STATUSES, MissingSourceError, PRIORITY_WEIGHTS, PROGRESS_STAGE_LABELS, REQUIREMENT_CATEGORIES, REQUIREMENT_EXTRACTOR_VERSION, REQUIREMENT_MATCHER_VERSION, REQUIREMENT_PRIORITIES, ROLE_ALIGNMENTS, ROLE_INSIGHT_SCHEMA_VERSION, RoleInsightDatabase, RoleInsightEngine, RoleInsightService, STATUS_CONTRIBUTION, TRANSFER_EDGES, assessRequirements, assignSeverity, buildClarifications, buildEvidencePool, buildSummary, calculateCoverage, canonicalLabel, canonicalize, classifyAuthority, deriveAlignment, deriveEvidenceConfidence, evaluateHardGates, evidenceTerms, extractCanonicalTerms, extractRequirements, findTransferEdges, fingerprint, fingerprintJd, fingerprintProfile, fingerprintResume, heuristicExtract, inferCategory, inferMandatory, inferPreferred, inferPriority, isBoilerplate, isDuplicate, isHttpUrl, locateQuote, normalizeRequirements, normalizeTerm, reconstructJdText, resolveFromUrl, retrieveForRequirement, sectionAt, termsEquivalent, validateAssessments, verifyAgainstOfficialPosting };
