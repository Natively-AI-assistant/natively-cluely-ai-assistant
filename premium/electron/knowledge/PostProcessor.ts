// electron/knowledge/PostProcessor.ts
// Deterministic post-processing of structured resume data

import { StructuredResume, SkillExperienceMap, ProcessedResumeData } from './types';
import { calculateDurationMonths, extractTags } from './DocumentChunker';
import { coerceSkills, flattenSkills } from './skillsUtil';

/**
 * Compute total years of professional experience from all experience entries.
 */
export function computeTotalExperience(resume: StructuredResume): number {
    if (!resume.experience || resume.experience.length === 0) return 0;

    let totalMonths = 0;
    for (const exp of resume.experience) {
        totalMonths += calculateDurationMonths(exp.start_date, exp.end_date);
    }

    return Math.round((totalMonths / 12) * 10) / 10;
}

/**
 * Build a map of skill → months of experience.
 */
export function buildSkillExperienceMap(resume: StructuredResume): SkillExperienceMap {
    const map: SkillExperienceMap = {};

    const flatSkills = resume.skills_flat ?? flattenSkills(resume.skills);
    for (const exp of resume.experience) {
        const duration = calculateDurationMonths(exp.start_date, exp.end_date);
        const allText = (exp.bullets || []).join(' ').toLowerCase();

        for (const skill of flatSkills) {
            const skillLower = skill.toLowerCase();
            if (allText.includes(skillLower)) {
                map[skill] = (map[skill] || 0) + duration;
            }
        }
    }

    if (resume.projects) {
        for (const project of resume.projects) {
            for (const tech of project.technologies || []) {
                const existing = map[tech] || 0;
                if (existing === 0) {
                    map[tech] = 6;
                }
            }
        }
    }

    return map;
}

/**
 * Normalize and sort timeline entries by date.
 */
export function normalizeTimeline(resume: StructuredResume): StructuredResume {
    if (resume.experience) {
        resume.experience.sort((a, b) => {
            const aDate = a.start_date || '0000-00';
            const bDate = b.start_date || '0000-00';
            return bDate.localeCompare(aDate);
        });
    }

    if (resume.education) {
        resume.education.sort((a, b) => {
            const aDate = a.start_date || '0000-00';
            const bDate = b.start_date || '0000-00';
            return bDate.localeCompare(aDate);
        });
    }

    // Normalize categorized skills (coerce handles legacy flat arrays + dedupes
    // each bucket) and keep the derived flat list in sync.
    resume.skills = coerceSkills(resume.skills);
    resume.skills_flat = flattenSkills(resume.skills);

    return resume;
}

export function deduplicateSkills(skills: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const skill of skills) {
        const key = skill.toLowerCase().trim();
        if (!seen.has(key) && key.length > 0) {
            seen.add(key);
            result.push(skill.trim());
        }
    }

    return result;
}

/**
 * Full post-processing pipeline for Resumes specifically.
 */
export function processResume(resume: StructuredResume): ProcessedResumeData {
    console.log('[PostProcessor] Running deterministic post-processing...');

    // Deep clone to avoid mutating the original object
    const cloned: StructuredResume = JSON.parse(JSON.stringify(resume));
    const normalized = normalizeTimeline(cloned);
    const totalExperienceYears = computeTotalExperience(normalized);
    const skillExperienceMap = buildSkillExperienceMap(normalized);

    console.log(`[PostProcessor] Total experience: ${totalExperienceYears} years`);
    console.log(`[PostProcessor] Skills mapped: ${Object.keys(skillExperienceMap).length}`);

    return {
        structured: normalized,
        totalExperienceYears,
        skillExperienceMap
    };
}
