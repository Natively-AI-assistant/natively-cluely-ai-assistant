// intelligence-eval-real-ui/scripts-generate-fixtures.mjs
// Materializes the 10 canonical synthetic profiles into the per-profile TEXT
// files the real UI consumes (resume.txt / jd.txt / custom-context.txt /
// persona.txt / negotiation.txt + reference-files/). Resume/JD become realistic
// plaintext documents (the UI's upload accepts .txt). All synthetic — no real PII.
//
// Run: node intelligence-eval-real-ui/scripts-generate-fixtures.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, '../intelligence-eval/fixtures');
const outDir = path.resolve(__dirname, 'fixtures');

function resumeToText(r) {
  const lines = [];
  lines.push(r.identity.name);
  const contact = [r.identity.email, r.identity.phone, r.identity.location].filter(Boolean).join(' | ');
  if (contact) lines.push(contact);
  if (r.summary) lines.push('', 'SUMMARY', r.summary);
  if (r.skills?.length) lines.push('', 'SKILLS', r.skills.join(', '));
  if (r.experience?.length) {
    lines.push('', 'EXPERIENCE');
    for (const e of r.experience) {
      const dates = [e.start_date, e.end_date || 'Present'].filter(Boolean).join(' – ');
      lines.push(`${e.role} — ${e.company} (${dates})`);
      for (const b of (e.bullets || [])) lines.push(`  - ${b}`);
    }
  }
  if (r.projects?.length) {
    lines.push('', 'PROJECTS');
    for (const p of r.projects) {
      lines.push(`${p.name}: ${p.description}${(p.technologies || []).length ? ` [${p.technologies.join(', ')}]` : ''}`);
    }
  }
  if (r.education?.length) {
    lines.push('', 'EDUCATION');
    for (const ed of r.education) lines.push(`${[ed.degree, ed.field].filter(Boolean).join(', ')} — ${ed.institution}${ed.end_date ? ` (${ed.end_date})` : ''}`);
  }
  if (r.achievements?.length) { lines.push('', 'ACHIEVEMENTS'); for (const a of r.achievements) lines.push(`- ${a.title}${a.description ? `: ${a.description}` : ''}`); }
  if (r.certifications?.length) { lines.push('', 'CERTIFICATIONS'); for (const c of r.certifications) lines.push(`- ${c.name}${c.issuer ? ` (${c.issuer})` : ''}`); }
  return lines.join('\n') + '\n';
}

function jdToText(jd) {
  if (!jd) return '';
  const lines = [];
  lines.push(`${jd.title} — ${jd.company}${jd.location ? ` (${jd.location})` : ''}`);
  if (jd.level) lines.push(`Level: ${jd.level}`);
  if (jd.description_summary) lines.push('', jd.description_summary);
  if (jd.requirements?.length) { lines.push('', 'REQUIREMENTS'); for (const r of jd.requirements) lines.push(`- ${r}`); }
  if (jd.nice_to_haves?.length) { lines.push('', 'NICE TO HAVE'); for (const r of jd.nice_to_haves) lines.push(`- ${r}`); }
  if (jd.responsibilities?.length) { lines.push('', 'RESPONSIBILITIES'); for (const r of jd.responsibilities) lines.push(`- ${r}`); }
  if (jd.technologies?.length) lines.push('', `TECHNOLOGIES: ${jd.technologies.join(', ')}`);
  if (jd.compensation_hint) lines.push('', `COMPENSATION: ${jd.compensation_hint}`);
  return lines.join('\n') + '\n';
}

function negotiationToText(n) {
  if (!n) return '';
  const lines = ['NEGOTIATION CONTEXT'];
  if (n.targetSalary) lines.push(`Target salary: $${n.targetSalary}`);
  if (n.minimumSalary) lines.push(`Minimum acceptable: $${n.minimumSalary}`);
  if (n.currentSalary) lines.push(`Current salary: $${n.currentSalary}`);
  if (n.signingBonus) lines.push(`Signing bonus target: $${n.signingBonus}`);
  if (n.equity) lines.push(`Equity: ${n.equity}`);
  if (n.priorities?.length) lines.push(`Priorities: ${n.priorities.join(', ')}`);
  return lines.join('\n') + '\n';
}

let count = 0;
for (const f of fs.readdirSync(srcDir)) {
  if (!f.endsWith('.json')) continue;
  const fx = JSON.parse(fs.readFileSync(path.join(srcDir, f), 'utf8'));
  const dir = path.join(outDir, fx.profileId);
  fs.mkdirSync(path.join(dir, 'reference-files'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'resume.txt'), resumeToText(fx.resume));
  fs.writeFileSync(path.join(dir, 'jd.txt'), jdToText(fx.jd));
  fs.writeFileSync(path.join(dir, 'custom-context.txt'), (fx.customContext || '') + '\n');
  fs.writeFileSync(path.join(dir, 'persona.txt'), (fx.persona || '') + '\n');
  fs.writeFileSync(path.join(dir, 'negotiation.txt'), negotiationToText(fx.negotiation));
  // Keep a machine-readable copy of the structured profile for the grader/expected values.
  fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify(fx, null, 2));
  count++;
  console.log(`✓ ${fx.profileId}/ (resume ${fx.resume.identity.name})`);
}
console.log(`\nGenerated ${count} UI fixture profiles in ${path.relative(process.cwd(), outDir)}/`);
