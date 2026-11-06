// premium/electron/knowledge/roleInsight/RoleInsightService.ts
//
// The surface the IPC layer talks to. Owns:
//   • run / cancel / supersede of an analysis
//   • outdated detection against live source fingerprints
//   • user corrections, and the recomputation they trigger
//   • the explicit, never-implicit path from a correction to permanent
//     Profile Intelligence evidence
//
// The last one is a hard product rule: an answer the user gives inside Role
// Insight updates THIS analysis only. It becomes reusable profile evidence only
// when the user separately and explicitly asks for that. `saveToProfile` is a
// distinct call, not a flag on the correction, so there is no code path where a
// correction silently mutates the profile.

import { randomUUID } from 'node:crypto';
import { KnowledgeDocument, ContextNode } from '../types';
import { RoleInsightDatabase } from './RoleInsightDatabase';
import {
    RoleInsightEngine, RoleInsightDeps, RunOptions, ProgressStage,
    AnalysisCancelledError, MissingSourceError,
    fingerprintResume, fingerprintJd, fingerprintProfile,
} from './RoleInsightEngine';
import { buildClarifications } from './RoleInsightEngine';
import {
    RoleInsightReport, RoleInsightAnalysis, RequirementAssessment, CandidateEvidence,
    RoleInsightCorrection, CorrectionKind, MatchStatus, ClarificationAnswer,
    REQUIREMENT_EXTRACTOR_VERSION, REQUIREMENT_MATCHER_VERSION,
} from './types';
import { canonicalize, extractCanonicalTerms } from './skillOntology';
import { calculateCoverage, deriveAlignment, deriveEvidenceConfidence, buildSummary } from './CoverageCalculator';

export interface RoleInsightStatus {
    hasResume: boolean;
    hasJobDescription: boolean;
    hasAnalysis: boolean;
    analysing: boolean;
    /** Current stage while analysing, for the progress list. */
    stage: ProgressStage | null;
    outdated: boolean;
    outdatedReasons: string[];
    resumeName: string;
    jdTitle: string;
    jdCompany: string;
}

type ServiceDeps = Omit<RoleInsightDeps, 'db' | 'onProgress' | 'isCancelled'> & {
    db: RoleInsightDatabase;
    /** Persist a confirmed claim into Profile Intelligence. Explicit action only. */
    appendProfileEvidence?: (claim: string, label: string) => Promise<boolean>;
};

export class RoleInsightService {
    private analysing = false;
    private stage: ProgressStage | null = null;
    private cancelled = false;
    private runToken = 0;
    private lastError: { message: string; diagnosticId: string } | null = null;

    constructor(private deps: ServiceDeps) {}

    // ── Status / outdated detection ──────────────────────────────────────────

    /**
     * Compare the stored analysis's fingerprints against the live sources.
     * Returns the specific drifts, because "outdated" alone is not actionable —
     * the user needs to know WHICH source changed.
     */
    private detectOutdated(analysis: RoleInsightAnalysis | null): { outdated: boolean; reasons: string[] } {
        if (!analysis) return { outdated: false, reasons: [] };
        const reasons: string[] = [];

        if (fingerprintResume(this.deps.getResumeDoc()) !== analysis.resumeFingerprint) {
            reasons.push('Your résumé has changed since this analysis ran.');
        }
        // A URL-sourced analysis is not tied to the stored JD, so a stored-JD
        // change is not drift for it.
        if (analysis.sourceMeta?.jdSourceKind !== 'job_url'
            && fingerprintJd(this.deps.getJdDoc()) !== analysis.jdFingerprint) {
            reasons.push('The job description has changed since this analysis ran.');
        }
        if (fingerprintProfile(this.deps.getNodes()) !== analysis.profileFingerprint) {
            reasons.push('Your Profile Intelligence data has changed since this analysis ran.');
        }
        if (analysis.extractorVersion !== REQUIREMENT_EXTRACTOR_VERSION
            || analysis.matcherVersion !== REQUIREMENT_MATCHER_VERSION) {
            reasons.push('Natively\'s analysis method has been updated since this analysis ran.');
        }

        return { outdated: reasons.length > 0, reasons };
    }

