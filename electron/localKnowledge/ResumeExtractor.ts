// electron/localKnowledge/ResumeExtractor.ts
//
// Turns resume text into a structured profile, using a local model when one is
// running and deterministic parsing when one is not.
//
// The fallback is not a nicety. electron/services/knowledge/OkfExtractor.ts
// states the principle this follows: "extraction must work even when every
// provider is unavailable." A user who uploads a resume with Ollama stopped
// should still get their name, roles, and skills, because a profile that
// silently fails to build looks identical to a feature that does not work.
//
// Everything the model returns passes through
// electron/localKnowledge/profileNormalization.ts before it is stored. The
// model proposes; deterministic code decides the date format, the ordering, and
// the flattened skill list. See that file for why each of those is not left to
// the model.

import type { LocalIngestedDocument } from './DocumentReader';
import {
  canonicalizeProfile,
  isUsableProfile,
  type CanonicalProfileFacts,
} from './profileNormalization';

export type ExtractionMode = 'local_llm' | 'heuristic';

export interface ExtractProfileOptions {
  /** Defaults to the address LLMHelper uses (electron/LLMHelper.ts:396). */
  ollamaUrl?: string;
  /** Ollama model tag. When absent, the first installed model is used. */
  model?: string;
  /** Injected for tests, so date-dependent ordering is not wall-clock dependent. */
  now?: Date;
  /** Injected for tests, and so a caller can supply its own transport. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface ExtractProfileResult {
  structured_data: CanonicalProfileFacts;
  extractionMode: ExtractionMode;
  /** Non-fatal problems worth surfacing in diagnostics, never to the model. */
  warnings: string[];
}

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Resumes are short. This cap exists for the pathological case: a 40-page CV,
 * or a text file the user mislabelled. Truncating keeps the request inside a
 * small local model's context instead of failing the whole extraction.
 */
const MAX_PROMPT_CHARS = 20_000;

const EXTRACTION_INSTRUCTIONS = [
  'You extract structured data from a resume. Return JSON only, with no prose and no code fences.',
  '',
  'Use exactly this shape. Omit any field the resume does not state:',
  '{',
  '  "name": "string",',
  '  "experience": [{"role": "string", "company": "string", "start_date": "YYYY-MM", "end_date": "YYYY-MM", "bullets": ["string"]}],',
  '  "education": [{"degree": "string", "field": "string", "institution": "string"}],',
  '  "projects": [{"name": "string", "description": "string", "technologies": ["string"], "highlights": ["string"]}],',
  '  "skills": {"languages": ["string"], "frameworks": ["string"], "tools": ["string"]}',
  '}',
  '',
  'Rules:',
  '- Copy facts from the resume. Never infer, complete, or invent a value.',
  '- If a role has not ended, set "end_date" to "Present".',
  '- If the resume gives only a year with no month, omit that date field entirely.',
  '- Order experience with the most recent role first.',
  '- Keep bullets as the resume wrote them. Do not summarize or rewrite them.',
  '- Group skills under the headings the resume uses. If it has no headings, put them all under "skills".',
].join('\n');

/** Strip the code fence a model adds despite being told not to. */
function extractJsonPayload(raw: string): string {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();

  // Fall back to the outermost braces, which survives a leading apology line.
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) return text.slice(first, last + 1);

  return text;
}

interface InstalledModel {
  name: string;
  capabilities: string[];
}

