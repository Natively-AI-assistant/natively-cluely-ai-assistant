import { ActiveJD, GenerateContentFn } from './types';
import { JD_PARSE_PROMPT } from './prompts';
import { generateJSON, fillTemplate } from './llmInvoker';

export async function parseJD(
  rawText: string,
  generateFn: GenerateContentFn
): Promise<ActiveJD> {
  if (!rawText || rawText.trim().length < 50) {
    throw new Error('JD text too short to parse');
  }

  const jd = await generateJSON<ActiveJD>(
    generateFn,
    fillTemplate(JD_PARSE_PROMPT, { JD_TEXT: rawText.slice(0, 16000) })
  );

  normalizeJD(jd);
  return jd;
}

function normalizeJD(jd: ActiveJD): void {
  jd.title = (jd.title ?? '').trim();
  jd.company = (jd.company ?? '').trim();
  jd.location = (jd.location ?? '').trim();
  jd.level = (jd.level ?? '').toString().trim().toLowerCase();
  jd.technologies = dedupe(jd.technologies ?? []);
  jd.requirements = (jd.requirements ?? []).map(s => s.trim()).filter(Boolean);
  jd.nice_to_haves = (jd.nice_to_haves ?? []).map(s => s.trim()).filter(Boolean);
  jd.keywords = dedupe(jd.keywords ?? []);
  jd.responsibilities = (jd.responsibilities ?? []).map(s => s.trim()).filter(Boolean);
}

function dedupe(arr: string[]): string[] {
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