    getStatus(): RoleInsightStatus {
        const resumeDoc = this.deps.getResumeDoc();
        const jdDoc = this.deps.getJdDoc();
        const analysis = safe(() => this.deps.db.getLatestAnalysis(), null);
        const { outdated, reasons } = this.detectOutdated(analysis);
        const jd: any = jdDoc?.structured_data ?? {};
        const resume: any = resumeDoc?.structured_data ?? {};

        return {
            hasResume: !!resumeDoc,
            hasJobDescription: !!jdDoc,
            hasAnalysis: !!analysis,
            analysing: this.analysing,
            stage: this.stage,
            outdated,
            outdatedReasons: reasons,
            resumeName: resume?.identity?.name ? `${resume.identity.name}'s résumé` : 'Submitted résumé',
            jdTitle: jd?.title ?? '',
            jdCompany: jd?.company ?? '',
        };
    }

    getLastError(): { message: string; diagnosticId: string } | null {
        return this.lastError;
    }

    // ── Report loading ───────────────────────────────────────────────────────

    getReport(analysisId?: string): RoleInsightReport | null {
        const analysis = analysisId
            ? this.deps.db.getAnalysis(analysisId)
            : this.deps.db.getLatestAnalysis();
        if (!analysis) return null;

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
            outdatedReasons: reasons,
        };
    }

    listHistory(limit = 20): Array<Pick<RoleInsightAnalysis, 'id' | 'createdAt' | 'roleAlignment' | 'evidenceConfidence' | 'status'> & { jdTitle: string; jdCompany: string }> {
        return this.deps.db.listAnalyses(limit).map(a => ({
            id: a.id,
            createdAt: a.createdAt,
            roleAlignment: a.roleAlignment,
            evidenceConfidence: a.evidenceConfidence,
            status: a.status,
            jdTitle: a.sourceMeta?.jdTitle ?? '',
            jdCompany: a.sourceMeta?.jdCompany ?? '',
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
    getLiveEvidence(question: string): string | null {
        const analysis = safe(() => this.deps.db.getLatestAnalysis(), null);
        if (!analysis) return null;
        if (this.detectOutdated(analysis).outdated) return null;

        // F7 (code review 2026-08-05): the live path inherits the pivot path's
        // invariant that gap context describes the ACTIVE JD. detectOutdated
        // deliberately exempts job_url-sourced analyses from JD drift (for the
        // UI), which here would let an analysis of a completely different job
        // stay "fresh" and make the assistant disclaim experience relevant to
        // the interview actually in progress. Exact fingerprint match, no
        // exemptions — anything else falls back to the activeJD-keyed pivots.
        if (analysis.jdFingerprint !== fingerprintJd(this.deps.getJdDoc())) return null;

        // Generic tokens survive canonicalization but carry no topical signal —
        // "tell me about your PostgreSQL work" must not match the authorization
        // requirement via "work". Injecting on weak overlap is exactly the
        // 2026-06-12 prompt-bloat regression, so precision beats recall here.
        const GENERIC = new Set([
            'work', 'team', 'role', 'company', 'position', 'job', 'time', 'tell',
            'skill', 'skills', 'build', 'make', 'handle', 'good', 'best', 'help',
        ]);
        const qTerms = new Set(
            extractCanonicalTerms(question).map(t => canonicalize(t)).filter(t => !GENERIC.has(t)),
        );
        const qLower = ` ${question.toLowerCase()} `;
        if (qTerms.size === 0) return null;

        const assessments = new Map(
            this.deps.db.getAssessments(analysis.id).map(a => [a.requirementId, a]),
        );
        const AT_RISK = new Set(['transferable', 'needs_evidence', 'confirmed_gap', 'requirement_not_met']);

        const matched: Array<{ req: any; a: any; rank: number }> = [];
        for (const req of this.deps.db.getRequirements(analysis.id)) {
            if (req.excluded) continue;
            const a = assessments.get(req.id);
            if (!a || !AT_RISK.has(a.status)) continue;

            const terms = (req.canonicalTerms ?? []).map((t: string) => canonicalize(t))
                .filter((t: string) => t && !GENERIC.has(t));
            const hit = terms.some((t: string) =>
                qTerms.has(t) || (t.includes('_') && qLower.includes(` ${t.replace(/_/g, ' ')} `)));
            if (!hit) continue;

            const rank = a.status === 'requirement_not_met' ? 0
                : a.status === 'confirmed_gap' ? 1
                    : a.status === 'needs_evidence' ? 2 : 3;
            matched.push({ req, a, rank });
        }
        if (matched.length === 0) return null;
        matched.sort((x, y) => x.rank - y.rank);

        const clip = (t: unknown, n: number) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
        const STATE_LABEL: Record<string, string> = {
            transferable: 'related experience only',
            needs_evidence: 'no recorded evidence',
            confirmed_gap: 'confirmed no direct experience',
            requirement_not_met: 'condition not met',
        };

        const lines: string[] = [
            'Ground any claim about these topics in the evidence below. Never assert experience beyond it; acknowledge honestly and pivot to the adjacent evidence.',
        ];
        for (const { req, a } of matched.slice(0, 2)) {
            lines.push(`[${clip(req.normalizedText, 90)} — ${STATE_LABEL[a.status]}]`);
            if (a.explanation) lines.push(`Evidence: ${clip(a.explanation, 280)}`);
            if (a.transferExplanation) lines.push(`Transfers because: ${clip(a.transferExplanation, 200)}`);
            if (a.limitations?.length) lines.push(`Not established: ${clip(a.limitations.join(' '), 220)}`);
        }
        return `<role_fit_evidence>\n${lines.join('\n')}\n</role_fit_evidence>`;
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
    private lastAutoKey: string | null = null;

    maybeAutoRefresh(): boolean {
        if (this.analysing) return false;
        const resumeDoc = this.deps.getResumeDoc();
        const jdDoc = this.deps.getJdDoc();
        if (!resumeDoc || !jdDoc) return false;

        const analysis = safe(() => this.deps.db.getLatestAnalysis(), null);
        if (!analysis) return false;
        if (!this.detectOutdated(analysis).outdated) return false;
        // F7: a job_url-sourced analysis cannot be reproduced by analyse({}) —
        // re-running would silently replace the analysed job with the stored
        // JD. URL analyses refresh only by explicit user action.
        if (analysis.sourceMeta?.jdSourceKind === 'job_url') return false;

        const key = [
            fingerprintResume(resumeDoc),
            fingerprintJd(jdDoc),
            fingerprintProfile(this.deps.getNodes()),
        ].join('|');
        if (this.lastAutoKey === key) return false;
        this.lastAutoKey = key;

        console.log('[RoleInsight] Sources changed — refreshing analysis in the background');
        void this.analyse({}).catch(() => { /* recorded via getLastError; no retry loop */ });
        return true;
    }

    // ── Run ──────────────────────────────────────────────────────────────────

    isAnalysing(): boolean { return this.analysing; }

    /** Cooperative cancel: the in-flight run stops at its next stage boundary. */
    cancel(): void {
        if (!this.analysing) return;
        this.cancelled = true;
        console.log('[RoleInsight] Cancellation requested');
    }

    async analyse(options: RunOptions = {}): Promise<RoleInsightReport> {
        // Supersede rather than queue: a second request means the first result is
        // already stale from the user's point of view.
        if (this.analysing) this.cancel();
        const token = ++this.runToken;

        this.analysing = true;
        this.cancelled = false;
        this.stage = 'reading_job_description';
        this.lastError = null;

        const engine = new RoleInsightEngine({
            ...this.deps,
            onProgress: (s) => { if (token === this.runToken) this.stage = s; },
            isCancelled: () => this.cancelled || token !== this.runToken,
        });

        try {
            const report = await engine.run(options);
            return report;
        } catch (e: any) {
            if (e instanceof AnalysisCancelledError) throw e;
            if (e instanceof MissingSourceError) throw e;
            const diagnosticId = randomUUID().slice(0, 8);
            console.error(`[RoleInsight] Analysis failed (diagnostic ${diagnosticId}):`, e);
            this.lastError = { message: e?.message ?? 'Unknown error', diagnosticId };
            throw e;
        } finally {
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
    applyCorrection(args: {
        analysisId: string;
        requirementId: string | null;
        kind: CorrectionKind;
        detail?: string;
        /** For confirm_experience: the narrative the user supplied. */
        evidenceText?: string;
        /** For reclassify_priority. */
        priority?: 'critical' | 'important' | 'supporting' | 'preferred';
        mandatory?: boolean;
        /** For evidence_unrelated: which evidence to drop. */
        evidenceId?: string;
    }): RoleInsightReport | null {
        const { analysisId, requirementId, kind } = args;
        const analysis = this.deps.db.getAnalysis(analysisId);
        if (!analysis) return null;

        const assessments = this.deps.db.getAssessments(analysisId);
        const current = requirementId ? assessments.find(a => a.requirementId === requirementId) ?? null : null;

        this.deps.db.addCorrection({
            id: `rc_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
            analysisId,
            requirementId,
            kind,
            detail: args.detail ?? args.evidenceText ?? '',
            previousStatus: current?.status ?? null,
            savedToProfile: false,
            createdAt: new Date().toISOString(),
        });

        switch (kind) {
            case 'requirement_irrelevant':
                if (requirementId) this.deps.db.setRequirementExcluded(requirementId, true);
                break;
            case 'requirement_restored':
                if (requirementId) this.deps.db.setRequirementExcluded(requirementId, false);
                break;
            case 'reclassify_priority':
                if (requirementId && args.priority) {
                    this.deps.db.setRequirementPriority(requirementId, args.priority, args.mandatory ?? false);
                }
                break;
            case 'confirm_experience': {
                if (!current || !requirementId) break;
                const evidenceText = (args.evidenceText ?? '').trim();
                // F2 (code review 2026-08-05): a CONDITION is binary — you hold
                // the authorization / degree / certification or you do not.
                // "Describe the work" has no meaning for it, so a bare "yes" is a
                // complete answer and must resolve it fully; routing it through
                // the narrative-depth rule below left a confirmed mandatory
                // condition pinned as "Only partly evidenced" forever, and
                // entered a confirmed degree into coverage at half credit.
                const confirmedReq = this.deps.db.getRequirements(analysisId)
                    .find(r => r.id === requirementId);
                const isCondition = !!confirmedReq && (confirmedReq.hardGate
                    || ((confirmedReq.category === 'education' || confirmedReq.category === 'certification')
                        && confirmedReq.mandatory));
                if (isCondition) {
                    this.deps.db.saveAssessments([{
                        ...current,
                        status: 'proven',
                        originalStatus: current.originalStatus ?? current.status,
                        userCorrected: true,
                        explanation: evidenceText.length > 0
                            ? `You confirmed you meet this requirement: "${evidenceText}"`
                            : 'You confirmed you meet this requirement.',
                        transferExplanation: undefined,
                        limitations: [],
                        missingInformation: [],
                        confidence: 0.95,
                        evidenceIds: current.evidenceIds,
                    }]);
                    break;
                }
                const updated: RequirementAssessment = {
                    ...current,
                    // A user-supplied narrative is direct evidence → proven.
                    // A bare "yes" with no detail establishes that they have it
                    // but not how, so it lands as transferable with the gap named.
                    status: evidenceText.length >= 40 ? 'proven' : 'transferable',
                    originalStatus: current.originalStatus ?? current.status,
                    userCorrected: true,
                    explanation: evidenceText.length >= 40
                        ? `You confirmed this and described it: "${evidenceText}"`
                        : 'You confirmed you have this experience.',
                    transferExplanation: evidenceText.length >= 40 ? undefined
                        : 'You confirmed the experience exists, so it counts as supported.',
                    limitations: evidenceText.length >= 40 ? []
                        : ['You have not yet described the work, so its depth and scope are unrecorded.'],
                    missingInformation: evidenceText.length >= 40 ? []
                        : ['Add what happened, what you did, and the result to make this fully evidenced.'],
                    confidence: evidenceText.length >= 40 ? 0.9 : 0.7,
                    evidenceIds: current.evidenceIds,
                };
                this.deps.db.saveAssessments([updated]);
                break;
            }
            case 'confirm_gap': {
                if (!current || !requirementId) break;
                // The ONLY route to confirmed_gap in the entire system.
                this.deps.db.saveAssessments([{
                    ...current,
                    status: 'confirmed_gap',
                    originalStatus: current.originalStatus ?? current.status,
                    userCorrected: true,
                    explanation: 'You confirmed you do not have this experience.',
                    transferExplanation: undefined,
                    limitations: [],
                    missingInformation: [],
                    confidence: 0.95,
                }]);
                break;
            }
            case 'evidence_unrelated': {
                if (!current || !args.evidenceId) break;
                const remaining = current.evidenceIds.filter(id => id !== args.evidenceId);
                // Removing the last citation removes the basis for the conclusion.
                this.deps.db.saveAssessments([{
                    ...current,
                    evidenceIds: remaining,
                    originalStatus: current.originalStatus ?? current.status,
                    userCorrected: true,
                    status: remaining.length === 0 ? 'needs_evidence' : current.status,
                    explanation: remaining.length === 0
                        ? 'You marked the supporting evidence as unrelated, so this is unresolved again.'
                        : current.explanation,
                    missingInformation: remaining.length === 0
                        ? ['Confirm whether you have this experience.']
                        : current.missingInformation,
                }]);
                break;
            }
            case 'jd_misparsed':
            case 'private_note':
                // Recorded in the audit table only; they do not change a status.
                break;
        }

        this.recomputeSummary(analysisId);
        return this.getReport(analysisId);
    }

    /** Map a clarification answer onto the correction it implies. */
    answerClarification(args: {
        analysisId: string;
        requirementId: string;
        answer: ClarificationAnswer;
        detail?: string;
    }): RoleInsightReport | null {
        const { analysisId, requirementId, answer, detail } = args;
        switch (answer) {
            case 'yes':
            case 'partially':
                return this.applyCorrection({
                    analysisId, requirementId, kind: 'confirm_experience',
                    evidenceText: detail, detail,
                });
            case 'no':
                return this.applyCorrection({ analysisId, requirementId, kind: 'confirm_gap', detail });
            case 'unsure':
            case 'decline':
            default:
                // Both leave the requirement unresolved, which is already its
                // state. Record that it was asked so it is not asked again.
                this.deps.db.addCorrection({
                    id: `rc_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
                    analysisId, requirementId, kind: 'private_note',
                    detail: answer === 'decline'
                        ? 'User declined to add this to their profile.'
                        : 'User was unsure whether their experience qualifies.',
                    previousStatus: null, savedToProfile: false,
                    createdAt: new Date().toISOString(),
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
    async saveToProfile(args: {
        analysisId: string;
        requirementId: string;
        claim: string;
    }): Promise<{ success: boolean; error?: string }> {
        const claim = args.claim.trim();
        if (claim.length < 10) {
            return { success: false, error: 'Add a little more detail before saving this to your profile.' };
        }
        if (!this.deps.appendProfileEvidence) {
            return { success: false, error: 'Saving to Profile Intelligence is not available in this build.' };
        }
        const requirement = this.deps.db.getRequirements(args.analysisId)
            .find(r => r.id === args.requirementId);
        const label = requirement ? `Confirmed for: ${requirement.normalizedText}` : 'Confirmed experience';

        const ok = await this.deps.appendProfileEvidence(claim, label);
        if (!ok) return { success: false, error: 'Could not write to Profile Intelligence.' };

        // F9 (code review 2026-08-05): the appended node changes the live
        // profile fingerprint, which — left alone — marks the very analysis
        // this claim came from as outdated: getLiveEvidence goes dark and the
        // next get-report auto-triggers a token-spending re-analysis, seconds
        // after the user's save. The analysis semantically INCLUDES the claim
        // (applyCorrection already updated its assessment), so adopt the new
        // fingerprint. Other analyses correctly become outdated.
        this.deps.db.updateProfileFingerprint(
            args.analysisId,
            fingerprintProfile(this.deps.getNodes()),
        );

        this.deps.db.addCorrection({
            id: `rc_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
            analysisId: args.analysisId,
            requirementId: args.requirementId,
            kind: 'confirm_experience',
            detail: claim,
            previousStatus: null,
            savedToProfile: true,
            createdAt: new Date().toISOString(),
        });
        return { success: true };
    }

    // ── Recomputation after a correction ─────────────────────────────────────

    /**
     * Corrections change statuses and exclusions, so every summary metric must be
     * recomputed. This is deterministic and cheap — no LLM, no retrieval — which
     * is why a correction updates the whole picture instantly.
     */
    private recomputeSummary(analysisId: string): void {
        const analysis = this.deps.db.getAnalysis(analysisId);
        if (!analysis) return;

        const requirements = this.deps.db.getRequirements(analysisId);
        const assessments = this.deps.db.getAssessments(analysisId);

        const coverageInput = {
            requirements,
            assessments,
            extractionMode: (analysis.stageTrace.find(s => s.stage === 'extract_requirements')?.detail ?? '')
                .includes('mode=llm') ? 'llm' as const : 'heuristic' as const,
            jdTruncated: (analysis.stageTrace.find(s => s.stage === 'extract_requirements')?.detail ?? '')
                .includes('truncated'),
            resumeHeuristic: false,
            profileNodeCount: analysis.sourceMeta?.profileNodeCount ?? 0,
            failedStages: analysis.failedStages,
        };

        const coverage = calculateCoverage(coverageInput);
        const roleAlignment = deriveAlignment(coverage);
        const { confidence, reasons } = deriveEvidenceConfidence(coverage, coverageInput);

        // F3 (code review 2026-08-05): gates are NOT re-derived. The analysis's
        // stored hardGates were computed from the résumé it actually analysed;
        // re-running evaluateHardGates here read the LIVE résumé, so answering a
        // correction on an old report rewrote its gate strip to describe a
        // résumé that analysis never saw — and cited freshly generated evidence
        // ids that were never persisted. A correction can only OVERLAY the
        // user's own confirmations onto the stored checks.
        const gateConfirmations = new Map<string, { held: boolean; detail: string }>();
        for (const c of this.deps.db.getCorrections(analysisId)) {
            if (!c.requirementId) continue;
            if (c.kind === 'confirm_experience') {
                gateConfirmations.set(c.requirementId, { held: true, detail: c.detail || 'You confirmed you meet this requirement.' });
            } else if (c.kind === 'confirm_gap') {
                gateConfirmations.set(c.requirementId, { held: false, detail: c.detail || 'You confirmed you do not meet this requirement.' });
            }
        }
        const gateChecks = (analysis.hardGates ?? []).map(g => {
            const conf = gateConfirmations.get(g.requirementId);
            if (!conf) return g;
            return {
                ...g,
                state: (conf.held ? 'met' : 'not_met') as typeof g.state,
                detail: conf.detail,
                // Stored citations only — never ids from a rebuilt pool.
            };
        });
        const hardGateStatus =
            gateChecks.length === 0 ? 'not_applicable' as const
                : gateChecks.some(g => g.state === 'not_met') ? 'not_met' as const
                    : gateChecks.some(g => g.state === 'needs_confirmation') ? 'needs_confirmation' as const
                        : 'clear' as const;

        this.deps.db.updateAnalysisSummary(analysisId, {
            roleAlignment,
            evidenceConfidence: confidence,
            hardGateStatus,
            summary: buildSummary(roleAlignment, coverage, hardGateStatus, analysis.sourceMeta?.jdTitle ?? ''),
            coverage,
            hardGates: gateChecks,
            confidenceReasons: reasons,
        });
    }
}

function safe<T>(fn: () => T, fallback: T): T {
    try { return fn(); } catch (e: any) {
        console.warn('[RoleInsight] guarded call failed:', e?.message);
        return fallback;
    }
}

export type { RunOptions, ProgressStage };
export { AnalysisCancelledError, MissingSourceError };
