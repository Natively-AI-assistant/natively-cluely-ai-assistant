import { StructuredResume, ActiveJD, GenerateContentFn } from './types';
import {
  RESUME_PARSE_PROMPT,
  COMPACT_PERSONA_PROMPT,
  INTRO_SHORT_PROMPT,
  INTRO_INTERVIEW_PROMPT,
} from './prompts';
import { generateJSON, generateText, fillTemplate } from './llmInvoker';

export interface ResumeArtifacts {
  structured: StructuredResume;
  compactPersona: string;
  introShort: string;
  introInterview: string;
}

export async function parseResume(
  rawText: string,
  generateFn: GenerateContentFn,
  jd?: ActiveJD | null
): Promise<ResumeArtifacts> {
  if (!rawText || rawText.trim().length < 50) {
    throw new Error('Resume text too short to parse');
  }

  const structured = await generateJSON<StructuredResume>(
    generateFn,
    fillTemplate(RESUME_PARSE_PROMPT, { RESUME_TEXT: rawText.slice(0, 24000) })
  );

  normalizeStructuredResume(structured);

  const resumeJsonForPrompt = JSON.stringify(structured, null, 2).slice(0, 12000);

  const [compactPersona, introShort, introInterview] = await Promise.all([
    generateText(generateFn, fillTemplate(COMPACT_PERSONA_PROMPT, { RESUME_JSON: resumeJsonForPrompt })),
    generateText(generateFn, fillTemplate(INTRO_SHORT_PROMPT, { RESUME_JSON: resumeJsonForPrompt })),
    generateText(generateFn, fillTemplate(INTRO_INTERVIEW_PROMPT, {
      RESUME_JSON: resumeJsonForPrompt,
      JD_JSON: jd ? JSON.stringify(jd, null, 2).slice(0, 4000) : 'null',
    })),
  ]);

  return { structured, compactPersona, introShort, introInterview };
}

function normalizeStructuredResume(r: StructuredResume): void {
  r.skills = dedupeStringArray(r.skills ?? []);
  r.experiences = (r.experiences ?? []).map(exp => ({
    ...exp,
    bullets: (exp.bullets ?? []).map(s => s.trim()).filter(Boolean),
    technologies: dedupeStringArray(exp.technologies ?? []),
  }));
  r.projects = (r.projects ?? []).map(p => ({
    ...p,
    technologies: dedupeStringArray(p.technologies ?? []),
  }));
  r.education = r.education ?? [];
  r.certifications = r.certifications ?? [];
  if (typeof r.total_experience_years !== 'number') {
    r.total_experience_years = inferYearsFromExperiences(r);
  }
}

function dedupeStringArray(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function inferYearsFromExperiences(r: StructuredResume): number {
  const totalMonths = (r.experiences ?? []).reduce(
    (sum, e) => sum + (typeof e.duration_months === 'number' ? e.duration_months : 0),
    0
  );
  return Math.round((totalMonths / 12) * 10) / 10;
}
