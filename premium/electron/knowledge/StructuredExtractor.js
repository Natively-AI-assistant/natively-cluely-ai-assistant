// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.
import { VALID_JD_LEVELS } from "./types";
import { VALID_JD_EMPLOYMENT_TYPES } from "./types";
import { callWithRetry } from "./llmUtils";
import { coerceSkills } from "./skillsUtil";
import { flattenSkills } from "./skillsUtil";
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
// premium/electron/knowledge/StructuredExtractor.ts
var RESUME_SCHEMA = `{
  "identity": {
    "name": "",
    "email": "",
    "phone": "",
    "location": "",
    "linkedin": "",
    "github": "",
    "website": "",
    "summary": ""
  },
  "skills": {
    "languages": [],
    "frameworks": [],
    "cloud": [],
    "databases": [],
    "ml": [],
    "devops": [],
    "tools": []
  },
  "experience": [
    {
      "company": "",
      "role": "",
      "start_date": "YYYY-MM",
      "end_date": "YYYY-MM or null",
      "bullets": []
    }
  ],
  "projects": [
    {
      "name": "",
      "description": "",
      "highlights": [],
      "technologies": [],
      "url": ""
    }
  ],
  "education": [
    {
      "institution": "",
      "degree": "",
      "field": "",
      "start_date": "YYYY-MM",
      "end_date": "YYYY-MM or null",
      "gpa": ""
    }
  ],
  "achievements": [
    {
      "title": "",
      "description": "",
      "date": ""
    }
  ],
  "certifications": [
    {
      "name": "",
      "issuer": "",
      "date": ""
    }
  ],
  "leadership": [
    {
      "role": "",
      "organization": "",
      "description": ""
    }
  ]
}`;
var JD_SCHEMA = `{
  "title": "",
  "company": "",
  "location": "City, Country",
  "description_summary": "",
  "level": "senior",
  "employment_type": "full_time",
  "min_years_experience": 0,
  "compensation_hint": "",
  "requirements": [],
  "nice_to_haves": [],
  "responsibilities": [],
  "technologies": [],
  "keywords": []
}`;
var VALID_LEVELS = VALID_JD_LEVELS;
var VALID_EMPLOYMENT = VALID_JD_EMPLOYMENT_TYPES;
function buildExtractionPrompt(type) {
    const schema = type === "resume" /* RESUME */ ? RESUME_SCHEMA : JD_SCHEMA;
    const documentName = type === "resume" /* RESUME */ ? "resume" : "job description";
    let extra = "";
    if (type === "job_description" /* JD */) {
        extra = `
Normalize level to one of: ${VALID_LEVELS.join(", ")}.
Normalize employment_type to one of: ${VALID_EMPLOYMENT.join(", ")}.
Normalize location to "City, Country" format.
For compensation_hint, extract any salary or compensation mentions as a string (e.g. "competitive", "$150k-$200k"). If none, use "".
For keywords, extract 5-10 key themes from the JD (e.g. "scalability", "event-driven", "leadership").`;
    }
    else {
        extra = `
For "skills", classify every skill the resume mentions into EXACTLY ONE bucket:
- "languages": programming languages (Python, TypeScript, Go, Java, SQL, C++, R...).
- "frameworks": libraries/frameworks (React, Next.js, Django, FastAPI, Spring, Node.js, Express, Flutter...).
- "cloud": cloud platforms/services (AWS, GCP, Azure, Vercel, Cloudflare, Firebase, Supabase...).
- "databases": data stores (PostgreSQL, MySQL, Redis, MongoDB, pgvector, Snowflake...).
- "ml": AI/ML tools (PyTorch, TensorFlow, LangChain, Hugging Face, RAG, LLMs, pandas, NumPy...).
- "devops": infra/CI-CD/observability (Docker, Kubernetes, Terraform, Jenkins, GitHub Actions, Kafka, Datadog...).
- "tools": anything that fits none of the above (Git, Jira, Figma, Postman...).
Rules: a tool that fits multiple buckets goes in the MOST SPECIFIC one (PyTorch \u2192 ml, not frameworks; Kubernetes \u2192 devops, not cloud). Put every skill somewhere; if truly uncertain, use "tools". Return an empty array [] for any category with no skills \u2014 never drop the key.`;
    }
    return `You are a strict ${documentName} parser.

Extract structured information from the text below into the exact JSON schema specified.
Normalize all dates to YYYY-MM format.
If an end date is ongoing or "Present", return null for end_date.
Do not fabricate identity, company names, dates, or contact information that is not explicitly stated.
For project descriptions: if a description is not explicitly provided, generate a concise 1-sentence summary based on the project name, technologies used, and any available context clues.
For project "highlights": if the resume lists MULTIPLE bullet points for a project (e.g. one bullet about a metric/outcome like "gained 4,000+ users", another about architecture, another about a specific engineering decision), put EACH bullet as its own string in "highlights" verbatim (lightly cleaned, not paraphrased) \u2014 do NOT compress them all into the single "description" sentence. "description" should be a 1-sentence summary; "highlights" preserves the individual bullets, especially any concrete numbers/metrics, so they are never lost. If the project has only one bullet total, "highlights" may be empty or contain that same bullet.${extra}
Return ONLY valid JSON. No markdown, no explanation, no commentary.

JSON Schema:
${schema}`;
}
function cleanJsonResponse(response) {
    let cleaned = response.trim();
    if (cleaned.startsWith("```json")) {
        cleaned = cleaned.slice(7);
    }
    else if (cleaned.startsWith("```")) {
        cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith("```")) {
        cleaned = cleaned.slice(0, -3);
    }
    return cleaned.trim();
}
async function extractStructuredData(rawText, type, generateContent) {
    console.log(`[StructuredExtractor] Starting structured extraction for type: ${type}...`);
    const systemPrompt = buildExtractionPrompt(type);
    const documentName = type === "resume" /* RESUME */ ? "RESUME" : "JOB DESCRIPTION";
    const sanitizedText = rawText.replace(/---\s*(END\s+)?(RESUME|JOB DESCRIPTION)\s+TEXT\s*---/gi, "[REDACTED-DELIMITER]");
    const prompt = `${systemPrompt}

--- ${documentName} TEXT ---
${sanitizedText}
--- END ${documentName} TEXT ---

Return ONLY the JSON object. No markdown fences, no explanation.`;
    const response = await callWithRetry(() => generateContent([{ text: prompt }]), 45e3
    // 45s timeout for structured extraction (larger docs need more time)
    );
    const cleaned = cleanJsonResponse(response);
    try {
        const parsed = JSON.parse(cleaned);
        if (type === "resume" /* RESUME */) {
            const resume = parsed;
            if (!resume.identity) {
                resume.identity = { name: "Unknown Candidate", email: "", phone: "", location: "", linkedin: "", github: "", website: "", summary: "" };
            }
            if (!resume.identity.name) {
                console.warn("[StructuredExtractor] Parsed resume missing name. Providing fallback.");
                resume.identity.name = "Unknown Candidate";
            }
            resume.skills = coerceSkills(resume.skills);
            resume.skills_flat = flattenSkills(resume.skills);
            resume.experience = resume.experience || [];
            resume.projects = resume.projects || [];
            resume.education = resume.education || [];
            resume.achievements = resume.achievements || [];
            resume.certifications = resume.certifications || [];
            resume.leadership = resume.leadership || [];
            console.log(`[StructuredExtractor] Successfully parsed resume for: ${resume.identity.name}`);
        }
        else if (type === "job_description" /* JD */) {
            const jd = parsed;
            if (!jd.title && jd.role) {
                jd.title = jd.role;
            }
            if (!jd.title) {
                console.warn("[StructuredExtractor] Parsed JD missing title/role. Providing fallback.");
                jd.title = "Unknown Role";
            }
            jd.company = jd.company || "";
            jd.location = jd.location || "Unknown Location";
            jd.requirements = jd.requirements || [];
            jd.nice_to_haves = jd.nice_to_haves || [];
            jd.responsibilities = jd.responsibilities || [];
            jd.technologies = jd.technologies || [];
            jd.keywords = jd.keywords || [];
            jd.compensation_hint = jd.compensation_hint || "";
            jd.min_years_experience = jd.min_years_experience || 0;
            if (!VALID_LEVELS.includes(jd.level)) {
                jd.level = "mid";
            }
            if (!VALID_EMPLOYMENT.includes(jd.employment_type)) {
                jd.employment_type = "full_time";
            }
            console.log(`[StructuredExtractor] Successfully parsed JD for: ${jd.title} at ${jd.company || "Unknown"} (Level: ${jd.level})`);
        }
        return parsed;
    }
    catch (error) {
        console.error("[StructuredExtractor] Failed to parse LLM response as JSON:", error.message);
        console.error("[StructuredExtractor] Raw response (first 500 chars):", cleaned.substring(0, 500));
        throw new Error(`Data extraction failed: ${error.message}`);
    }
}
export { extractStructuredData };
