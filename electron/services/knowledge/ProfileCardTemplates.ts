// electron/services/knowledge/ProfileCardTemplates.ts
//
// OKF Profile Intelligence upgrade (2026-07-02) — DETERMINISTIC card builders
// that transform the premium engine's already-LLM-extracted structured_data
// (StructuredResume / StructuredJD) and AOT artifacts into typed profile
// KnowledgeCard drafts. NO new LLM call: every card body is assembled from
// fields that already exist in structured_data, so the OKF layer can never
// invent an employer, date, or metric the resume didn't state (OkfProfileVerifier
// then enforces that every card body is grounded in the structured source text).
//
// These are PURE functions (no DB, no crypto id assignment — ProfilePackBuilder
// owns ids/checksums/persistence, mirroring OkfCardBuilder's split from
// KnowledgePackStore). Each draft carries a stable `conceptId` so re-ingesting
// the same resume produces the same card ids (idempotent regeneration).
//
// Card ↔ OKF Concept mapping (see the exporter for the human-readable `type`):
//   candidate/identity, candidate/summary, candidate/experience-<slug>,
//   candidate/project-<slug>, candidate/education-<slug>, candidate/achievements,
//   candidate/skills-<category>, target-job/role, target-job/requirements,
//   target-job/nice-to-haves, target-job/keywords, artifacts/gap-analysis,
//   artifacts/negotiation-strategy, artifacts/mock-questions,
//   artifacts/culture-mapping, artifacts/intro.

import { uniqueSlug, conceptIdFor } from './OkfSlugger';
import type {
  KnowledgeCardConfidence,
  KnowledgeCardGeneratedFrom,
  KnowledgeCardQuote,
  KnowledgeCardType,
} from './types';

/**
 * A profile card draft — everything ProfilePackBuilder needs to mint a full
 * KnowledgeCard except the ids/checksums/timestamps it assigns centrally.
 */
export interface ProfileCardDraft {
  type: KnowledgeCardType;
  title: string;
  /** bundle-relative directory this card lives under, e.g. "candidate" / "target-job" / "artifacts". */
  bundleDir: string;
  slug: string;
  conceptId: string;
  body: string;
  /**
   * Verbatim source phrases lifted from structured_data — the grounding
   * evidence OkfProfileVerifier checks the body against, and the "# Source
   * Evidence" the exporter emits. For profile cards these are resume bullets /
   * JD requirement lines, not PDF page quotes.
   */
  sourceQuotes: KnowledgeCardQuote[];
  entities: string[];
  tags: string[];
  confidence: KnowledgeCardConfidence;
  generatedFrom: KnowledgeCardGeneratedFrom;
  /** Sub-source discriminator for the card resource URI (e.g. "experience", "gap_analysis"). */
  sourceCategory: string;
}

const CANDIDATE_DIR = 'candidate';
const JOB_DIR = 'target-job';
const ARTIFACTS_DIR = 'artifacts';

// ── size caps ─────────────────────────────────────────────────
// Card bodies feed the prompt (and the exported bundle). A pathological resume
// (a 40-bullet role, a 60-item skill category) would otherwise produce an
// unbounded card. Cap at the SOURCE so the stored card, the export, AND the
// prompt are all bounded — not just the retrieval-time per-card trim. These are
// generous (a real role rarely lists >12 bullets) so normal resumes are untouched.
const MAX_BULLETS_PER_ROLE = 12;
const MAX_SKILLS_PER_CATEGORY = 40;
const MAX_ACHIEVEMENTS = 15;
const MAX_BODY_CHARS = 1200;

