// electron/knowledge/GapAnalysisEngine.ts
// Diffs JD requirements vs resume skills and pre-generates pivot scripts

import { StructuredResume, StructuredJD, SkillExperienceMap, SkillGap, GapAnalysisResult } from './types';
import { extractJSONArray, callWithTimeout } from './llmUtils';
import { flattenSkills } from './skillsUtil';

/**
 * Analyze gaps between a resume and a job description.
 * First pass: deterministic string matching.
 * Second pass: LLM generates pivot scripts for missing/weak skills.
 */
export async function analyzeGaps(
    resume: StructuredResume,
    jd: StructuredJD,
    skillExperienceMap: SkillExperienceMap,
    generateContentFn: (contents: any[]) => Promise<string>
): Promise<GapAnalysisResult> {
    console.log('[GapAnalysisEngine] Starting gap analysis...');

    // Normalize candidate skills for matching
    const candidateSkillsLower = new Set(
        (resume.skills_flat ?? flattenSkills(resume.skills)).map(s => s.toLowerCase().trim())
    );

    // Also include skills inferred from experience bullets
    const bulletText = (resume.experience || [])
        .flatMap(e => e.bullets)
        .join(' ')
        .toLowerCase();

    // Collect all required skills from JD. `requirements` is prose and has to be
    // mined for the skills it names — see buildJdSkillUniverse.
    const { jdSkills, nonSkillRequirements } = buildJdSkillUniverse(
        jd,
        resume.skills_flat ?? flattenSkills(resume.skills),
    );

    const matched: string[] = [];
    const rawGaps: { skill: string; gap_type: 'missing' | 'weak' }[] = [];

    for (const skill of jdSkills) {
        const skillLower = skill.toLowerCase().trim();
        const experienceMonths = findSkillExperience(skillLower, skillExperienceMap);

        if (candidateSkillsLower.has(skillLower) || experienceMonths > 6) {
            matched.push(skill);
        } else if (bulletText.includes(skillLower) || experienceMonths > 0) {
            rawGaps.push({ skill, gap_type: 'weak' });
        } else {
            rawGaps.push({ skill, gap_type: 'missing' });
        }
    }

    const totalSkills = matched.length + rawGaps.length;
    const matchPercentage = totalSkills > 0 ? Math.round((matched.length / totalSkills) * 100) : 100;

    console.log(`[GapAnalysisEngine] Match: ${matched.length}/${totalSkills} (${matchPercentage}%), Gaps: ${rawGaps.length}`);
    if (nonSkillRequirements.length > 0) {
        // Logged, not silently dropped: these ARE real requirements, they are
        // just not skills, so they belong in neither the match percentage nor a
        // "pivot script" for a skill the candidate lacks.
        console.log(`[GapAnalysisEngine] ${nonSkillRequirements.length} non-skill requirement(s) excluded from the skill match: `
            + nonSkillRequirements.map(r => JSON.stringify(r)).join(', '));
    }

    // Generate pivot scripts for gaps via LLM
    let gaps: SkillGap[] = [];
    if (rawGaps.length > 0) {
        gaps = await generatePivotScripts(rawGaps, resume, generateContentFn);
    }

    console.log(`[GapAnalysisEngine] ✅ Gap analysis complete`);

    return {
        matched_skills: matched,
        gaps,
        match_percentage: matchPercentage
    };
}

/** Longest an entry can be and still plausibly be a skill token, in words. */
const MAX_SKILL_TOKEN_WORDS = 4;

/**
 * Is this JD entry a skill TOKEN ("Kubernetes", "Spring Boot", "Protocol
 * Buffers") rather than a prose requirement ("Strong debugging and
 * problem-solving skills")? Sentence punctuation and length are the only
 * signals available without a skill vocabulary, and both are cheap.
 */
function isSkillToken(entry: string): boolean {
    const trimmed = entry.trim();
    if (!trimmed) return false;
    if (trimmed.split(/\s+/).length > MAX_SKILL_TOKEN_WORDS) return false;
    // ';' and ':' are always prose. A '.' only counts when it ENDS a word —
    // otherwise ".NET" and "Node.js" would be misread as sentences.
    if (/[;:]/.test(trimmed)) return false;
    if (/\.(\s|$)/.test(trimmed)) return false;
    return true;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Does `haystack` name `token` as a standalone term? `\b` is useless on either
 * side of "C++", ".NET" or "Node.js", so the boundary is expressed as "not an
 * identifier-ish character" instead, which handles those and still stops "Go"
 * from matching "Google" or "algorithms".
 */
function mentionsToken(haystack: string, token: string): boolean {
    const needle = token.trim();
    if (!needle) return false;
    try {
        return new RegExp(`(?<![a-z0-9+#.])${escapeRegExp(needle)}(?![a-z0-9+#])`, 'i').test(haystack);
    } catch {
        // A token that will not compile into a pattern falls back to plain
        // containment rather than dropping the skill entirely.
        return haystack.toLowerCase().includes(needle.toLowerCase());
    }
}

/** First spelling wins; later case-variants of the same token are dropped. */
function dedupeByLower(values: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of values) {
        const key = value.toLowerCase().trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(value.trim());
    }
    return out;
}

