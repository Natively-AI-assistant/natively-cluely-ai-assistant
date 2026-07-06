// scripts/e2e/verify-fixtures.mjs
// Verify every generated profile fixture: meta completeness, resume doc parse,
// and scenario question structure. Prints a table + PASS/FAIL. Exit 1 if any fail.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const outRoot = path.join(repoRoot, 'test-fixtures', 'profiles');

const IDS = ['p01', 'p02', 'p03', 'p04', 'p05', 'p06', 'p07', 'p08', 'p09', 'p10'];
const QID_RE = /^Q(?:1[0-6]|[1-9])$/;
const ne = (v) => v != null && v !== '' && (!Array.isArray(v) || v.length > 0);

async function parseDoc(file) {
  const ext = path.extname(file).toLowerCase();
  const buf = fs.readFileSync(file);
  if (ext === '.pdf') {
    const pdfParse = require('pdf-parse');
    const d = await pdfParse(buf);
    return d.text || '';
  }
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const d = await mammoth.extractRawText({ buffer: buf });
    return d.value || '';
  }
  return buf.toString('utf8');
}

function metaErrors(m) {
  const e = [];
  if (!ne(m.fullName) || typeof m.fullName !== 'string') e.push('fullName');
  if (!ne(m.mostRecentEmployer) || typeof m.mostRecentEmployer !== 'string') e.push('mostRecentEmployer');
  if (typeof m.totalExperienceMonths !== 'number') e.push('totalExperienceMonths');
  if (!Array.isArray(m.topSkills) || m.topSkills.length < 3 || m.topSkills.length > 8) e.push('topSkills(3-8)');
  if (!ne(m.education) || typeof m.education !== 'string') e.push('education');
  if (!Array.isArray(m.projects) || m.projects.length < 2
      || !m.projects.every((p) => ne(p?.name) && ne(p?.verifiableFact))) e.push('projects(>=2 name+fact)');
  if (!ne(m.jdCompany) || typeof m.jdCompany !== 'string') e.push('jdCompany');
  if (!ne(m.jdRole) || typeof m.jdRole !== 'string') e.push('jdRole');
  if (!Array.isArray(m.requirementsMet) || m.requirementsMet.length !== 3
      || !m.requirementsMet.every((x) => typeof x === 'string' && x)) e.push('requirementsMet(3 str)');
  if (!Array.isArray(m.requirementsNotMet) || m.requirementsNotMet.length !== 2
      || !m.requirementsNotMet.every((x) => typeof x === 'string' && x)) e.push('requirementsNotMet(2 str)');
  return e;
}

function scenarioErrors(sc) {
  const e = [];
  const turns = Array.isArray(sc?.turns) ? sc.turns : null;
  if (!turns) return ['no turns'];
  const iv = turns.filter((t) => t && t.speaker === 'interviewer');
  const qids = [...new Set(iv.filter((t) => t.isQuestion).map((t) => t.qid).filter((q) => QID_RE.test(String(q || ''))))];
  if (qids.length < 14) e.push(`Qids=${qids.length}<14`);
  const st = iv.filter((t) => t.isQuestion === false && (t.qid == null || t.qid === ''));
  if (st.length !== 1) e.push(`smalltalk=${st.length}!=1`);
  if (!iv.some((t) => (String(t.text).match(/\?/g) || []).length >= 2)) e.push('no two-in-one');
  return e;
}

const rows = [];
let anyFail = false;
for (const id of IDS) {
  const dir = path.join(outRoot, id);
  const row = { id, name: '', employer: '', jdRole: '', skills: 0, projects: 0, fmt: '', chars: 0, ivQ: 0, metaOk: false, docOk: false, scOk: false, notes: [] };
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    row.name = meta.fullName || '';
    row.employer = meta.mostRecentEmployer || '';
    row.jdRole = meta.jdRole || '';
    row.skills = Array.isArray(meta.topSkills) ? meta.topSkills.length : 0;
    row.projects = Array.isArray(meta.projects) ? meta.projects.length : 0;
    row.fmt = meta.resumeFormat || '';
    const me = metaErrors(meta);
    row.metaOk = me.length === 0;
    if (me.length) row.notes.push('meta:' + me.join(','));

    const resumeFile = fs.readdirSync(dir).find((f) => /^resume\.(pdf|docx|txt)$/.test(f));
    if (!resumeFile) { row.notes.push('no resume file'); }
    else {
      const gotExt = path.extname(resumeFile).slice(1);
      if (row.fmt && gotExt !== row.fmt) row.notes.push(`fmt mismatch meta=${row.fmt} file=${gotExt}`);
      const text = await parseDoc(path.join(dir, resumeFile));
      row.chars = text.trim().length;
      row.docOk = row.chars > 300 && (!row.fmt || gotExt === row.fmt);
      if (!row.docOk) row.notes.push(`docParse chars=${row.chars}`);
    }

    const sc = JSON.parse(fs.readFileSync(path.join(dir, 'scenario.json'), 'utf8'));
    row.ivQ = (sc.turns || []).filter((t) => t.speaker === 'interviewer' && t.isQuestion).length;
    const se = scenarioErrors(sc);
    row.scOk = se.length === 0;
    if (se.length) row.notes.push('sc:' + se.join(','));
  } catch (err) {
    row.notes.push('ERR:' + err.message);
  }
  if (!(row.metaOk && row.docOk && row.scOk)) anyFail = true;
  rows.push(row);
}

const pad = (s, n) => String(s).slice(0, n).padEnd(n);
console.log('\n' + pad('id', 4) + pad('fullName', 22) + pad('employer', 20) + pad('jdRole', 26) + pad('sk', 3) + pad('pj', 3) + pad('fmt', 5) + pad('chars', 7) + pad('ivQ', 4) + pad('META', 5) + pad('DOC', 4) + pad('SCEN', 5));
console.log('-'.repeat(108));
for (const r of rows) {
  console.log(pad(r.id, 4) + pad(r.name, 22) + pad(r.employer, 20) + pad(r.jdRole, 26) + pad(r.skills, 3) + pad(r.projects, 3) + pad(r.fmt, 5) + pad(r.chars, 7) + pad(r.ivQ, 4)
    + pad(r.metaOk ? 'OK' : 'FAIL', 5) + pad(r.docOk ? 'OK' : 'FAIL', 4) + pad(r.scOk ? 'OK' : 'FAIL', 5));
  if (r.notes.length) console.log('      ↳ ' + r.notes.join(' | '));
}
console.log('\n' + (anyFail ? 'RESULT: SOME FIXTURES FAILED' : 'RESULT: ALL 10 FIXTURES PASS'));
process.exit(anyFail ? 1 : 0);
