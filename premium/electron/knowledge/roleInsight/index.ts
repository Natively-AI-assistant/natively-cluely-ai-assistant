// premium/electron/knowledge/roleInsight/index.ts
// Public surface of the Role Insight engine.

export * from './types';
export { RoleInsightDatabase, fingerprint, ROLE_INSIGHT_SCHEMA_VERSION } from './RoleInsightDatabase';
export {
    RoleInsightEngine, PROGRESS_STAGE_LABELS, AnalysisCancelledError, MissingSourceError,
    fingerprintResume, fingerprintJd, fingerprintProfile, buildClarifications, reconstructJdText,
} from './RoleInsightEngine';
export type { RoleInsightDeps, RunOptions, ProgressStage } from './RoleInsightEngine';
export { RoleInsightService } from './RoleInsightService';
export type { RoleInsightStatus } from './RoleInsightService';
export { extractRequirements, heuristicExtract, locateQuote, sectionAt, isBoilerplate, inferCategory, inferPriority, inferMandatory, inferPreferred } from './RequirementExtractor';
export { normalizeRequirements, isDuplicate, CATEGORY_LABELS, CATEGORY_GROUPS } from './RequirementNormalizer';
export { buildEvidencePool, retrieveForRequirement, evidenceTerms } from './EvidenceRetriever';
export type { EvidencePool, RetrievedEvidence } from './EvidenceRetriever';
export { assessRequirements, assignSeverity } from './RequirementAssessor';
export { evaluateHardGates, HARD_GATE_STATE_ORDER } from './HardGateEvaluator';
export { calculateCoverage, deriveAlignment, deriveEvidenceConfidence, buildSummary } from './CoverageCalculator';
export { validateAssessments, MODEL_ORIGINABLE_STATUSES } from './AssessmentValidator';
export { resolveFromUrl, verifyAgainstOfficialPosting, classifyAuthority, isHttpUrl } from './JdSourceResolver';
export {
    canonicalize, canonicalLabel, extractCanonicalTerms, findTransferEdges,
    normalizeTerm, termsEquivalent, TRANSFER_EDGES,
} from './skillOntology';
export type { TransferEdge } from './skillOntology';
