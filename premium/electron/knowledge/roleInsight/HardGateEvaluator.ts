// premium/electron/knowledge/roleInsight/HardGateEvaluator.ts
//
// Eligibility conditions — authorization, location, clearance, degree, licence,
// language, travel, shift — evaluated SEPARATELY from capability coverage.
//
// Why separate: averaging a blocker into a percentage lets a strong technical
// match visually hide an unmet mandatory requirement. That is the single most
// misleading thing this feature could do, so hard gates never enter the coverage
// denominator and are surfaced in their own strip.
//
// This module is entirely deterministic and deliberately CONSERVATIVE. Work
// authorization, citizenship, clearance and residency are facts Natively cannot
// infer — a résumé listing a US address does not establish work authorization,
// and treating it as if it did would be exactly the kind of assumed status the
// product rules forbid. So the default for those is `needs_confirmation`, and
// `not_met` is reachable only from an explicit user confirmation.

import { StructuredResume } from '../types';
import { RoleRequirement, HardGateCheck, HardGateState, HardGateStatus, CandidateEvidence } from './types';
import { EvidencePool } from './EvidenceRetriever';
import { normalizeTerm } from './skillOntology';

/** Degrees in ascending order, so "Bachelor's or higher" is satisfiable. */
const DEGREE_RANK: Array<{ re: RegExp; rank: number; label: string }> = [
    { re: /\b(high school|secondary|ged)\b/i, rank: 1, label: 'high school' },
    { re: /\b(associate|a\.?a\.?s?\.?)\b/i, rank: 2, label: "associate's" },
    { re: /\b(bachelor|b\.?s\.?c?\.?|b\.?a\.?|b\.?tech|b\.?e\.?|undergraduate)\b/i, rank: 3, label: "bachelor's" },
    { re: /\b(master|m\.?s\.?c?\.?|m\.?a\.?|m\.?tech|mba|postgraduate)\b/i, rank: 4, label: "master's" },
    { re: /\b(ph\.?d|doctora|dphil)\b/i, rank: 5, label: 'doctorate' },
];

function degreeRank(text: string): { rank: number; label: string } | null {
    // Scan highest-first so "Bachelor's or Master's" reads as the higher bar met.
    for (let i = DEGREE_RANK.length - 1; i >= 0; i--) {
        if (DEGREE_RANK[i].re.test(text)) return { rank: DEGREE_RANK[i].rank, label: DEGREE_RANK[i].label };
    }
    return null;
}

const REMOTE_RE = /\b(fully remote|remote[- ]first|100% remote|work from home|wfh|remote)\b/i;
const ONSITE_RE = /\b(on-?site|in[- ]office|in person)\b/i;
const HYBRID_RE = /\bhybrid\b/i;

function labelFor(req: RoleRequirement): string {
    switch (req.category) {
        case 'authorization': return 'Work authorization';
        case 'clearance': return 'Security clearance';
        case 'location': return 'Location';
        case 'logistics': return 'Logistics';
        case 'education': return 'Degree';
        case 'certification': return 'Certification';
        default: return 'Requirement';
    }
}

/** Evidence items that speak to logistics/education/certification facts. */
function factEvidence(pool: EvidencePool, categories: Array<CandidateEvidence['category']>): CandidateEvidence[] {
    return pool.items.filter(i => categories.includes(i.category));
}

export interface HardGateOutcome {
    checks: HardGateCheck[];
    status: HardGateStatus;
}

export function evaluateHardGates(
    requirements: RoleRequirement[],
    resume: StructuredResume | null,
    pool: EvidencePool,
    /** Explicit user answers, keyed by requirement id. The only route to not_met. */
    userConfirmations: Map<string, { held: boolean; detail: string }> = new Map(),
): HardGateOutcome {
    const checks: HardGateCheck[] = [];

    // Degree and certification requirements are eligibility conditions when the
    // JD states them as mandatory, even though their category is not in
    // HARD_GATE_CATEGORIES (they are also capability signals).
    const gateRequirements = requirements.filter(r =>
        !r.excluded && (
            r.hardGate ||
            ((r.category === 'education' || r.category === 'certification') && r.mandatory)
        ));

    for (const req of gateRequirements) {
        const confirmed = userConfirmations.get(req.id);
        if (confirmed) {
            checks.push({
                requirementId: req.id,
                label: labelFor(req),
                state: confirmed.held ? 'met' : 'not_met',
                detail: confirmed.detail || (confirmed.held
                    ? 'You confirmed you meet this requirement.'
                    : 'You confirmed you do not meet this requirement.'),
                evidenceIds: [],
            });
            continue;
        }

        checks.push(evaluateOne(req, resume, pool));
    }

    // ── Roll-up ───────────────────────────────────────────────────────────────
    let status: HardGateStatus;
    if (checks.length === 0) status = 'not_applicable';
    else if (checks.some(c => c.state === 'not_met')) status = 'not_met';
    else if (checks.some(c => c.state === 'needs_confirmation')) status = 'needs_confirmation';
    else status = 'clear';

    return { checks, status };
}