/** Hard char cap for a card body (defense-in-depth over the per-field caps). */
function capBody(body: string): string {
  return body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS).replace(/\s+\S*$/, '')}…` : body;
}

// ── small helpers ─────────────────────────────────────────────
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v.filter((x) => x != null) : []);
const strArr = (v: unknown): string[] => arr(v).map(str).filter(Boolean);

/** A KnowledgeCardQuote for profile evidence — profile has no page numbers, so page=0 and the category rides in section. */
function quote(text: string, category: string): KnowledgeCardQuote {
  return { text: text.trim(), page: 0, section: category };
}

function dateRange(start: unknown, end: unknown): string {
  const s = str(start);
  const e = str(end) || 'present';
  if (!s) return '';
  return `${s} to ${e}`;
}

// ── resume cards ──────────────────────────────────────────────

/**
 * Build every candidate card from a StructuredResume-shaped object. Defensive
 * against missing/partial fields (heuristic-extracted resumes can be sparse) —
 * a section that is empty simply produces no card.
 */
export function buildResumeCardDrafts(
  resume: any,
  opts: { totalExperienceYears?: number } = {},
): ProfileCardDraft[] {
  const drafts: ProfileCardDraft[] = [];
  const takenByDir = new Map<string, Set<string>>();
  const slugIn = (dir: string, title: string): { slug: string; conceptId: string } => {
    const taken = takenByDir.get(dir) || new Set<string>();
    takenByDir.set(dir, taken);
    const slug = uniqueSlug(title, taken);
    return { slug, conceptId: conceptIdFor(dir, slug) };
  };

  const identity = (resume?.identity && typeof resume.identity === 'object') ? resume.identity : {};
  const name = str(identity.name);
  const summary = str(identity.summary);
  const location = str(identity.location);

  // 1) identity
  {
    const title = name ? `${name} — Candidate Identity` : 'Candidate Identity';
    const { slug, conceptId } = slugIn(CANDIDATE_DIR, 'identity');
    const bodyLines: string[] = [];
    if (name) bodyLines.push(`The candidate's name is ${name}.`);
    if (location) bodyLines.push(`Based in ${location}.`);
    const totalYears = opts.totalExperienceYears;
    if (typeof totalYears === 'number' && totalYears > 0) {
      bodyLines.push(`Approximately ${Math.round(totalYears * 10) / 10} years of total professional experience.`);
    }
    const quotes: KnowledgeCardQuote[] = [];
    if (name) quotes.push(quote(name, 'identity'));
    if (location) quotes.push(quote(location, 'identity'));
    if (bodyLines.length > 0) {
      drafts.push({
        type: 'candidate_identity', title, bundleDir: CANDIDATE_DIR, slug, conceptId,
        body: bodyLines.join(' '),
        sourceQuotes: quotes.length > 0 ? quotes : [quote(name || 'candidate', 'identity')],
        entities: name ? [name] : [], tags: ['identity', 'candidate'],
        confidence: 'high', generatedFrom: 'structured_profile', sourceCategory: 'identity',
      });
    }
  }

  // 2) professional summary
  if (summary) {
    const { slug, conceptId } = slugIn(CANDIDATE_DIR, 'summary');
    drafts.push({
      type: 'candidate_summary', title: 'Professional Summary', bundleDir: CANDIDATE_DIR, slug, conceptId,
      body: capBody(summary),
      sourceQuotes: [quote(summary.slice(0, 300), 'summary')],
      entities: name ? [name] : [], tags: ['summary', 'candidate'],
      confidence: 'high', generatedFrom: 'structured_profile', sourceCategory: 'summary',
    });
  }

  // 3) experience — one card per role
  for (const exp of arr(resume?.experience)) {
    const e = exp as any;
    const company = str(e.company);
    const role = str(e.role);
    const bullets = strArr(e.bullets);
    if (!company && !role && bullets.length === 0) continue;
    const title = role && company ? `${role} at ${company}` : (role || company || 'Experience');
    const { slug, conceptId } = slugIn(CANDIDATE_DIR, `experience-${company || role}`);
    const range = dateRange(e.start_date, e.end_date);
    const bodyLines: string[] = [];
    if (role && company) bodyLines.push(`${role} at ${company}${range ? ` (${range})` : ''}.`);
    else if (title) bodyLines.push(`${title}${range ? ` (${range})` : ''}.`);
    if (bullets.length > 0) {
      bodyLines.push('Key contributions from the resume:');
      for (const b of bullets.slice(0, MAX_BULLETS_PER_ROLE)) bodyLines.push(`- ${b}`);
    }
    drafts.push({
      type: 'candidate_experience', title, bundleDir: CANDIDATE_DIR, slug, conceptId,
      body: capBody(bodyLines.join('\n')),
      sourceQuotes: bullets.slice(0, 6).map((b) => quote(b, 'experience')).concat(
        company ? [quote(company, 'experience')] : [],
      ),
      entities: [company, role].filter(Boolean),
      tags: ['experience', company].filter(Boolean),
      confidence: bullets.length > 0 ? 'high' : 'medium',
      generatedFrom: 'structured_profile', sourceCategory: 'experience',
    });
  }

  // 4) projects
  for (const proj of arr(resume?.projects)) {
    const p = proj as any;
    const pname = str(p.name);
    const desc = str(p.description);
    const techs = strArr(p.technologies);
    if (!pname && !desc) continue;
    const title = pname || 'Project';
    const { slug, conceptId } = slugIn(CANDIDATE_DIR, `project-${pname || desc.slice(0, 24)}`);
    const bodyLines: string[] = [];
    if (desc) bodyLines.push(desc);
    if (techs.length > 0) bodyLines.push(`Technologies: ${techs.join(', ')}.`);
    drafts.push({
      type: 'candidate_project', title, bundleDir: CANDIDATE_DIR, slug, conceptId,
      body: capBody(bodyLines.join('\n') || title),
      sourceQuotes: [quote(desc || pname, 'project')].concat(techs.length ? [quote(techs.join(', '), 'project')] : []),
      entities: [pname, ...techs].filter(Boolean).slice(0, 8),
      tags: ['project', ...techs].filter(Boolean).slice(0, 6),
      confidence: desc ? 'high' : 'medium', generatedFrom: 'structured_profile', sourceCategory: 'project',
    });
  }

  // 5) education — one card per entry
  for (const edu of arr(resume?.education)) {
    const ed = edu as any;
    const inst = str(ed.institution);
    const degree = str(ed.degree);
    const field = str(ed.field);
    if (!inst && !degree) continue;
    const title = [degree, field && `in ${field}`, inst && `— ${inst}`].filter(Boolean).join(' ') || inst;
    const { slug, conceptId } = slugIn(CANDIDATE_DIR, `education-${inst || degree}`);
    const range = dateRange(ed.start_date, ed.end_date);
    const bodyParts: string[] = [];
    if (degree || field) bodyParts.push(`${degree}${field ? ` in ${field}` : ''}`.trim());
    if (inst) bodyParts.push(`at ${inst}`);
    if (range) bodyParts.push(`(${range})`);
    const gpa = str(ed.gpa);
    if (gpa) bodyParts.push(`GPA: ${gpa}`);
    drafts.push({
      type: 'candidate_education', title, bundleDir: CANDIDATE_DIR, slug, conceptId,
      body: bodyParts.join(' ') || title,
      sourceQuotes: [quote([degree, field, inst].filter(Boolean).join(' '), 'education')],
      entities: [inst, degree, field].filter(Boolean),
      tags: ['education', inst].filter(Boolean),
      confidence: 'high', generatedFrom: 'structured_profile', sourceCategory: 'education',
    });
  }

  // 6) achievements — one aggregate card
  const achievements = arr(resume?.achievements).map((a: any) => {
    const t = str(a?.title); const d = str(a?.description);
    return [t, d].filter(Boolean).join(': ');
  }).filter(Boolean).slice(0, MAX_ACHIEVEMENTS);
  if (achievements.length > 0) {
    const { slug, conceptId } = slugIn(CANDIDATE_DIR, 'achievements');
    drafts.push({
      type: 'candidate_achievement', title: 'Achievements', bundleDir: CANDIDATE_DIR, slug, conceptId,
      body: capBody(achievements.map((a) => `- ${a}`).join('\n')),
      sourceQuotes: achievements.slice(0, 6).map((a) => quote(a, 'achievement')),
      entities: [], tags: ['achievements', 'candidate'],
      confidence: 'high', generatedFrom: 'structured_profile', sourceCategory: 'achievement',
    });
  }

  // 7) skills — one card per non-empty category
  const skills = (resume?.skills && typeof resume.skills === 'object') ? resume.skills : {};
  for (const category of Object.keys(skills)) {
    const items = strArr(skills[category]).slice(0, MAX_SKILLS_PER_CATEGORY);
    if (items.length === 0) continue;
    const label = category.charAt(0).toUpperCase() + category.slice(1);
    const title = `${label} Skills`;
    const { slug, conceptId } = slugIn(CANDIDATE_DIR, `skills-${category}`);
    drafts.push({
      type: 'candidate_skills', title, bundleDir: CANDIDATE_DIR, slug, conceptId,
      body: capBody(`The candidate lists the following ${category} skills: ${items.join(', ')}.`),
      sourceQuotes: [quote(items.join(', '), `skills_${category}`)],
      entities: items.slice(0, 12),
      tags: ['skills', category, ...items.slice(0, 4)],
      confidence: 'high', generatedFrom: 'structured_profile', sourceCategory: `skills_${category}`,
    });
  }

  return drafts;
}

