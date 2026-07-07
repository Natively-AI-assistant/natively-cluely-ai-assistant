#!/usr/bin/env node
/**
 * trace-classification.mjs — drives the REAL compiled AnswerPlanner.planAnswer
 * over the investigation's question set and prints the routing decision.
 *
 * READ-ONLY. No DB writes, no provider calls. It only calls the pure classifier
 * (planAnswer) from dist-electron and reports, per question:
 *   answerType, profileContextPolicy, requiredContextLayers (=> selected),
 *   forbiddenContextLayers (=> excluded), and whether 'jd'/'resume' survive.
 *
 * The point: prove which JD questions never select the 'jd' layer (so the JD
 * text can never reach the prompt), independent of any storage state.
 *
 * PREREQ: a compiled build must exist:
 *   dist-electron/electron/llm/AnswerPlanner.js
 * If it does not, run the project's electron build first (e.g. npm run build /
 * scripts/build-electron.js). This script does NOT build anything.
 *
 * Usage: node tools/jd-resume-jit-investigation/trace-classification.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const compiled = path.join(repoRoot, 'dist-electron', 'electron', 'llm', 'AnswerPlanner.js');
if (!fs.existsSync(compiled)) {
  console.log('FAIL: compiled classifier not found at', compiled);
  console.log('Build the electron bundle first, then re-run. (This script never builds.)');
  process.exit(2);
}
const { planAnswer } = require(compiled);

// Effective layers = required minus forbidden (forbidden always wins — see
// contextRoute.ts:71 buildContextRoute). We mirror that projection here.
function effective(plan) {
  const req = new Set(plan.requiredContextLayers || []);
  for (const f of plan.forbiddenContextLayers || []) req.delete(f);
  return [...req];
}

// Categorised question set (mirrors the investigation brief).
const SETS = {
  'JD-ONLY (should route JD in)': [
    'What kind of candidate is this JD looking for?',
    'What are the top 5 skills required for this role?',
    'What are the most important responsibilities in this JD?',
    'Based only on the JD, what kind of engineer do they want?',
    'Does the JD mention salary?',
    'Does the JD require relocation?',
  ],
  'RESUME+JD FIT (should route resume+JD)': [
    'Why am I a good fit for this role?',
    'Which parts of my resume best match this JD?',
    'Which of my projects is most relevant for this JD?',
    'Which internship should I highlight most for this JD?',
    'What are my gaps for this JD?',
    'How should I introduce myself for this role?',
    'Walk me through your resume with this JD in mind.',
    'Tell me about yourself for this role.',
    'How would you explain your lack of experience in some JD requirements?',
  ],
  'RESUME-ONLY (JD not needed)': [
    'What is my name?',
    'What is my CGPA?',
    'Which project uses Redis?',
    'What companies have I worked at?',
  ],
};

// Per-question expectation for the JD/resume routing invariant.
function expectation(set) {
  if (set.startsWith('JD-ONLY')) return { needJd: true, needResume: false };
  if (set.startsWith('RESUME+JD')) return { needJd: true, needResume: true };
  return { needJd: false, needResume: true };
}

let bugCount = 0;
for (const [set, questions] of Object.entries(SETS)) {
  console.log('\n' + '═'.repeat(90));
  console.log(' ' + set);
  console.log('═'.repeat(90));
  const exp = expectation(set);
  for (const q of questions) {
    const plan = planAnswer({ question: q, source: 'manual_input' });
    const eff = effective(plan);
    const hasJd = eff.includes('jd');
    const hasResume = eff.includes('resume') || eff.includes('stable_identity');
    const jdBug = exp.needJd && !hasJd;
    const resumeBug = exp.needResume && !hasResume;
    const bug = jdBug || resumeBug;
    if (bug) bugCount++;
    console.log(`\n Q: ${q}`);
    console.log(`   answerType         : ${plan.answerType}`);
    console.log(`   profileCtxPolicy   : ${plan.profileContextPolicy}`);
    console.log(`   required layers    : ${(plan.requiredContextLayers || []).join(', ')}`);
    console.log(`   forbidden layers   : ${(plan.forbiddenContextLayers || []).join(', ') || '(none)'}`);
    console.log(`   EFFECTIVE layers   : ${eff.join(', ')}`);
    console.log(`   jd selected?       : ${hasJd ? 'yes' : 'NO'}   resume/identity?: ${hasResume ? 'yes' : 'NO'}`);
    console.log(`   VERDICT            : ${bug ? 'BUG -> ' + [jdBug ? 'JD dropped' : '', resumeBug ? 'resume dropped' : ''].filter(Boolean).join(' + ') : 'ok (routing shape)'}`);
  }
}

console.log('\n' + '═'.repeat(90));
console.log(` SUMMARY: ${bugCount} question(s) drop a layer they need (JD or resume) BEFORE any prompt is built.`);
console.log(' Note: "ok" here means the LAYER routing is correct; it does NOT prove the JD TEXT');
console.log(' reached the prompt — see trace-jd-question-flow for the storage->prompt reconciliation.');
console.log('═'.repeat(90));
