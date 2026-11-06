// premium/electron/knowledge/roleInsight/types.ts
//
// Role Insight — type surface.
//
// Deliberately adapted to what the Profile Intelligence DB can actually key on
// rather than copied from the product spec. Notably: there is exactly ONE
// active résumé and ONE active JD (KnowledgeDatabaseManager.getDocumentByType
// is `ORDER BY created_at DESC LIMIT 1`, and every ingest calls
// deleteDocumentsByType first), so a `profileId` / `resumeId` / `jobDescriptionId`
// triple of stable row ids does not exist. Analyses are keyed on CONTENT
// FINGERPRINTS instead, which additionally gives outdated-detection for free:
// refingerprint the live sources on open and compare.

// ─── Versioning ───────────────────────────────────────────────────────────────
// Bump when the extraction prompt/schema changes in a way that invalidates
// cached requirements, or when matching semantics change. Persisted per
// analysis so an old report is never silently reinterpreted under new rules.
export const REQUIREMENT_EXTRACTOR_VERSION = 1 as const;
export const REQUIREMENT_MATCHER_VERSION = 1 as const;

// ─── Requirements ─────────────────────────────────────────────────────────────

export const REQUIREMENT_CATEGORIES = [
    'core_responsibility',
    'technical_skill',
    'functional_skill',
    'experience',
    'domain',
    'leadership',
    'communication',
    'education',
    'certification',
    'location',
    'authorization',
    'clearance',
    'logistics',
    'preferred',
] as const;
export type RequirementCategory = typeof REQUIREMENT_CATEGORIES[number];

export const REQUIREMENT_PRIORITIES = ['critical', 'important', 'supporting', 'preferred'] as const;
export type RequirementPriority = typeof REQUIREMENT_PRIORITIES[number];

/** Categories that describe a logistical/eligibility condition rather than a capability. */
export const HARD_GATE_CATEGORIES: ReadonlySet<RequirementCategory> = new Set<RequirementCategory>([
    'location', 'authorization', 'clearance', 'logistics',
]);

export interface RoleRequirement {
    id: string;
    analysisId: string;
    /** Verbatim JD wording. Never paraphrased — this is what the UI quotes. */
    originalText: string;
    /** Natively's plain-language interpretation of the requirement. */
    normalizedText: string;
    /** Canonical matching tokens (alias/acronym-expanded). */
    canonicalTerms: string[];
    /** JD heading the requirement was found under, when detectable. */
    sourceSection?: string;
    /**
     * Character span of `originalText` inside the JD's raw_text. Null when the
     * quote could not be relocated (LLM paraphrased despite instructions, or
     * raw_text is absent on a legacy row) — the UI then shows the quote without
     * the "locate in JD" affordance rather than pointing at the wrong offset.
     */
    sourceCharStart: number | null;
    sourceCharEnd: number | null;
    category: RequirementCategory;
    priority: RequirementPriority;
    /** True for eligibility conditions that must not be averaged into coverage. */
    hardGate: boolean;
    /** True when the JD states it outright (vs. inferred from responsibilities). */
    explicit: boolean;
    /** True when stated as a minimum/must-have rather than a nice-to-have. */
    mandatory: boolean;
    extractionConfidence: number;
    /** Additional JD passages consolidated into this requirement. */
    supportingPassages: string[];
    /** Set when the user excluded this requirement as not actually part of the role. */
    excluded: boolean;
    /** JD order, for the "JD order" sort. */
    ordinal: number;
}

// ─── Candidate evidence ───────────────────────────────────────────────────────

export const EVIDENCE_CATEGORIES = [
    'experience', 'project', 'skill', 'achievement', 'education', 'certification', 'logistics',
] as const;
export type EvidenceCategory = typeof EVIDENCE_CATEGORIES[number];

export const EVIDENCE_SOURCE_TYPES = [
    'submitted_resume', 'other_resume', 'profile_intelligence', 'reference_file', 'user_confirmation',
] as const;
export type EvidenceSourceType = typeof EVIDENCE_SOURCE_TYPES[number];

export interface CandidateEvidence {
    id: string;
    analysisId: string;
    /** The candidate-side statement, quoted from the source. Never synthesized. */
    claim: string;
    category: EvidenceCategory;
    sourceType: EvidenceSourceType;
    /** context_nodes.id when the evidence came from the embedded corpus. */
    nodeId: number | null;
    /** Human-readable provenance, e.g. "Aetherlab · Submitted résumé · Bullet 2". */
    sourceLocation: string;
    /** True only for evidence the user explicitly confirmed. */
    userConfirmed: boolean;
    confidence: number;
}

// ─── Assessments ──────────────────────────────────────────────────────────────

