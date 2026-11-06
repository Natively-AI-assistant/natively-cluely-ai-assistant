// premium/electron/knowledge/roleInsight/RequirementNormalizer.ts
//
// Consolidates semantically equivalent requirements and finalizes priority.
//
// Two things happen here that cannot happen during extraction:
//
//  1. CONSOLIDATION. A JD commonly states the same requirement in the summary,
//     again under "Requirements", and again inside a responsibility bullet.
//     Extraction sees three items. Left alone, that triples the weight of one
//     requirement and distorts every coverage number downstream. Merging keeps
//     ALL supporting passages (the product requirement) while collapsing the
//     item to one row.
//
//  2. RESPONSIBILITY LINKAGE. "Whether other responsibilities depend on it" is
//     a stated priority input, and it can only be computed once the full set is
//     known. A skill referenced by three separate core responsibilities is
//     central to the role even if the JD never says "required".
//
// Everything here is deterministic — no LLM — so it is directly unit-testable.

import {
    RoleRequirement, RequirementCategory, RequirementPriority, HARD_GATE_CATEGORIES,
} from './types';
import { inferPriority } from './RequirementExtractor';
import { canonicalize } from './skillOntology';

type Draft = Omit<RoleRequirement, 'analysisId' | 'id'>;

/** Jaccard overlap of canonical term sets. */
function termOverlap(a: string[], b: string[]): number {
    if (a.length === 0 || b.length === 0) return 0;
    const sa = new Set(a.map(canonicalize));
    const sb = new Set(b.map(canonicalize));
    let inter = 0;
    for (const t of sa) if (sb.has(t)) inter++;
    const union = sa.size + sb.size - inter;
    return union === 0 ? 0 : inter / union;
}

function textSimilarity(a: string, b: string): number {
    const wa = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 3));
    const wb = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 3));
    if (wa.size === 0 || wb.size === 0) return 0;
    let inter = 0;
    for (const w of wa) if (wb.has(w)) inter++;
    return inter / Math.min(wa.size, wb.size);
}

/**
 * True when two requirements are the same ask stated differently.
 *
 * Requires BOTH a category match and substantial overlap. Category alone is far
 * too coarse (every technical skill would merge); term overlap alone merges
 * "5 years of Python" with "Python code review" — related, but distinct asks.
 */
export function isDuplicate(a: Draft, b: Draft): boolean {
    if (a.category !== b.category) return false;
    // Hard gates are never merged: "authorized to work in the US" and "must
    // reside in EST" are both logistics but are separately answerable.
    if (a.hardGate || b.hardGate) {
        return a.originalText.trim().toLowerCase() === b.originalText.trim().toLowerCase();
    }
    // A required item and a preferred item are different asks even when worded
    // identically, so they never merge. `mandatory` alone is NOT the guard: the
    // same requirement routinely appears once in a summary (unmarked) and again
    // under "Minimum qualifications" (marked), and those must merge — with
    // mandatory winning, which the caller applies.
    const aPreferred = a.priority === 'preferred' || a.category === 'preferred';
    const bPreferred = b.priority === 'preferred' || b.category === 'preferred';
    if (aPreferred !== bPreferred) return false;

    // Term overlap ALONE is not sufficient. "5 years of Python experience" and
    // "review Python code from other engineers" share every canonical term but
    // are distinct asks; merging them would silently delete a requirement. So a
    // merge needs agreement on the wording as well as the subject.
    const overlap = termOverlap(a.canonicalTerms, b.canonicalTerms);
    const textual = textSimilarity(a.normalizedText, b.normalizedText);
    return textual >= 0.8 || (overlap >= 0.34 && textual >= 0.45);
}

/** How many core responsibilities reference this requirement's canonical terms. */
function countResponsibilityLinks(target: Draft, all: Draft[]): number {
    if (target.category === 'core_responsibility') return 0;
    const terms = new Set(target.canonicalTerms.map(canonicalize).filter(Boolean));
    if (terms.size === 0) return 0;
    let links = 0;
    for (const r of all) {
        if (r === target || r.category !== 'core_responsibility') continue;
        const rTerms = new Set(r.canonicalTerms.map(canonicalize));
        for (const t of terms) {
            if (rTerms.has(t)) { links++; break; }
        }
    }
    return links;
}

export interface NormalizationResult {
    requirements: Draft[];
    /** How many raw items were folded into others. Surfaced in the stage trace. */
    consolidatedCount: number;
}

