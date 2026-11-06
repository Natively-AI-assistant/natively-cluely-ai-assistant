// Defensive runtime normalization for LLM- and heuristic-produced resume data.
// TypeScript interfaces describe the desired shape, but model output is untrusted
// JSON and can omit nested arrays required by post-processing and node generation.

import { EMPTY_SKILLS, type StructuredResume } from './types';
import { coerceSkills, flattenSkills } from './skillsUtil';

const strings = (value: unknown): string[] => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)
    : [];

const text = (value: unknown): string => typeof value === 'string' ? value : '';
const nullableText = (value: unknown): string | null => typeof value === 'string' && value ? value : null;

/**
 * Preserve extracted facts while guaranteeing every downstream resume consumer
 * receives its required collection fields. This is intentionally fact-neutral:
 * absent data becomes an empty value rather than inferred content.
 */
export function normalizeStructuredResume(input: StructuredResume | null | undefined): StructuredResume {
    const raw = input && typeof input === 'object' ? input as Record<string, any> : {};
    const identity = raw.identity && typeof raw.identity === 'object' ? raw.identity : {};
    const skills = coerceSkills(raw.skills ?? EMPTY_SKILLS);

    return {
        ...raw,
        identity: {
            ...identity,
            name: text(identity.name) || 'Unknown Candidate',
            email: text(identity.email),
            phone: text(identity.phone),
            location: text(identity.location),
            linkedin: text(identity.linkedin),
            github: text(identity.github),
            website: text(identity.website),
            summary: text(identity.summary),
        },
        skills,
        skills_flat: flattenSkills(skills),
        experience: Array.isArray(raw.experience) ? raw.experience
            .filter((entry: unknown) => entry && typeof entry === 'object')
            .map((entry: any) => ({
                ...entry,
                company: text(entry.company),
                role: text(entry.role),
                start_date: text(entry.start_date),
                end_date: nullableText(entry.end_date),
                bullets: strings(entry.bullets),
            })) : [],
        projects: Array.isArray(raw.projects) ? raw.projects
            .filter((entry: unknown) => entry && typeof entry === 'object')
            .map((entry: any) => ({
                ...entry,
                name: text(entry.name),
                description: text(entry.description),
                technologies: strings(entry.technologies),
                highlights: strings(entry.highlights),
                url: text(entry.url),
            })) : [],
        education: Array.isArray(raw.education) ? raw.education
            .filter((entry: unknown) => entry && typeof entry === 'object')
            .map((entry: any) => ({
                ...entry,
                institution: text(entry.institution),
                degree: text(entry.degree),
                field: text(entry.field),
                start_date: text(entry.start_date),
                end_date: nullableText(entry.end_date),
                gpa: text(entry.gpa),
            })) : [],
        achievements: Array.isArray(raw.achievements) ? raw.achievements
            .filter((entry: unknown) => entry && typeof entry === 'object')
            .map((entry: any) => ({ ...entry, title: text(entry.title), description: text(entry.description), date: text(entry.date) })) : [],
        certifications: Array.isArray(raw.certifications) ? raw.certifications
            .filter((entry: unknown) => entry && typeof entry === 'object')
            .map((entry: any) => ({ ...entry, name: text(entry.name), issuer: text(entry.issuer), date: text(entry.date) })) : [],
        leadership: Array.isArray(raw.leadership) ? raw.leadership
            .filter((entry: unknown) => entry && typeof entry === 'object')
            .map((entry: any) => ({ ...entry, role: text(entry.role), organization: text(entry.organization), description: text(entry.description) })) : [],
    } as StructuredResume;
}
