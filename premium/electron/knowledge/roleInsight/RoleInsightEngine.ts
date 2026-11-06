// premium/electron/knowledge/roleInsight/RoleInsightEngine.ts
//
// Stage orchestration. Deliberately NOT one large prompt: each stage has a
// structured input, a structured output, its own failure handling, and a trace
// entry carrying duration, outcome and (where applicable) the extraction mode.
//
// Failure policy: a stage that fails is recorded and the pipeline continues
// wherever the remaining stages can still produce something honest. The analysis
// is then marked `partial` and names the failed stages, so the UI shows what
// exists and says what is missing — rather than an empty dashboard shell or, far
// worse, a complete-looking report built on a stage that silently no-opped.

import { randomUUID } from 'node:crypto';
import {
    DocType, KnowledgeDocument, ContextNode, StructuredResume, StructuredJD,
} from '../types';
import { SearchProvider } from '../CompanyResearchEngine';
import { RoleInsightDatabase, fingerprint } from './RoleInsightDatabase';
import {
    RoleInsightAnalysis, RoleInsightReport, RoleRequirement, RequirementAssessment,
    CandidateEvidence, StageTraceEntry, SourceMeta, ClarificationPrompt,
    REQUIREMENT_EXTRACTOR_VERSION, REQUIREMENT_MATCHER_VERSION, RequirementPriority,
} from './types';
import { extractRequirements } from './RequirementExtractor';
import { normalizeRequirements } from './RequirementNormalizer';
import { buildEvidencePool, retrieveForRequirement, RetrievedEvidence, EvidencePool, evidenceTerms } from './EvidenceRetriever';
import { assessRequirements, assignSeverity } from './RequirementAssessor';
import { evaluateHardGates } from './HardGateEvaluator';
import { calculateCoverage, deriveAlignment, deriveEvidenceConfidence, buildSummary } from './CoverageCalculator';
import { validateAssessments } from './AssessmentValidator';
import { verifyAgainstOfficialPosting, resolveFromUrl } from './JdSourceResolver';

export type ProgressStage =
    | 'reading_job_description'
    | 'structuring_requirements'
    | 'finding_profile_evidence'
    | 'evaluating_transferable_experience'
    | 'validating_conclusions'
    | 'preparing_role_insight';

export const PROGRESS_STAGE_LABELS: Record<ProgressStage, string> = {
    reading_job_description: 'Reading job description',
    structuring_requirements: 'Structuring requirements',
    finding_profile_evidence: 'Finding profile evidence',
    evaluating_transferable_experience: 'Evaluating transferable experience',
    validating_conclusions: 'Validating conclusions',
    preparing_role_insight: 'Preparing Role Insight',
};

export interface RoleInsightDeps {
    db: RoleInsightDatabase;
    getResumeDoc: () => KnowledgeDocument | null;
    getJdDoc: () => KnowledgeDocument | null;
    getNodes: () => ContextNode[];
    generateContentFn: (contents: any[]) => Promise<string>;
    embedFn: ((text: string) => Promise<number[]>) | null;
    /**
     * Committed embedding-space key of the node corpus, resolved per call
     * (the space can change mid-session, exactly like embedFn's resolution).
     * Consumed by the semantic-admission gate; optional — absent means the
     * gate falls back to legacy admission.
     */
    getEmbeddingSpaceKey?: () => string | null;
    getSearchProvider: () => SearchProvider | null;
    /** Emitted per stage so the analysing state shows real progress, not a fake %. */
    onProgress?: (stage: ProgressStage) => void;
    /** Cooperative cancellation for navigate-away / supersede. */
    isCancelled?: () => boolean;
}

export interface RunOptions {
    /** Analyse this URL instead of the stored JD. */
    jobUrl?: string;
    /** Skip the Tavily verification pass entirely. */
    skipExternalVerification?: boolean;
}

export class AnalysisCancelledError extends Error {
    constructor() {
        super('Role Insight analysis was cancelled');
        this.name = 'AnalysisCancelledError';
    }
}

