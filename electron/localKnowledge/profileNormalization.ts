// electron/localKnowledge/profileNormalization.ts
//
// Deterministic shaping of a structured resume. No model runs here.
//
// A language model is good at finding which words are the job title and which
// are the company. It is unreliable at arithmetic and at emitting a strict date
// format on every entry. This module owns everything in the second category, so
// the model's output passes through code that guarantees the contract the free
// tree already depends on:
//
// - Dates must be exactly `YYYY-MM`. electron/llm/manualProfileIntelligence.ts
//   parses them with /^(\d{4})-(\d{2})$/ and returns null on anything else, so
//   "June 2024" silently disables every tenure and gap answer for that role.
// - `experience[0]` is read as the CURRENT role (manualProfileIntelligence's
//   formatIntro takes `exp[0]` for "I'm a <role> at <company>"), so ordering is
//   part of the contract, not a presentation detail.
// - Durations are never stored. The free tree computes them at query time from
//   start_date and end_date. Storing a years-of-experience number would create
//   a second source of truth that goes stale the month after ingestion.
//
// Absent data stays absent. A resume that gives only a year for a role gets no
// start_date rather than an invented month, because a fabricated date produces
// a confident wrong answer to "how long were you there" instead of no answer.

/** Canonical structured resume. Field names match what the free-tree readers try first. */
export interface CanonicalProfileExperience {
  role?: string;
  company?: string;
  bullets?: string[];
  /** `YYYY-MM`, or absent when the resume did not give a parseable month. */
  start_date?: string;
  /** `YYYY-MM`. Absent means the role is ongoing, which the readers resolve to now. */
  end_date?: string;
}

export interface CanonicalProfileProject {
  name?: string;
  description?: string;
  technologies?: string[];
  highlights?: string[];
}

export interface CanonicalProfileEducation {
  degree?: string;
  field?: string;
  institution?: string;
}

export interface CanonicalProfileFacts {
  identity?: { name?: string };
  name?: string;
  experience?: CanonicalProfileExperience[];
  projects?: CanonicalProfileProject[];
  education?: CanonicalProfileEducation[];
  /** Categorized skills, as the resume presented them. */
  skills?: Record<string, string[]>;
  /** Flattened skills. The readers prefer this when present. */
  skills_flat?: string[];
  /** How this profile was produced, for diagnostics. */
  _extraction_mode?: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/** Words a resume uses for a role that has not ended. */
const ONGOING_WORDS = /^(present|current|now|ongoing|to date|till date|date)$/i;

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/** True when the value means "this role has not ended". */
export function isOngoing(raw: unknown): boolean {
  const text = asText(raw);
  return text.length > 0 && ONGOING_WORDS.test(text);
}

/**
 * Parse a resume date into the strict `YYYY-MM` the readers require.
 *
 * Returns undefined rather than guessing. A year with no month is the common
 * case for that: "2023 - 2024" gives no month, and inventing January would make
 * a tenure answer that reads as precise while being wrong by up to 11 months.
 */
export function normalizeYearMonth(raw: unknown): string | undefined {
  const text = asText(raw);
  if (!text || isOngoing(text)) return undefined;

  // Already canonical.
  const iso = text.match(/^(\d{4})-(\d{1,2})$/);
  if (iso) {
    const month = Number(iso[2]);
    if (month >= 1 && month <= 12) return `${iso[1]}-${pad2(month)}`;
    return undefined;
  }

  // Full ISO date: take the year and month.
  const isoDay = text.match(/^(\d{4})-(\d{2})-\d{2}/);
  if (isoDay) return `${isoDay[1]}-${isoDay[2]}`;

  // `2024/06`.
  const slashYearFirst = text.match(/^(\d{4})\/(\d{1,2})$/);
  if (slashYearFirst) {
    const month = Number(slashYearFirst[2]);
    if (month >= 1 && month <= 12) return `${slashYearFirst[1]}-${pad2(month)}`;
    return undefined;
  }

  // `06/2024` or `6-2024`.
  const monthFirst = text.match(/^(\d{1,2})[\/-](\d{4})$/);
  if (monthFirst) {
    const month = Number(monthFirst[1]);
    if (month >= 1 && month <= 12) return `${monthFirst[2]}-${pad2(month)}`;
    return undefined;
  }

  // `June 2024`, `Jun. 2024`, `SEPT 2024`.
  const named = text.match(/^([A-Za-z]{3,9})\.?\s+(\d{4})$/);
  if (named) {
    const month = MONTHS[named[1].toLowerCase()];
    if (month) return `${named[2]}-${pad2(month)}`;
    return undefined;
  }

  // `2024 June`.
  const yearFirstNamed = text.match(/^(\d{4})\s+([A-Za-z]{3,9})\.?$/);
  if (yearFirstNamed) {
    const month = MONTHS[yearFirstNamed[2].toLowerCase()];
    if (month) return `${yearFirstNamed[1]}-${pad2(month)}`;
    return undefined;
  }

  // A bare year carries no month, so it cannot become a canonical date.
  return undefined;
}

const monthIndex = (yearMonth: string): number => {
  const [year, month] = yearMonth.split('-').map(Number);
  return year * 12 + (month - 1);
};

const asStringArray = (value: unknown, limit: number): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const text = typeof item === 'string' ? item.trim() : asText((item as { name?: unknown })?.name);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
};