// ── JD cards ──────────────────────────────────────────────────

export function buildJdCardDrafts(jd: any): ProfileCardDraft[] {
  const drafts: ProfileCardDraft[] = [];
  const taken = new Set<string>();
  const slugIn = (title: string): { slug: string; conceptId: string } => {
    const slug = uniqueSlug(title, taken);
    return { slug, conceptId: conceptIdFor(JOB_DIR, slug) };
  };

  const title = str(jd?.title);
  const company = str(jd?.company);
  const summary = str(jd?.description_summary);
  const level = str(jd?.level);
  const location = str(jd?.location);

  // role
  if (title || company || summary) {
    const { slug, conceptId } = slugIn('role');
    const roleTitle = title && company ? `${title} at ${company}` : (title || company || 'Target Role');
    const bodyLines: string[] = [];
    if (title && company) bodyLines.push(`Target role: ${title} at ${company}.`);
    else if (title) bodyLines.push(`Target role: ${title}.`);
    if (level) bodyLines.push(`Level: ${level}.`);
    if (location) bodyLines.push(`Location: ${location}.`);
    if (summary) bodyLines.push(summary);
    drafts.push({
      type: 'target_job_role', title: roleTitle, bundleDir: JOB_DIR, slug, conceptId,
      body: capBody(bodyLines.join(' ')),
      sourceQuotes: [quote(summary || `${title} ${company}`.trim(), 'role')],
      entities: [company, title].filter(Boolean),
      tags: ['target-job', 'role', company].filter(Boolean),
      confidence: 'high', generatedFrom: 'structured_profile', sourceCategory: 'role',
    });
  }

  const listCard = (
    field: string, type: KnowledgeCardType, titleText: string, slugSeed: string, category: string,
  ): void => {
    const items = strArr(jd?.[field]).slice(0, MAX_SKILLS_PER_CATEGORY);
    if (items.length === 0) return;
    const { slug, conceptId } = slugIn(slugSeed);
    drafts.push({
      type, title: titleText, bundleDir: JOB_DIR, slug, conceptId,
      body: capBody(items.map((i) => `- ${i}`).join('\n')),
      sourceQuotes: items.slice(0, 8).map((i) => quote(i, category)),
      entities: [], tags: ['target-job', category],
      confidence: 'high', generatedFrom: 'structured_profile', sourceCategory: category,
    });
  };

  listCard('requirements', 'target_job_requirements', 'Job Requirements', 'requirements', 'requirement');
  listCard('nice_to_haves', 'target_job_nice_to_haves', 'Nice-to-Haves', 'nice-to-haves', 'nice_to_have');

  // keywords (technologies + keywords merged, deduped)
  const keywords = [...new Set([...strArr(jd?.keywords), ...strArr(jd?.technologies)])].slice(0, MAX_SKILLS_PER_CATEGORY);
  if (keywords.length > 0) {
    const { slug, conceptId } = slugIn('keywords');
    drafts.push({
      type: 'target_job_keywords', title: 'Job Keywords', bundleDir: JOB_DIR, slug, conceptId,
      body: capBody(`Key terms and technologies from the job description: ${keywords.join(', ')}.`),
      sourceQuotes: [quote(keywords.join(', '), 'keyword')],
      entities: keywords.slice(0, 16),
      tags: ['target-job', 'keywords', ...keywords.slice(0, 6)],
      confidence: 'high', generatedFrom: 'structured_profile', sourceCategory: 'keyword',
    });
  }

  return drafts;
}

