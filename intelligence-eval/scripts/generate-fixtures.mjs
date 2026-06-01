// intelligence-eval/scripts/generate-fixtures.mjs
//
// Generates the 10 canonical eval fixtures in intelligence-eval/fixtures/ by
// normalizing the existing synthetic profiles (tests/intelligence-fixtures/
// fixture-set.mjs) into the production StructuredResume / StructuredJD shape the
// KnowledgeOrchestrator consumes:
//   experience[].highlights → bullets, start/end → start_date/end_date
//   education[].school → institution, year → end_date, + field
//
// All data is synthetic (fake names, example.com-style contacts). No real PII.
// Run: node intelligence-eval/scripts/generate-fixtures.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allFixtures } from '../../tests/intelligence-fixtures/fixture-set.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../fixtures');

// Stable slug per role, matching the spec's required filenames.
const SLUG_BY_ID = {
  'backend-eng-001': 'backend-engineer',
  'ml-eng-002': 'ml-engineer',
  'pm-003': 'product-manager',
  'sales-sdr-004': 'sales-development-rep',
  'ux-designer-005': 'ui-ux-designer',
  'data-analyst-006': 'data-analyst',
  'devops-sre-007': 'devops-sre',
  'csm-008': 'customer-success-manager',
  'security-009': 'cybersecurity-analyst',
  'founder-010': 'founder-ceo-bd',
};

function normalizeExperience(exp = []) {
  return exp.map(e => ({
    company: e.company || '',
    role: e.role || '',
    start_date: e.start || e.start_date || '',
    end_date: (e.end === 'present' || !e.end) ? null : e.end,
    bullets: e.highlights || e.bullets || [],
  }));
}

function normalizeEducation(edu = []) {
  return edu.map(e => ({
    institution: e.school || e.institution || '',
    degree: e.degree || '',
    field: e.field || (e.degree ? e.degree.replace(/^(BS|MS|BTech|BFA|MBA|PhD|BA)\s+/i, '') : ''),
    start_date: e.start_date || '',
    end_date: e.year || e.end_date || null,
  }));
}

function normalizeProjects(projects = []) {
  return projects.map(p => ({
    name: p.name || '',
    description: p.description || '',
    technologies: p.technologies || [],
    url: p.url,
  }));
}

function toCanonical(fx) {
  const r = fx.resume;
  return {
    profileId: SLUG_BY_ID[fx.id] || fx.id,
    role: fx.role,
    // Production StructuredResume shape (what KnowledgeOrchestrator reads as structured_data)
    resume: {
      identity: {
        name: r.identity.name,
        email: r.identity.email || '',
        location: r.identity.location || '',
        phone: r.identity.phone || '',
        links: r.identity.links || [],
      },
      summary: r.summary || '',
      skills: r.skills || [],
      experience: normalizeExperience(r.experience),
      projects: normalizeProjects(r.projects),
      education: normalizeEducation(r.education),
      achievements: r.achievements || [],
      certifications: r.certifications || [],
      leadership: r.leadership || [],
    },
    // Production StructuredJD shape
    jd: fx.jd ? {
      title: fx.jd.title || '',
      company: fx.jd.company || '',
      location: fx.jd.location || '',
      description_summary: fx.jd.description_summary || '',
      level: fx.jd.level || 'mid',
      employment_type: fx.jd.employment_type || 'full_time',
      min_years_experience: fx.jd.min_years_experience || 0,
      compensation_hint: fx.jd.compensation_hint || '',
      requirements: fx.jd.requirements || [],
      nice_to_haves: fx.jd.nice_to_haves || [],
      responsibilities: fx.jd.responsibilities || [],
      technologies: fx.jd.technologies || [],
      keywords: fx.jd.keywords || [],
    } : null,
    customContext: fx.customContext || '',
    persona: fx.persona || '',
    negotiation: fx.negotiation || null,
    referenceFiles: fx.referenceFiles || [],
  };
}

fs.mkdirSync(outDir, { recursive: true });
let count = 0;
for (const fx of allFixtures) {
  const canonical = toCanonical(fx);
  const file = path.join(outDir, `${canonical.profileId}.json`);
  fs.writeFileSync(file, JSON.stringify(canonical, null, 2));
  count++;
  console.log(`✓ ${canonical.profileId}.json  (${canonical.resume.identity.name}, ${canonical.resume.projects.length} projects, ${canonical.resume.experience.length} roles)`);
}
console.log(`\nGenerated ${count} canonical fixtures in ${path.relative(process.cwd(), outDir)}/`);
