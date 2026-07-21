#!/usr/bin/env node
// Read-only routing verifier for the JD/Resume JIT fix. Drives the REAL compiled
// planAnswer over generalized paraphrases (NOT prod benchmark strings) and prints
// answerType + effective layers. No DB, no provider.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const { planAnswer } = await import(path.join(repoRoot, 'dist-electron/electron/llm/AnswerPlanner.js'));

const eff = (plan) => {
  const req = new Set(plan.requiredContextLayers);
  const forb = new Set(plan.forbiddenContextLayers);
  return [...req].filter((l) => !forb.has(l));
};
const run = (q, source = 'manual_input') => {
  const plan = planAnswer({ question: q, source, hasCandidateProfile: true, hasJobDescription: true });
  const layers = eff(plan);
  return { q, type: plan.answerType, jd: layers.includes('jd'), resume: layers.includes('resume'), layers };
};

// Each row: [question, expectAnswerTypePrefix, expectJdLayer, expectResumeLayer]
const CASES = [
  // ── JD-ONLY (jd layer required, resume NOT required) ──
  ['what kind of candidate is this job description looking for?', 'jd_summary_answer', true, false],
  ['based only on the jd, what kind of engineer do they want?', 'jd_summary_answer', true, false],
  ['what does this role require?', 'jd_requirements_answer', true, false],
  ['what are the top skills required for this role?', 'jd_requirements_answer', true, false],
  ['what responsibilities are listed in the job description?', 'jd_requirements_answer', true, false],
  ['what technologies does the jd mention?', 'jd_requirements_answer', true, false],
  ['does the jd mention salary?', 'jd_fact_answer', true, false],
  ['does this role require relocation?', 'jd_fact_answer', true, false],
  ['how many years of experience does the role need?', 'jd_fact_answer', true, false],
  ['is this position remote or onsite?', 'jd_fact_answer', true, false],
  // ── RESUME+JD (both layers) ──
  // Generic fit questions are already claimed by the proven JD_FIT_PATTERNS
  // (resume+jd); assert layer coverage, not the exact type name.
  ['why am i a good fit for this role?', null, true, true],
  ['which parts of my resume best match this jd?', null, true, true],
  ['which of my projects is most relevant for this jd?', null, true, true],
  ['which internship should i highlight for this role?', null, true, true],
  // "what are my gaps for this jd" is already routed by the proven jd_fit
  // pattern (resume+jd); the type name is not asserted — layer coverage is what
  // matters. The HYPOTHETICAL gap ("how would you explain your lack…") is the one
  // we specifically rescue from technical_concept → resume_jd_gap_answer.
  ['what are my gaps for this jd?', null, true, true],
  ['how would you explain your lack of experience in some of the jd requirements?', 'resume_jd_gap_answer', true, true],
  ['tell me about yourself for this role', 'resume_jd_intro_answer', true, true],
  ['walk me through my resume with this jd in mind', 'resume_jd_intro_answer', true, true],
  // ── NEGOTIATION carve-out: explicit "how to negotiate" stays negotiation ──
  ['how should i negotiate the salary for this role?', 'negotiation_answer', null, null],
  // ── RESUME-ONLY REGRESSION (jd NOT included) ──
  ['what is my name?', 'identity_answer', false, true],
  ['what is my cgpa?', 'profile_fact_answer', false, true],
  ['which project uses redis?', null, false, null],
  ['what companies have i worked at?', 'experience_answer', false, true],
  ['tell me about yourself', 'identity_answer', false, true],
  // ── CODING REGRESSION (no profile/jd leak) ──
  ['write a function to reverse a linked list', 'dsa_question_answer', false, false],
  ['explain how tcp differs from udp', 'technical_concept_answer', false, false],
];

let pass = 0, fail = 0;
const fails = [];
for (const [q, expType, expJd, expResume] of CASES) {
  const r = run(q);
  const typeOk = expType == null || r.type === expType || (expType.endsWith('_answer') && r.type === expType);
  const jdOk = expJd == null || r.jd === expJd;
  const resumeOk = expResume == null || r.resume === expResume;
  const ok = typeOk && jdOk && resumeOk;
  if (ok) pass++; else { fail++; fails.push({ ...r, expType, expJd, expResume, typeOk, jdOk, resumeOk }); }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.type.padEnd(24)} jd=${String(r.jd).padEnd(5)} resume=${String(r.resume).padEnd(5)} | ${q}`);
}
console.log(`\n${pass}/${CASES.length} passed, ${fail} failed`);
if (fails.length) {
  console.log('\nFAILURES:');
  for (const f of fails) console.log(`  "${f.q}"\n    got type=${f.type} jd=${f.jd} resume=${f.resume}\n    want type=${f.expType} jd=${f.expJd} resume=${f.expResume} (typeOk=${f.typeOk} jdOk=${f.jdOk} resumeOk=${f.resumeOk})`);
  process.exitCode = 1;
}
