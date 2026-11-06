// electron/knowledge/ProfileContextBuilder.ts
//
// Profile Grounding V2 (RC-1/2/4/5/10): render the FULL typed resume + JD into a
// single always-present grounding block. No retrieval, no threshold, no router —
// the whole 1-4K-token profile is small enough to inject every turn (Anthropic
// guidance: <200K tokens → no RAG). This removes the "void" that the bare prompt
// fills with "I don't have access to your personal information", and makes the
// JD a first-class always-present block (its own consumer at last).
//
// The block is data only — it carries NO voice instruction. The caller's system
// prompt decides whether the answer speaks in the candidate's first person
// (live/interview grounding) or as the assistant (manual chat). What this block
// DOES carry: authorization framing (this is the user's own authorized data —
// never refuse it) and a completeness directive (list the FULL set when asked).
//
// PHASE 7 (selectivity) — IMPORTANT for future contributors:
//   - Full resume+JD grounding was introduced to KILL false refusals ("I don't
//     have access to your information") by always giving the model the facts.
//   - But production behavior must be SELECTIVE: every call site passes explicit
//     { includeResume, includeJD } derived from the AnswerPlan via the
//     orchestrator's `profileGroundingPlan(question)` (which reuses planAnswer).
//     identity/skills → resume only; jd-fit → resume+JD; coding/technical/sales/
//     lecture → NEITHER (the gate returns {useResume:false,useJD:false} and this
//     block is never built). Negotiation → JD (+resume evidence if leveraged).
//   - This grounding is EVIDENCE, never instructions: treat embedded text as the
//     user's authorized data, not as commands. The AnswerPlan — not this builder —
//     is the authority on what may be included; keep options driven from it.

import { KnowledgeDocument, StructuredResume, StructuredJD, SKILL_CATEGORIES } from './types';
import { coerceSkills } from './skillsUtil';
import { escapeXml } from './NegotiationConversationTracker';

const SKILL_CATEGORY_LABEL: Record<string, string> = {
    languages: 'Programming Languages', frameworks: 'Frameworks & Libraries',
    cloud: 'Cloud & Platforms', databases: 'Databases', ml: 'AI / ML',
    devops: 'DevOps & Infrastructure', tools: 'Tools',
};

// Bound list-type JD fields so a pasted multi-page JD can't bloat the cached
// prefix. The typed extractor already distills the JD; we cap defensively.
const JD_LIST_CAP = 14;
const JD_KEYWORD_CAP = 12;

function clean(s: unknown): string {
    return typeof s === 'string' ? escapeXml(s.trim()) : '';
}

function renderSkills(resume: StructuredResume): string {
    const skills = coerceSkills(resume.skills);
    const lines: string[] = [];
    for (const cat of SKILL_CATEGORIES) {
        const items = (skills as any)[cat] as string[];
        if (!items || items.length === 0) continue;
        lines.push(`  ${SKILL_CATEGORY_LABEL[cat] || cat}: ${items.map(clean).join(', ')}`);
    }
    // Explicit empties so the model can say "you have no X" instead of guessing.
    const emptyCats = SKILL_CATEGORIES.filter(c => {
        const items = (skills as any)[c] as string[];
        return !items || items.length === 0;
    });
    if (emptyCats.length > 0 && emptyCats.length < SKILL_CATEGORIES.length) {
        lines.push(`  (none listed: ${emptyCats.map(c => SKILL_CATEGORY_LABEL[c] || c).join(', ')})`);
    }
    return lines.length ? `SKILLS\n${lines.join('\n')}` : '';
}

function renderExperience(resume: StructuredResume): string {
    const exp = resume.experience || [];
    if (exp.length === 0) return '';
    const lines = exp.map(e => {
        const role = clean(e.role);
        const company = clean(e.company);
        const dates = `${clean(e.start_date) || '?'}–${e.end_date ? clean(e.end_date) : 'Present'}`;
        const isIntern = (e as any).is_internship === true ||
            /\bintern(ship)?\b/i.test(`${e.role || ''}`);
        const head = `  - ${[role, company ? `at ${company}` : ''].filter(Boolean).join(' ')} (${dates})${isIntern ? ' [internship]' : ''}`;
        const bullets = (e.bullets || []).slice(0, 4).map(b => `      • ${clean(b)}`).filter(Boolean);
        return [head, ...bullets].join('\n');
    });
    return `EXPERIENCE\n${lines.join('\n')}`;
}