/** Read the first present value among several aliases a model might emit. */
const firstText = (source: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const text = asText(source[key]);
    if (text) return text;
  }
  return '';
};

const firstArray = (source: Record<string, unknown>, keys: string[], limit: number): string[] => {
  for (const key of keys) {
    const list = asStringArray(source[key], limit);
    if (list.length) return list;
  }
  return [];
};

/**
 * Order roles so `experience[0]` is the one the candidate holds now.
 *
 * Ongoing roles come first, then roles by most recent end date, then by most
 * recent start. Entries with no parseable date keep their original relative
 * order and sit last: the resume's own ordering is the only signal left, and
 * inventing a position for them would be worse than preserving it.
 */
export function sortExperienceMostRecentFirst(
  entries: CanonicalProfileExperience[],
  now: Date,
): CanonicalProfileExperience[] {
  const nowIndex = now.getFullYear() * 12 + now.getMonth();

  return entries
    .map((entry, originalIndex) => ({ entry, originalIndex }))
    .sort((a, b) => {
      const aDated = Boolean(a.entry.start_date || a.entry.end_date);
      const bDated = Boolean(b.entry.start_date || b.entry.end_date);
      if (aDated !== bDated) return aDated ? -1 : 1;
      if (!aDated) return a.originalIndex - b.originalIndex;

      // An ongoing role has no end_date, so it resolves to now and sorts first.
      const aEnd = a.entry.end_date ? monthIndex(a.entry.end_date) : nowIndex;
      const bEnd = b.entry.end_date ? monthIndex(b.entry.end_date) : nowIndex;
      if (aEnd !== bEnd) return bEnd - aEnd;

      const aStart = a.entry.start_date ? monthIndex(a.entry.start_date) : -Infinity;
      const bStart = b.entry.start_date ? monthIndex(b.entry.start_date) : -Infinity;
      if (aStart !== bStart) return bStart - aStart;

      return a.originalIndex - b.originalIndex;
    })
    .map((item) => item.entry);
}

