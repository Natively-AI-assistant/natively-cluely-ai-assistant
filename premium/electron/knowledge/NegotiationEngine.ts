// electron/knowledge/NegotiationEngine.ts
// Generates negotiation scripts using resume achievements, JD context, and company salary data

import { KnowledgeDocument, StructuredResume, StructuredJD, CompanyDossier } from './types';
import { extractJsonObject } from './jsonExtract';
import { flattenSkills } from './skillsUtil';

export interface NegotiationScript {
    opening_line: string;
    justification: string;
    counter_offer_fallback: string;
    salary_range: { min: number; max: number; currency: string; confidence: string } | null;
    sources: string[];
}

// ─── Location → currency inference ──────────────────────────────────────────
// Cheap heuristic so the script defaults to the role's local currency instead
// of always falling back to USD. The LLM is also told the inferred currency
// in the prompt and instructed to quote the ask in it.
const COUNTRY_CURRENCY: Record<string, { code: string; symbol: string; name: string }> = {
    india: { code: 'INR', symbol: '₹', name: 'Indian Rupees' },
    uk: { code: 'GBP', symbol: '£', name: 'British Pounds' },
    'united kingdom': { code: 'GBP', symbol: '£', name: 'British Pounds' },
    britain: { code: 'GBP', symbol: '£', name: 'British Pounds' },
    england: { code: 'GBP', symbol: '£', name: 'British Pounds' },
    germany: { code: 'EUR', symbol: '€', name: 'Euros' },
    france: { code: 'EUR', symbol: '€', name: 'Euros' },
    spain: { code: 'EUR', symbol: '€', name: 'Euros' },
    italy: { code: 'EUR', symbol: '€', name: 'Euros' },
    netherlands: { code: 'EUR', symbol: '€', name: 'Euros' },
    ireland: { code: 'EUR', symbol: '€', name: 'Euros' },
    portugal: { code: 'EUR', symbol: '€', name: 'Euros' },
    canada: { code: 'CAD', symbol: 'C$', name: 'Canadian Dollars' },
    australia: { code: 'AUD', symbol: 'A$', name: 'Australian Dollars' },
    'new zealand': { code: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollars' },
    singapore: { code: 'SGD', symbol: 'S$', name: 'Singapore Dollars' },
    japan: { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
    china: { code: 'CNY', symbol: '¥', name: 'Chinese Yuan' },
    'hong kong': { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollars' },
    'south korea': { code: 'KRW', symbol: '₩', name: 'Korean Won' },
    korea: { code: 'KRW', symbol: '₩', name: 'Korean Won' },
    brazil: { code: 'BRL', symbol: 'R$', name: 'Brazilian Real' },
    mexico: { code: 'MXN', symbol: 'MX$', name: 'Mexican Pesos' },
    'south africa': { code: 'ZAR', symbol: 'R', name: 'South African Rand' },
    uae: { code: 'AED', symbol: 'AED', name: 'UAE Dirhams' },
    'united arab emirates': { code: 'AED', symbol: 'AED', name: 'UAE Dirhams' },
    dubai: { code: 'AED', symbol: 'AED', name: 'UAE Dirhams' },
    'saudi arabia': { code: 'SAR', symbol: 'SAR', name: 'Saudi Riyals' },
    switzerland: { code: 'CHF', symbol: 'CHF', name: 'Swiss Francs' },
    sweden: { code: 'SEK', symbol: 'kr', name: 'Swedish Krona' },
    norway: { code: 'NOK', symbol: 'kr', name: 'Norwegian Krone' },
    denmark: { code: 'DKK', symbol: 'kr', name: 'Danish Krone' },
    poland: { code: 'PLN', symbol: 'zł', name: 'Polish Złoty' },
};

// City/region tokens that strongly imply a country (covers JDs that only
// mention a city like "Bengaluru" without the country).
const CITY_TO_COUNTRY: Record<string, string> = {
    // India
    bengaluru: 'india', bangalore: 'india', mumbai: 'india', bombay: 'india',
    delhi: 'india', 'new delhi': 'india', gurgaon: 'india', gurugram: 'india',
    noida: 'india', hyderabad: 'india', pune: 'india', chennai: 'india',
    madras: 'india', kolkata: 'india', calcutta: 'india', ahmedabad: 'india',
    kochi: 'india', cochin: 'india', jaipur: 'india', chandigarh: 'india',
    // UK
    london: 'uk', manchester: 'uk', edinburgh: 'uk', glasgow: 'uk',
    birmingham: 'uk', bristol: 'uk', cambridge: 'uk', oxford: 'uk',
    // EU
    berlin: 'germany', munich: 'germany', hamburg: 'germany',
    paris: 'france', lyon: 'france', amsterdam: 'netherlands',
    rotterdam: 'netherlands', dublin: 'ireland', madrid: 'spain',
    barcelona: 'spain', milan: 'italy', rome: 'italy',
    // Canada
    toronto: 'canada', vancouver: 'canada', montreal: 'canada',
    ottawa: 'canada', calgary: 'canada',
    // Australia
    sydney: 'australia', melbourne: 'australia', brisbane: 'australia',
    perth: 'australia', auckland: 'new zealand', wellington: 'new zealand',
    // Asia
    tokyo: 'japan', osaka: 'japan', kyoto: 'japan',
    beijing: 'china', shanghai: 'china', shenzhen: 'china',
    seoul: 'south korea', busan: 'south korea',
    // Other
    'são paulo': 'brazil', 'sao paulo': 'brazil', rio: 'brazil',
    zurich: 'switzerland', geneva: 'switzerland',
    stockholm: 'sweden', oslo: 'norway', copenhagen: 'denmark',
    warsaw: 'poland',
};

function inferCurrency(location?: string, _company?: string): { code: string; symbol: string; name: string } {
    const hay = (location ?? '').toLowerCase();
    if (!hay) return { code: 'USD', symbol: '$', name: 'US Dollars' };

    // Direct country match
    for (const country of Object.keys(COUNTRY_CURRENCY)) {
        if (hay.includes(country)) return COUNTRY_CURRENCY[country];
    }
    // City match → country
    for (const city of Object.keys(CITY_TO_COUNTRY)) {
        if (hay.includes(city)) return COUNTRY_CURRENCY[CITY_TO_COUNTRY[city]];
    }
    // US fallback (also catches "remote — US", "USA", etc.)
    if (/\b(us|usa|united states|america|new york|nyc|san francisco|sf|seattle|austin|boston|chicago|denver|los angeles)\b/.test(hay)) {
        return { code: 'USD', symbol: '$', name: 'US Dollars' };
    }
    return { code: 'USD', symbol: '$', name: 'US Dollars' };
}

/**
 * Generate a negotiation script using LLM.
 */
export async function generateNegotiationScript(
    resumeDoc: KnowledgeDocument,
    jdDoc: KnowledgeDocument | null,
    dossier: CompanyDossier | null,
    generateContentFn: (contents: any[]) => Promise<string>
): Promise<NegotiationScript | null> {
    const resume = resumeDoc.structured_data as StructuredResume;
    const name = resume.identity.name;

    // Build resume highlights
    const topExperience = resume.experience?.slice(0, 3).map(e =>
        `${e.role} at ${e.company} (${e.bullets?.slice(0, 2).join('; ')})`
    ).join('\n') || 'No experience data';

    const topSkills = (resume.skills_flat ?? flattenSkills(resume.skills)).slice(0, 8).join(', ') || 'Not specified';

    // Build JD context + infer local currency from JD location/company.
    // This is the authoritative currency for the negotiation — overrides
    // any USD default when the role is clearly in India, UK, EU, etc.
    let jdContext = '';
    let jdLocation: string | undefined;
    let jdCompany: string | undefined;
    if (jdDoc) {
        const jd = jdDoc.structured_data as StructuredJD;
        jdLocation = jd.location;
        jdCompany = jd.company;
        jdContext = `Target Role: ${jd.title} at ${jd.company} (${jd.level || 'mid'}-level, ${jd.location || 'unspecified location'})`;
    }
    const localCurrency = inferCurrency(jdLocation, jdCompany);

    // Build salary context
    let salaryContext = `No external salary data available. Use ${localCurrency.code} (${localCurrency.name}) market norms for this role and level.`;
    let salaryRange: NegotiationScript['salary_range'] = null;
    const sources: string[] = [];

    if (dossier?.salary_estimates && dossier.salary_estimates.length > 0) {
        const estimates = dossier.salary_estimates;
        const avgMin = Math.round(estimates.reduce((s, e) => s + e.min, 0) / estimates.length);
        const avgMax = Math.round(estimates.reduce((s, e) => s + e.max, 0) / estimates.length);
        // Trust the dossier currency only if it's plausible for the location.
        // Otherwise fall back to the location-inferred currency.
        const dossierCurrency = (estimates[0].currency || '').toUpperCase();
        const currency = dossierCurrency && dossierCurrency !== 'USD'
            ? dossierCurrency
            : (localCurrency.code !== 'USD' ? localCurrency.code : (dossierCurrency || 'USD'));
        const avgConfidence = estimates[0].confidence || 'low';

        salaryRange = { min: avgMin, max: avgMax, currency, confidence: avgConfidence };
        salaryContext = `Market data indicates compensation of ~${currency} ${avgMin.toLocaleString()}-${avgMax.toLocaleString()} (confidence: ${avgConfidence}).`;
        if (currency !== localCurrency.code) {
            salaryContext += ` Note: role is based in a ${localCurrency.code} market — quote the ask in ${localCurrency.code}.`;
        }
        sources.push(...estimates.filter(e => e.source).map(e => e.source));
    }

    // Build company culture + complaint context to inform negotiation angle
    const cultureLines: string[] = [];
    if (dossier?.culture_ratings) {
        const cr = dossier.culture_ratings;
        if (cr.overall > 0) cultureLines.push(`Overall employee rating: ${cr.overall.toFixed(1)}/5`);
        if (cr.work_life_balance > 0) cultureLines.push(`Work-life balance: ${cr.work_life_balance.toFixed(1)}/5`);
        if (cr.compensation > 0) cultureLines.push(`Compensation satisfaction: ${cr.compensation.toFixed(1)}/5`);
    }
    if (dossier?.critics && dossier.critics.length > 0) {
        const relevant = dossier.critics.filter(c =>
            ['compensation', 'pay', 'salary', 'work-life', 'benefits', 'workload', 'hours'].some(k =>
                c.category.toLowerCase().includes(k) || c.complaint.toLowerCase().includes(k)
            )
        );
        relevant.forEach(c => cultureLines.push(`[${c.frequency.toUpperCase()} complaint] ${c.category}: ${c.complaint}`));
    }
    if (dossier?.benefits && dossier.benefits.length > 0) {
        cultureLines.push(`Known benefits: ${dossier.benefits.join(', ')}`);
    }
    const companyInsightContext = cultureLines.length > 0
        ? `Company Culture & Compensation Signals:\n${cultureLines.map(l => `  - ${l}`).join('\n')}`
        : '';

    const prompt = `You are a career negotiation coach. Generate a negotiation script for ${name}.

Resume Highlights:
${topExperience}
Top Skills: ${topSkills}

${jdContext}

Local Compensation Currency: ${localCurrency.code} (${localCurrency.name}, symbol "${localCurrency.symbol}")
${salaryContext}
${companyInsightContext ? `\n${companyInsightContext}` : ''}

Generate EXACTLY this JSON (no markdown, no fences):
{
  "opening_line": "2 sentences: what to say when the recruiter asks about expected salary",
  "justification": "1 paragraph linking 3 specific resume achievements to justify the ask",
  "counter_offer_fallback": "2 sentences: what to say if employer counters with a lower offer"
}

Rules:
- Use first person, confident but professional tone.
- Reference REAL achievements from the resume.
- CRITICAL: All salary, stipend, and compensation figures in opening_line, justification, and counter_offer_fallback MUST be quoted in ${localCurrency.code} (${localCurrency.symbol}). Do NOT use USD/dollars unless ${localCurrency.code} is USD. The role is based in a ${localCurrency.code} market — quoting the wrong currency makes the entire script useless.
- Use natural local formatting for ${localCurrency.code} (e.g., for INR use "₹X LPA" or "₹X lakh per annum" for annual figures; for GBP use "£X" or "£Xk"; for EUR use "€X"; etc.).
- If market data above is in a different currency than ${localCurrency.code}, do NOT convert with made-up rates — instead anchor your ask to typical ${localCurrency.code} market norms for this role/level/location.
- If salary data is available in ${localCurrency.code}, anchor the opening to the upper range.
- If work-life balance or compensation satisfaction scores are low (<3.5), acknowledge the demanding environment and justify a higher salary ask accordingly.
- If there are widespread or frequent complaints about compensation/workload, reference the market data as a floor, not a ceiling.
- If benefits appear limited, the counter_offer_fallback may suggest non-salary alternatives (equity, PTO, remote work).
- DO NOT fabricate achievements.
- Return JSON only.`;

    try {
        const response = await generateContentFn([{ text: prompt }]);
        const parsed = extractJsonObject(response);

        return {
            opening_line: parsed.opening_line || '',
            justification: parsed.justification || '',
            counter_offer_fallback: parsed.counter_offer_fallback || '',
            salary_range: salaryRange,
            sources: [...new Set(sources)]
        };
    } catch (error: any) {
        console.error('[NegotiationEngine] Failed to generate script:', error.message);
        return null;
    }
}