function evaluateOne(req: RoleRequirement, resume: StructuredResume | null, pool: EvidencePool): HardGateCheck {
    const text = `${req.originalText} ${req.normalizedText}`;
    const base = { requirementId: req.id, label: labelFor(req), evidenceIds: [] as string[] };

    switch (req.category) {
        case 'authorization':
            // Deliberately never inferred. A résumé address, a past US employer,
            // or a degree from a US university establish none of citizenship,
            // visa status, or sponsorship need.
            return {
                ...base,
                state: 'needs_confirmation',
                detail: 'Natively does not hold your work-authorization status. Confirm it to complete this check.',
            };

        case 'clearance':
            return {
                ...base,
                state: 'needs_confirmation',
                detail: 'No clearance is recorded in your profile. Confirm whether you hold one.',
            };

        case 'location': {
            const candidateLocation = resume?.identity?.location?.trim();
            if (REMOTE_RE.test(text) && !HYBRID_RE.test(text) && !ONSITE_RE.test(text)) {
                return { ...base, state: 'met', detail: 'The role is remote, so location is not a constraint.' };
            }
            if (!candidateLocation) {
                return {
                    ...base,
                    state: 'needs_confirmation',
                    detail: 'No location is recorded on your résumé, so this cannot be checked.',
                };
            }
            const evidence = factEvidence(pool, ['logistics']).filter(e => e.claim.includes(candidateLocation));
            // A shared city or region token is a genuine signal; anything less is not.
            const reqLoc = normalizeTerm(text);
            const tokens = normalizeTerm(candidateLocation).split(/[\s,]+/).filter(t => t.length > 3);
            const overlap = tokens.some(t => reqLoc.includes(t));
            if (overlap) {
                return {
                    ...base,
                    state: 'likely_met',
                    detail: `Your résumé lists ${candidateLocation}, which matches the stated location. Confirm you can work from there on the required schedule.`,
                    evidenceIds: evidence.map(e => e.id),
                };
            }
            return {
                ...base,
                state: 'needs_confirmation',
                detail: `The role specifies a location that does not obviously match your résumé location (${candidateLocation}). Confirm whether you can meet it.`,
                evidenceIds: evidence.map(e => e.id),
            };
        }

        case 'education': {
            const required = degreeRank(text);
            if (!required) {
                return { ...base, state: 'not_specified', detail: 'No specific degree level is stated.' };
            }
            const held = (resume?.education ?? [])
                .map(e => degreeRank(`${e.degree} ${e.field}`))
                .filter((d): d is { rank: number; label: string } => d !== null)
                .sort((a, b) => b.rank - a.rank)[0];
            if (!held) {
                return {
                    ...base,
                    state: 'needs_confirmation',
                    detail: `The role requires a ${required.label} degree; no degree is recorded in your profile.`,
                };
            }
            const evidence = factEvidence(pool, ['education']).slice(0, 2).map(e => e.id);
            if (held.rank >= required.rank) {
                return {
                    ...base,
                    state: 'met',
                    detail: `Your ${held.label} degree meets the stated ${required.label} requirement.`,
                    evidenceIds: evidence,
                };
            }
            return {
                ...base,
                state: 'needs_confirmation',
                detail: `The role states a ${required.label} degree; your profile records a ${held.label}. Many employers accept equivalent experience — confirm how you want this treated.`,
                evidenceIds: evidence,
            };
        }

        case 'certification': {
            const certs = resume?.certifications ?? [];
            if (certs.length === 0) {
                return {
                    ...base,
                    state: 'needs_confirmation',
                    detail: 'The role names a required certification; none is recorded in your profile.',
                };
            }
            const reqText = normalizeTerm(text);
            const match = certs.find(c => {
                const tokens = normalizeTerm(c.name).split(/\s+/).filter(t => t.length > 3);
                return tokens.length > 0 && tokens.every(t => reqText.includes(t));
            });
            const evidence = factEvidence(pool, ['certification']).slice(0, 3).map(e => e.id);
            if (match) {
                return {
                    ...base,
                    state: 'met',
                    detail: `Your profile records "${match.name}", which matches the stated requirement.`,
                    evidenceIds: evidence,
                };
            }
            return {
                ...base,
                state: 'needs_confirmation',
                detail: 'The named certification does not match any recorded in your profile. Confirm whether you hold it.',
                evidenceIds: evidence,
            };
        }

        case 'logistics':
        default:
            return {
                ...base,
                state: 'needs_confirmation',
                detail: 'This is a logistical condition Natively cannot verify from your profile. Confirm whether you can meet it.',
            };
    }
}

/** Display order for the hard-requirement strip: unresolved first. */
export const HARD_GATE_STATE_ORDER: Record<HardGateState, number> = {
    not_met: 0, needs_confirmation: 1, likely_met: 2, met: 3, not_specified: 4,
};