/** Thrown when the pipeline cannot start at all — surfaced as the missing-source state. */
export class MissingSourceError extends Error {
    constructor(public readonly missing: Array<'resume' | 'job_description'>) {
        super(`Missing required source: ${missing.join(', ')}`);
        this.name = 'MissingSourceError';
    }
}

// ── Fingerprints ──────────────────────────────────────────────────────────────

export function fingerprintResume(doc: KnowledgeDocument | null): string {
    if (!doc) return 'none';
    return fingerprint(doc.raw_text ?? '', JSON.stringify(doc.structured_data ?? {}));
}

export function fingerprintJd(doc: KnowledgeDocument | null, overrideText?: string): string {
    if (overrideText) return fingerprint(overrideText);
    if (!doc) return 'none';
    return fingerprint(doc.raw_text ?? '', JSON.stringify(doc.structured_data ?? {}));
}

/**
 * Profile fingerprint. Node ids are monotonic and re-ingestion replaces the set,
 * so count + max id + embedding space detects any change to the indexed corpus
 * without hashing every embedding.
 */
export function fingerprintProfile(nodes: ContextNode[]): string {
    let maxId = 0;
    let space = '';
    for (const n of nodes) {
        if (n.id != null && n.id > maxId) maxId = n.id;
        if (!space && n.embedding_space) space = n.embedding_space;
    }
    return fingerprint(nodes.length, maxId, space);
}

// ── Engine ────────────────────────────────────────────────────────────────────

export class RoleInsightEngine {
    constructor(private deps: RoleInsightDeps) {}

    private checkCancelled(): void {
        if (this.deps.isCancelled?.()) throw new AnalysisCancelledError();
    }

    private async stage<T>(
        trace: StageTraceEntry[],
        failed: string[],
        name: string,
        fn: () => Promise<T> | T,
        fallback: T,
        detail?: () => string,
    ): Promise<T> {
        this.checkCancelled();
        const traceId = randomUUID().slice(0, 8);
        const started = Date.now();
        try {
            const result = await fn();
            trace.push({
                stage: name, status: 'ok', durationMs: Date.now() - started,
                detail: detail?.(), traceId,
            });
            return result;
        } catch (e: any) {
            if (e instanceof AnalysisCancelledError) throw e;
            console.error(`[RoleInsight] Stage "${name}" failed (trace ${traceId}):`, e?.message);
            trace.push({
                stage: name, status: 'failed', durationMs: Date.now() - started,
                detail: e?.message ? String(e.message).slice(0, 300) : 'unknown error', traceId,
            });
            failed.push(name);
            return fallback;
        }
    }

