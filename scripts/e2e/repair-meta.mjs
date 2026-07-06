// scripts/e2e/repair-meta.mjs
// Deterministic + MiniMax repair of ground-truth meta.json fields that the
// bulk generator left wrong/empty. Runs over all (or named) fixtures:
//   - mostRecentEmployer / mostRecentTitle: re-extract from _resume.txt if "None"
//     but the resume clearly has work experience.
//   - totalExperienceMonths: recompute if 0 but employers exist.
//   - jdRole / jdCompany: backfill from _jd.txt via a focused MiniMax call.
// Only fixes fields that are clearly wrong; leaves good values untouched.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatJson } from './lib/minimax.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const root = path.join(repoRoot, 'test-fixtures', 'profiles');

const only = process.argv.slice(2).filter((a) => /^p\d\d$/.test(a));
const ids = fs.readdirSync(root).filter((d) => /^p\d\d$/.test(d) && (!only.length || only.includes(d))).sort();

function looksExperienced(resumeText) {
  // Has an explicit work-experience section OR a company—title line OR multiple years.
  const years = (resumeText.match(/\b(19|20)\d\d\b/g) || []).length;
  return /experience|employment|work history|professional experience/i.test(resumeText)
    || /[—–-]\s*(senior|staff|lead|principal|software|engineer|manager|director|analyst|nurse|designer|consultant|developer|architect|specialist|coordinator|scientist)/i.test(resumeText)
    || years >= 4;
}

for (const id of ids) {
  const dir = path.join(root, id);
  const metaPath = path.join(dir, 'meta.json');
  if (!fs.existsSync(metaPath)) { console.log(`[${id}] no meta — skip`); continue; }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const resumeText = fs.existsSync(path.join(dir, '_resume.txt')) ? fs.readFileSync(path.join(dir, '_resume.txt'), 'utf8') : '';
  const jdText = fs.existsSync(path.join(dir, '_jd.txt')) ? fs.readFileSync(path.join(dir, '_jd.txt'), 'utf8') : '';
  let changed = false;
  const fixes = [];

  const employerMissing = !meta.mostRecentEmployer || meta.mostRecentEmployer === 'None' || !meta.mostRecentTitle || meta.mostRecentTitle === 'None' || meta.mostRecentTitle === undefined;
  if (employerMissing && looksExperienced(resumeText)) {
    try {
      const raw = await chatJson(
        'From this resume, identify the MOST RECENT (current or latest) job. Output ONLY JSON.',
        `RESUME:\n"""${resumeText}"""\n\nReturn ONLY: {"mostRecentEmployer":"<company name>","mostRecentTitle":"<job title>","totalExperienceMonths":<integer months of total professional experience>}`,
        { timeoutMs: 120000 });
      const r = {
        mostRecentEmployer: raw.mostRecentEmployer ?? raw.company ?? raw.employer ?? raw.mostRecent?.company,
        mostRecentTitle: raw.mostRecentTitle ?? raw.title ?? raw.role ?? raw.jobTitle,
        totalExperienceMonths: raw.totalExperienceMonths ?? raw.total_experience_months ?? raw.experienceMonths,
      };
      if (r.mostRecentEmployer && r.mostRecentEmployer !== 'None') { meta.mostRecentEmployer = r.mostRecentEmployer; changed = true; fixes.push('employer'); }
      if (r.mostRecentTitle && r.mostRecentTitle !== 'None') { meta.mostRecentTitle = r.mostRecentTitle; changed = true; fixes.push('title'); }
      if (typeof r.totalExperienceMonths === 'number' && r.totalExperienceMonths > 0 && (!meta.totalExperienceMonths || meta.totalExperienceMonths === 0)) { meta.totalExperienceMonths = r.totalExperienceMonths; changed = true; fixes.push('months'); }
    } catch (e) { console.log(`[${id}] employer repair failed: ${e.message}`); }
  }

  if ((!meta.jdRole || !meta.jdCompany) && jdText) {
    try {
      const r = await chatJson(
        'Extract the job title and company from this job description. Output ONLY JSON.',
        `JD:\n"""${jdText}"""\n\nReturn ONLY: {"jdRole":"<role title>","jdCompany":"<company>"}`,
        { timeoutMs: 120000 });
      if (!meta.jdRole && r.jdRole) { meta.jdRole = r.jdRole; changed = true; fixes.push('jdRole'); }
      if (!meta.jdCompany && r.jdCompany) { meta.jdCompany = r.jdCompany; changed = true; fixes.push('jdCompany'); }
    } catch (e) { console.log(`[${id}] jd repair failed: ${e.message}`); }
  }

  // Coerce requirement arrays to strings + ensure lengths.
  const toStr = (a) => Array.isArray(a) ? a.map((x) => typeof x === 'string' ? x : (x?.requirement || x?.text || x?.name || JSON.stringify(x))) : [];
  if (Array.isArray(meta.requirementsMet)) meta.requirementsMet = toStr(meta.requirementsMet);
  if (Array.isArray(meta.requirementsNotMet)) meta.requirementsNotMet = toStr(meta.requirementsNotMet);
  if (Array.isArray(meta.topSkills)) meta.topSkills = toStr(meta.topSkills);

  if (changed) fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  console.log(`[${id}] ${changed ? 'REPAIRED ' + fixes.join(',') : 'ok'} | employer=${meta.mostRecentEmployer} title=${meta.mostRecentTitle} months=${meta.totalExperienceMonths} jdRole=${meta.jdRole}`);
}
console.log('meta repair complete');
