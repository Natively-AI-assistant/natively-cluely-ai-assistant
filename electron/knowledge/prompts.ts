/**
 * All prompts for the Profile Intelligence engine.
 * Each prompt enforces strict JSON output. The caller pipes the output through
 * safeParseJSON() in jsonUtils.ts which strips markdown fences and balances braces.
 */

export const RESUME_PARSE_PROMPT = `You are an expert resume parser. Extract the candidate's full professional profile from the resume text below into a strict JSON document.

JSON SCHEMA (return exactly this shape — no extra keys, no missing required keys):
{
  "identity": {
    "name": string,
    "email": string,
    "phone": string | null,
    "location": string | null,
    "links": string[]            // LinkedIn / GitHub / portfolio URLs
  },
  "summary": string | null,       // 1-2 sentence professional summary if explicit, else null
  "current_role": string | null,  // most recent role title, or null if unemployed
  "total_experience_years": number,  // best-effort total years of professional experience (sum of role durations, deduplicated)
  "skills": string[],             // hard + soft skills, deduplicated, order from most prominent to least
  "experiences": [
    {
      "title": string,
      "organization": string,
      "start_date": string | null,   // ISO YYYY-MM if extractable, else freeform
      "end_date": string | null,     // "Present" if current
      "duration_months": number | null,
      "bullets": string[],           // each accomplishment as a single concise sentence
      "technologies": string[]       // technologies used in this role
    }
  ],
  "projects": [
    {
      "name": string,
      "description": string,
      "technologies": string[],
      "url": string | null
    }
  ],
  "education": [
    {
      "degree": string,
      "institution": string,
      "start_date": string | null,
      "end_date": string | null,
      "details": string | null     // GPA, honors, relevant coursework if listed
    }
  ],
  "certifications": string[]
}

RULES:
- Be exhaustive: capture every role, project, and skill. Resumes often span 2-3 pages — read all of it.
- Normalize titles ("Sr. Software Engineer" → "Senior Software Engineer").
- For technologies, extract specific named tools/languages/frameworks (e.g. "React", "PostgreSQL", "Kubernetes"), not generic phrases ("databases", "frontend frameworks").
- If a field is genuinely absent from the resume, use null (or [] for arrays). Never invent.
- If start/end dates are present but ambiguous (e.g. "2021"), set duration_months to null rather than guessing.

Respond with raw JSON only. Do not wrap in markdown. Do not add commentary.

RESUME TEXT:
"""
{{RESUME_TEXT}}
"""`;

export const JD_PARSE_PROMPT = `You are an expert job description analyst. Extract the structured posting from the JD text below into strict JSON.

JSON SCHEMA:
{
  "title": string,
  "company": string,                     // best-effort; if unclear, use "" (never null)
  "location": string,                    // city/region or "Remote"; "" if unclear
  "level": "junior" | "mid" | "senior" | "staff" | "principal" | string,
  "technologies": string[],              // specific named technologies required
  "requirements": string[],              // each must-have as a concise sentence
  "nice_to_haves": string[],
  "keywords": string[],                  // ATS-style keywords, deduplicated
  "compensation_hint": string | null,    // verbatim if salary range is mentioned, else null
  "min_years_experience": number | null,
  "remote_policy": "remote" | "hybrid" | "onsite" | string,
  "responsibilities": string[]           // day-to-day duties as concise sentences
}

RULES:
- Infer level from years of experience and seniority cues if not explicit ("0-2 years" → junior, "3-5" → mid, "6-9" → senior, "10+" → staff/principal).
- For company, try the JD body; if missing, leave as "".
- Compensation: only extract if a number or range is present. Phrases like "competitive" → null.
- Be exhaustive on requirements; do not summarize away technical specifics.

Respond with raw JSON only. Do not wrap in markdown.

JOB DESCRIPTION TEXT:
"""
{{JD_TEXT}}
"""`;