export const MATCH_STATUSES = [
    'proven', 'transferable', 'needs_evidence', 'confirmed_gap', 'requirement_not_met', 'preferred',
] as const;
export type MatchStatus = typeof MATCH_STATUSES[number];

export const GAP_SEVERITIES = ['critical', 'important', 'minor', 'preferred'] as const;
export type GapSeverity = typeof GAP_SEVERITIES[number];

export interface RequirementAssessment {
    requirementId: string;
    analysisId: string;
    status: MatchStatus;
    /** CandidateEvidence.id values actually cited. A conclusion citing none is
     *  downgraded to needs_evidence by AssessmentValidator — never accepted. */
    evidenceIds: string[];
    explanation: string;
    /** Only for `transferable`: what capability is shared, concretely. */
    transferExplanation?: string;
    /** What the evidence does NOT establish. Required for `transferable`. */
    limitations: string[];
    /** What the user could supply that would change the conclusion. */
    missingInformation: string[];
    severity?: GapSeverity;
    /** Why this severity — shown verbatim in the UI, never a generic phrase. */
    severityRationale?: string;
    confidence: number;
    userCorrected: boolean;
    /** Preserved when a correction overrides the model. Auditability requirement. */
    originalStatus?: MatchStatus;
    /** For preferred requirements: the underlying assessment, shown subordinately. */
    preferredSubStatus?: 'proven' | 'transferable' | 'unknown' | 'absent';
}

// ─── Hard gates ───────────────────────────────────────────────────────────────

export const HARD_GATE_STATES = ['met', 'likely_met', 'needs_confirmation', 'not_met', 'not_specified'] as const;
export type HardGateState = typeof HARD_GATE_STATES[number];

export interface HardGateCheck {
    requirementId: string;
    label: string;
    state: HardGateState;
    detail: string;
    evidenceIds: string[];
}

// ─── Coverage ─────────────────────────────────────────────────────────────────

/** Weight per priority. Preferred is excluded from core coverage entirely. */
export const PRIORITY_WEIGHTS: Record<RequirementPriority, number> = {
    critical: 4, important: 2, supporting: 1, preferred: 0,
};

/** Fractional contribution per status, for requirements that count. */
export const STATUS_CONTRIBUTION: Partial<Record<MatchStatus, number>> = {
    proven: 1, transferable: 0.5, confirmed_gap: 0, requirement_not_met: 0,
};

export interface StatusBucket {
    status: MatchStatus;
    count: number;
    weight: number;
}

export interface CategoryCoverage {
    category: RequirementCategory;
    label: string;
    total: number;
    proven: number;
    transferable: number;
    needsEvidence: number;
    confirmedGap: number;
    requirementNotMet: number;
    /**
     * Preferred qualifications in this category. Counted so the category bar can
     * be drawn against `total`: without it, a category of 3 transferable + 2
     * preferred rendered as a FULL bar labelled "3/5", which reads as complete
     * coverage of something only 60% covered.
     */
    preferred: number;
    /** Weighted 0–1 over the resolved (non-needs_evidence) portion, or null when nothing resolved. */
    coverage: number | null;
}

export interface CoverageBreakdown {
    /** 0–1, weighted, over resolved requirements only. Null when nothing resolved. */
    weightedCoverage: number | null;
    /** Sum of weights that actually entered the denominator. */
    countedWeight: number;
    /** Weight parked in needs_evidence — excluded from the judgement, reported separately. */
    unresolvedWeight: number;
    unresolvedCount: number;
    /** Share of counted+unresolved weight that is unresolved. Drives confidence. */
    unresolvedShare: number;
    buckets: StatusBucket[];
    categories: CategoryCoverage[];
    severityCounts: Record<GapSeverity, number>;
    criticalTotal: number;
    criticalProven: number;
    criticalUnresolved: number;
    criticalBlocked: number;
    preferredTotal: number;
    /** Machine-readable trace of how the number was produced, rendered in the tooltip. */
    explanation: string[];
}

// ─── Analysis ─────────────────────────────────────────────────────────────────

export const ROLE_ALIGNMENTS = ['strong', 'good', 'mixed', 'limited', 'insufficient_information'] as const;
export type RoleAlignment = typeof ROLE_ALIGNMENTS[number];

export const EVIDENCE_CONFIDENCES = ['high', 'moderate', 'low', 'insufficient'] as const;
export type EvidenceConfidence = typeof EVIDENCE_CONFIDENCES[number];

export const HARD_GATE_STATUSES = ['clear', 'needs_confirmation', 'not_met', 'not_applicable'] as const;
export type HardGateStatus = typeof HARD_GATE_STATUSES[number];