    async run(options: RunOptions = {}): Promise<RoleInsightReport> {
        const trace: StageTraceEntry[] = [];
        const failedStages: string[] = [];
        const analysisId = `ri_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

        // ── Stage 1: resolve sources ─────────────────────────────────────────
        const resumeDoc = this.deps.getResumeDoc();
        const jdDoc = this.deps.getJdDoc();
        const missing: Array<'resume' | 'job_description'> = [];
        if (!resumeDoc) missing.push('resume');
        if (!jdDoc && !options.jobUrl) missing.push('job_description');
        if (missing.length > 0) throw new MissingSourceError(missing);

        const resume = (resumeDoc?.structured_data ?? null) as StructuredResume | null;
        const jd = (jdDoc?.structured_data ?? null) as StructuredJD | null;
        const nodes = this.deps.getNodes();
        const provider = safeCall(() => this.deps.getSearchProvider(), null);

        this.deps.onProgress?.('reading_job_description');

        // ── Stage 2: resolve JD text ─────────────────────────────────────────
        let jdText = (jdDoc?.raw_text ?? '').trim();
        let jdOrigin = jdDoc?.source_uri ?? '';
        let jdSourceKind: SourceMeta['jdSourceKind'] = jdDoc ? 'uploaded_file' : 'unknown';
        let externalSources: SourceMeta['externalSources'] = [];
        let unavailableVerifications: string[] = [];
        let officialVerified = false;

        if (options.jobUrl) {
            const resolved = await this.stage(trace, failedStages, 'resolve_jd_from_url',
                () => resolveFromUrl(options.jobUrl!, provider as any, jd?.company ?? ''),
                null);
            if (resolved) {
                jdText = resolved.text;
                jdOrigin = resolved.origin;
                jdSourceKind = resolved.sourceKind;
                externalSources = resolved.externalSources;
                officialVerified = resolved.officialVerified;
            } else {
                unavailableVerifications.push(
                    'The job URL could not be read. The analysis used the job description already stored in Profile Intelligence.',
                );
            }
        }

        if (!jdText && jd) {
            // Legacy row with no raw_text: reconstruct from the structured JD so
            // the analysis still runs, and record the degraded fidelity.
            jdText = reconstructJdText(jd);
            unavailableVerifications.push(
                'The original job-description text was not stored, so requirements were read from the extracted summary. Re-upload the job description for exact wording.',
            );
        }
        if (!jdText) throw new MissingSourceError(['job_description']);

        // ── Stage 3: external verification (never blocking) ──────────────────
        if (!options.skipExternalVerification) {
            const verification = await this.stage(trace, failedStages, 'verify_official_posting',
                () => verifyAgainstOfficialPosting({
                    jdText,
                    title: jd?.title ?? '',
                    company: jd?.company ?? '',
                    location: jd?.location && jd.location !== 'Unknown Location' ? jd.location : '',
                    provider: provider as any,
                    allowRecovery: jdSourceKind !== 'job_url',
                }),
                { externalSources: [], unavailableVerifications: [], officialVerified: false, recoveredText: null });

            externalSources = [...externalSources, ...verification.externalSources];
            unavailableVerifications = [...unavailableVerifications, ...verification.unavailableVerifications];
            officialVerified = officialVerified || verification.officialVerified;
            if (verification.recoveredText) jdText = verification.recoveredText;
        } else {
            trace.push({ stage: 'verify_official_posting', status: 'skipped', durationMs: 0, traceId: randomUUID().slice(0, 8) });
        }

        this.deps.onProgress?.('structuring_requirements');

        // ── Stage 4: extract requirements ────────────────────────────────────
        const extraction = await this.stage(trace, failedStages, 'extract_requirements',
            () => extractRequirements(jdText, this.deps.generateContentFn),
            { requirements: [], mode: 'heuristic' as const, truncated: false, unanchoredCount: 0 },
            );
        trace[trace.length - 1].detail =
            `${extraction.requirements.length} raw · mode=${extraction.mode}` +
            `${extraction.truncated ? ' · truncated' : ''}` +
            `${extraction.unanchoredCount > 0 ? ` · ${extraction.unanchoredCount} unanchored` : ''}`;

        // ── Stage 5: normalize ───────────────────────────────────────────────
        const normalized = await this.stage(trace, failedStages, 'normalize_requirements',
            () => normalizeRequirements(extraction.requirements),
            { requirements: extraction.requirements, consolidatedCount: 0 });
        trace[trace.length - 1].detail = `${normalized.requirements.length} final · ${normalized.consolidatedCount} consolidated`;

        const requirements: RoleRequirement[] = normalized.requirements.map((r, i) => ({
            ...r,
            id: `rq_${analysisId.slice(3, 11)}_${i.toString(36)}`,
            analysisId,
        }));

        this.deps.onProgress?.('finding_profile_evidence');

        // ── Stage 6: evidence pool ───────────────────────────────────────────
        const pool = await this.stage(trace, failedStages, 'build_evidence_pool',
            () => buildEvidencePool(analysisId, resume, nodes),
            buildEvidencePool(analysisId, null, []));
        trace[trace.length - 1].detail = `${pool.items.length} evidence items · ${pool.allTerms.size} distinct capabilities`;

        // ── Stage 7: per-requirement retrieval ───────────────────────────────
        const retrieved = new Map<string, RetrievedEvidence>();
        await this.stage(trace, failedStages, 'retrieve_evidence', async () => {
            // Bounded concurrency: each call may embed a query.
            const queue = requirements.filter(r => !r.hardGate);
            const CONCURRENCY = 4;
            let cursor = 0;
            await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
                for (;;) {
                    const i = cursor++;
                    if (i >= queue.length) return;
                    this.checkCancelled();
                    const req = queue[i];
                    retrieved.set(req.id, await retrieveForRequirement(
                        req, pool, nodes, this.deps.embedFn,
                        this.deps.getEmbeddingSpaceKey?.() ?? null,
                    ));
                }
            }));
            return true;
        }, false);
        trace[trace.length - 1].detail = `${retrieved.size} requirements searched`;

        this.deps.onProgress?.('evaluating_transferable_experience');

        // ── Stage 8: assess ──────────────────────────────────────────────────
        const outcome = await this.stage(trace, failedStages, 'assess_requirements',
            () => assessRequirements({
                requirements, retrieved, pool, generateContentFn: this.deps.generateContentFn,
            }),
            { assessments: [], deterministicCount: 0, failedBatches: 0 });
        trace[trace.length - 1].detail =
            `${outcome.assessments.length} assessed · ${outcome.deterministicCount} without a model call` +
            `${outcome.failedBatches > 0 ? ` · ${outcome.failedBatches} batch(es) failed` : ''}`;
        if (outcome.failedBatches > 0 && !failedStages.includes('assess_requirements')) {
            failedStages.push('assess_requirements');
        }

        // ── Stage 9: hard gates ──────────────────────────────────────────────
        const gates = await this.stage(trace, failedStages, 'evaluate_hard_gates',
            () => evaluateHardGates(requirements, resume, pool),
            { checks: [], status: 'not_applicable' as const });
        trace[trace.length - 1].detail = `${gates.checks.length} condition(s) · ${gates.status}`;

        // Hard-gate requirements are decided by the evaluator above, not by
        // capability matching — but they still need a row in the requirement
        // workspace so the user can open and confirm them. Synthesize their
        // assessments from the gate verdict so the strip and the workspace can
        // never disagree. Coverage already excludes hardGate requirements, so
        // this cannot leak an eligibility condition into the score.
        const gateAssessments: RequirementAssessment[] = gates.checks.map(check => {
            const status =
                check.state === 'not_met' ? 'requirement_not_met' as const
                    : (check.state === 'met' || check.state === 'likely_met') ? 'proven' as const
                        : 'needs_evidence' as const;
            return {
                requirementId: check.requirementId,
                analysisId,
                status,
                evidenceIds: check.evidenceIds,
                explanation: check.detail,
                limitations: check.state === 'likely_met'
                    ? ['Natively inferred this from your résumé; it has not been confirmed by you.']
                    : [],
                missingInformation: status === 'needs_evidence'
                    ? ['Confirm this condition so it can be resolved — Natively cannot verify it from your profile.']
                    : [],
                confidence: check.state === 'met' ? 0.9 : check.state === 'likely_met' ? 0.6 : 0.5,
                userCorrected: false,
            };
        });
        // REPLACE, never append. evaluateHardGates also covers mandatory degree
        // and certification requirements, whose category is NOT a gate category —
        // so those already have a capability assessment from the stage above.
        // Appending would give one requirement two assessments that disagree,
        // and since saveAssessments is keyed on requirement_id the DB would keep
        // one while the in-memory report showed the other. The deterministic gate
        // verdict wins: for "Bachelor's degree required" it reads the actual
        // education entries, which is strictly better than capability matching.
        const gateById = new Map(gateAssessments.map(a => [a.requirementId, a]));
        outcome.assessments = [
            ...outcome.assessments.filter(a => !gateById.has(a.requirementId)),
            ...gateAssessments,
        ];

        this.deps.onProgress?.('validating_conclusions');

        // ── Stage 10: validate ───────────────────────────────────────────────
        const validated = await this.stage(trace, failedStages, 'validate_conclusions',
            () => validateAssessments(requirements, outcome.assessments, pool, new Set(gateById.keys())),
            { assessments: outcome.assessments, violations: [] });
        trace[trace.length - 1].detail = validated.violations.length > 0
            ? `${validated.violations.length} conclusion(s) downgraded`
            : 'all conclusions cite stored evidence';
        if (validated.violations.length > 0) {
            console.warn('[RoleInsight] Validator corrections:', validated.violations.slice(0, 10));
        }

        // ── Stage 11: severity ───────────────────────────────────────────────
        const reqById = new Map(requirements.map(r => [r.id, r]));
        const assessments: RequirementAssessment[] = validated.assessments.map(a => {
            const req = reqById.get(a.requirementId);
            if (!req) return a;
            const isGap = a.status === 'needs_evidence' || a.status === 'confirmed_gap' || a.status === 'requirement_not_met';
            if (!isGap) return a;
            const ret = retrieved.get(req.id);
            const hasAdjacent = !!ret && evidenceTerms(pool, ret.orderedIds).size > 0;
            const { severity, rationale } = assignSeverity(req, a, hasAdjacent);
            return { ...a, severity, severityRationale: rationale };
        });

        this.deps.onProgress?.('preparing_role_insight');

        // ── Stage 12: summary metrics ────────────────────────────────────────
        const resumeHeuristic = (resumeDoc?.structured_data as any)?._extraction_mode === 'heuristic';
        const coverageInput = {
            requirements, assessments,
            extractionMode: extraction.mode,
            jdTruncated: extraction.truncated,
            resumeHeuristic,
            profileNodeCount: nodes.filter(n => n.source_type === DocType.RESUME).length,
            failedStages,
        };
        const coverage = calculateCoverage(coverageInput);
        const roleAlignment = deriveAlignment(coverage);
        const { confidence: evidenceConfidence, reasons: confidenceReasons } =
            deriveEvidenceConfidence(coverage, coverageInput);

        const sourceMeta: SourceMeta = {
            resumeName: resume?.identity?.name ? `${resume.identity.name}'s résumé` : 'Submitted résumé',
            resumeUpdatedAt: resumeDoc?.created_at ?? null,
            resumeOrigin: resumeDoc?.source_uri ?? '',
            resumeIsSubmitted: true,
            jdTitle: jd?.title ?? '',
            jdCompany: jd?.company ?? '',
            jdUpdatedAt: jdDoc?.created_at ?? null,
            jdOrigin: jdOrigin,
            jdSourceKind,
            jdOfficialVerified: officialVerified,
            profileNodeCount: coverageInput.profileNodeCount,
            externalSources,
            unavailableVerifications,
        };