export function normalizeRequirements(drafts: Draft[]): NormalizationResult {
    // ── 1. Consolidate ────────────────────────────────────────────────────────
    const merged: Draft[] = [];
    let consolidated = 0;

    for (const draft of drafts) {
        const target = merged.find(m => isDuplicate(m, draft));
        if (!target) {
            merged.push({ ...draft, supportingPassages: [...draft.supportingPassages] });
            continue;
        }
        consolidated++;

        // Union of every quote either side carries. Consolidation must retain
        // ALL supporting JD evidence — it collapses rows, not evidence.
        const allQuotes = new Set<string>([
            target.originalText, ...target.supportingPassages,
            draft.originalText, ...draft.supportingPassages,
        ].filter(Boolean));

        // Prefer the more anchored, more explicit, longer-quoted statement as
        // the canonical row: it is the one the UI will quote.
        const draftIsCanonical =
            (draft.sourceCharStart !== null && target.sourceCharStart === null) ||
            (draft.explicit && !target.explicit) ||
            (draft.explicit === target.explicit
                && draft.sourceCharStart !== null === (target.sourceCharStart !== null)
                && draft.originalText.length > target.originalText.length * 1.3);

        const ordinal = Math.min(target.ordinal, draft.ordinal);
        // Mandatory wins over preferred across duplicates: if the JD says it once
        // under "minimum qualifications", it is required regardless of a looser
        // restatement elsewhere.
        const mandatory = target.mandatory || draft.mandatory;
        const explicit = target.explicit || draft.explicit;
        const confidence = Math.max(target.extractionConfidence, draft.extractionConfidence);
        const canonicalTerms = Array.from(new Set([...target.canonicalTerms, ...draft.canonicalTerms]));

        if (draftIsCanonical) Object.assign(target, draft);
        allQuotes.delete(target.originalText);
        target.supportingPassages = Array.from(allQuotes);
        target.ordinal = ordinal;
        target.mandatory = mandatory;
        target.explicit = explicit;
        target.extractionConfidence = confidence;
        target.canonicalTerms = canonicalTerms;
    }

    // ── 2. Finalize priority with full-set knowledge ─────────────────────────
    const finalized = merged.map<Draft>(r => {
        const preferred = r.priority === 'preferred';
        const priority: RequirementPriority = preferred
            ? 'preferred'
            : inferPriority({
                text: `${r.originalText} ${r.supportingPassages.join(' ')}`,
                section: r.sourceSection,
                mandatory: r.mandatory,
                preferred: false,
                category: r.category,
                passageCount: 1 + r.supportingPassages.length,
                responsibilityLinks: countResponsibilityLinks(r, merged),
            });
        return { ...r, priority, hardGate: HARD_GATE_CATEGORIES.has(r.category) };
    });

    // ── 3. Stable ordering by JD position ────────────────────────────────────
    finalized.sort((a, b) => {
        const ax = a.sourceCharStart ?? Number.MAX_SAFE_INTEGER;
        const bx = b.sourceCharStart ?? Number.MAX_SAFE_INTEGER;
        if (ax !== bx) return ax - bx;
        return a.ordinal - b.ordinal;
    });
    finalized.forEach((r, i) => { r.ordinal = i; });

    return { requirements: finalized, consolidatedCount: consolidated };
}

/** Display label for a category, used in the UI and in explanations. */
export const CATEGORY_LABELS: Record<RequirementCategory, string> = {
    core_responsibility: 'Core responsibilities',
    technical_skill: 'Technical skills',
    functional_skill: 'Functional skills',
    experience: 'Experience and seniority',
    domain: 'Domain knowledge',
    leadership: 'Leadership',
    communication: 'Communication',
    education: 'Education',
    certification: 'Certifications',
    location: 'Location',
    authorization: 'Work authorization',
    clearance: 'Clearance',
    logistics: 'Logistics',
    preferred: 'Preferred qualifications',
};

/** Category grouping used by the category-coverage bars. */
export const CATEGORY_GROUPS: Array<{ label: string; categories: RequirementCategory[] }> = [
    { label: 'Core responsibilities', categories: ['core_responsibility'] },
    { label: 'Technical skills', categories: ['technical_skill'] },
    { label: 'Experience and seniority', categories: ['experience', 'functional_skill'] },
    { label: 'Domain knowledge', categories: ['domain'] },
    { label: 'Leadership and communication', categories: ['leadership', 'communication'] },
    { label: 'Education and certifications', categories: ['education', 'certification'] },
    { label: 'Logistics and hard requirements', categories: ['location', 'authorization', 'clearance', 'logistics'] },
];