/** Flatten categorized skills into the single list the readers prefer. */
export function buildSkillsFlat(skills: Record<string, string[]> | undefined, limit = 120): string[] {
  if (!skills) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const values of Object.values(skills)) {
    for (const value of values) {
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(value);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

const MAX_EXPERIENCE = 25;
const MAX_PROJECTS = 25;
const MAX_EDUCATION = 15;
const MAX_BULLETS = 12;

function canonicalizeExperience(raw: unknown): CanonicalProfileExperience[] {
  if (!Array.isArray(raw)) return [];
  const out: CanonicalProfileExperience[] = [];

  for (const item of raw.slice(0, MAX_EXPERIENCE)) {
    if (!item || typeof item !== 'object') continue;
    const source = item as Record<string, unknown>;

    const role = firstText(source, ['role', 'title', 'position']);
    const company = firstText(source, ['company', 'organization', 'employer']);
    if (!role && !company) continue;

    const entry: CanonicalProfileExperience = {};
    if (role) entry.role = role;
    if (company) entry.company = company;

    const bullets = firstArray(source, ['bullets', 'highlights', 'responsibilities', 'achievements'], MAX_BULLETS);
    if (bullets.length) entry.bullets = bullets;

    const start = normalizeYearMonth(source.start_date ?? source.startDate ?? source.start);
    if (start) entry.start_date = start;

    // An ongoing role must have NO end_date: the readers resolve a missing end
    // to now, and writing "Present" there would fail the strict date parse and
    // disable the role's tenure answer entirely.
    const rawEnd = source.end_date ?? source.endDate ?? source.end;
    if (!isOngoing(rawEnd)) {
      const end = normalizeYearMonth(rawEnd);
      if (end) entry.end_date = end;
    }

    out.push(entry);
  }

  return out;
}

function canonicalizeProjects(raw: unknown): CanonicalProfileProject[] {
  if (!Array.isArray(raw)) return [];
  const out: CanonicalProfileProject[] = [];

  for (const item of raw.slice(0, MAX_PROJECTS)) {
    if (!item || typeof item !== 'object') continue;
    const source = item as Record<string, unknown>;

    const name = firstText(source, ['name', 'title']);
    if (!name) continue;

    const project: CanonicalProfileProject = { name };
    const description = firstText(source, ['description', 'summary']);
    if (description) project.description = description;
    const technologies = firstArray(source, ['technologies', 'tech_stack', 'techStack', 'tools'], 30);
    if (technologies.length) project.technologies = technologies;
    const highlights = firstArray(source, ['highlights', 'bullets'], MAX_BULLETS);
    if (highlights.length) project.highlights = highlights;

    out.push(project);
  }

  return out;
}

function canonicalizeEducation(raw: unknown): CanonicalProfileEducation[] {
  if (!Array.isArray(raw)) return [];
  const out: CanonicalProfileEducation[] = [];

  for (const item of raw.slice(0, MAX_EDUCATION)) {
    if (!item || typeof item !== 'object') continue;
    const source = item as Record<string, unknown>;

    const degree = firstText(source, ['degree', 'qualification']);
    const institution = firstText(source, ['institution', 'school', 'university', 'college']);
    if (!degree && !institution) continue;

    const entry: CanonicalProfileEducation = {};
    if (degree) entry.degree = degree;
    if (institution) entry.institution = institution;
    const field = firstText(source, ['field', 'major', 'field_of_study']);
    if (field) entry.field = field;

    out.push(entry);
  }

  return out;
}

function canonicalizeSkills(raw: unknown): Record<string, string[]> | undefined {
  // A flat list is legal input; file it under one category so the categorized
  // shape stays the single internal representation.
  if (Array.isArray(raw)) {
    const flat = asStringArray(raw, 200);
    return flat.length ? { skills: flat } : undefined;
  }
  if (!raw || typeof raw !== 'object') return undefined;

  const out: Record<string, string[]> = {};
  for (const [category, values] of Object.entries(raw as Record<string, unknown>)) {
    const list = asStringArray(values, 60);
    if (list.length) out[category.trim() || 'skills'] = list;
  }
  if (!Object.keys(out).length) return undefined;

  // Observed against a real local model on a resume whose skills line carried
  // no headings: it returned {"SQL":["SQL"],"Tableau":["Tableau"],...}, making
  // every skill its own category. Retrieval still worked, because the readers
  // prefer skills_flat, but the stored categories were noise that any profile
  // view would render. When every category holds exactly one value and its own
  // name, there are no real categories, so collapse to a single list.
  const categories = Object.entries(out);
  const eachIsItsOwnCategory = categories.length > 2
    && categories.every(([name, values]) => values.length === 1 && values[0].toLowerCase() === name.toLowerCase());
  if (eachIsItsOwnCategory) {
    return { skills: categories.map(([, values]) => values[0]) };
  }

  return out;
}

/**
 * Turn any plausible extraction output into the canonical structured resume.
 *
 * Accepts loose input on purpose. A local model emits `title` where the schema
 * asked for `role`, or `techStack` for `technologies`, and rejecting that costs
 * the user a working profile for no benefit. Alias handling belongs in one
 * place rather than in every reader.
 */
export function canonicalizeProfile(
  raw: unknown,
  options: { now: Date; extractionMode: string },
): CanonicalProfileFacts {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const identityName =
    asText((source.identity as Record<string, unknown> | undefined)?.name)
    || asText(source.name)
    || asText((source.personal as Record<string, unknown> | undefined)?.name);

  const experience = sortExperienceMostRecentFirst(
    canonicalizeExperience(source.experience ?? source.work_experience ?? source.employment),
    options.now,
  );
  const projects = canonicalizeProjects(source.projects);
  const education = canonicalizeEducation(source.education);
  const skills = canonicalizeSkills(source.skills);

  const profile: CanonicalProfileFacts = { _extraction_mode: options.extractionMode };

  if (identityName) {
    profile.identity = { name: identityName };
    // Written at the top level too: profileName() tries identity.name first but
    // falls back to name, and other readers reach for the top-level field.
    profile.name = identityName;
  }
  if (experience.length) profile.experience = experience;
  if (projects.length) profile.projects = projects;
  if (education.length) profile.education = education;
  if (skills) {
    profile.skills = skills;
    const flat = buildSkillsFlat(skills);
    if (flat.length) profile.skills_flat = flat;
  }

  return profile;
}

/** True when the profile carries enough to answer anything about the candidate. */
export function isUsableProfile(profile: CanonicalProfileFacts): boolean {
  return Boolean(
    profile.name
    || (profile.experience && profile.experience.length > 0)
    || (profile.education && profile.education.length > 0)
    || (profile.skills_flat && profile.skills_flat.length > 0),
  );
}