export const COMPACT_PERSONA_PROMPT = `Given the structured resume below, write a single-paragraph (<= 80 words) third-person professional persona summary that captures: years of experience, core domain, top 3-5 specializations, and most recent senior role. This will be injected into LLM prompts as system context — be dense and factual, no fluff.

STRUCTURED RESUME:
{{RESUME_JSON}}

Respond with the paragraph only. No markdown, no prefix, no quotes.`;

export const INTRO_SHORT_PROMPT = `Write a concise self-introduction (2-3 sentences, ~40 words) the candidate could say in casual networking. First-person voice, conversational, mentions current role + top 1-2 specializations + 1 standout accomplishment.

STRUCTURED RESUME:
{{RESUME_JSON}}

Respond with the spoken text only. No quotes, no preamble.`;

export const INTRO_INTERVIEW_PROMPT = `Write a structured "tell me about yourself" interview answer (~150 words, 4-6 sentences) using the present-past-future pattern:
1. Present: current role + 1-2 specializations
2. Past: career arc — 2-3 most relevant prior roles in chronological order, each with a concrete impact
3. Future: why this role/this company is a logical next step (use the JD if provided to tailor; otherwise speak generally about the candidate's growth direction)

First-person voice. Confident, not boastful. No bullet points. Numbers preferred over adjectives.

STRUCTURED RESUME:
{{RESUME_JSON}}

ACTIVE JD (may be null):
{{JD_JSON}}

Respond with the spoken text only. No quotes, no preamble.`;

export const INTRO_DETECTION_PROMPT = `Classify whether this question is an interview-style introduction request. Return strict JSON.

QUESTION:
"""
{{QUESTION}}
"""

JSON SCHEMA:
{
  "isIntro": boolean,
  "type": "background" | "role" | "general" | "none",  // "background" = "tell me about yourself" / "walk me through your career"; "role" = "what are you looking for" / "why this role"; "general" = generic intro; "none" = not an intro
  "reasoning": string  // 1 short sentence
}

Respond with raw JSON only.`;

export const COMPANY_RESEARCH_SYNTHESIS_PROMPT = `You are a research analyst preparing a candidate's interview dossier on {{COMPANY}}.

USE THE WEB SEARCH SNIPPETS BELOW AS PRIMARY SOURCES. If search snippets are empty, fall back to your training data and clearly mark sources as "model knowledge — verify before interview".

JD CONTEXT (the role the candidate is interviewing for):
{{JD_CONTEXT}}

WEB SEARCH SNIPPETS (may be empty if no Tavily key configured):
{{SEARCH_SNIPPETS}}

Produce strict JSON in this schema:
{
  "hiring_strategy": string,                    // 1-2 sentences: how the company hires (volume, bar, common rounds)
  "interview_focus": string,                    // 1-2 sentences: what they emphasize (system design, coding, behavioral, culture fit)
  "interview_difficulty": "easy" | "medium" | "hard",
  "salary_estimates": [                         // 1-3 estimates for similar roles in similar locations
    {
      "title": string,
      "location": string,
      "currency": string,                       // e.g. "USD"
      "min": number,
      "max": number,
      "confidence": "high" | "medium" | "low"
    }
  ],
  "culture_ratings": {                          // approximate from reviews; 0-5 scale
    "overall": number,
    "review_count": number | null,
    "data_sources": string[],                   // e.g. ["Glassdoor", "LinkedIn"]
    "work_life_balance": number,
    "career_growth": number,
    "compensation": number,
    "management": number,
    "diversity": number
  },
  "employee_reviews": [                          // 2-4 representative quotes
    {
      "quote": string,
      "sentiment": "positive" | "mixed" | "negative",
      "role": string | null,
      "source": string | null                    // e.g. "Glassdoor 2024"
    }
  ],
  "critics": [                                   // common complaints
    {
      "category": string,                        // e.g. "compensation", "management", "growth"
      "complaint": string,
      "frequency": "widespread" | "frequently" | "occasionally"
    }
  ],
  "benefits": string[],                          // e.g. ["unlimited PTO", "401k 4% match"]
  "core_values": string[],
  "recent_news": string,                         // 1-2 sentences on the past 12 months
  "competitors": string[],                       // 3-6 companies in the same space
  "sources": string[]                            // URLs from search snippets actually cited; if none, ["model knowledge — verify before interview"]
}

RULES:
- Be specific. "Good benefits" is not useful; "unlimited PTO + 401k match up to 4%" is.
- Salary numbers: only quote if the search snippets or your high-confidence training data support it. Set confidence: "low" otherwise.
- If the company is small/private and data is sparse, return reasonable null/empty fields rather than fabricating.
- Sources must be real URLs from the snippets, or the disclaimer string above.

Respond with raw JSON only.`;

