// electron/knowledge/SalaryIntelligenceEngine.ts
// Generates salary estimates from resume data alone (no JD required)
// and formats salary context blocks for LLM injection

import { StructuredResume, ResumeSalaryEstimate } from './types';
import { NegotiationScript } from './NegotiationEngine';
import { callWithRetry } from './llmUtils';
import { flattenSkills } from './skillsUtil';

/**
 * Lightweight engine that generates salary estimates from resume data.
 * Caches results in-memory per resume identity to avoid repeated LLM calls.
 */
export class SalaryIntelligenceEngine {
    private cachedEstimate: ResumeSalaryEstimate | null = null;
    private cachedResumeKey: string = '';
    private inFlightPromise: Promise<ResumeSalaryEstimate | null> | null = null;

    /**
     * Generate a salary estimate from resume data alone.
     * Uses candidate's location, skills, experience, and latest role to estimate market rate.
     */
    /**
     * The résumé-identity key that scopes the cache AND the DB persistence
     * row (2026-08-02). Public/static so KnowledgeOrchestrator can validate a
     * persisted estimate against the CURRENT active résumé on cold start —
     * a stale row for a replaced résumé must be detected, never served.
     */
    static cacheKeyFor(resume: StructuredResume): string {
        const latestRole = resume.experience?.[0]?.role || 'Professional';
        const latestCompany = resume.experience?.[0]?.company || '';
        return `${resume.identity?.name ?? ''}|${latestRole}|${latestCompany}`;
    }

    /**
     * Seed the in-memory cache from a persisted estimate (2026-08-02 cold-start
     * fix). The caller (orchestrator) has already validated the key against the
     * active résumé; priming here means every downstream reader — legacy salary
     * context AND the V3 PROFILE_FACT source — sees one consistent value.
     */
    primeCache(cacheKey: string, estimate: ResumeSalaryEstimate): void {
        this.cachedEstimate = estimate;
        this.cachedResumeKey = cacheKey;
    }

    async estimateFromResume(
        resume: StructuredResume,
        totalExperienceYears: number,
        generateContentFn: (contents: any[]) => Promise<string>
    ): Promise<ResumeSalaryEstimate | null> {
        // Cache key based on name + role to avoid re-computing
        const cacheKey = SalaryIntelligenceEngine.cacheKeyFor(resume);

        if (this.cachedEstimate && this.cachedResumeKey === cacheKey) {
            console.log('[SalaryIntelligence] Returning cached resume-based salary estimate');
            return this.cachedEstimate;
        }

        // If an estimation is already in-flight for this key, await it instead of duplicating
        if (this.inFlightPromise && this.cachedResumeKey === cacheKey) {
            console.log('[SalaryIntelligence] Awaiting in-flight estimation');
            return this.inFlightPromise;
        }

        this.cachedResumeKey = cacheKey;
        this.inFlightPromise = this._doEstimate(resume, totalExperienceYears, generateContentFn, cacheKey);

        try {
            const result = await this.inFlightPromise;
            return result;
        } finally {
            this.inFlightPromise = null;
        }
    }

