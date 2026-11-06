// electron/knowledge/StructuredExtractor.ts
// LLM call to parse raw text into structured JSON based on Document Type

import { DocType, StructuredResume, StructuredJD, VALID_JD_LEVELS, VALID_JD_EMPLOYMENT_TYPES } from './types';
import { callWithRetry } from './llmUtils';
import { coerceSkills, flattenSkills } from './skillsUtil';

const RESUME_SCHEMA = `{
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

const JD_SCHEMA = `{
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

const VALID_LEVELS: string[] = VALID_JD_LEVELS;
const VALID_EMPLOYMENT: string[] = VALID_JD_EMPLOYMENT_TYPES;

function buildExtractionPrompt(type: DocType): string {
  const schema = type === DocType.RESUME ? RESUME_SCHEMA : JD_SCHEMA;
  const documentName = type === DocType.RESUME ? "resume" : "job description";

  let extra = '';
  if (type === DocType.JD) {
    extra = `\nNormalize level to one of: ${VALID_LEVELS.join(', ')}.\nNormalize employment_type to one of: ${VALID_EMPLOYMENT.join(', ')}.\nNormalize location to "City, Country" format.\nFor compensation_hint, extract any salary or compensation mentions as a string (e.g. "competitive", "$150k-$200k"). If none, use "".\nFor keywords, extract 5-10 key themes from the JD (e.g. "scalability", "event-driven", "leadership").`;
  } else {
    // RC-3: categorize every skill into exactly one bucket. Empty array means
    // "the resume mentions none of this category" — a real, usable signal — so
    // NEVER omit a category key. Do not fabricate skills not in the text.
    extra = `\nFor "skills", classify every skill the resume mentions into EXACTLY ONE bucket:
- "languages": programming languages (Python, TypeScript, Go, Java, SQL, C++, R...).
- "frameworks": libraries/frameworks (React, Next.js, Django, FastAPI, Spring, Node.js, Express, Flutter...).
- "cloud": cloud platforms/services (AWS, GCP, Azure, Vercel, Cloudflare, Firebase, Supabase...).
- "databases": data stores (PostgreSQL, MySQL, Redis, MongoDB, pgvector, Snowflake...).
- "ml": AI/ML tools (PyTorch, TensorFlow, LangChain, Hugging Face, RAG, LLMs, pandas, NumPy...).
- "devops": infra/CI-CD/observability (Docker, Kubernetes, Terraform, Jenkins, GitHub Actions, Kafka, Datadog...).
- "tools": anything that fits none of the above (Git, Jira, Figma, Postman...).
Rules: a tool that fits multiple buckets goes in the MOST SPECIFIC one (PyTorch → ml, not frameworks; Kubernetes → devops, not cloud). Put every skill somewhere; if truly uncertain, use "tools". Return an empty array [] for any category with no skills — never drop the key.`;
  }

  return `You are a strict ${documentName} parser.

Extract structured information from the text below into the exact JSON schema specified.
Normalize all dates to YYYY-MM format.
If an end date is ongoing or "Present", return null for end_date.
Do not fabricate identity, company names, dates, or contact information that is not explicitly stated.
For project descriptions: if a description is not explicitly provided, generate a concise 1-sentence summary based on the project name, technologies used, and any available context clues.
For project "highlights": if the resume lists MULTIPLE bullet points for a project (e.g. one bullet about a metric/outcome like "gained 4,000+ users", another about architecture, another about a specific engineering decision), put EACH bullet as its own string in "highlights" verbatim (lightly cleaned, not paraphrased) — do NOT compress them all into the single "description" sentence. "description" should be a 1-sentence summary; "highlights" preserves the individual bullets, especially any concrete numbers/metrics, so they are never lost. If the project has only one bullet total, "highlights" may be empty or contain that same bullet.${extra}
Return ONLY valid JSON. No markdown, no explanation, no commentary.

JSON Schema:
${schema}`;
}

/**
 * Clean JSON response from LLM
 */
function cleanJsonResponse(response: string): string {
  let cleaned = response.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }
  return cleaned.trim();
}

/**
 * Extract structured data from raw text using LLM.
 */