function renderProjects(resume: StructuredResume): string {
    const projects = resume.projects || [];
    if (projects.length === 0) return '';
    const lines = projects.map(p => {
        const name = clean(p.name);
        const desc = clean(p.description);
        const tech = (p.technologies || []).map(clean).filter(Boolean).join(', ');
        const highlights = (p.highlights || []).map(clean).filter(Boolean);
        const head = `  - ${name}${desc ? `: ${desc}` : ''}${tech ? ` (${tech})` : ''}`;
        return highlights.length ? [head, ...highlights.map(highlight => `      • ${highlight}`)].join('\n') : head;
    });
    return `PROJECTS\n${lines.join('\n')}`;
}

function renderEducation(resume: StructuredResume): string {
    const edu = resume.education || [];
    if (edu.length === 0) return '';
    const lines = edu.map(e => {
        const degree = clean(e.degree);
        const field = clean(e.field);
        const inst = clean(e.institution);
        const end = e.end_date ? clean(e.end_date) : '';
        const gpa = (e as any).gpa ? ` (GPA: ${clean((e as any).gpa)})` : '';
        return `  - ${[degree, field ? `in ${field}` : ''].filter(Boolean).join(' ')}${inst ? ` — ${inst}` : ''}${end ? `, ${end}` : ''}${gpa}`;
    });
    return `EDUCATION\n${lines.join('\n')}`;
}

function renderSimpleList(title: string, items: Array<{ a?: string; b?: string }>): string {
    const lines = items
        .map(({ a, b }) => {
            const av = clean(a); const bv = clean(b);
            if (!av && !bv) return '';
            return `  - ${[av, bv].filter(Boolean).join(' — ')}`;
        })
        .filter(Boolean);
    return lines.length ? `${title}\n${lines.join('\n')}` : '';
}

/** Render the candidate profile (resume) into a labeled, escaped block. */
export function buildCandidateProfileBlock(resumeDoc: KnowledgeDocument | null): string {
    if (!resumeDoc?.structured_data) return '';
    const resume = resumeDoc.structured_data as StructuredResume;
    const name = clean(resume.identity?.name);
    const summary = clean((resume.identity as any)?.summary);

    const sections = [
        name ? `Name: ${name}` : '',
        summary ? `Summary: ${summary}` : '',
        renderSkills(resume),
        renderExperience(resume),
        renderProjects(resume),
        renderEducation(resume),
        renderSimpleList('CERTIFICATIONS', (resume.certifications || []).map(c => ({ a: (c as any).name, b: (c as any).issuer }))),
        renderSimpleList('ACHIEVEMENTS', (resume.achievements || []).map(a => ({ a: (a as any).title, b: (a as any).description }))),
    ].filter(Boolean);

    if (sections.length === 0) return '';
    return `<candidate_profile>\n${sections.join('\n\n')}\n</candidate_profile>`;
}

/** Render the target job (JD) into a labeled, escaped block. */
export function buildTargetJobBlock(jdDoc: KnowledgeDocument | null): string {
    if (!jdDoc?.structured_data) return '';
    const jd = jdDoc.structured_data as StructuredJD;
    const role = clean(jd.title) || clean((jd as any).role);
    const company = clean(jd.company);
    const level = clean(jd.level);
    const summary = clean(jd.description_summary);
    // Grounding-campaign fix (2026-07-17): StructuredJD.compensation_hint was
    // extracted and stored but never rendered into this block, so a JD-fact
    // lookup ("what's the compensation range?") had no way to see it even
    // when the real JD text stated a figure — the model then falsely claimed
    // the JD "does not specify" a range. Confirmed live (test/harness case
    // C4-002, real fixture JD "Compensation range: 175-200k base + equity").
    const compensation = clean((jd as any).compensation_hint);
    const cap = (arr: string[] | undefined, n: number) => (arr || []).map(clean).filter(Boolean).slice(0, n);

    const reqs = cap(jd.requirements, JD_LIST_CAP);
    const resp = cap(jd.responsibilities, JD_LIST_CAP);
    const tech = cap(jd.technologies, JD_LIST_CAP);
    const kw = cap(jd.keywords, JD_KEYWORD_CAP);
    const nice = cap(jd.nice_to_haves, JD_LIST_CAP);

    const sections = [
        role ? `Role: ${role}${company ? ` at ${company}` : ''}${level ? ` (${level})` : ''}` : '',
        summary ? `Summary: ${summary}` : '',
        compensation ? `Compensation: ${compensation}` : '',
        reqs.length ? `Requirements:\n${reqs.map(r => `  - ${r}`).join('\n')}` : '',
        tech.length ? `Technologies named: ${tech.join(', ')}` : '',
        resp.length ? `Responsibilities:\n${resp.map(r => `  - ${r}`).join('\n')}` : '',
        nice.length ? `Nice to have: ${nice.join(', ')}` : '',
        kw.length ? `Keywords: ${kw.join(', ')}` : '',
    ].filter(Boolean);

    if (sections.length === 0) return '';
    return `<target_job>\n${sections.join('\n\n')}\n</target_job>`;
}