        const analysis: RoleInsightAnalysis = {
            id: analysisId,
            resumeFingerprint: fingerprintResume(resumeDoc),
            // F6 (code review 2026-08-05): the override-text fingerprint is only
            // valid when the URL actually resolved. On a failed resolution
            // jdText falls back to the stored JD, and hashing that text alone
            // can never equal fingerprintJd(jdDoc)'s two-part hash — the report
            // was born "outdated", showed a spurious banner, and auto-refresh
            // immediately spent tokens replacing a seconds-old analysis.
            jdFingerprint: fingerprintJd(jdDoc, jdSourceKind === 'job_url' ? jdText : undefined),
            profileFingerprint: fingerprintProfile(nodes),
            extractorVersion: REQUIREMENT_EXTRACTOR_VERSION,
            matcherVersion: REQUIREMENT_MATCHER_VERSION,
            roleAlignment,
            evidenceConfidence,
            hardGateStatus: gates.status,
            summary: buildSummary(roleAlignment, coverage, gates.status, jd?.title ?? ''),
            confidenceReasons,
            coverage,
            hardGates: gates.checks,
            sourceMeta,
            stageTrace: trace,
            status: failedStages.length === 0 ? 'complete' : (requirements.length > 0 ? 'partial' : 'failed'),
            failedStages,
            createdAt: new Date().toISOString(),
        };