/** Read the installed models and their capabilities from Ollama. */
async function listInstalledModels(
  ollamaUrl: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<InstalledModel[]> {
  const response = await fetchImpl(`${ollamaUrl}/api/tags`, {
    signal: AbortSignal.timeout(Math.min(timeoutMs, 10_000)),
  });
  if (!response.ok) return [];
  const data = (await response.json()) as {
    models?: Array<{ name?: unknown; capabilities?: unknown }>;
  };
  return (data?.models ?? [])
    .filter((entry) => typeof entry?.name === 'string' && entry.name)
    .map((entry) => ({
      name: String(entry.name),
      capabilities: Array.isArray(entry.capabilities) ? entry.capabilities.map(String) : [],
    }));
}

/**
 * Choose a model that can actually hold a conversation.
 *
 * Taking the first installed model is wrong: an embedding model such as
 * nomic-embed-text is a normal thing to have installed, it sorts wherever
 * Ollama puts it, and sending it a chat request fails. Verified against a real
 * Ollama install, where the embedding model sat in the returned list alongside
 * four chat models.
 *
 * A model that reports no capabilities at all is still accepted, because older
 * Ollama versions omit the field and refusing those would be worse than trying.
 */
function pickChatModel(models: InstalledModel[]): string | null {
  const usable = models.find(
    (model) =>
      model.capabilities.length === 0
        ? !/embed/i.test(model.name)
        : model.capabilities.includes('completion'),
  );
  return usable ? usable.name : null;
}

/** One non-streaming JSON-mode chat call. */
async function requestExtraction(
  resumeText: string,
  model: string,
  ollamaUrl: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  suppressThinking: boolean,
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: EXTRACTION_INSTRUCTIONS },
      { role: 'user', content: resumeText },
    ],
    stream: false,
    // Ollama's JSON mode. It constrains the decoder, which matters far more
    // for a small local model than the instruction text alone.
    format: 'json',
    options: {
      // Extraction is a copying task, not a creative one. A fixed low
      // temperature also makes re-ingesting the same resume reproducible.
      temperature: 0,
      top_p: 0.9,
    },
  };

  // Reasoning models spend their whole budget thinking before emitting the
  // object. Measured against a real install: gemma4:12b-mlx hit the 120s
  // timeout on a 335-character resume with thinking left on. LLMHelper
  // suppresses it the same way for the same reason (electron/LLMHelper.ts:1691).
  // The field is only sent when the model reports the capability, because
  // sending it to a model without thinking support is not universally accepted.
  if (suppressThinking) body.think = false;

  const response = await fetchImpl(`${ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Ollama /api/chat ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as { message?: { content?: unknown }; response?: unknown };
  const content = data?.message?.content ?? data?.response ?? '';
  return typeof content === 'string' ? content : '';
}

// --- Deterministic fallback -------------------------------------------------

const SECTION_PATTERNS: Array<{ key: string; test: RegExp }> = [
  { key: 'experience', test: /^(work\s+)?(experience|employment|professional experience|work history)\b/i },
  { key: 'education', test: /^education\b/i },
  { key: 'skills', test: /^(technical\s+)?skills\b|^technologies\b/i },
  { key: 'projects', test: /^(personal\s+)?projects\b/i },
];

/** A heading is a short line that names a known section. */
function sectionKeyFor(line: string): string | null {
  const text = line.trim().replace(/[:\-_]+$/, '');
  if (!text || text.length > 40) return null;
  for (const { key, test } of SECTION_PATTERNS) {
    if (test.test(text)) return key;
  }
  return null;
}

function splitIntoSections(content: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current = 'header';
  sections.set(current, []);

  for (const line of content.split('\n')) {
    const key = sectionKeyFor(line);
    if (key) {
      current = key;
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    sections.get(current)!.push(line);
  }

  return sections;
}

/**
 * A person's name, taken from the top of the document.
 *
 * Resumes put the name on the first substantive line. The checks reject the
 * lines that commonly sit there instead: contact details, addresses, and
 * headline titles.
 */
function guessName(headerLines: string[]): string {
  for (const line of headerLines.slice(0, 6)) {
    const text = line.trim();
    if (!text || text.length > 60) continue;
    if (/[@|]|https?:|\d{3}/.test(text)) continue;
    const words = text.split(/\s+/);
    if (words.length < 2 || words.length > 4) continue;
    if (!/^[A-Za-z][A-Za-z'.\-]*$/.test(words[0])) continue;
    // A line in all capitals is still a name on many resumes, so it is allowed.
    return text;
  }
  return '';
}

/** `Jun 2023 - Present`, `2021-03 to 2022-01`, and similar. */
const DATE_RANGE = new RegExp(
  '([A-Za-z]{3,9}\\.?\\s+\\d{4}|\\d{4}[-/]\\d{1,2}|\\d{1,2}[/-]\\d{4}|\\d{4})'
  + '\\s*(?:-|to|until|through)\\s*'
  + '([A-Za-z]{3,9}\\.?\\s+\\d{4}|\\d{4}[-/]\\d{1,2}|\\d{1,2}[/-]\\d{4}|\\d{4}|present|current|now)',
  'i',
);

/**
 * Parse experience entries without a model.
 *
 * Each entry starts at a line carrying a date range, which is the one reliable
 * structural signal across resume layouts. Role and company come from that same
 * line, split on the usual separators; bullets are the lines that follow until
 * the next dated line.
 */
function heuristicExperience(lines: string[]): Array<Record<string, unknown>> {
  const entries: Array<Record<string, unknown>> = [];
  let current: Record<string, unknown> | null = null;
  let bullets: string[] = [];

  const flush = () => {
    if (!current) return;
    if (bullets.length) current.bullets = bullets.slice(0, 12);
    entries.push(current);
    current = null;
    bullets = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const range = line.match(DATE_RANGE);
    if (range) {
      flush();
      // Removing the range leaves the punctuation that wrapped it. Verified on
      // a real fixture: "Northwind Systems (2021-2026)" became "Northwind
      // Systems ()" and was stored as the company name.
      const withoutDates = line
        .replace(range[0], '')
        .replace(/[|]/g, ',')
        .replace(/\(\s*\)|\[\s*\]|\{\s*\}/g, '')
        .replace(/[\s,;:.\-]+$/, '')
        .trim();
      const parts = withoutDates.split(/\s+[-]\s+|,\s*|\s+at\s+/i).map((p) => p.trim()).filter(Boolean);
      current = { start_date: range[1], end_date: range[2] };
      if (parts[0]) current.role = parts[0];
      if (parts[1]) current.company = parts[1];
      continue;
    }

    if (!current) continue;
    const bullet = line.replace(/^[•‣◦⁃∙*\-]\s*/, '').trim();
    if (bullet) bullets.push(bullet);
  }

  flush();
  return entries;
}

function heuristicSkills(lines: string[]): Record<string, string[]> {
  const skills: Record<string, string[]> = {};
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // `Languages: Python, Go` keeps its category; a bare list does not have one.
    const labelled = line.match(/^([A-Za-z][A-Za-z\s/&+]{1,30}):\s*(.+)$/);
    const category = labelled ? labelled[1].trim().toLowerCase() : 'skills';
    const body = labelled ? labelled[2] : line;
    const values = body.split(/[,;|]/).map((v) => v.trim()).filter((v) => v.length > 1 && v.length < 40);
    if (!values.length) continue;
    skills[category] = [...(skills[category] ?? []), ...values];
  }
  return skills;
}

function heuristicEducation(lines: string[]): Array<Record<string, unknown>> {
  const entries: Array<Record<string, unknown>> = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.length < 6) continue;
    const degreeMatch = line.match(/\b(B\.?S\.?|B\.?A\.?|M\.?S\.?|M\.?A\.?|Ph\.?D\.?|Bachelor[a-z']*|Master[a-z']*|Doctorate|Associate)\b[^,|]*/i);
    const institutionMatch = line.match(/\b([A-Z][A-Za-z.'-]*(?:\s+(?:of|and|the))?(?:\s+[A-Z][A-Za-z.'-]*)*\s+(?:University|College|Institute|School))\b/);
    if (!degreeMatch && !institutionMatch) continue;
    const entry: Record<string, unknown> = {};
    if (degreeMatch) entry.degree = degreeMatch[0].trim();
    if (institutionMatch) entry.institution = institutionMatch[1].trim();
    entries.push(entry);
  }
  return entries;
}

/** Structure a resume with no model available. Finds less, invents nothing. */
export function heuristicExtract(content: string): Record<string, unknown> {
  const sections = splitIntoSections(content);
  const out: Record<string, unknown> = {};

  const name = guessName(sections.get('header') ?? []);
  if (name) out.name = name;

  const experience = heuristicExperience(sections.get('experience') ?? []);
  if (experience.length) out.experience = experience;

  const education = heuristicEducation(sections.get('education') ?? []);
  if (education.length) out.education = education;

  const skills = heuristicSkills(sections.get('skills') ?? []);
  if (Object.keys(skills).length) out.skills = skills;

  return out;
}

// --- Entry point ------------------------------------------------------------

/**
 * Record roles that ended up with no usable dates.
 *
 * The common cause is a resume that writes a year-only range such as
 * "(2021-2026)". A year carries no month, so it cannot become the `YYYY-MM` the
 * readers parse, and the alternative of assuming January would answer "how long
 * were you there" with a number that is confidently wrong by up to a year. The
 * date is dropped instead, and this warning makes that visible rather than
 * silent, since the role itself is still stored and still answerable.
 */
function warnDroppedDates(profile: CanonicalProfileFacts, warnings: string[]): void {
  const undated = (profile.experience ?? []).filter((entry) => !entry.start_date).length;
  if (undated > 0) {
    warnings.push(
      `${undated} role(s) gave no month-level dates, so tenure and gap answers are unavailable for them.`,
    );
  }
}

/**
 * Build a structured profile from an ingested resume.
 *
 * Never throws and never returns nothing. A model failure degrades to
 * deterministic parsing, and a deterministic parse that finds nothing still
 * returns an empty profile with the reason recorded in `warnings`, so the
 * caller can tell "no model" apart from "unreadable resume".
 */
export async function extractStructuredProfile(
  document: Pick<LocalIngestedDocument, 'content'>,
  options: ExtractProfileOptions = {},
): Promise<ExtractProfileResult> {
  const now = options.now ?? new Date();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const ollamaUrl = (options.ollamaUrl ?? DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const warnings: string[] = [];

  const content = document.content ?? '';
  const resumeText = content.length > MAX_PROMPT_CHARS ? content.slice(0, MAX_PROMPT_CHARS) : content;
  if (content.length > MAX_PROMPT_CHARS) {
    warnings.push(`Resume text truncated to ${MAX_PROMPT_CHARS} characters for extraction.`);
  }

  if (fetchImpl) {
    try {
      const installed = await listInstalledModels(ollamaUrl, fetchImpl, timeoutMs).catch(() => []);
      const model = options.model ?? pickChatModel(installed);
      if (!model) {
        warnings.push('No local chat model is installed, so extraction used deterministic parsing.');
      } else {
        const suppressThinking = installed
          .find((entry) => entry.name === model)
          ?.capabilities.includes('thinking') ?? false;
        const raw = await requestExtraction(resumeText, model, ollamaUrl, fetchImpl, timeoutMs, suppressThinking);
        const parsed = JSON.parse(extractJsonPayload(raw)) as unknown;
        const profile = canonicalizeProfile(parsed, { now, extractionMode: 'local_llm' });
        if (isUsableProfile(profile)) {
          warnDroppedDates(profile, warnings);
          return { structured_data: profile, extractionMode: 'local_llm', warnings };
        }
        warnings.push('The local model returned no usable fields, so extraction used deterministic parsing.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Local model extraction failed (${message}), so extraction used deterministic parsing.`);
    }
  } else {
    warnings.push('No fetch implementation is available, so extraction used deterministic parsing.');
  }

  const profile = canonicalizeProfile(heuristicExtract(resumeText), { now, extractionMode: 'heuristic' });
  if (!isUsableProfile(profile)) {
    warnings.push('No profile fields could be read from this document.');
  }
  warnDroppedDates(profile, warnings);
  return { structured_data: profile, extractionMode: 'heuristic', warnings };
}
