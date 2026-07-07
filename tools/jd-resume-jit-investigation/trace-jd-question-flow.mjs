#!/usr/bin/env node
/**
 * trace-jd-question-flow.mjs — the RECONCILIATION script.
 *
 * READ-ONLY. No provider calls. It joins two ground-truth sources:
 *   (A) the REAL compiled classifier (dist-electron/.../AnswerPlanner.js), and
 *   (B) the REAL knowledge DB (<userData>/natively.db),
 * to answer the single question the investigation cares about:
 *
 *   "Is the stored, active JD actually routed into the prompt for JD questions?"
 *
 * For each question it prints:
 *   - answerType + effective context layers (from the real planAnswer)
 *   - whether 'jd' survived routing
 *   - whether an active JD with non-empty structured_data EXISTS in the DB
 *   - the RECONCILIATION verdict:
 *       * JD_PRESENT_BUT_NOT_ROUTED  <- the core bug: JD on disk, dropped by routing
 *       * JD_ROUTED                  <- layer selected; JD text CAN reach prompt
 *       * JD_NOT_NEEDED              <- resume-only question, correctly no JD
 *
 * This is the script that disproves "selectedContextLayers includes jd => success":
 * it shows JD questions where the JD is fully stored yet the layer is dropped, and
 * (separately) notes that even a routed layer only means the JD *can* be rendered —
 * ProfileContextBuilder can still emit an empty <target_job> block.
 *
 * PREREQ: compiled build present; better-sqlite3 loadable (use the electron runner):
 *   ELECTRON_RUN_AS_NODE=1 <electron> tools/.../trace-jd-question-flow.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

// ---- (A) real classifier ----
const compiled = path.join(repoRoot, 'dist-electron', 'electron', 'llm', 'AnswerPlanner.js');
if (!fs.existsSync(compiled)) {
  console.log('FAIL: compiled classifier missing at', compiled, '\nBuild the electron bundle first.');
  process.exit(2);
}
const { planAnswer } = require(compiled);

function effective(plan) {
  const req = new Set(plan.requiredContextLayers || []);
  for (const f of plan.forbiddenContextLayers || []) req.delete(f);
  return [...req];
}

// ---- (B) real DB (read-only) ----
function resolveDb() {
  const cand = [];
  if (process.env.NATIVELY_DB) cand.push(process.env.NATIVELY_DB);
  const appSupport = path.join(os.homedir(), 'Library', 'Application Support');
  for (const n of ['natively', 'Natively', 'answercue', 'Electron']) cand.push(path.join(appSupport, n, 'natively.db'));
  cand.push(path.join(os.homedir(), '.config', 'natively', 'natively.db'));
  for (const p of cand) { try { if (p && fs.existsSync(p)) return p; } catch {} }
  return null;
}

let activeJd = null;
let activeResume = null;
let dbNote = '';
try {
  const Database = require('better-sqlite3');
  const dbPath = resolveDb();
  if (!dbPath) {
    dbNote = 'no DB found (set NATIVELY_DB); routing shown without storage reconciliation';
  } else {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const jd = db.prepare("SELECT id, structured_data FROM knowledge_documents WHERE type='job_description' ORDER BY created_at DESC LIMIT 1").get();
    const rs = db.prepare("SELECT id, structured_data FROM knowledge_documents WHERE type='resume' ORDER BY created_at DESC LIMIT 1").get();
    if (jd) { try { activeJd = { id: jd.id, sd: JSON.parse(jd.structured_data) }; } catch { activeJd = { id: jd.id, sd: null }; } }
    if (rs) { try { activeResume = { id: rs.id, sd: JSON.parse(rs.structured_data) }; } catch { activeResume = { id: rs.id, sd: null }; } }
    dbNote = `DB=${dbPath}`;
    db.close();
  }
} catch (e) {
  dbNote = 'better-sqlite3 not loadable under bare node — re-run with ELECTRON_RUN_AS_NODE=1 <electron>. Routing still shown.';
}

function jdIsRenderable(sd) {
  if (!sd) return false;
  const nonEmpty = (a) => Array.isArray(a) && a.length > 0;
  // buildTargetJobBlock renders '' when every section is empty (ProfileContextBuilder).
  return Boolean(sd.title) || nonEmpty(sd.requirements) || nonEmpty(sd.responsibilities) || nonEmpty(sd.technologies) || nonEmpty(sd.keywords);
}

const QUESTIONS = [
  // JD-only
  ['jd-only', 'What kind of candidate is this JD looking for?'],
  ['jd-only', 'What are the top 5 skills required for this role?'],
  ['jd-only', 'What are the most important responsibilities in this JD?'],
  ['jd-only', 'Based only on the JD, what kind of engineer do they want?'],
  ['jd-only', 'Does the JD mention salary?'],
  ['jd-only', 'Does the JD require relocation?'],
  // resume+JD fit
  ['resume+jd', 'Why am I a good fit for this role?'],
  ['resume+jd', 'Which parts of my resume best match this JD?'],
  ['resume+jd', 'Which of my projects is most relevant for this JD?'],
  ['resume+jd', 'What are my gaps for this JD?'],
  ['resume+jd', 'How should I introduce myself for this role?'],
  ['resume+jd', 'Walk me through your resume with this JD in mind.'],
  ['resume+jd', 'Tell me about yourself for this role.'],
  // resume-only
  ['resume-only', 'What is my name?'],
  ['resume-only', 'Which project uses Redis?'],
];

console.log('═'.repeat(96));
console.log(' JD QUESTION FLOW — routing (real classifier) x storage (real DB)  RECONCILIATION');
console.log(' ' + dbNote);
if (activeJd) console.log(` active JD: id=${activeJd.id} renderable=${jdIsRenderable(activeJd.sd)} title=${JSON.stringify(activeJd.sd?.title)} techs=${JSON.stringify(activeJd.sd?.technologies)}`);
else console.log(' active JD: (none in DB or DB unavailable)');
console.log('═'.repeat(96));

let coreBug = 0;
for (const [kind, q] of QUESTIONS) {
  const plan = planAnswer({ question: q, source: 'manual_input' });
  const eff = effective(plan);
  const jdRouted = eff.includes('jd');
  const jdOnDisk = activeJd ? jdIsRenderable(activeJd.sd) : null;
  const needsJd = kind === 'jd-only' || kind === 'resume+jd';

  let verdict;
  if (!needsJd) verdict = 'JD_NOT_NEEDED';
  else if (jdRouted) verdict = 'JD_ROUTED (layer ok; note: block can still render empty)';
  else if (jdOnDisk === true) { verdict = 'JD_PRESENT_BUT_NOT_ROUTED  <<< CORE BUG'; coreBug++; }
  else if (jdOnDisk === false) verdict = 'JD_NOT_ROUTED (and JD not renderable on disk)';
  else verdict = 'JD_NOT_ROUTED (storage unknown)';

  console.log(`\n[${kind}] ${q}`);
  console.log(`   answerType=${plan.answerType}  policy=${plan.profileContextPolicy}`);
  console.log(`   effective layers: ${eff.join(', ')}`);
  console.log(`   jd routed=${jdRouted ? 'yes' : 'NO'}   jd on disk & renderable=${jdOnDisk === null ? 'unknown' : jdOnDisk}`);
  console.log(`   => ${verdict}`);
}

console.log('\n' + '═'.repeat(96));
console.log(` CORE-BUG COUNT (JD stored & renderable, but routing drops the jd layer): ${coreBug}`);
console.log(' This is the precise failure: the JD is NOT missing/stale — the answer-type routing');
console.log(' never selects the jd layer for these questions, so the stored JD text cannot reach');
console.log(' the prompt and the model emergently says "I don\'t have the JD loaded".');
console.log('═'.repeat(96));