        // ── Stage 13: persist ────────────────────────────────────────────────
        // Only evidence actually cited is persisted. The retrieval pool can run
        // to thousands of items across a large profile; storing all of it per
        // analysis would bloat the DB with rows nothing ever reads.
        const citedIds = new Set(assessments.flatMap(a => a.evidenceIds));
        for (const g of gates.checks) g.evidenceIds.forEach(id => citedIds.add(id));
        const citedEvidence: CandidateEvidence[] = pool.items.filter(i => citedIds.has(i.id));

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
            outdatedReasons: [],
        };
    }
}

// ── Clarification prompts ─────────────────────────────────────────────────────

const PRIORITY_LABEL: Record<RequirementPriority, string> = {
    critical: 'Critical', important: 'Important', supporting: 'Supporting', preferred: 'Preferred',
};

/**
 * Only ask where the answer would materially change the analysis. A question
 * about a supporting requirement that is already transferable changes nothing,
 * so it is not asked.
 */
export function buildClarifications(
    requirements: RoleRequirement[],
    assessments: RequirementAssessment[],
): ClarificationPrompt[] {
    const byId = new Map(assessments.map(a => [a.requirementId, a]));
    const out: ClarificationPrompt[] = [];

    for (const req of requirements) {
        if (req.excluded) continue;
        const a = byId.get(req.id);
        if (!a || a.status !== 'needs_evidence') continue;
        if (req.priority === 'supporting' || req.priority === 'preferred') continue;
        if (a.userCorrected) continue;

        const known = a.evidenceIds.length > 0 || (a.missingInformation.length > 1 && a.limitations.length > 0)
            ? a.explanation
            : 'Nothing in your profile addresses this yet.';

        // An eligibility condition is not an experience question. Asking "Must be
        // authorized to work in the United States — have you done this?" is
        // nonsense, and the honest impact of answering it is that a mandatory
        // condition resolves, not that a capability becomes proven.
        const isCondition = req.hardGate
            || ((req.category === 'education' || req.category === 'certification') && req.mandatory);

        const subject = req.normalizedText.replace(/\.$/, '');
        out.push({
            requirementId: req.id,
            question: isCondition
                ? `${subject} — can you confirm this?`
                : `${subject} — have you done this?`,
            knownContext: known,
            missingContext: a.missingInformation[0] ?? 'No supporting evidence was found.',
            impactStatement: isCondition
                ? 'Confirming this resolves one mandatory condition. Mandatory conditions are tracked separately and never affect requirement coverage.'
                : `Answering this could change one ${PRIORITY_LABEL[req.priority]} requirement from Needs Evidence to Proven or Transferable.`,
            priority: req.priority,
            isCondition,
        });
    }

    // Critical first, and bounded — a wall of questions is a form to fill in,
    // which the product explicitly avoids.
    out.sort((a, b) => (a.priority === 'critical' ? 0 : 1) - (b.priority === 'critical' ? 0 : 1));
    return out.slice(0, 8);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeCall<T>(fn: () => T, fallback: T): T {
    try { return fn(); } catch { return fallback; }
}

/**
 * Rebuild readable JD text from the structured extraction, for legacy documents
 * ingested before raw_text existed. Offsets into this reconstruction are real
 * (the extractor anchors against the string it is given), but the wording is the
 * extractor's, not the employer's — which is why the caller records reduced
 * fidelity in unavailableVerifications.
 */
export function reconstructJdText(jd: StructuredJD): string {
    const parts: string[] = [];
    if (jd.title) parts.push(`# ${jd.title}`);
    if (jd.company) parts.push(`Company: ${jd.company}`);
    if (jd.location) parts.push(`Location: ${jd.location}`);
    if (jd.description_summary) parts.push(`\n## Overview\n${jd.description_summary}`);
    if (jd.responsibilities?.length) {
        parts.push(`\n## Responsibilities\n${jd.responsibilities.map(r => `- ${r}`).join('\n')}`);
    }
    if (jd.requirements?.length) {
        parts.push(`\n## Requirements\n${jd.requirements.map(r => `- ${r}`).join('\n')}`);
    }
    if (jd.nice_to_haves?.length) {
        parts.push(`\n## Nice to have\n${jd.nice_to_haves.map(r => `- ${r}`).join('\n')}`);
    }
    if (jd.technologies?.length) {
        parts.push(`\n## Technologies\n${jd.technologies.map(t => `- ${t}`).join('\n')}`);
    }
    return parts.join('\n');
}