/**
 * Build the set of JD skills the gap analysis scores against.
 *
 * A JD's `technologies` are skill tokens ("Java", "Kubernetes"). Its
 * `requirements` are whatever the JD's Requirements section actually says —
 * ordinary prose, because the extraction prompt asks for no particular shape
 * and no real job posting writes that section as a skill list:
 *
 *   "Bachelor's degree in Computer Science or related field"
 *   "2+ years of professional software development experience"
 *   "Strong programming skills in Java, C++, Go, Python, or Kotlin"
 *
 * Both arrays used to be concatenated into one list and tested with
 * `candidateSkillsLower.has(...)`, an exact Set lookup. A sentence can never
 * satisfy that, so EVERY prose requirement scored as a missing skill by
 * construction. It padded the denominator (a live Google SWE II JD scored
 * 3/26 = 12% where its technology tokens alone were 3/19 = 16%) and then had an
 * LLM "pivot script" generated for it — coaching the candidate on how to talk
 * around not holding a Computer Science degree.
 *
 * So prose is mined for the skill tokens it names (against the JD's own
 * technologies plus the candidate's skills) instead of being treated as one
 * atomic skill. Prose naming none is returned separately as a non-skill
 * requirement: a degree or a years-of-experience bar is a real requirement, but
 * it is not a skill, and this is a skill gap analysis.
 */
export function buildJdSkillUniverse(
    jd: StructuredJD,
    candidateSkills: string[],
): { jdSkills: string[]; nonSkillRequirements: string[] } {
    const technologies = (jd.technologies || [])
        .filter((t): t is string => typeof t === 'string')
        .map(t => t.trim())
        .filter(Boolean);

    // Vocabulary for mining prose: the JD's own technology tokens plus the
    // candidate's skills, so a JD that lists no technologies at all still
    // produces a comparable set rather than an empty one.
    const vocabulary = dedupeByLower([...technologies, ...candidateSkills]);

    const jdSkills: string[] = [...technologies];
    const nonSkillRequirements: string[] = [];

    for (const requirement of jd.requirements || []) {
        if (typeof requirement !== 'string') continue;
        const entry = requirement.trim();
        if (!entry) continue;

        if (isSkillToken(entry)) {
            jdSkills.push(entry);
            continue;
        }

        const mined = vocabulary.filter(term => mentionsToken(entry, term));
        if (mined.length === 0) {
            nonSkillRequirements.push(entry);
            continue;
        }
        jdSkills.push(...mined);
    }

    // Deduplicate: mining necessarily re-derives tokens already present in
    // `technologies`, and before this fix a token listed in BOTH arrays was
    // scored twice.
    return { jdSkills: dedupeByLower(jdSkills), nonSkillRequirements };
}

/**
 * Find experience months for a skill, with fuzzy matching.
 */
function findSkillExperience(skillLower: string, map: SkillExperienceMap): number {
    // Direct match
    for (const [key, months] of Object.entries(map)) {
        if (key.toLowerCase() === skillLower) return months;
    }
    // Partial match
    for (const [key, months] of Object.entries(map)) {
        if (key.toLowerCase().includes(skillLower) || skillLower.includes(key.toLowerCase())) {
            return months;
        }
    }
    return 0;
}

/**
 * Use LLM to generate pivot scripts for each gap.
 */
async function generatePivotScripts(
    rawGaps: { skill: string; gap_type: 'missing' | 'weak' }[],
    resume: StructuredResume,
    generateContentFn: (contents: any[]) => Promise<string>
): Promise<SkillGap[]> {
    const candidateSkills = (resume.skills_flat ?? flattenSkills(resume.skills)).join(', ');
    const topExperience = (resume.experience || []).slice(0, 3).map(e =>
        `${e.role} at ${e.company}: ${e.bullets.slice(0, 2).join('; ')}`
    ).join('\n');

    const gapList = rawGaps.map((g, i) =>
        `${i + 1}. "${g.skill}" (${g.gap_type})`
    ).join('\n');

    const prompt = `You are a career coach helping a candidate handle skill gap questions in interviews.

Candidate's Skills: ${candidateSkills}
Top Experience:
${topExperience}

For each missing/weak skill below, generate a realistic "pivot script" — a confident 2-3 sentence response that:
- Acknowledges the gap honestly (if missing) or positions limited experience positively (if weak)
- Pivots to specific transferable skills from the candidate's actual background
- Shows willingness and ability to learn quickly

Gaps:
${gapList}

Return a JSON array (no markdown fences):
[
  {
    "index": 1,
    "pivot_script": "...",
    "transferable_skills": ["skill1", "skill2"]
  }
]

Return ONLY the JSON array.`;

    try {
        const response = await callWithTimeout(
            () => generateContentFn([{ text: prompt }]),
            30000
        );
        const parsed = extractJSONArray(response);

        return parsed.map((item, idx) => {
            const gap = rawGaps[idx]; // Trust array order, not LLM-reported index
            return {
                skill: gap.skill,
                gap_type: gap.gap_type,
                pivot_script: item.pivot_script || '',
                transferable_skills: item.transferable_skills || []
            };
        });
    } catch (error: any) {
        console.error('[GapAnalysisEngine] Failed to generate pivot scripts:', error.message);
        // Return gaps without scripts as fallback
        return rawGaps.map(g => ({
            skill: g.skill,
            gap_type: g.gap_type,
            pivot_script: `While I haven't worked extensively with ${g.skill}, I have strong experience with related technologies and can ramp up quickly.`,
            transferable_skills: [] as string[]
        }));
    }
}