export const NEGOTIATION_SCRIPT_PROMPT = `You are a negotiation coach for a candidate interviewing at {{COMPANY}}.

INPUTS:
- Candidate seniority and specializations: {{RESUME_SUMMARY}}
- Role being interviewed for: {{JD_SUMMARY}}
- Cached company dossier (may be null): {{DOSSIER_SNIPPET}}

Produce a negotiation playbook in strict JSON:
{
  "salary_range": {
    "currency": string,                        // e.g. "USD"
    "min": number,                             // candidate's floor — what they should not go below
    "max": number,                             // ambitious target
    "confidence": "high" | "medium" | "low"
  },
  "opening_line": string,                      // exactly what the candidate says when first asked for expectations. ~20-30 words. First-person voice. Anchor high but not absurd.
  "justification": string,                     // 2-3 sentences explaining why this number is fair given experience, market, and role scope. Reference specific resume strengths.
  "counter_offer_fallback": string,            // exactly what to say if their first offer is below the candidate's floor. ~25 words.
  "sources": string[]                          // markers like "JD compensation_hint", "company dossier salary_estimates", "BLS data" — be honest about what backed the range
}

RULES:
- If the JD has a compensation_hint with explicit numbers, anchor near the top of that range.
- If the dossier has salary_estimates, use them as a market sanity check.
- Otherwise, infer from level + tech stack + location. Set confidence: "low".
- The opening_line and counter_offer_fallback are spoken verbatim — write them like the candidate would say them, not like a memo.

Respond with raw JSON only.`;

export const NEGOTIATION_INTENT_PROMPT = `Classify this recruiter/interviewer utterance for negotiation state tracking. Return strict JSON.

UTTERANCE:
"""
{{UTTERANCE}}
"""

JSON SCHEMA:
{
  "intent": "asking_expectations" | "making_offer" | "counter" | "closing" | "other",
  "amount": number | null,                     // if a salary number is mentioned
  "currency": string | null,                   // e.g. "USD"
  "confidence": "high" | "medium" | "low"
}

- "asking_expectations": e.g. "what are your salary expectations"
- "making_offer": e.g. "we're prepared to offer 180k base"
- "counter": e.g. "we can come up to 195k but that's our ceiling"
- "closing": e.g. "can we move forward at this number"
- "other": anything else

Respond with raw JSON only.`;

export const LIVE_COACHING_PROMPT = `You are giving a candidate live, in-meeting coaching during a salary negotiation. The recruiter just said something. Respond with the EXACT line the candidate should say next.

TRACKER STATE:
{{TRACKER_STATE}}

CACHED NEGOTIATION SCRIPT (the candidate's prepared playbook):
{{SCRIPT}}

RECRUITER'S RECENT UTTERANCES (most recent last):
{{RECENT_UTTERANCES}}

Output strict JSON:
{
  "tacticalNote": string,    // 1 sentence: what the recruiter is doing and why this response works
  "exactScript": string,     // ~25 words; first-person; spoken verbatim; do NOT hedge
  "phase": "opening" | "anchored" | "countering" | "closing" | "walking_away",
  "theirOffer": number | null,
  "yourTarget": number | null,
  "currency": string,
  "showSilenceTimer": boolean   // true if the candidate should stop talking after delivering and wait
}

Respond with raw JSON only.`;

export const JSON_REPAIR_PROMPT = `Your previous response was not valid JSON. Fix it now and return only the corrected JSON. Do not wrap in markdown. Do not add commentary.

PREVIOUS RESPONSE:
"""
{{PREV}}
"""`;
