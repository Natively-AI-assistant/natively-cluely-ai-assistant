// premium/electron/knowledge/roleInsight/AssessmentValidator.ts
//
// The last line between a model's output and something the user reads as fact.
//
// Every rule here exists because the corresponding failure produces a claim
// about a real person's career that nothing supports. The validator does not
// warn — it DOWNGRADES. A conclusion that cannot survive these checks becomes
// `needs_evidence`, which is the honest state and the one the user can resolve.

import { RoleRequirement, RequirementAssessment, MatchStatus } from './types';
import { EvidencePool } from './EvidenceRetriever';

export interface ValidationResult {
    assessments: RequirementAssessment[];
    /** One line per correction, for the stage trace and support diagnostics. */
    violations: string[];
}

/** Filler that asserts a relationship without describing it. */
const GENERIC_PHRASES = [
    /\byour experience is relevant\b/i,
    /\bthis (skill )?aligns( well)?\b/i,
    /\byou (appear to be|seem to be|are) a (good|strong|great) (match|fit)\b/i,
    /\bstrong (candidate|match|fit)\b/i,
    /\bclosely (aligns|matches|related)\b/i,
    /\bhighly relevant\b/i,
    /\bdemonstrates? (strong|excellent|good) (skills|ability)\b/i,
    /\bwell[- ]suited\b/i,
];

/** Language that asserts a capability the record cannot establish. */
// The `[^.]{0,40}` spans are load-bearing: a model writes "You hold a valid
// TS/SCI clearance", not "you hold a clearance", so an adjacency-only pattern
// misses every realistic phrasing of the claim it is meant to catch.
const UNSUPPORTED_ASSERTIONS = [
    /\byou (are|have been|remain)\b[^.]{0,40}\b(certified|authorized|eligible|cleared)\b/i,
    /\byou (hold|possess|have)\b[^.]{0,40}\b(visa|clearance|licence|license|certification|work authorization)\b/i,
    /\byou (live|reside|are based) in\b/i,
    /\byou managed \d+/i,
    /\byou (are|were) (a )?(us|u\.s\.|american|eu|uk) citizen\b/i,
];

function isGeneric(text: string): boolean {
    return GENERIC_PHRASES.some(re => re.test(text));
}

function downgrade(
    a: RequirementAssessment,
    req: RoleRequirement,
    reason: string,
    extraMissing: string,
): RequirementAssessment {
    return {
        ...a,
        status: 'needs_evidence',
        // The original conclusion is preserved, never silently discarded — the
        // spec requires corrections be auditable and this is a correction.
        originalStatus: a.originalStatus ?? a.status,
        evidenceIds: [],
        explanation: reason,
        transferExplanation: undefined,
        limitations: [],
        missingInformation: Array.from(new Set([...a.missingInformation, extraMissing])),
        confidence: Math.min(a.confidence, 0.4),
    };
}

