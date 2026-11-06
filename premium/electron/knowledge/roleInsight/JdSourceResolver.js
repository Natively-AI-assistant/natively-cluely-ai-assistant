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
var TRUNCATION_FLOOR_CHARS = 900;
function isHttpUrl(value) {
    try {
        const u = new URL(value.trim());
        return u.protocol === "http:" || u.protocol === "https:";
    }
    catch {
        return false;
    }
}
function classifyAuthority(url, company) {
    let host = "";
    try {
        host = new URL(url).hostname.toLowerCase();
    }
    catch {
        return "secondary";
    }
    const JOB_BOARDS = [
        "linkedin.com",
        "indeed.com",
        "glassdoor.com",
        "ziprecruiter.com",
        "monster.com",
        "dice.com",
        "wellfound.com",
        "angel.co",
        "builtin.com",
        "otta.com",
        "hired.com",
        "greenhouse.io",
        "lever.co",
        "ashbyhq.com",
        "workday.com",
        "myworkdayjobs.com",
        "smartrecruiters.com",
        "jobvite.com",
        "bamboohr.com",
        "workable.com",
        "recruitee.com"
    ];
    const companyToken = String(company ?? "").toLowerCase().replace(/\b(inc|llc|ltd|limited|corp|corporation|gmbh|co|plc|the)\b/g, "").replace(/[^a-z0-9]/g, "");
    const isCompanyHost = companyToken.length >= 3 && host.replace(/[^a-z0-9]/g, "").includes(companyToken);
    if (isCompanyHost) {
        return /\b(careers?|jobs?|join|work-with-us|opportunities)\b/.test(url.toLowerCase()) ? "official_careers" : "official_site";
    }
    if (JOB_BOARDS.some((b) => host.endsWith(b))) {
        const atsHosts = ["greenhouse.io", "lever.co", "ashbyhq.com", "myworkdayjobs.com", "smartrecruiters.com", "workable.com"];
        if (atsHosts.some((b) => host.endsWith(b)) && companyToken.length >= 3 && url.toLowerCase().replace(/[^a-z0-9]/g, "").includes(companyToken)) {
            return "official_careers";
        }
        return "job_board";
    }
    if (/\b(docs?|documentation|developer)\b/.test(host))
        return "documentation";
    return "secondary";
}
var AUTHORITY_RANK = {
    official_careers: 0,
    official_site: 1,
    documentation: 2,
    job_board: 3,
    secondary: 4
};
function nowIso() {
    return ( /* @__PURE__ */new Date()).toISOString();
}
async function resolveFromUrl(url, provider, company) {
    if (!isHttpUrl(url))
        return null;
    if (!provider || typeof provider.extractUrl !== "function") {
        console.warn("[RoleInsight/JdSource] No extraction-capable search provider configured for job URL.");
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
        sourceKind: "job_url",
        officialVerified: authority === "official_careers" || authority === "official_site",
        externalSources: [{
                url,
                title: extracted.title || url,
                retrievedAt: nowIso(),
                authority,
                snippet: extracted.content.slice(0, 400),
                purpose: "Job description text extracted from the supplied job URL."
            }],
        unavailableVerifications: []
    };
}
async function verifyAgainstOfficialPosting(args) {
    const { jdText, title, company, location, provider, allowRecovery } = args;
    const unavailable = [];
    const sources = [];
    const looksTruncated = jdText.trim().length < TRUNCATION_FLOOR_CHARS;
    if (!provider) {
        unavailable.push("The job posting could not be verified against an official source \u2014 no web-search key is configured.");
        if (looksTruncated) {
            unavailable.push("The supplied job description looks incomplete and could not be recovered.");
        }
        return { externalSources: [], unavailableVerifications: unavailable, officialVerified: false, recoveredText: null };
    }
    if (!title && !company) {
        unavailable.push("The job description did not name a title or company, so it could not be verified against an official posting.");
        return { externalSources: [], unavailableVerifications: unavailable, officialVerified: false, recoveredText: null };
    }
    const query = [company, title, "careers job posting"].filter(Boolean).join(" ");
    let results = [];
    try {
        results = await provider.search(query, 6);
    }
    catch (e) {
        console.warn("[RoleInsight/JdSource] Verification search failed:", e?.message);
    }
    if (results.length === 0) {
        unavailable.push("The official posting could not be located, so the role title and location were not verified.");
        if (looksTruncated) {
            unavailable.push("The supplied job description looks incomplete and could not be recovered.");
        }
        return { externalSources: [], unavailableVerifications: unavailable, officialVerified: false, recoveredText: null };
    }
    const ranked = results.map((r) => ({ ...r, authority: classifyAuthority(r.link, company) })).sort((a, b) => AUTHORITY_RANK[a.authority] - AUTHORITY_RANK[b.authority]);
    const best = ranked[0];
    const officialVerified = best.authority === "official_careers" || best.authority === "official_site";
    const blob = `${best.title} ${best.snippet}`.toLowerCase();
    const titleConfirmed = !!title && blob.includes(title.toLowerCase().split(/[,(]/)[0].trim());
    const locationConfirmed = !!location && blob.includes(location.toLowerCase().split(/[,(]/)[0].trim());
    const confirmations = [];
    if (titleConfirmed)
        confirmations.push("role title");
    if (locationConfirmed)
        confirmations.push("location");
    sources.push({
        url: best.link,
        title: best.title,
        retrievedAt: nowIso(),
        authority: best.authority,
        snippet: best.snippet.slice(0, 400),
        purpose: confirmations.length > 0 ? `Confirmed the ${confirmations.join(" and ")} against this posting.` : "Located as the closest matching public posting; it did not confirm the title or location."
    });
    if (!titleConfirmed && title) {
        unavailable.push(`The role title "${title}" could not be confirmed against a public posting.`);
    }
    if (!locationConfirmed && location) {
        unavailable.push(`The location "${location}" could not be confirmed against a public posting.`);
    }
    let recoveredText = null;
    if (looksTruncated && allowRecovery && typeof provider.extractUrl === "function") {
        const extracted = await provider.extractUrl(best.link);
        if (extracted && extracted.content.length > jdText.length * 1.5) {
            recoveredText = extracted.content;
            sources.push({
                url: best.link,
                title: extracted.title || best.title,
                retrievedAt: nowIso(),
                authority: best.authority,
                snippet: extracted.content.slice(0, 400),
                purpose: "Recovered the fuller job-description text after the supplied version appeared truncated."
            });
        }
        else {
            unavailable.push("The supplied job description looks incomplete and a fuller version could not be recovered.");
        }
    }
    else if (looksTruncated) {
        unavailable.push("The supplied job description looks incomplete and could not be recovered.");
    }
    return { externalSources: sources, unavailableVerifications: unavailable, officialVerified, recoveredText };
}
export { classifyAuthority, isHttpUrl, resolveFromUrl, verifyAgainstOfficialPosting };
