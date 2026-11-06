// premium/electron/knowledge/roleInsight/JdSourceResolver.ts
//
// Turns whatever the user has into job-description text, and — only where it
// genuinely helps — verifies it against the official posting.
//
// Tavily is used NARROWLY here, on purpose:
//   • extract a JD from a supplied job URL
//   • recover a JD that arrived truncated
//   • confirm the title/location match the official posting
//
// It is never asked about the candidate, never used to infer a skill, and never
// used to generate company research (Company Intel already owns that). Every
// externally retrieved fact keeps its url, title, retrieval date, authority
// tier and the supporting snippet.
//
// Failure is always non-fatal. If Tavily is unavailable, out of credits, or
// returns nothing, the analysis proceeds on the supplied JD and the caller
// records which verification could not be completed — the UI then says so
// rather than silently presenting an unverified analysis as verified.

import { SearchProvider } from '../CompanyResearchEngine';
import { ExternalSourceRef, ResolvedJdText } from './types';

/** Below this, a JD is almost certainly truncated or a stub. */
const TRUNCATION_FLOOR_CHARS = 900;

interface TavilyLike extends SearchProvider {
    extractUrl?(url: string): Promise<{ title: string; content: string } | null>;
}

export function isHttpUrl(value: string): boolean {
    try {
        const u = new URL(value.trim());
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

/** Authority tier for a retrieved URL, given the employer's name. */
export function classifyAuthority(url: string, company: string): ExternalSourceRef['authority'] {
    let host = '';
    try { host = new URL(url).hostname.toLowerCase(); } catch { return 'secondary'; }

    const JOB_BOARDS = [
        'linkedin.com', 'indeed.com', 'glassdoor.com', 'ziprecruiter.com', 'monster.com',
        'dice.com', 'wellfound.com', 'angel.co', 'builtin.com', 'otta.com', 'hired.com',
        'greenhouse.io', 'lever.co', 'ashbyhq.com', 'workday.com', 'myworkdayjobs.com',
        'smartrecruiters.com', 'jobvite.com', 'bamboohr.com', 'workable.com', 'recruitee.com',
    ];

    const companyToken = String(company ?? '')
        .toLowerCase()
        .replace(/\b(inc|llc|ltd|limited|corp|corporation|gmbh|co|plc|the)\b/g, '')
        .replace(/[^a-z0-9]/g, '');

    const isCompanyHost = companyToken.length >= 3 && host.replace(/[^a-z0-9]/g, '').includes(companyToken);

    if (isCompanyHost) {
        return /\b(careers?|jobs?|join|work-with-us|opportunities)\b/.test(url.toLowerCase())
            ? 'official_careers'
            : 'official_site';
    }
    // An ATS host carrying the employer's slug is the employer's own posting.
    if (JOB_BOARDS.some(b => host.endsWith(b))) {
        const atsHosts = ['greenhouse.io', 'lever.co', 'ashbyhq.com', 'myworkdayjobs.com', 'smartrecruiters.com', 'workable.com'];
        if (atsHosts.some(b => host.endsWith(b)) && companyToken.length >= 3 && url.toLowerCase().replace(/[^a-z0-9]/g, '').includes(companyToken)) {
            return 'official_careers';
        }
        return 'job_board';
    }
    if (/\b(docs?|documentation|developer)\b/.test(host)) return 'documentation';
    return 'secondary';
}

const AUTHORITY_RANK: Record<ExternalSourceRef['authority'], number> = {
    official_careers: 0, official_site: 1, documentation: 2, job_board: 3, secondary: 4,
};

function nowIso(): string {
    return new Date().toISOString();
}

/**
 * Resolve JD text from a supplied URL.
 * Returns null (never throws) when extraction is unavailable or fails.
 */
export async function resolveFromUrl(
    url: string,
    provider: TavilyLike | null,
    company: string,
): Promise<ResolvedJdText | null> {
    if (!isHttpUrl(url)) return null;
    if (!provider || typeof provider.extractUrl !== 'function') {
        console.warn('[RoleInsight/JdSource] No extraction-capable search provider configured for job URL.');
        return null;
    }

    const extracted = await provider.extractUrl(url);
    if (!extracted || extracted.content.trim().length < 200) {
        return null;
    }

    const authority = classifyAuthority(url, company);
    return {
        text: extracted.content,
        origin: url,
        sourceKind: 'job_url',
        officialVerified: authority === 'official_careers' || authority === 'official_site',
        externalSources: [{
            url,
            title: extracted.title || url,
            retrievedAt: nowIso(),
            authority,
            snippet: extracted.content.slice(0, 400),
            purpose: 'Job description text extracted from the supplied job URL.',
        }],
        unavailableVerifications: [],
    };
}

export interface VerificationOutcome {
    externalSources: ExternalSourceRef[];
    unavailableVerifications: string[];
    officialVerified: boolean;
    /** Text recovered when the supplied JD looked truncated. Null otherwise. */
    recoveredText: string | null;
}

/**
 * Locate the official posting to (a) confirm title/location and (b) recover the
 * full text when the supplied JD looks truncated.
 *
 * Bounded to at most two provider calls (one search, one extract) so a
 * verification pass can never dominate analysis latency.
 */
export async function verifyAgainstOfficialPosting(
    args: {
        jdText: string;
        title: string;
        company: string;
        location: string;
        provider: TavilyLike | null;
        /** Skip recovery when the JD came from a URL we already extracted fully. */
        allowRecovery: boolean;
    },
): Promise<VerificationOutcome> {
    const { jdText, title, company, location, provider, allowRecovery } = args;
    const unavailable: string[] = [];
    const sources: ExternalSourceRef[] = [];
    const looksTruncated = jdText.trim().length < TRUNCATION_FLOOR_CHARS;

    if (!provider) {
        unavailable.push('The job posting could not be verified against an official source — no web-search key is configured.');
        if (looksTruncated) {
            unavailable.push('The supplied job description looks incomplete and could not be recovered.');
        }
        return { externalSources: [], unavailableVerifications: unavailable, officialVerified: false, recoveredText: null };
    }
    if (!title && !company) {
        unavailable.push('The job description did not name a title or company, so it could not be verified against an official posting.');
        return { externalSources: [], unavailableVerifications: unavailable, officialVerified: false, recoveredText: null };
    }

    const query = [company, title, 'careers job posting'].filter(Boolean).join(' ');
    let results: Array<{ title: string; link: string; snippet: string }> = [];
    try {
        results = await provider.search(query, 6);
    } catch (e: any) {
        // TavilySearchProvider already swallows errors and returns []; this guard
        // covers any other SearchProvider implementation.
        console.warn('[RoleInsight/JdSource] Verification search failed:', e?.message);
    }

    if (results.length === 0) {
        unavailable.push('The official posting could not be located, so the role title and location were not verified.');
        if (looksTruncated) {
            unavailable.push('The supplied job description looks incomplete and could not be recovered.');
        }
        return { externalSources: [], unavailableVerifications: unavailable, officialVerified: false, recoveredText: null };
    }

    // Source priority: official careers → official site → docs → job board → other.
    const ranked = results
        .map(r => ({ ...r, authority: classifyAuthority(r.link, company) }))
        .sort((a, b) => AUTHORITY_RANK[a.authority] - AUTHORITY_RANK[b.authority]);

    const best = ranked[0];
    const officialVerified = best.authority === 'official_careers' || best.authority === 'official_site';

    const blob = `${best.title} ${best.snippet}`.toLowerCase();
    const titleConfirmed = !!title && blob.includes(title.toLowerCase().split(/[,(]/)[0].trim());
    const locationConfirmed = !!location && blob.includes(location.toLowerCase().split(/[,(]/)[0].trim());

    const confirmations: string[] = [];
    if (titleConfirmed) confirmations.push('role title');
    if (locationConfirmed) confirmations.push('location');

    sources.push({
        url: best.link,
        title: best.title,
        retrievedAt: nowIso(),
        authority: best.authority,
        snippet: best.snippet.slice(0, 400),
        purpose: confirmations.length > 0
            ? `Confirmed the ${confirmations.join(' and ')} against this posting.`
            : 'Located as the closest matching public posting; it did not confirm the title or location.',
    });

    if (!titleConfirmed && title) {
        unavailable.push(`The role title "${title}" could not be confirmed against a public posting.`);
    }
    if (!locationConfirmed && location) {
        unavailable.push(`The location "${location}" could not be confirmed against a public posting.`);
    }

    // ── Recovery of a truncated JD ────────────────────────────────────────────
    let recoveredText: string | null = null;
    if (looksTruncated && allowRecovery && typeof provider.extractUrl === 'function') {
        const extracted = await provider.extractUrl(best.link);
        if (extracted && extracted.content.length > jdText.length * 1.5) {
            recoveredText = extracted.content;
            sources.push({
                url: best.link,
                title: extracted.title || best.title,
                retrievedAt: nowIso(),
                authority: best.authority,
                snippet: extracted.content.slice(0, 400),
                purpose: 'Recovered the fuller job-description text after the supplied version appeared truncated.',
            });
        } else {
            unavailable.push('The supplied job description looks incomplete and a fuller version could not be recovered.');
        }
    } else if (looksTruncated) {
        unavailable.push('The supplied job description looks incomplete and could not be recovered.');
    }

    return { externalSources: sources, unavailableVerifications: unavailable, officialVerified, recoveredText };
}
