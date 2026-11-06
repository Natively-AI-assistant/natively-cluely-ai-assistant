// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.

var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
function jdContextFromStructured(jd) {
    return {
        title: jd.title || jd.role || "Unknown Role",
        location: jd.location || "Unknown Location",
        level: jd.level,
        employment_type: jd.employment_type,
        technologies: jd.technologies,
        requirements: jd.requirements,
        responsibilities: jd.responsibilities,
        keywords: jd.keywords,
        compensation_hint: jd.compensation_hint,
        min_years_experience: jd.min_years_experience,
        description_summary: jd.description_summary
    };
}
async function fetchPageText(url, timeoutMs = 5e3) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                "User-Agent": "Mozilla/5.0 (compatible; NativelyBot/1.0)",
                "Accept": "text/html,application/xhtml+xml"
            }
        });
        clearTimeout(timeout);
        if (!response.ok)
            return "";
        const html = await response.text();
        return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3e3);
    }
    catch {
        return "";
    }
}
var DOSSIER_SCHEMA = `{
  "company": "",
  "hiring_strategy": "",
  "interview_focus": "",
  "interview_difficulty": "medium",
  "salary_estimates": [
    {"title": "", "location": "", "min": 0, "max": 0, "currency": "USD", "source": "", "confidence": "low"}
  ],
  "culture_ratings": {
    "overall": 0.0,
    "work_life_balance": 0.0,
    "career_growth": 0.0,
    "compensation": 0.0,
    "management": 0.0,
    "diversity": 0.0,
    "review_count": "",
    "data_sources": []
  },
  "employee_reviews": [
    {"quote": "", "sentiment": "positive", "source": "", "role": ""}
  ],
  "critics": [
    {"category": "", "complaint": "", "frequency": "frequently"}
  ],
  "benefits": [],
  "competitors": [],
  "recent_news": "",
  "core_values": [],
  "sources": []
}`;
var CompanyResearchEngine = class {
    db;
    searchProvider = null;
    generateContentFn = null;
    // Rate limiting
    lastSearchTime = 0;
    minSearchIntervalMs = 2e3;
    // 2 seconds between searches
    constructor(db) {
        this.db = db;
    }
    /**
     * Set the search provider (Tavily, Natively proxy, etc.). Pass null to clear —
     * callers re-resolve per run, and a provider wired from a key that was since
     * removed must not stay live on the shared engine.
     */
    setSearchProvider(provider) {
        this.searchProvider = provider;
    }
    /**
     * Set the LLM content generation function.
     */
    setGenerateContentFn(fn) {
        this.generateContentFn = fn;
    }
    /**
     * Research a company. Returns cached dossier if fresh, otherwise runs live research.
     * Accepts a JDContext for richer, role-aware dossiers.
     */
    async researchCompany(companyName, jdCtx = {}, forceRefresh = false) {
        const normalizedName = companyName.toLowerCase().trim();
        console.log(`[CompanyResearch] Researching: ${companyName} (role: ${jdCtx.title}, location: ${jdCtx.location}, level: ${jdCtx.level})`);
        if (!forceRefresh) {
            const cached = this.db.getDossier(normalizedName);
            if (cached && !this.db.isDossierStale(normalizedName)) {
                const cachedDossier = cached.dossier;
                if (cachedDossier.degraded && this.searchProvider) {
                    console.log(`[CompanyResearch] Cached dossier for ${companyName} is LLM-only and search is now available \u2014 refreshing`);
                }
                else {
                    console.log(`[CompanyResearch] Returning cached dossier for ${companyName}`);
                    return cachedDossier;
                }
            }
        }
        if (!this.searchProvider) {
            console.warn("[CompanyResearch] No search provider configured. Returning LLM-only dossier.");
            return this.generateLLMOnlyDossier(companyName, jdCtx);
        }
        const now = Date.now();
        if (now - this.lastSearchTime < this.minSearchIntervalMs) {
            await new Promise((resolve) => setTimeout(resolve, this.minSearchIntervalMs - (now - this.lastSearchTime)));
        }
        try {
            const queries = this.buildSearchQueries(companyName, jdCtx);
            const allResults = [];
            const allUrls = [];
            for (const query of queries) {
                try {
                    this.lastSearchTime = Date.now();
                    const results = await this.searchProvider.search(query, 3);
                    allResults.push(...results);
                    allUrls.push(...results.map((r) => r.link));
                    await new Promise((resolve) => setTimeout(resolve, 500));
                }
                catch (error) {
                    console.warn(`[CompanyResearch] Search failed for query "${query}": ${error.message}`);
                }
            }
            if (allResults.length === 0) {
                console.warn("[CompanyResearch] No search results found. Falling back to LLM-only.");
                return this.generateLLMOnlyDossier(companyName, jdCtx);
            }
            const snippets = [];
            for (const result of allResults.slice(0, 8)) {
                const text = result.snippet || await fetchPageText(result.link);
                if (text) {
                    snippets.push({ url: result.link, text: text.slice(0, 1500) });
                }
            }
            const dossier = await this.summarizeWithLLM(companyName, jdCtx, snippets);
            if (dossier) {
                this.db.saveDossier(normalizedName, dossier, allUrls);
                return dossier;
            }
            return null;
        }
        catch (error) {
            console.error(`[CompanyResearch] Research failed for ${companyName}:`, error.message);
            return this.generateLLMOnlyDossier(companyName, jdCtx);
        }
    }
    /**
     * Build targeted search queries for a company using full JD context.
     */
    buildSearchQueries(companyName, jdCtx) {
        const { title, location, technologies, level } = jdCtx;
        const queries = [
            `${companyName} hiring strategy careers`,
            `${companyName} interview process ${title || ""}`.trim()
        ];
        if (title && location) {
            queries.push(`${companyName} ${title} salary ${location}`);
        }
        else if (title) {
            queries.push(`${companyName} ${title} salary`);
        }
        queries.push(`${companyName} recent funding news layoffs`);
        queries.push(`${companyName} competitors`);
        queries.push(`${companyName} glassdoor reviews employee rating work life balance culture`);
        queries.push(`${companyName} employee complaints criticism problems work culture`);
        queries.push(`${companyName} employee benefits perks remote work`);
        if (technologies && technologies.length > 0) {
            queries.push(`${companyName} tech stack ${technologies.slice(0, 3).join(" ")}`);
        }
        if (level && title) {
            queries.push(`${companyName} ${level} ${title} interview`);
        }
        return queries;
    }
    /**
     * Format a compact JD summary block for LLM context.
     */
    formatJDContextBlock(jdCtx) {
        const parts = [];
        if (jdCtx.title)
            parts.push(`Role: ${jdCtx.title}`);
        if (jdCtx.level)
            parts.push(`Level: ${jdCtx.level}`);
        if (jdCtx.location)
            parts.push(`Location: ${jdCtx.location}`);
        if (jdCtx.employment_type)
            parts.push(`Type: ${jdCtx.employment_type.replace("_", " ")}`);
        if (jdCtx.min_years_experience !== void 0 && jdCtx.min_years_experience > 0) {
            parts.push(`Min Experience: ${jdCtx.min_years_experience} years`);
        }
        if (jdCtx.compensation_hint)
            parts.push(`Compensation Hint: ${jdCtx.compensation_hint}`);
        if (jdCtx.technologies && jdCtx.technologies.length > 0) {
            parts.push(`Technologies: ${jdCtx.technologies.join(", ")}`);
        }
        if (jdCtx.requirements && jdCtx.requirements.length > 0) {
            parts.push(`Key Requirements: ${jdCtx.requirements.slice(0, 5).join("; ")}`);
        }
        if (jdCtx.responsibilities && jdCtx.responsibilities.length > 0) {
            parts.push(`Key Responsibilities: ${jdCtx.responsibilities.slice(0, 5).join("; ")}`);
        }
        if (jdCtx.keywords && jdCtx.keywords.length > 0) {
            parts.push(`Keywords: ${jdCtx.keywords.join(", ")}`);
        }
        if (jdCtx.description_summary)
            parts.push(`Summary: ${jdCtx.description_summary}`);
        return parts.join("\n");
    }
    /**
     * Use LLM to summarize search snippets into a structured dossier.
     */
    async summarizeWithLLM(companyName, jdCtx, snippets) {
        if (!this.generateContentFn)
            return null;
        const snippetText = snippets.map((s) => `[Source: ${s.url}]
${s.text}`).join("\n\n---\n\n");
        const jdBlock = this.formatJDContextBlock(jdCtx);
        const prompt = `You are a web research assistant. Using the following web snippets, create a structured company dossier JSON for ${companyName}.

${jdBlock ? `The candidate is applying for the following position \u2014 tailor salary estimates, interview focus, and hiring strategy to this specific role:
${jdBlock}
` : ""}
Match this exact JSON schema:
${DOSSIER_SCHEMA}

Rules:
- salary_estimates: Use snippet data first. If no salary figures appear in snippets, use your training knowledge (Glassdoor/LinkedIn/Levels.fyi patterns) to estimate and set confidence to "low". Do NOT return an empty array when the role and location are known \u2014 always provide at least one estimate.
- culture_ratings: Extract numeric star ratings (1\u20135 scale) from Glassdoor/Indeed/Blind snippets. If not explicitly in snippets, estimate from overall reputation you know (set data_sources to []). Use 0.0 only if the company is genuinely unknown.
- employee_reviews: Extract 2\u20134 real representative quotes from employee review snippets. Assign sentiment (positive/mixed/negative), platform source, and role if mentioned.
- critics: Identify the 3\u20135 most commonly cited complaints from employee review snippets or known reputation. Assign category (e.g. "Work-Life Balance", "Management", "Compensation", "Culture", "Job Security"), and frequency (occasionally/frequently/widespread).
- benefits: List key benefits mentioned in snippets (e.g. "401k match", "Remote-friendly", "Equity / RSUs", "Health insurance", "Parental leave").
- interview_difficulty: Set to "easy", "medium", "hard", or "very_hard" based on snippets or known reputation.
- hiring_strategy, interview_focus, recent_news: Only use information present in the snippets.
- For interview_focus, consider the specific technologies, requirements, and responsibilities listed in the JD context.
- If a field has no data and no reasonable estimate, use empty strings or empty arrays.
- Return JSON only. No markdown fences.

Web Snippets:
${snippetText}`;
        try {
            const response = await this.generateContentFn([{ text: prompt }]);
            let cleaned = response.trim();
            if (cleaned.startsWith("```json"))
                cleaned = cleaned.slice(7);
            if (cleaned.startsWith("```"))
                cleaned = cleaned.slice(3);
            if (cleaned.endsWith("```"))
                cleaned = cleaned.slice(0, -3);
            const dossier = JSON.parse(cleaned.trim());
            dossier.fetched_at = ( /* @__PURE__ */new Date()).toISOString();
            dossier.core_values = dossier.core_values || [];
            dossier.salary_estimates = dossier.salary_estimates || [];
            dossier.employee_reviews = (dossier.employee_reviews || []).filter((r) => r.quote && r.quote.trim().length > 0);
            dossier.critics = (dossier.critics || []).filter((c) => c.complaint && c.complaint.trim().length > 0);
            dossier.benefits = (dossier.benefits || []).filter((b) => b && b.trim().length > 0);
            if (dossier.culture_ratings && typeof dossier.culture_ratings === "object") {
                dossier.culture_ratings.data_sources = dossier.culture_ratings.data_sources || [];
            }
            else {
                dossier.culture_ratings = void 0;
            }
            dossier.sources = [... /* @__PURE__ */new Set([...dossier.sources || [], ...snippets.map((s) => s.url)])];
            console.log(`[CompanyResearch] Dossier generated for ${companyName} with ${dossier.sources.length} sources`);
            return dossier;
        }
        catch (error) {
            console.error(`[CompanyResearch] Failed to parse LLM dossier response:`, error.message);
            return null;
        }
    }
    /**
     * Generate a minimal dossier using only LLM knowledge (no web search).
     */
    async generateLLMOnlyDossier(companyName, jdCtx = {}) {
        if (!this.generateContentFn)
            return null;
        const jdBlock = this.formatJDContextBlock(jdCtx);
        const prompt = `Based on your general knowledge, provide a brief company dossier for ${companyName}.

${jdBlock ? `The candidate is applying for the following position \u2014 tailor salary estimates, interview focus, and hiring strategy to this specific role:
${jdBlock}
` : ""}
Match this exact JSON schema:
${DOSSIER_SCHEMA}

Rules:
- Mark ALL salary confidence levels as "low" since this is from general knowledge, not live data.
- Use empty string for all source URLs.
- Provide salary estimates from your training knowledge tailored to the role, level, and location. Do NOT leave salary_estimates empty when the role is known.
- culture_ratings: Use general reputation knowledge. Set data_sources to [] if guessing.
- employee_reviews: Provide 2\u20133 illustrative reviews that reflect the company's known reputation. Mark source as "General Knowledge".
- critics: List the 3\u20134 most well-known complaints about this company from your training data.
- benefits: List typical/known benefits for this company.
- interview_difficulty: Estimate based on known reputation.
- Return JSON only. No markdown fences.`;
        try {
            const response = await this.generateContentFn([{ text: prompt }]);
            let cleaned = response.trim();
            if (cleaned.startsWith("```json"))
                cleaned = cleaned.slice(7);
            if (cleaned.startsWith("```"))
                cleaned = cleaned.slice(3);
            if (cleaned.endsWith("```"))
                cleaned = cleaned.slice(0, -3);
            const dossier = JSON.parse(cleaned.trim());
            dossier.fetched_at = ( /* @__PURE__ */new Date()).toISOString();
            dossier.core_values = dossier.core_values || [];
            dossier.salary_estimates = dossier.salary_estimates || [];
            dossier.employee_reviews = (dossier.employee_reviews || []).filter((r) => r.quote && r.quote.trim().length > 0);
            dossier.critics = (dossier.critics || []).filter((c) => c.complaint && c.complaint.trim().length > 0);
            dossier.benefits = (dossier.benefits || []).filter((b) => b && b.trim().length > 0);
            if (dossier.culture_ratings && typeof dossier.culture_ratings === "object") {
                dossier.culture_ratings.data_sources = dossier.culture_ratings.data_sources || [];
            }
            else {
                dossier.culture_ratings = void 0;
            }
            dossier.sources = [];
            dossier.degraded = true;
            this.db.saveDossier(companyName, dossier, []);
            console.log(`[CompanyResearch] LLM-only dossier generated for ${companyName} (low confidence)`);
            return dossier;
        }
        catch (error) {
            console.error(`[CompanyResearch] LLM-only dossier generation failed:`, error.message);
            return null;
        }
    }
    /**
     * Get cached dossier without triggering research.
     */
    getCachedDossier(companyName) {
        const cached = this.db.getDossier(companyName);
        return cached ? cached.dossier : null;
    }
};
export { CompanyResearchEngine, jdContextFromStructured };