// ── AOT artifact cards ────────────────────────────────────────
//
// Each artifact card cites the artifact it was derived from. Bodies are
// assembled from the artifact JSON's own fields (already LLM-generated during
// the AOT pipeline) — no new synthesis. All artifact cards live under artifacts/.

export function buildArtifactCardDrafts(artifacts: {
  gapAnalysis?: any;
  negotiationScript?: any;
  mockQuestions?: any;
  cultureMappings?: any;
  intro?: any;
}): ProfileCardDraft[] {
  const drafts: ProfileCardDraft[] = [];
  const taken = new Set<string>();
  const mk = (
    type: KnowledgeCardType, title: string, slugSeed: string, body: string,
    quotes: string[], category: string, tags: string[],
  ): void => {
    if (!body.trim()) return;
    const slug = uniqueSlug(slugSeed, taken);
    drafts.push({
      type, title, bundleDir: ARTIFACTS_DIR, slug, conceptId: conceptIdFor(ARTIFACTS_DIR, slug),
      body: capBody(body),
      sourceQuotes: quotes.filter(Boolean).slice(0, 6).map((q) => quote(q, category)),
      entities: [], tags: ['artifact', ...tags],
      confidence: 'medium', generatedFrom: 'aot_artifact', sourceCategory: category,
    });
  };

  // gap analysis
  const gap = artifacts.gapAnalysis;
  if (gap && typeof gap === 'object') {
    const matched = strArr(gap.matched_skills);
    const gaps = arr(gap.gaps).map((g: any) => {
      const skill = str(g?.skill); const gt = str(g?.gap_type);
      return skill ? `${skill}${gt ? ` (${gt})` : ''}` : '';
    }).filter(Boolean);
    const pct = typeof gap.match_percentage === 'number' ? `${gap.match_percentage}% match. ` : '';
    const bodyLines: string[] = [];
    if (pct) bodyLines.push(pct.trim());
    if (matched.length > 0) bodyLines.push(`Matched skills: ${matched.join(', ')}.`);
    if (gaps.length > 0) bodyLines.push(`Gaps: ${gaps.join(', ')}.`);
    mk('artifact_gap_analysis', 'Gap Analysis', 'gap-analysis', bodyLines.join(' '),
      [...matched, ...gaps], 'gap_analysis', ['gap', 'fit']);
  }

  // negotiation
  const nego = artifacts.negotiationScript;
  if (nego && typeof nego === 'object') {
    const range = nego.salary_range && typeof nego.salary_range === 'object'
      ? `Suggested range: ${str(nego.salary_range.min) || nego.salary_range.min}–${str(nego.salary_range.max) || nego.salary_range.max} ${str(nego.salary_range.currency) || ''}. `
      : '';
    const anchor = str(nego.anchor_script) || str(nego.opening_script) || str(nego.script);
    const rationale = str(nego.rationale) || str(nego.justification);
    const bodyLines: string[] = [];
    if (range.trim()) bodyLines.push(range.trim());
    if (anchor) bodyLines.push(anchor);
    if (rationale) bodyLines.push(rationale);
    mk('artifact_negotiation', 'Negotiation Strategy', 'negotiation-strategy', bodyLines.join(' '),
      [anchor, rationale], 'negotiation', ['negotiation', 'salary']);
  }

  // mock questions
  const mock = artifacts.mockQuestions;
  const mockList = arr(mock).map((m: any) => str(m?.question)).filter(Boolean);
  if (mockList.length > 0) {
    mk('artifact_mock_questions', 'Mock Interview Questions', 'mock-questions',
      mockList.map((q) => `- ${q}`).join('\n'), mockList, 'mock_questions', ['mock', 'interview']);
  }

  // culture mapping
  const culture = artifacts.cultureMappings;
  if (culture && typeof culture === 'object') {
    const values = strArr(culture.values);
    const mappings = arr(culture.mappings).map((m: any) => {
      const v = str(m?.value); const e = str(m?.evidence) || str(m?.candidate_alignment);
      return v ? `${v}${e ? `: ${e}` : ''}` : '';
    }).filter(Boolean);
    const bodyLines: string[] = [];
    if (values.length > 0) bodyLines.push(`Company values: ${values.join(', ')}.`);
    if (mappings.length > 0) bodyLines.push(...mappings.map((m) => `- ${m}`));
    mk('artifact_culture_mapping', 'Culture Mapping', 'culture-mapping', bodyLines.join('\n'),
      [...values, ...mappings], 'culture_mapping', ['culture', 'values']);
  }

  // intro
  const intro = artifacts.intro;
  const introText = typeof intro === 'string' ? intro : str(intro?.text) || str(intro?.intro) || str(intro?.narrative);
  if (introText) {
    mk('artifact_intro', '60-Second Intro', 'intro', introText, [introText], 'intro', ['intro', 'pitch']);
  }

  return drafts;
}
