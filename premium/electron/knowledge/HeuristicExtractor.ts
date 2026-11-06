// premium/electron/knowledge/HeuristicExtractor.ts
//
// D2 fix (PROFILE_INTELLIGENCE_RESEARCH_AND_REDESIGN.md §15 R2): a PURE, LLM-free
// fallback parser for resume / JD text.
//
// WHY THIS EXISTS: StructuredExtractor.extractStructuredData is 100% LLM-dependent.
// When the extraction LLM is down / billing-blocked / times out, it throws, so
// ingestDocument returns {success:false} and `activeResume` is never saved — the
// profile is then NEVER ready (profileFactsReady false forever) and identity /
// project questions fall back to the bare chat prompt ("I am Natively"). This was
// the live real-UI failure (resumeLoaded=false for 169s).
//
// This module is the deterministic safety net: it parses the raw text into the
// MINIMUM StructuredResume / StructuredJD shape needed so that
//   - profileFactsReady() returns true (name OR experience OR projects OR skills
//     OR education present), and
//   - the deterministic manual fast path can answer name/skills/experience/
//     projects/education with no provider.
//
// It is intentionally conservative: it NEVER fabricates. A field it cannot find
// stays empty. The richer LLM extraction remains the PRIMARY path; this only runs
// on LLM failure and is stamped `_extraction_mode='heuristic'` so the caller can
// re-extract later when the LLM recovers.
//
// No LLM, no I/O, no electron deps — trivially unit-testable.

import {
  StructuredResume,
  StructuredJD,
  IdentityInfo,
  ExperienceEntry,
  ProjectEntry,
  EducationEntry,
  JDLevel,
  EmploymentType,
  PROFILE_SCHEMA_VERSION,
} from './types';
import { categorizeFlatSkills, flattenSkills } from './skillsUtil';

// ── small text utilities ───────────────────────────────────────────────────

const lines = (text: string): string[] =>
  (text || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd());

const nonEmpty = (ls: string[]): string[] => ls.map((l) => l.trim()).filter(Boolean);

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/;
const GITHUB_RE = /(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_.-]+/i;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/[A-Za-z0-9_/.-]+/i;
const URL_RE = /\bhttps?:\/\/[^\s|]+/i;

// A line looks like a person's name when it's short, title-cased-ish, has no
// digits / @ / urls, isn't an ALL-CAPS section header, and isn't an obvious
// contact/role line.
const SECTION_WORDS = new Set([
  'resume', 'cv', 'curriculum vitae', 'summary', 'objective', 'profile', 'about',
  'skills', 'technical skills', 'experience', 'work experience', 'employment',
  'projects', 'education', 'achievements', 'certifications', 'awards', 'interests',
  'contact', 'references', 'leadership', 'publications', 'languages',
]);

// Words that are NEVER part of a person's name — section headers, contact
// labels, and generic résumé nouns. A line containing ANY of these is not a name
// (catches "PROFESSIONAL SUMMARY", "Meg Donovan Email", "Contact Info").
const NON_NAME_TOKENS = new Set([
  'resume', 'cv', 'summary', 'objective', 'profile', 'about', 'professional',
  'skills', 'experience', 'employment', 'projects', 'education', 'achievements',
  'certifications', 'awards', 'interests', 'contact', 'references', 'leadership',
  'publications', 'languages', 'email', 'phone', 'mobile', 'tel', 'address',
  'linkedin', 'github', 'portfolio', 'website', 'info', 'information', 'details',
  'engineer', 'developer', 'manager', 'analyst', 'consultant', 'nurse', 'designer',
]);

// Professional post-nominal credentials that commonly follow a comma after the
// name ("MARIA GUTIERREZ, RN, BSN, CCRN", "JOHN SMITH, MBA, PMP"). Stripped
// before name-detection so they don't inflate the token count or get mistaken
// for the name itself.
const CREDENTIAL_TOKEN_RE = /^(RN|BSN|MSN|CCRN|CNA|LPN|NP|DNP|MD|PhD|Ph\.?D\.?|MBA|CPA|PE|PMP|CFA|JD|Esq\.?|CISSP|PMI|MPH|DO)\.?$/i;

/** Strip a trailing ", CREDENTIAL, CREDENTIAL…" tail from a name line. */
const stripCredentials = (l: string): string => {
  const parts = l.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return l;
  const kept: string[] = [parts[0]];
  for (let i = 1; i < parts.length; i++) {
    if (!CREDENTIAL_TOKEN_RE.test(parts[i])) kept.push(parts[i]);
  }
  return kept.join(', ');
};