export type AnalysisStatus = 'complete' | 'partial' | 'failed';

export interface ExternalSourceRef {
    url: string;
    title: string;
    retrievedAt: string;
    authority: 'official_careers' | 'official_site' | 'job_board' | 'documentation' | 'secondary';
    snippet: string;
    /** What this reference was used to establish. */
    purpose: string;
}

export interface SourceMeta {
    resumeName: string;
    resumeUpdatedAt: string | null;
    resumeOrigin: string;
    /** True when this is the résumé submitted with the application (the only one PI stores). */
    resumeIsSubmitted: boolean;
    jdTitle: string;
    jdCompany: string;
    jdUpdatedAt: string | null;
    jdOrigin: string;
    /** How the JD text arrived. */
    jdSourceKind: 'uploaded_file' | 'pasted_text' | 'job_url' | 'unknown';
    /** True when the JD content was confirmed against an official posting. */
    jdOfficialVerified: boolean;
    profileNodeCount: number;
    externalSources: ExternalSourceRef[];
    /** Verifications that were attempted and could not be completed. */
    unavailableVerifications: string[];
}

export interface StageTraceEntry {
    stage: string;
    status: 'ok' | 'skipped' | 'failed';
    durationMs: number;
    detail?: string;
    model?: string;
    /** Correlates with console logs for support. */
    traceId: string;
}

export interface RoleInsightAnalysis {
    id: string;
    resumeFingerprint: string;
    jdFingerprint: string;
    profileFingerprint: string;
    extractorVersion: number;
    matcherVersion: number;
    roleAlignment: RoleAlignment;
    evidenceConfidence: EvidenceConfidence;
    hardGateStatus: HardGateStatus;
    /** Descriptive, evidence-anchored. Never a score sentence. */
    summary: string;
    /** Why evidence confidence landed where it did. */
    confidenceReasons: string[];
    coverage: CoverageBreakdown;
    hardGates: HardGateCheck[];
    sourceMeta: SourceMeta;
    stageTrace: StageTraceEntry[];
    status: AnalysisStatus;
    /** Named stages that failed, for the partial-result state. */
    failedStages: string[];
    createdAt: string;
}

/** Everything the renderer needs for one analysis. */
export interface RoleInsightReport {
    analysis: RoleInsightAnalysis;
    requirements: RoleRequirement[];
    assessments: RequirementAssessment[];
    evidence: CandidateEvidence[];
    clarifications: ClarificationPrompt[];
    /** True when the live sources no longer fingerprint-match this analysis. */
    outdated: boolean;
    /** Which source drifted, for the outdated banner. */
    outdatedReasons: string[];
}

// ─── Clarification ────────────────────────────────────────────────────────────

export interface ClarificationPrompt {
    requirementId: string;
    question: string;
    /** What is already known, so the question does not re-ask it. */
    knownContext: string;
    /** What is missing and why it matters. */
    missingContext: string;
    /** "Answering this could change one Important requirement from …" */
    impactStatement: string;
    priority: RequirementPriority;
    /**
     * True for eligibility conditions (authorization, clearance, location,
     * logistics, mandatory degree/certification). These are asked and answered
     * DIFFERENTLY from capability questions: "do you meet this?" not "have you
     * done this?", and there is no experience narrative to describe — so the UI
     * must not offer "describe it" or "not sure it qualifies" for them.
     */
    isCondition: boolean;
}

export type ClarificationAnswer =
    | 'yes' | 'no' | 'partially' | 'unsure' | 'decline';

// ─── Corrections ──────────────────────────────────────────────────────────────

export const CORRECTION_KINDS = [
    'confirm_experience',
    'confirm_gap',
    'evidence_unrelated',
    'requirement_irrelevant',
    'requirement_restored',
    'reclassify_priority',
    'jd_misparsed',
    'private_note',
] as const;
export type CorrectionKind = typeof CORRECTION_KINDS[number];

export interface RoleInsightCorrection {
    id: string;
    analysisId: string;
    requirementId: string | null;
    kind: CorrectionKind;
    /** Free-text detail the user supplied (narrative evidence, note, reason). */
    detail: string;
    /** The model's conclusion at the time of correction — never overwritten. */
    previousStatus: MatchStatus | null;
    /** Only true once the user has EXPLICITLY opted to persist to Profile Intelligence. */
    savedToProfile: boolean;
    createdAt: string;
}

// ─── Source resolution ────────────────────────────────────────────────────────

export interface ResolvedJdText {
    text: string;
    origin: string;
    sourceKind: SourceMeta['jdSourceKind'];
    externalSources: ExternalSourceRef[];
    unavailableVerifications: string[];
    officialVerified: boolean;
}