export async function extractStructuredData<T>(
  rawText: string,
  type: DocType,
  generateContent: (contents: any[]) => Promise<string>
): Promise<T> {
  console.log(`[StructuredExtractor] Starting structured extraction for type: ${type}...`);

  const systemPrompt = buildExtractionPrompt(type);
  const documentName = type === DocType.RESUME ? "RESUME" : "JOB DESCRIPTION";
  // Bug fix 2026-07-28 (code review): rawText is untrusted document content —
  // most commonly a pasted JD, the one artifact routinely sourced from a
  // third party — concatenated directly into the prompt with a plain-text
  // sentinel as the only boundary. A document crafted to contain this
  // sentinel could break out of its own text block and inject instructions
  // that influence the "factual" extracted title/company/compensation_hint.
  // Scrub both delimiter forms regardless of `type`, since a crafted
  // document shouldn't be assumed to guess which one is active for its own
  // extraction call.
  const sanitizedText = rawText.replace(/---\s*(END\s+)?(RESUME|JOB DESCRIPTION)\s+TEXT\s*---/gi, '[REDACTED-DELIMITER]');
  const prompt = `${systemPrompt}\n\n--- ${documentName} TEXT ---\n${sanitizedText}\n--- END ${documentName} TEXT ---\n\nReturn ONLY the JSON object. No markdown fences, no explanation.`;

  const response = await callWithRetry(
    () => generateContent([{ text: prompt }]),
    45000 // 45s timeout for structured extraction (larger docs need more time)
  );
  const cleaned = cleanJsonResponse(response);

  try {
    const parsed = JSON.parse(cleaned) as T;

    if (type === DocType.RESUME) {
      const resume = parsed as unknown as StructuredResume;
      if (!resume.identity) {
        resume.identity = { name: 'Unknown Candidate', email: '', phone: '', location: '', linkedin: '', github: '', website: '', summary: '' };
      }
      if (!resume.identity.name) {
        console.warn('[StructuredExtractor] Parsed resume missing name. Providing fallback.');
        resume.identity.name = 'Unknown Candidate';
      }
      // Set defaults. coerceSkills tolerates the categorized object, a legacy
      // flat string[] (model regression), or undefined — and always yields a
      // complete CategorizedSkills. skills_flat is the derived convenience list.
      resume.skills = coerceSkills(resume.skills);
      resume.skills_flat = flattenSkills(resume.skills);
      resume.experience = resume.experience || [];
      resume.projects = resume.projects || [];
      resume.education = resume.education || [];
      resume.achievements = resume.achievements || [];
      resume.certifications = resume.certifications || [];
      resume.leadership = resume.leadership || [];
      console.log(`[StructuredExtractor] Successfully parsed resume for: ${resume.identity.name}`);
    } else if (type === DocType.JD) {
      const jd = parsed as unknown as StructuredJD;

      // Fallback for LLMs that output 'role' instead of 'title'
      if (!jd.title && (jd as any).role) {
        jd.title = (jd as any).role;
      }

      if (!jd.title) {
        console.warn('[StructuredExtractor] Parsed JD missing title/role. Providing fallback.');
        jd.title = 'Unknown Role';
      }

      // Set defaults
      jd.company = jd.company || '';
      jd.location = jd.location || 'Unknown Location';
      jd.requirements = jd.requirements || [];
      jd.nice_to_haves = jd.nice_to_haves || [];
      jd.responsibilities = jd.responsibilities || [];
      jd.technologies = jd.technologies || [];
      jd.keywords = jd.keywords || [];
      jd.compensation_hint = jd.compensation_hint || '';
      jd.min_years_experience = jd.min_years_experience || 0;
      // Normalize level
      if (!VALID_LEVELS.includes(jd.level)) {
        jd.level = 'mid' as any;
      }
      // Normalize employment type
      if (!VALID_EMPLOYMENT.includes(jd.employment_type)) {
        jd.employment_type = 'full_time' as any;
      }
      console.log(`[StructuredExtractor] Successfully parsed JD for: ${jd.title} at ${jd.company || 'Unknown'} (Level: ${jd.level})`);
    }

    return parsed;
  } catch (error: any) {
    console.error('[StructuredExtractor] Failed to parse LLM response as JSON:', error.message);
    console.error('[StructuredExtractor] Raw response (first 500 chars):', cleaned.substring(0, 500));
    throw new Error(`Data extraction failed: ${error.message}`);
  }
}