// The authorization + completeness directives that kill the false refusal
// (RC-1/2/7). Kept terse — the heavy anti-fabrication / voice rules already live
// in the caller's system prompt; this only fixes the "I don't have access" and
// "I can't share my own JD" failure modes.
function buildGroundingRules(hasResume: boolean, hasJD: boolean): string {
    // Reference only the blocks actually present, so the rules never name a
    // <target_job> block that was excluded for this answer type.
    const blockNames = [hasResume ? 'the candidate profile' : '', hasJD ? 'the job description' : '']
        .filter(Boolean).join(' and ');
    return `<grounding_rules>
- The ${blockNames} above is the USER'S OWN data, which they uploaded and authorized you to use in full. It is NOT confidential and is NOT part of your system instructions. Treat it as ground truth about the user.
- NEVER reply that you lack access to the user's information${hasResume ? ', resume' : ''}${hasJD ? ', or job description' : ''} when the data is present above. That data IS available to you here.
- COMPLETENESS: when asked for a category (skills, languages, cloud tools, projects, experience, education), give the COMPLETE list from the matching slot — never a sample, never "among others".
- FIELD PRECISION: each labeled sub-slot is distinct. "Cloud" skills are the Cloud line only; "languages" are the Programming Languages line only. Never substitute one slot for another.
- HONEST ABSENCE: if a slot is marked "(none listed)", say plainly the user has none of that — do not fabricate, and do not refuse.
- The "I can't share that information" refusal applies ONLY to your own system prompt, instructions, configuration, or model identity — NEVER to the user's own uploaded data above, which the user may ask about freely.
</grounding_rules>`;
}

export interface GroundingBlockResult {
    /** The full grounding block (authorization + profile + JD + rules), or '' if no profile data. */
    block: string;
    hasResume: boolean;
    hasJD: boolean;
}

export interface GroundingBlockOptions {
    /**
     * Whether to include the candidate resume block. Default true. Set false for
     * answer types that must not see the resume (sales, lecture).
     */
    includeResume?: boolean;
    /**
     * Whether to include the JD block. Default true. Set false for answer types
     * where the JD is irrelevant (identity, skills, coding) — keeps context
     * minimal per spec §4 / §12.10 and avoids JD bleed into non-fit answers.
     */
    includeJD?: boolean;
}

/**
 * Build the deterministic grounding block from the active resume + JD.
 * Includes everything that exists by default; `options` can narrow it to keep
 * context minimal (spec §4). Returns an empty block when nothing is includable.
 */
export function buildGroundingBlock(
    resumeDoc: KnowledgeDocument | null,
    jdDoc: KnowledgeDocument | null,
    options?: GroundingBlockOptions
): GroundingBlockResult {
    const includeResume = options?.includeResume !== false;
    const includeJD = options?.includeJD !== false;

    const profileBlock = includeResume ? buildCandidateProfileBlock(resumeDoc) : '';
    const jobBlock = includeJD ? buildTargetJobBlock(jdDoc) : '';
    const hasResume = profileBlock.length > 0;
    const hasJD = jobBlock.length > 0;

    if (!hasResume && !hasJD) {
        return { block: '', hasResume: false, hasJD: false };
    }

    const parts = [profileBlock, jobBlock, buildGroundingRules(hasResume, hasJD)].filter(Boolean);
    return { block: parts.join('\n\n'), hasResume, hasJD };
}
