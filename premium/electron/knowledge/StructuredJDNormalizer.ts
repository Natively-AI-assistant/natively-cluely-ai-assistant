// Defensive runtime normalization for LLM- and heuristic-produced JD data.
// Mirrors StructuredResumeNormalizer.ts: TypeScript interfaces describe the
// desired shape, but model output is untrusted JSON.
//
// Bug fix 2026-07-28 (code review): without this, a stray string where an
// array field belongs (e.g. `requirements: "React, Node"`) does not throw —
// it silently corrupts data downstream. `[...jd.requirements, ...]` splits a
// string into single-character array elements, so DocumentChunker would
// persist one fake "requirement" context_node PER CHARACTER, and
// GapAnalysisEngine would report per-character skill gaps to the user.
// StructuredExtractor's own inline defaults (`jd.requirements = jd.requirements
// || []`) only guard falsy values, not wrong types, and don't run at all on
// the heuristic-fallback / degenerate-JD-override paths in
// KnowledgeOrchestrator.ingestDocument — this runs unconditionally after
// extraction, regardless of which of the three paths produced the data.

import { VALID_JD_LEVELS, VALID_JD_EMPLOYMENT_TYPES, type StructuredJD } from './types';

const strings = (value: unknown): string[] => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)
    : [];

const text = (value: unknown): string => typeof value === 'string' ? value : '';

/**
 * Preserve extracted facts while guaranteeing every downstream JD consumer
 * receives its required collection fields as real arrays and its enum
 * fields as valid values. Fact-neutral: absent/malformed data becomes a
 * safe default rather than inferred content.
 */
export function normalizeStructuredJD(input: StructuredJD | null | undefined): StructuredJD {
    const raw = input && typeof input === 'object' ? input as Record<string, any> : {};

    return {
        ...raw,
        title: text(raw.title) || 'Unknown Role',
        company: text(raw.company),
        location: text(raw.location) || 'Unknown Location',
        description_summary: text(raw.description_summary),
        level: VALID_JD_LEVELS.includes(raw.level) ? raw.level : 'mid',
        employment_type: VALID_JD_EMPLOYMENT_TYPES.includes(raw.employment_type) ? raw.employment_type : 'full_time',
        min_years_experience: typeof raw.min_years_experience === 'number' && Number.isFinite(raw.min_years_experience)
            ? raw.min_years_experience
            : 0,
        compensation_hint: text(raw.compensation_hint),
        requirements: strings(raw.requirements),
        nice_to_haves: strings(raw.nice_to_haves),
        responsibilities: strings(raw.responsibilities),
        technologies: strings(raw.technologies),
        keywords: strings(raw.keywords),
    } as StructuredJD;
}