    /**
     * Internal: perform the actual LLM-based salary estimation.
     */
    private async _doEstimate(
        resume: StructuredResume,
        totalExperienceYears: number,
        generateContentFn: (contents: any[]) => Promise<string>,
        cacheKey: string
    ): Promise<ResumeSalaryEstimate | null> {
        const latestRole = resume.experience?.[0]?.role || 'Professional';
        const latestCompany = resume.experience?.[0]?.company || '';

        // Extract context from resume
        const location = resume.identity.location || 'Unknown';
        const topSkills = (resume.skills_flat ?? flattenSkills(resume.skills)).slice(0, 10).join(', ') || 'Not specified';

        const experienceSummary = resume.experience?.slice(0, 3).map(e =>
            `${e.role} at ${e.company} (${e.start_date}–${e.end_date || 'Present'})`
        ).join('; ') || 'No experience data';

        const educationSummary = resume.education?.slice(0, 2).map(e =>
            `${e.degree} in ${e.field} from ${e.institution}`
        ).join('; ') || '';

        const prompt = `You are a compensation analyst. Based on the candidate profile below, estimate a fair market salary range for their current level and location.

Candidate Profile:
- Name: ${resume.identity.name}
- Location: ${location}
- Total Experience: ${totalExperienceYears} years
- Current/Latest Role: ${latestRole}${latestCompany ? ` at ${latestCompany}` : ''}
- Key Skills: ${topSkills}
- Experience History: ${experienceSummary}
${educationSummary ? `- Education: ${educationSummary}` : ''}

IMPORTANT:
- Detect the country from the location and use the LOCAL CURRENCY (e.g., INR for India, GBP for UK, EUR for Europe, USD for USA).
- Base the estimate on the local job market for that region, NOT global/US rates.
- Consider the candidate's experience level, skills, and domain.
- Be realistic and conservative.

Return EXACTLY this JSON (no markdown, no fences):
{
  "role": "the role title you are estimating for",
  "location": "normalized city, country",
  "currency": "3-letter currency code",
  "min": 0,
  "max": 0,
  "confidence": "low or medium",
  "justification_factors": ["factor1", "factor2", "factor3"]
}

Rules:
- min and max should be ANNUAL salary as integers (no decimals).
- justification_factors: list 3-5 factors that influenced the estimate (e.g., "5+ years Python experience", "Bangalore tech market", "Senior-level role").
- confidence should be "low" if location is vague, "medium" if you have good location + skills data.
- Return JSON only.`;

        try {
            const response = await callWithRetry(
                () => generateContentFn([{ text: prompt }]),
                30000
            );

            let cleaned = response.trim();
            if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
            if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
            if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);

            const parsed = JSON.parse(cleaned.trim()) as ResumeSalaryEstimate;
            parsed.estimated_at = new Date().toISOString();

            // Validate
            if (!parsed.min || !parsed.max || !parsed.currency) {
                console.warn('[SalaryIntelligence] Invalid estimate, missing required fields');
                return null;
            }

            // Cache it
            this.cachedEstimate = parsed;
            this.cachedResumeKey = cacheKey;

            console.log(`[SalaryIntelligence] Resume-based estimate: ${parsed.currency} ${parsed.min.toLocaleString()}-${parsed.max.toLocaleString()} (${parsed.confidence})`);
            return parsed;
        } catch (error: any) {
            console.error('[SalaryIntelligence] Failed to generate resume-based estimate:', error.message);
            return null;
        }
    }

    /**
     * Format salary intelligence into a context block for LLM injection.
     * Works for both resume-only and JD-based estimates.
     */
    static buildSalaryContextBlock(
        resumeEstimate: ResumeSalaryEstimate | null,
        negotiationScript: NegotiationScript | null,
        hasJD: boolean
    ): string {
        const lines: string[] = [];

        if (resumeEstimate) {
            lines.push(`Market Salary Estimate for ${resumeEstimate.role} in ${resumeEstimate.location}:`);
            lines.push(`  Range: ${resumeEstimate.currency} ${resumeEstimate.min.toLocaleString()} - ${resumeEstimate.max.toLocaleString()} per year`);
            lines.push(`  Confidence: ${resumeEstimate.confidence}`);
            if (resumeEstimate.justification_factors.length > 0) {
                lines.push(`  Key Factors: ${resumeEstimate.justification_factors.join(', ')}`);
            }
            if (!hasJD) {
                lines.push(`  Note: This is a general market estimate based on the candidate's profile. No specific company/role JD was provided.`);
            }
        }

        if (negotiationScript) {
            lines.push('');
            lines.push('Pre-computed Negotiation Script:');
            lines.push(`  Opening: ${negotiationScript.opening_line}`);
            lines.push(`  Justification: ${negotiationScript.justification}`);
            lines.push(`  Counter-offer fallback: ${negotiationScript.counter_offer_fallback}`);
            if (negotiationScript.salary_range) {
                const sr = negotiationScript.salary_range;
                lines.push(`  Company-specific range: ${sr.currency} ${sr.min.toLocaleString()}-${sr.max.toLocaleString()} (confidence: ${sr.confidence})`);
            }
            if (negotiationScript.sources.length > 0) {
                lines.push(`  Sources: ${negotiationScript.sources.join(', ')}`);
            }
        }

        if (lines.length === 0) return '';
        return `<salary_intelligence>\n${lines.join('\n')}\n</salary_intelligence>`;
    }

    /**
     * Clear cached estimate (e.g., when resume is deleted).
     */
    clearCache(): void {
        this.cachedEstimate = null;
        this.cachedResumeKey = '';
    }

    /**
     * Get cached estimate without triggering computation.
     */
    getCachedEstimate(): ResumeSalaryEstimate | null {
        return this.cachedEstimate;
    }
}