export function validateAssessments(
    requirements: RoleRequirement[],
    assessments: RequirementAssessment[],
    pool: EvidencePool,
    /**
     * Requirement ids whose conclusion came from HardGateEvaluator rather than a
     * model. Passed explicitly rather than inferred from `req.hardGate`, because
     * the evaluator also decides mandatory degree and certification requirements,
     * whose category is not a gate category.
     */
    deterministicIds: ReadonlySet<string> = new Set(),
): ValidationResult {
    const reqById = new Map(requirements.map(r => [r.id, r]));
    const violations: string[] = [];
    const out: RequirementAssessment[] = [];

    for (const a of assessments) {
        const req = reqById.get(a.requirementId);
        if (!req) {
            violations.push(`Assessment for unknown requirement ${a.requirementId} dropped.`);
            continue;
        }

        // A user correction is the user's own statement about themselves. It is
        // not model output and is not subject to model-output validation.
        if (a.userCorrected) { out.push(a); continue; }

        let current = a;

        // Hard-gate conclusions come from HardGateEvaluator — deterministic code
        // reading structured résumé fields — not from a model. The citation and
        // phrasing rules below exist to police MODEL output, and applying them
        // here would downgrade a correct verdict for having no quotable bullet
        // (e.g. "the role is remote, so location is not a constraint", which is
        // true and cites nothing). Rule 1 still applies: any id it does carry
        // must resolve.
        if (deterministicIds.has(a.requirementId) || reqById.get(a.requirementId)?.hardGate) {
            const resolved = current.evidenceIds.filter(id => pool.byId.has(id));
            if (resolved.length !== current.evidenceIds.length) {
                violations.push(`${a.requirementId}: dropped unresolvable hard-gate citation(s).`);
            }
            out.push({ ...current, evidenceIds: resolved });
            continue;
        }

        // ── Rule 1: cited evidence must exist in the pool. ────────────────────
        const known = current.evidenceIds.filter(id => pool.byId.has(id));
        if (known.length !== current.evidenceIds.length) {
            violations.push(
                `${req.id}: dropped ${current.evidenceIds.length - known.length} citation(s) that do not resolve to stored evidence.`,
            );
            current = { ...current, evidenceIds: known };
        }

        // ── Rule 2: a positive conclusion MUST cite evidence. ────────────────
        // This is the structural guarantee behind "every candidate claim links
        // back to a candidate source".
        if ((current.status === 'proven' || current.status === 'transferable') && current.evidenceIds.length === 0) {
            violations.push(`${req.id}: "${current.status}" cited no stored evidence — downgraded to needs_evidence.`);
            out.push(downgrade(current, req,
                'Natively could not tie a conclusion here back to specific evidence in your profile, so this is left unresolved rather than assumed.',
                `Confirm whether you have experience with "${req.normalizedText}".`));
            continue;
        }
        if (current.status === 'preferred'
            && (current.preferredSubStatus === 'proven' || current.preferredSubStatus === 'transferable')
            && current.evidenceIds.length === 0) {
            violations.push(`${req.id}: preferred sub-status claimed support with no citation — reset to unknown.`);
            current = { ...current, preferredSubStatus: 'unknown' };
        }

        // ── Rule 3: transferable must explain BOTH sides. ────────────────────
        if (current.status === 'transferable') {
            const hasTransfer = (current.transferExplanation ?? '').trim().length >= 20;
            const hasLimit = current.limitations.some(l => l.trim().length >= 12);
            if (!hasTransfer || !hasLimit) {
                violations.push(`${req.id}: transferable without ${!hasTransfer ? 'a transfer explanation' : 'a stated limitation'} — downgraded.`);
                out.push(downgrade(current, req,
                    'Related experience was found, but Natively could not state precisely what transfers and what it does not — so this is left unresolved rather than overclaimed.',
                    `Describe how your experience relates to "${req.normalizedText}".`));
                continue;
            }
        }

        // ── Rule 4: no generic filler in a positive conclusion. ──────────────
        if (current.status === 'proven' || current.status === 'transferable') {
            const blob = `${current.explanation} ${current.transferExplanation ?? ''}`;
            if (isGeneric(blob) || current.explanation.trim().length < 25) {
                violations.push(`${req.id}: explanation was generic or empty — downgraded.`);
                out.push(downgrade(current, req,
                    'Natively could not produce a specific, evidence-grounded explanation for this requirement, so it is left unresolved.',
                    `Confirm whether you have experience with "${req.normalizedText}".`));
                continue;
            }
        }

        // ── Rule 5: strip unsupported assertions about the person. ───────────
        const assertion = UNSUPPORTED_ASSERTIONS.find(re => re.test(current.explanation));
        if (assertion) {
            violations.push(`${req.id}: explanation asserted an unverifiable personal status — downgraded.`);
            out.push(downgrade(current, req,
                'The explanation for this requirement made a claim about your status that your profile does not establish, so it has been withheld.',
                `Confirm your status for "${req.normalizedText}".`));
            continue;
        }

        // ── Rule 6: statuses reachable only through the sanctioned routes. ───
        // `confirmed_gap` requires a user confirmation (userCorrected, handled
        // above). `requirement_not_met` requires a verified hard-gate outcome.
        // Anything else arriving here is a bug or a model overreach.
        if (current.status === 'confirmed_gap') {
            violations.push(`${req.id}: confirmed_gap without a user confirmation — downgraded.`);
            out.push(downgrade(current, req,
                'This is recorded as unresolved because it was never confirmed with you.',
                `Confirm whether you have experience with "${req.normalizedText}".`));
            continue;
        }
        if (current.status === 'requirement_not_met' && !req.hardGate) {
            violations.push(`${req.id}: requirement_not_met on a non-gate requirement — downgraded.`);
            out.push(downgrade(current, req,
                'This is recorded as unresolved because it is not a verifiable eligibility condition.',
                `Confirm whether you have experience with "${req.normalizedText}".`));
            continue;
        }

        // ── Rule 7: needs_evidence must say what is missing. ─────────────────
        if (current.status === 'needs_evidence' && current.missingInformation.length === 0) {
            current = {
                ...current,
                missingInformation: [
                    `Nothing in your profile addresses "${req.normalizedText}".`,
                    'This means Natively could not find it — not that you lack it.',
                ],
            };
        }

        out.push(current);
    }

    // ── Rule 8: every non-excluded requirement has exactly one assessment. ───
    const covered = new Set(out.map(a => a.requirementId));
    for (const req of requirements) {
        if (req.excluded || covered.has(req.id)) continue;
        violations.push(`${req.id}: no assessment produced — recorded as unresolved.`);
        out.push({
            requirementId: req.id,
            analysisId: req.analysisId,
            status: 'needs_evidence',
            evidenceIds: [],
            explanation: 'This requirement was not assessed in this run.',
            limitations: [],
            missingInformation: [`Re-run the analysis to assess "${req.normalizedText}".`],
            confidence: 0.3,
            userCorrected: false,
        });
    }

    return { assessments: out, violations };
}

/** Statuses the model is permitted to originate. Exported for tests. */
export const MODEL_ORIGINABLE_STATUSES: ReadonlySet<MatchStatus> =
    new Set<MatchStatus>(['proven', 'transferable', 'needs_evidence', 'preferred']);