const looksLikeName = (raw: string): boolean => {
  const l = stripCredentials(raw.trim());
  if (!l || l.length > 60) return false;
  if (EMAIL_RE.test(l) || PHONE_RE.test(l) || URL_RE.test(l) || GITHUB_RE.test(l) || LINKEDIN_RE.test(l) || l.includes('@')) return false;
  if (/\d/.test(l)) return false;
  const lower = l.toLowerCase().replace(/[:•|]/g, '').trim();
  if (SECTION_WORDS.has(lower)) return false;
  const tokens = l.split(/\s+/).filter(Boolean);
  if (tokens.length < 1 || tokens.length > 5) return false;
  // Reject if ANY token is a section/label/role word — a real name has none.
  // (Old bug: "PROFESSIONAL SUMMARY" and "Meg Donovan Email" were accepted.)
  if (tokens.some((t) => NON_NAME_TOKENS.has(t.toLowerCase().replace(/[^a-z]/g, '')))) return false;
  // Reject lines that are clearly a role/title — names are capitalized words.
  // Strip surrounding quotes so a quoted nickname (MARGARET "MEG" DONOVAN) counts.
  const looksTitleCased = tokens.every((t) => {
    const c = t.replace(/^["'“”‘’(]+/, '');
    return /^[A-Z]/.test(c) || /^[A-Z]\./.test(c) || t.length <= 3;
  });
  return looksTitleCased;
};

const nameFromEmail = (email: string): string => {
  const local = email.split('@')[0] || '';
  const parts = local.split(/[._-]+/).filter(Boolean)
    // Drop label-ish tokens that are part of the address, not the name
    // ("meg.donovan.email@…" → "Meg Donovan", not "Meg Donovan Email").
    .filter((p) => !NON_NAME_TOKENS.has(p.toLowerCase()) && !/^\d+$/.test(p));
  if (parts.length === 0) return '';
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
};

// ── section detection ───────────────────────────────────────────────────────

type SectionKey =
  | 'summary' | 'skills' | 'experience' | 'projects' | 'education'
  | 'achievements' | 'certifications' | 'other';

const SECTION_HEADERS: Array<{ key: SectionKey; re: RegExp }> = [
  { key: 'summary', re: /^\s*(summary|objective|profile|about(?:\s+me)?)\s*:?\s*$/i },
  // Skills header — accepts a one-word qualifier ("CORE SKILLS", "KEY SKILLS",
  // "TECHNICAL SKILLS") so variants beyond the exact phrases still parse.
  { key: 'skills', re: /^\s*(?:[a-z]+\s+)?(technical\s+skills|skills|technologies|tech\s+stack|core\s+competencies|competencies)\s*:?\s*$/i },
  // Experience header — accepts a domain qualifier ("CLINICAL EXPERIENCE",
  // "RELEVANT EXPERIENCE", "NURSING EXPERIENCE", "TEACHING EXPERIENCE") so
  // non-tech résumés (nurse, educator) still get their experience parsed. The
  // qualifier is optional and bounded to one word so it can't swallow prose.
  { key: 'experience', re: /^\s*(?:[a-z]+\s+)?(work\s+experience|professional\s+experience|clinical\s+experience|experience|employment(?:\s+history)?|work\s+history|career\s+history)\s*:?\s*$/i },
  { key: 'projects', re: /^\s*(projects|personal\s+projects|selected\s+projects|side\s+projects)\s*:?\s*$/i },
  { key: 'education', re: /^\s*(education|academics?)\s*:?\s*$/i },
  { key: 'achievements', re: /^\s*(achievements|awards|honors)\s*:?\s*$/i },
  { key: 'certifications', re: /^\s*(certifications?|licenses?)\s*:?\s*$/i },
];

const detectSection = (line: string): SectionKey | null => {
  for (const h of SECTION_HEADERS) {
    if (h.re.test(line)) return h.key;
  }
  return null;
};

/** Split the document into ordered (sectionKey → lines) groups. */
const groupBySection = (ls: string[]): Map<SectionKey, string[]> => {
  const groups = new Map<SectionKey, string[]>();
  let current: SectionKey = 'other';
  for (const raw of ls) {
    const hit = detectSection(raw.trim());
    if (hit) {
      current = hit;
      if (!groups.has(current)) groups.set(current, []);
      continue;
    }
    if (!groups.has(current)) groups.set(current, []);
    groups.get(current)!.push(raw);
  }
  return groups;
};

const isBullet = (l: string): boolean => /^\s*([-•*‣◦·]|\d+\.)\s+/.test(l);
const stripBullet = (l: string): string => l.replace(/^\s*([-•*‣◦·]|\d+\.)\s+/, '').trim();

// ── skills ──────────────────────────────────────────────────────────────────

// Skills section lines look like "Languages: Python, Go" or just a comma list.
const parseSkills = (sectionLines: string[]): string[] => {
  const flat: string[] = [];
  for (const raw of sectionLines) {
    let line = stripBullet(raw).trim();
    if (!line) continue;
    // Drop a leading "Category    " label (multi-space separated, no colon) —
    // "Languages        ▪ Python   ▪ Go" → drop "Languages", keep the skills.
    // ("Category: skills" with a colon is handled below.)
    const catLabelMatch = line.match(/^([A-Za-z][A-Za-z &/]{1,24})\s{2,}(?=▪|·|[A-Z])/);
    if (catLabelMatch) line = line.slice(catLabelMatch[0].length);
    // Drop an optional "Category:" prefix; the categorizer re-buckets anyway.
    const afterColon = line.includes(':') ? line.slice(line.indexOf(':') + 1) : line;
    // Splitting on a bare comma breaks "SQL (PostgreSQL, MySQL)" into "SQL
    // (PostgreSQL" / "MySQL)". Protect parenthetical content by temporarily
    // swapping its internal commas for a sentinel, split, then restore —
    // "SQL (PostgreSQL, MySQL)" stays ONE token instead of two fragments.
    const protectedLine = afterColon.replace(/\([^)]*\)/g, (m) => m.replace(/[,/]/g, '\0'));
    // Split on comma / bullet (• or ▪) / pipe / slash / middle-dot (·) / 2+ spaces.
    for (const rawPart of protectedLine.split(/[,•▪|/·]|\s{2,}/)) {
      const s = rawPart.replace(/\0/g, ',').trim().replace(/\.$/, '');
      if (!s || /[.!?]$/.test(s)) continue;
      // keep short skill-like tokens; drop prose sentences
      if (s.length <= 40 && s.split(/\s+/).length <= 6) {
        flat.push(s);
      } else {
        // Too long overall (a verbose "Tool (long, qualifier, list)" entry) — the
        // LEAD token before the parenthetical is still a real, short skill name
        // ("Excel (pivot tables, VLOOKUP/XLOOKUP, charts, Power Query basics)" →
        // keep "Excel" rather than dropping the whole skill).
        const lead = s.match(/^([A-Za-z0-9+.#\- ]{1,24}?)\s*\(/);
        if (lead && lead[1].trim()) flat.push(lead[1].trim());
      }
    }
  }
  return flat;
};

// ── experience ───────────────────────────────────────────────────────────────

const DATE_RANGE_RE = /\(?\s*((?:19|20)\d{2}(?:-\d{2})?|\d{1,2}\/(?:19|20)?\d{2,4}|\b[A-Za-z]{3,9}\.?\s+\d{4})\s*[-–—to]+\s*((?:19|20)\d{2}(?:-\d{2})?|\d{1,2}\/(?:19|20)?\d{2,4}|present|current|now|[A-Za-z]{3,9}\.?\s+\d{4})\s*\)?/i;

// Real résumés spread ONE job across MULTIPLE lines — a company line, a title
// line, and a dates line, in either order ("Company — Title" then "Dates", OR
// "Title" then "Company — Location" then "Dates"), then bullets. The previous
// parser treated EVERY non-bullet line as a NEW entry, so a 3-line job became 3
// broken entries (company alone, title alone with no company, dates alone with
// no role) — this affected EVERY profile (E2E MiniMax campaign sweep: 20-100%
// of entries missing dates/company across all 10 fixtures). Rewritten to GROUP
// consecutive non-bullet lines into one entry until a genuinely NEW job starts.
const parseExperience = (sectionLines: string[]): ExperienceEntry[] => {
  const entries: ExperienceEntry[] = [];
  let cur: ExperienceEntry | null = null;
  const push = () => { if (cur && (cur.role || cur.company)) entries.push(cur); cur = null; };
  const ensure = (): ExperienceEntry => (cur ??= { company: '', role: '', start_date: '', end_date: null, bullets: [] });

  let lastWasBullet = false;
  for (const raw of sectionLines) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    // Divider/rule lines (box-drawing dashes, "────", "----") are pure
    // formatting, not content — must never become a garbage entry.
    if (/^[─—–\-_=]{5,}$/.test(line)) continue;
    if (isBullet(line) || /^[►▪]/.test(line)) {
      if (cur) cur.bullets.push(stripBullet(line.replace(/^[►▪]\s*/, '')));
      lastWasBullet = true;
      continue;
    }
    // A WRAPPED bullet continuation line — the previous line was a bullet, this
    // one has no marker of its own — is the rest of that bullet's sentence, NOT
    // a new entry, ONLY when it has none of the signals a new job would have (no
    // dates, no em/en-dash separator, no role-noun, no company-suffix, and it
    // reads like mid-sentence prose: starts lowercase OR ends without terminal
    // punctuation on the PRIOR bullet, i.e. the previous bullet is unfinished).
    const priorBulletUnfinished = cur && cur.bullets.length > 0 && !/[.!?]$/.test(cur.bullets[cur.bullets.length - 1]);
    if (lastWasBullet && priorBulletUnfinished && !DATE_RANGE_RE.test(line)
        && !/[—–]/.test(line) && !ROLE_NOUN_RE.test(line) && !COMPANY_SUFFIX_RE.test(line)) {
      cur!.bullets[cur!.bullets.length - 1] += ' ' + line;
      continue;
    }
    lastWasBullet = false;
    // A prose sentence (ends in . and is long) is a summary line for the CURRENT
    // entry, not a new job — attach nothing (informational only, skip it) rather
    // than let it become a garbage "role".
    if (line.length > 90 && /[.!?]$/.test(line) && cur?.role) continue;

    let head = line;
    let start = '';
    let end: string | null = null;
    const dm = line.match(DATE_RANGE_RE);
    if (dm) {
      head = line.replace(dm[0], '').trim().replace(/[|,]\s*$/, '');
      start = normalizeDate(dm[1]);
      end = /present|current|now/i.test(dm[2]) ? null : normalizeDate(dm[2]);
      // A dates-only (or dates + trailing location) line ALWAYS attaches to the
      // current entry — but ONLY if the leftover text has no role-noun (a role
      // title with a trailing date, "Senior Software Engineer   03/2022 –
      // Present", must still be recognized as the ROLE, not swallowed here).
      if (cur && (!head || (head.length < 30 && !ROLE_NOUN_RE.test(head)))) {
        cur.start_date ||= start;
        if (end !== null) cur.end_date = end;
        else if (cur.end_date === undefined) cur.end_date = null;
        continue;
      }
    }

    // "Role at Company" / "Company — Role" on one line — but ONLY split this way
    // when at least one side actually looks like a job title (has a role noun).
    // A line like "University of Cincinnati Medical Center — Cincinnati, OH" has
    // NEITHER side matching (it's company + city), so it must stay ONE company
    // string, not get incorrectly split into role="...Medical Center" / company=
    // "Cincinnati, OH".
    const CITY_STATE_RE = /^[A-Za-z .]+,\s*[A-Z]{2}$/;
    const atSplit = head.split(/\s+(?:at|@|[-–—|,])\s+/);
    let lineRole = '';
    let lineCompany = '';
    if (atSplit.length >= 2 && !CITY_STATE_RE.test(atSplit.slice(1).join(' ').trim())) {
      const [a, b] = [atSplit[0].trim(), atSplit.slice(1).join(' ').trim()];
      if (ROLE_NOUN_RE.test(b) && !ROLE_NOUN_RE.test(a)) { lineCompany = a; lineRole = b; }
      else if (ROLE_NOUN_RE.test(a) && !ROLE_NOUN_RE.test(b)) { lineRole = a; lineCompany = b; }
      else if (ROLE_NOUN_RE.test(a) || ROLE_NOUN_RE.test(b)) { lineRole = a; lineCompany = b; }
      else { lineCompany = head; } // neither side is a role — whole line is the company (+ location)
    } else if (ROLE_NOUN_RE.test(head)) {
      lineRole = head;
    } else {
      lineCompany = head;
    }

    // A bare "City, ST" location line that arrives when the current entry
    // ALREADY has both role and company is just trailing location info for that
    // SAME job — not a new entry ("Software Engineer II / Nimbus Systems /
    // Seattle, WA" — the city line must not spawn its own blank entry).
    if (cur && cur.role && cur.company && CITY_STATE_RE.test(head)) continue;

    // Does this line complete the CURRENT entry (filling in whichever of
    // role/company is still missing), or start a NEW one? It's a new entry only
    // if the current one already has BOTH role and company (or has neither yet
    // and this is the very first line of the section).
    if (cur && cur.role && cur.company) {
      push();
    }
    const e = ensure();
    if (lineRole && !e.role) e.role = lineRole;
    if (lineCompany && !e.company) e.company = lineCompany;
    // A line that matched neither heuristic cleanly (bare company.co or a
    // one-word line) still fills whichever slot is empty.
    if (!lineRole && !lineCompany && head) {
      if (!e.role) e.role = head; else if (!e.company) e.company = head;
    }
    if (start) e.start_date ||= start;
    if (end !== null) e.end_date ??= end;
  }
  push();
  return entries;
};

const normalizeDate = (d: string): string => {
  const s = (d || '').trim();
  const ym = s.match(/^((?:19|20)\d{2})-(\d{2})$/);
  if (ym) return `${ym[1]}-${ym[2]}`;
  // MM/YYYY or MM/YY ("03/2022", "3/22").
  const slash = s.match(/^(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const mm = slash[1].padStart(2, '0');
    const yy = slash[2].length === 2 ? `20${slash[2]}` : slash[2];
    return `${yy}-${mm}`;
  }
  const y = s.match(/((?:19|20)\d{2})/);
  if (!y) return '';
  const monMatch = s.match(/([A-Za-z]{3,9})/);
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const mm = monMatch ? months[monMatch[1].slice(0, 3).toLowerCase()] : undefined;
  return mm ? `${y[1]}-${mm}` : y[1];
};

// ── projects ──────────────────────────────────────────────────────────────────

// A metadata-only line (a bare GitHub/URL link, or "Open source · Jan 2024 –
// Present" style dates/tags) is a CONTINUATION of the previous project, not a
// new project. Without this, "Name\ngithub.com/user/repo | dates" produces TWO
// project entries — the URL line becoming its own garbage "project" (E2E
// MiniMax campaign sweep: p02/p03/p09/p10 all had this).
const BARE_DOMAIN_RE = /\b(?:github\.com|gitlab\.com|linkedin\.com|npmjs\.com|pypi\.org)\/\S+/i;
const isMetadataOnlyLine = (line: string): boolean => {
  const stripped = line.replace(URL_RE, '').replace(BARE_DOMAIN_RE, '').replace(/[|,·•]/g, ' ').replace(/\s+/g, ' ').trim();
  // Nothing left after removing the URL/bare-domain and separators → pure metadata line.
  if ((URL_RE.test(line) || BARE_DOMAIN_RE.test(line)) && stripped.length < 40) return true;
  // A bare date-range / tag line with no real project-name-like content.
  if (DATE_RANGE_RE.test(line) && line.replace(DATE_RANGE_RE, '').replace(/[|,·•\s]/g, '').length < 20) return true;
  return false;
};

const parseProjects = (sectionLines: string[]): ProjectEntry[] => {
  const entries: ProjectEntry[] = [];
  for (const raw of sectionLines) {
    let line = stripBullet(raw).trim();
    if (!line) continue;
    // Column-formatted title line ("pq-tap                    Open source ·
    // 2021 – Present") — drop the 2+-space-separated metadata tail (tags/dates),
    // keeping only the project name itself.
    const colTail = line.match(/^(.{2,60}?)\s{2,}(?=open source|proprietary|internal|\d{4}|[A-Za-z]{3,9}\.?\s+\d{4})/i);
    if (colTail) line = colTail[1].trim();
    // Divider/rule lines are pure formatting, never a project.
    if (/^[─—–\-_=]{5,}$/.test(line)) continue;
    // A metadata-only continuation line attaches its URL to the PREVIOUS
    // project rather than becoming its own blank-ish entry.
    if (isMetadataOnlyLine(line) && entries.length > 0) {
      const url = (line.match(URL_RE) || line.match(BARE_DOMAIN_RE) || [''])[0];
      if (url && !entries[entries.length - 1].url) entries[entries.length - 1].url = url;
      continue;
    }
    // "Name: description (tech a, tech b)" or "Name — description". Protect
    // parenthetical content first — "KubeFortress (2023 – Present): Open-
    // source..." must split at the final colon, not the en-dash INSIDE the
    // "(2023 – Present)" parenthetical (that produced name="KubeFortress
    // (2023" — a truncated, unusable project name). Since the protection only
    // swaps individual characters (same length), indices from the protected
    // copy map 1:1 onto the original line.
    let name = '';
    let description = '';
    const parenProtected = line.replace(/\([^)]*\)/g, (m) => m.replace(/[:—–-]/g, ' '));
    const sepMatch = parenProtected.match(/^([^:—–-]{2,60}?)\s*[:—–-]\s+(.*)$/);
    if (sepMatch) {
      name = line.slice(0, sepMatch[1].length).trim();
      description = line.slice(sepMatch[0].length - sepMatch[2].length).trim();
    } else {
      name = line.slice(0, 60).trim();
    }
    const url = (line.match(URL_RE) || [''])[0];
    // pull a trailing tech list out of the description if present
    const technologies: string[] = [];
    const techTail = description.match(/[.,]?\s*([A-Z][\w.+#]*(?:\s*,\s*[A-Z][\w.+#]*)+)\s*$/);
    if (techTail) {
      for (const t of techTail[1].split(/\s*,\s*/)) {
        const tv = t.trim();
        if (tv) technologies.push(tv);
      }
    }
    if (name) entries.push({ name, description, technologies, url });
  }
  return entries;
};

// ── education ─────────────────────────────────────────────────────────────────

// A degree line names an award (B.S., Bachelor, M.Sc., PhD, MBA, Associate…),
// usually with "in <field>". An institution line names a school (University,
// College, Institute, School, Academy, Polytechnic) or is a proper-noun place.
const DEGREE_RE = /\b(b\.?\s?s\.?|b\.?\s?a\.?|b\.?\s?e\.?|b\.?\s?tech|m\.?\s?s\.?|m\.?\s?a\.?|m\.?\s?e\.?|m\.?\s?tech|mba|ph\.?\s?d\.?|bachelor'?s?|master'?s?|doctorate|associate'?s?|diploma|b\.?sc|m\.?sc)\b/i;
const INSTITUTION_RE = /\b(university|college|institute|school|academy|polytechnic|conservatory)\b/i;
const GPA_RE = /\bgpa[:\s]*([0-4](?:\.\d{1,2})?(?:\s*\/\s*[0-5](?:\.\d{1,2})?)?)/i;
const HONORS_RE = /\b(with honors|with distinction|cum laude|magna cum laude|summa cum laude|dean'?s list)\b/i;

// Education blocks span MULTIPLE lines — an institution line, a degree line, a
// GPA line, a thesis line — that all describe ONE entry. The previous parser
// treated each line as a SEPARATE entry, so "University of Washington, Seattle"
// became degree="University of Washington" and "B.S. in Computer Science, with
// honors" became institution="with". This groups lines into coherent entries.
const parseEducation = (sectionLines: string[]): EducationEntry[] => {
  const entries: EducationEntry[] = [];
  let cur: EducationEntry | null = null;
  const flush = () => { if (cur && (cur.degree || cur.institution)) entries.push(cur); cur = null; };
  const ensure = (): EducationEntry => (cur ??= { institution: '', degree: '', field: '', start_date: '', end_date: null });

  for (const raw of sectionLines) {
    const line = stripBullet(raw).trim();
    if (!line) continue;

    // Pipe-delimited one-liner ("B.A., Economics | Oberlin College | Oberlin, OH")
    // — a full entry on ONE line: [degree/field] | [institution] | [location].
    // Only take this path when a segment actually looks like an institution, so a
    // "GPA | thesis" continuation line doesn't get mis-parsed as a new entry.
    if (line.includes('|') && DEGREE_RE.test(line) && INSTITUTION_RE.test(line)) {
      const segs = line.split('|').map((s) => s.trim()).filter(Boolean);
      const dm2 = line.match(DATE_RANGE_RE);
      if (cur && cur.degree) flush();
      const e = ensure();
      const degSeg = segs.find((s) => DEGREE_RE.test(s)) || segs[0];
      const instSeg = segs.find((s) => INSTITUTION_RE.test(s)) || '';
      const dParts = degSeg.replace(HONORS_RE, '').split(',').map((s) => s.trim()).filter(Boolean);
      e.degree = dParts[0];
      if (dParts[1]) e.field = dParts[1].replace(/concentration.*/i, '').trim();
      if (instSeg) e.institution = instSeg.split(',')[0].trim();
      if (dm2) { e.start_date = normalizeDate(dm2[1]); e.end_date = /present|current|now/i.test(dm2[2]) ? null : normalizeDate(dm2[2]); }
      const g = line.match(GPA_RE); if (g) e.gpa = g[1].trim();
      flush();
      continue;
    }

    // Dates attach to the current entry (or start one).
    let head = line;
    const dm = line.match(DATE_RANGE_RE);
    let start = ''; let end: string | null = null;
    if (dm) {
      head = line.replace(dm[0], '').trim().replace(/[|,]\s*$/, '');
      start = normalizeDate(dm[1]);
      end = /present|current|now/i.test(dm[2]) ? null : normalizeDate(dm[2]);
    }

    // GPA line → attach to current entry, don't create a new one.
    const gpaM = head.match(GPA_RE);
    if (gpaM && head.replace(GPA_RE, '').replace(/[|,;\s]/g, '').length < 4) {
      const e = ensure(); e.gpa = gpaM[1].trim();
      if (start) e.start_date ||= start; if (end) e.end_date ??= end;
      continue;
    }
    // Thesis / coursework / honors-only lines → noise, skip (don't become a degree).
    if (/(senior thesis|thesis|dissertation|relevant coursework|coursework|activities)\b/i.test(head)
        && !DEGREE_RE.test(head) && !INSTITUTION_RE.test(head)) {
      // A GPA may ride along on this noise line — capture it before skipping.
      const g2 = head.match(GPA_RE); if (g2 && cur && !cur.gpa) cur.gpa = g2[1].trim();
      continue;
    }

    // A line naming a school is an INSTITUTION line even if it also matches a
    // short ambiguous degree token — "Massachusetts Institute of Technology —
    // Cambridge, MA" matches DEGREE_RE via the "MA" state code, but it is clearly
    // the institution, not an M.A. degree. Institution wins when both match.
    const isInstLine = INSTITUTION_RE.test(head);
    const isDegreeLine = DEGREE_RE.test(head) && !isInstLine;

    // Strip a trailing "with honors" so it never lands in a field/institution.
    const cleanHead = head.replace(HONORS_RE, '').replace(/[,\s]+$/, '').trim();

    if (isDegreeLine) {
      // A new degree starts a new entry only if the current one already has a degree.
      if (cur && cur.degree) flush();
      const e = ensure();
      // "Degree in Field[, Institution]"
      const inMatch = cleanHead.match(/^(.*?)\bin\b\s+(.*?)(?:,\s*(.*))?$/i);
      if (inMatch) {
        e.degree = inMatch[1].trim();
        e.field = (inMatch[2] || '').replace(/,.*$/, '').trim();
        const inst = (inMatch[3] || '').trim();
        // Only accept the trailing comma segment as an institution if it is NOT a
        // bare date/month ("Bachelor of Science in Mathematics Education, May 2017"
        // — "May 2017" is a graduation date, not a school; the real institution is
        // on the next line). A dropped date here lets the next line fill it in.
        const instIsDate = /^(?:(?:19|20)\d{2}|[a-z]{3,9}\.?\s+\d{4}|\d{1,2}\/\d{2,4})$/i.test(inst);
        if (inst && !instIsDate && !e.institution) e.institution = inst;
        else if (instIsDate) { const dd = inst.match(/((?:19|20)\d{2})/); if (dd && !e.end_date) e.end_date = dd[1]; }
      } else {
        // "B.S. Computer Science" (no "in") — degree token + rest as field. Drop
        // anything after a pipe (GPA/dates ride there) and normalize the degree
        // (collapse the "B.S ." stray-space artifact).
        const beforePipe = cleanHead.split('|')[0].trim();
        const dMatch = beforePipe.match(DEGREE_RE);
        e.degree = (dMatch ? beforePipe.slice(0, dMatch.index! + dMatch[0].length) : beforePipe)
          .replace(/\s+\./g, '.').trim();
        const rest = dMatch ? beforePipe.slice(dMatch.index! + dMatch[0].length).replace(/^[\s,]+/, '').trim() : '';
        if (rest && !e.field) e.field = rest.replace(/,.*$/, '').trim();
      }
      // A GPA on the same degree line (common: "B.S. … | GPA 3.8").
      const gLine = head.match(GPA_RE); if (gLine && !e.gpa) e.gpa = gLine[1].trim();
      if (start) e.start_date ||= start; if (end) e.end_date ??= end;
    } else if (isInstLine || (!cur?.institution && /^[A-Z]/.test(cleanHead) && cleanHead.split(',').length <= 3 && !DEGREE_RE.test(cleanHead))) {
      // Institution line ("University of Washington, Seattle") → the FIRST comma
      // segment is the school; the rest (city) is dropped.
      const e = ensure();
      if (!e.institution) e.institution = cleanHead.split(',')[0].trim();
      if (start) e.start_date ||= start; if (end) e.end_date ??= end;
    } else if (cur) {
      // Continuation of the current entry with dates only.
      if (start) cur.start_date ||= start; if (end) cur.end_date ??= end;
    }
  }
  flush();
  return entries;
};

// ── public API ────────────────────────────────────────────────────────────────

export interface HeuristicResume extends StructuredResume {
  _extraction_mode: 'heuristic';
  _schema_version?: number;
}

/**
 * Parse raw resume text into the minimum StructuredResume shape with zero LLM
 * calls. Conservative: never fabricates; missing fields stay empty.
 */
export function heuristicResumeExtract(rawText: string): HeuristicResume {
  const allLines = lines(rawText);
  const ne = nonEmpty(allLines);
  const joined = rawText || '';

  // identity
  const email = (joined.match(EMAIL_RE) || [''])[0];
  const phone = (joined.match(PHONE_RE) || [''])[0].trim();
  const github = (joined.match(GITHUB_RE) || [''])[0];
  const linkedin = (joined.match(LINKEDIN_RE) || [''])[0];
  let name = '';
  // The name is almost always one of the first few non-empty lines.
  for (const l of ne.slice(0, 5)) {
    if (looksLikeName(l)) { name = stripCredentials(l.trim()); break; }
  }
  if (!name && email) name = nameFromEmail(email);

  const identity: IdentityInfo = {
    name: name || '',
    email: email || '',
    phone: phone || '',
    location: '',
    linkedin: linkedin || '',
    github: github || '',
    website: '',
    summary: '',
  };

  const groups = groupBySection(allLines);
  if (groups.has('summary')) {
    identity.summary = nonEmpty(groups.get('summary')!).join(' ').slice(0, 600);
  }

  const flatSkills = groups.has('skills') ? parseSkills(groups.get('skills')!) : [];
  const skills = categorizeFlatSkills(flatSkills);

  const experience = groups.has('experience') ? parseExperience(groups.get('experience')!) : [];
  const projects = groups.has('projects') ? parseProjects(groups.get('projects')!) : [];
  const education = groups.has('education') ? parseEducation(groups.get('education')!) : [];

  const resume: HeuristicResume = {
    identity,
    skills,
    skills_flat: flattenSkills(skills),
    experience,
    projects,
    education,
    achievements: [],
    certifications: [],
    leadership: [],
    _extraction_mode: 'heuristic',
    _schema_version: PROFILE_SCHEMA_VERSION,
  };
  return resume;
}

export interface HeuristicJD extends StructuredJD {
  _extraction_mode: 'heuristic';
  _schema_version?: number;
}

const LEVEL_FROM_TEXT = (t: string): JDLevel => {
  const s = t.toLowerCase();
  if (/\bprincipal\b/.test(s)) return 'principal';
  if (/\bstaff\b/.test(s)) return 'staff';
  if (/\bsenior\b|\bsr\.?\b|\blead\b/.test(s)) return 'senior';
  if (/\bintern(ship)?\b/.test(s)) return 'intern';
  if (/\bentry|junior|\bjr\.?\b|graduate\b/.test(s)) return 'entry';
  return 'mid';
};

const EMPLOYMENT_FROM_TEXT = (t: string): EmploymentType => {
  const s = t.toLowerCase();
  if (/\bintern(ship)?\b/.test(s)) return 'internship';
  if (/\bcontract(or)?\b|\bfreelance\b/.test(s)) return 'contract';
  if (/\bpart[-\s]?time\b/.test(s)) return 'part_time';
  return 'full_time';
};

/**
 * Parse raw JD text into the minimum StructuredJD shape with zero LLM calls.
 * Title = first meaningful line; requirements/responsibilities pulled from the
 * matching sections; enums inferred conservatively with safe defaults.
 */
// Role-noun tokens that mark a line as the JOB TITLE rather than the company
// name — used to disambiguate "Company\nTitle" vs "Title\nCompany" ordering,
// which varies across real JDs (E2E MiniMax campaign: p04 had company-then-title
// with neither line labeled).
const ROLE_NOUN_RE = /\b(engineer|developer|manager|director|coordinator|designer|analyst|scientist|architect|lead|specialist|consultant|nurse|administrator|coordinator|officer|associate|intern|technician|vp|vice president|president|ceo|cto|coo|cfo|founder|head\s+of|chief)\b/i;
const COMPANY_SUFFIX_RE = /\b(inc\.?|llc|ltd\.?|corp\.?|co\.?|technologies|systems|networks|analytics|logistics|health(?:\s*network)?|group|solutions|labs?)\b\.?$/i;

// Common tech/tool keywords a JD names — used to build `technologies` (was
// hardcoded to []). Kept short and unambiguous to avoid noise.
const TECH_KEYWORDS = [
  'Python', 'Java', 'JavaScript', 'TypeScript', 'Go', 'Golang', 'Rust', 'C++', 'C#', 'Ruby', 'Scala', 'Kotlin', 'Swift',
  'React', 'Vue', 'Angular', 'Node.js', 'Node', 'Django', 'Flask', 'Spring', 'Rails', 'Express',
  'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Cassandra', 'DynamoDB', 'Elasticsearch', 'Kafka', 'RabbitMQ',
  'AWS', 'GCP', 'Azure', 'Kubernetes', 'Docker', 'Terraform', 'Jenkins', 'CI/CD', 'GitHub Actions',
  'SQL', 'NoSQL', 'GraphQL', 'REST', 'gRPC', 'Spark', 'Hadoop', 'Airflow', 'Snowflake', 'BigQuery', 'Tableau',
  'TensorFlow', 'PyTorch', 'scikit-learn', 'pandas', 'NumPy', 'Figma', 'Sketch', 'Salesforce', 'HL7', 'FHIR', 'Epic',
];

export function heuristicJDExtract(rawText: string): HeuristicJD {
  const allLines = lines(rawText);
  const ne = nonEmpty(allLines).map(stripMd);

  const collectSection = (re: RegExp): string[] => {
    const out: string[] = [];
    let capturing = false;
    for (const raw of allLines) {
      const line = stripMd(raw.trim());
      if (re.test(line)) { capturing = true; continue; }
      if (capturing) {
        if (detectJDHeader(line)) break;
        if (line) out.push(stripBullet(line));
      }
    }
    return out;
  };

  const requirements = collectSection(/^\s*(requirements|qualifications|what you'?ll need|what you bring|must haves?|you have)\s*(?:\([^)]*\))?\s*:?\s*$/i);
  const nice = collectSection(/^\s*(nice to haves?|bonus|preferred|pluses?)\s*:?\s*$/i);
  const responsibilities = collectSection(/^\s*(responsibilities|what you'?ll do|the role|day to day)\s*:?\s*$/i);

  // Title/company: check the first few lines for an EXPLICIT "Company:" label
  // first (highest confidence). If absent, use the role-noun/company-suffix
  // heuristic to disambiguate which of the first two lines is the title vs the
  // company (order varies: "Title\nCompany:" is common, but "Company\nTitle"
  // and "Company — Title" also occur).
  let title = '';
  let company = '';
  const labeledCompany = ne.slice(0, 5).find((l) => /^company\s*:/i.test(l));
  if (labeledCompany) company = labeledCompany.replace(/^company\s*:\s*/i, '').trim();

  const line0 = ne[0] || '';
  const line1 = ne[1] || '';
  // Only split on EM/EN dash (with surrounding spaces) — a bare hyphen is often
  // part of a compound word ("Full-Stack Engineer") and must not be split.
  const dashSplit = (l: string) => l.split(/\s+[—–]\s+/).map((s) => s.trim()).filter(Boolean);

  if (/—|–/.test(line0) && dashSplit(line0).length >= 2) {
    // "Company — Title" or "Title — Company" on ONE line — the role-noun side
    // is the title, the other is the company.
    const [a, b] = dashSplit(line0);
    if (ROLE_NOUN_RE.test(b) && !ROLE_NOUN_RE.test(a)) { company = company || a; title = b; }
    else { title = a; company = company || b; }
  } else if (!labeledCompany && line1 && !/^company\s*:|^location\s*:/i.test(line1)
             && ROLE_NOUN_RE.test(line1) && !ROLE_NOUN_RE.test(line0) && COMPANY_SUFFIX_RE.test(line0)) {
    // Line 0 looks like a company name (ends in Inc/LLC/Technologies/etc, no role
    // noun) and line 1 looks like the title (has a role noun) — "Company\nTitle".
    company = company || line0;
    title = line1;
  } else {
    title = line0;
  }
  title = (title || line0 || 'Unknown Role').replace(/^job\s*(?:description|title|posting)\s*:\s*/i, '').slice(0, 80);

  if (!company) {
    const companyLine = ne.slice(1, 4).find((l) => /—|\bat\b|·|\|/.test(l) && !/^location\s*:/i.test(l));
    if (companyLine) company = companyLine.split(/—|\bat\b|·|\|/)[0].trim();
  }
  // Strip a leftover "Company:" label if it slipped through as a whole line.
  company = company.replace(/^company\s*:\s*/i, '').trim();

  const technologies = TECH_KEYWORDS.filter((t) => new RegExp(`\\b${t.replace(/[.+#]/g, '\\$&')}\\b`, 'i').test(rawText));

  const jd: HeuristicJD = {
    title,
    company: company || '',
    location: '',
    description_summary: ne.slice(0, 3).join(' ').slice(0, 400),
    level: LEVEL_FROM_TEXT(`${title} ${rawText.slice(0, 400)}`),
    employment_type: EMPLOYMENT_FROM_TEXT(rawText.slice(0, 800)),
    min_years_experience: (() => {
      const m = rawText.match(/(\d+)\+?\s*years?/i);
      return m ? Number(m[1]) : 0;
    })(),
    compensation_hint: (rawText.match(/\$\s?\d[\d,]*\s?[kK]?(?:\s*[-–]\s*\$?\s?\d[\d,]*\s?[kK]?)?/) || [''])[0],
    requirements,
    nice_to_haves: nice,
    responsibilities,
    technologies,
    // Keywords feed jd_alignment scoring (ContextAssembler.kwLower) and company
    // research context — leaving this hardcoded [] silently weakened those paths
    // on every heuristic-extracted JD. Technologies are the highest-signal
    // keywords; title/level words add a little more without becoming noisy.
    keywords: [...new Set([...technologies, ...title.split(/\s+/).filter((w) => w.length > 3 && !ROLE_NOUN_RE.test(w))])].slice(0, 15),
    _extraction_mode: 'heuristic',
    _schema_version: PROFILE_SCHEMA_VERSION,
  };
  return jd;
}

// Markdown bold/italic markers ("**Requirements**", "*Nice to Have*") wrap many
// real JD section headers; strip them before matching so the header regexes
// below don't need to special-case markdown everywhere.
const stripMd = (l: string): string => l.replace(/\*{1,3}/g, '').trim();
const JD_HEADER_RE = /^\s*(about(?:\s+the\s+role)?|requirements|qualifications|nice to haves?|bonus|preferred|responsibilities|what you'?ll do|what you bring|what you'?ll need|the role|benefits|perks|how to apply|compensation)\s*(?:\([^)]*\))?\s*:?\s*$/i;
const detectJDHeader = (line: string): boolean => JD_HEADER_RE.test(stripMd(line));
