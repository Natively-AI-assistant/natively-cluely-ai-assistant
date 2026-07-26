#!/usr/bin/env node
// Read-only end-to-end evidence verifier: planAnswer → selectManualProfileEvidence
// → buildProfileJitPrompt. Uses a SYNTHETIC JD/resume (no prod data, no DB, no
// provider) to prove source-tagged JD/resume evidence reaches the JIT prompt.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const { planAnswer } = await import(path.join(repoRoot, 'dist-electron/electron/llm/AnswerPlanner.js'));
const mpi = await import(path.join(repoRoot, 'dist-electron/electron/llm/manualProfileIntelligence.js'));
const { buildProfileJitPrompt } = await import(path.join(repoRoot, 'dist-electron/electron/llm/ProfileJitPromptBuilder.js'));

// Synthetic fixtures — generic, not the user's real data.
const profile = {
  identity: { name: 'Alex Rivera' },
  experience: [{ role: 'Backend Engineer', company: 'Cloudform', bullets: ['Built REST APIs in Go', 'Ran Postgres at scale'] }],
  projects: [{ name: 'PayFlow', description: 'a payments service', technologies: ['Go', 'Postgres', 'Kafka'] }],
  skills_flat: ['Go', 'Postgres', 'Kafka', 'Docker'],
  education: [{ institution: 'State University', degree: 'BSc CS' }],
};
const jd = {
  title: 'Data Platform Engineer',
  company: 'NorthStar',
  description_summary: 'Own the data ingestion and warehouse layer.',
  level: 'Senior',
  employment_type: 'Full-time',
  requirements: ['5+ years data engineering', 'Strong SQL', 'Airflow experience', 'Python'],
  responsibilities: ['Design ETL pipelines', 'Own data quality', 'Mentor juniors'],
  technologies: ['SQL', 'Python', 'Airflow', 'Snowflake'],
  keywords: ['ETL', 'data-warehouse', 'orchestration'],
  nice_to_haves: ['dbt', 'Spark'],
  // note: NO compensation_hint / relocation → absence cases
};

const cases = [
  { q: 'what does this role require?', wantJdEvidence: true, wantResumeEvidence: false },
  { q: 'what technologies does the jd mention?', wantJdEvidence: true, wantResumeEvidence: false },
  { q: 'does the jd mention salary?', wantJdEvidence: true, wantResumeEvidence: false, wantAbsence: true },
  { q: 'which of my projects is most relevant for this jd?', wantJdEvidence: true, wantResumeEvidence: true },
  { q: 'how would you explain your lack of experience in some jd requirements?', wantJdEvidence: true, wantResumeEvidence: true },
  { q: 'walk me through my resume with this jd in mind', wantJdEvidence: true, wantResumeEvidence: true },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const plan = planAnswer({ question: c.q, source: 'manual_input', hasCandidateProfile: true, hasJobDescription: true });
  const evidence = mpi.selectManualProfileEvidence({ question: c.q, profile, jobDescription: jd, source: 'manual_input', answerType: plan.answerType });
  const diag = mpi.computeEvidenceDiagnostics(evidence);
  const prompt = evidence ? buildProfileJitPrompt({ question: c.q, answerType: plan.answerType, answerShape: plan.answerType, sourceOwner: evidence.sourceOwner, evidence }) : null;
  const up = prompt?.userPrompt || '';
  const jdInPrompt = /<target_job_evidence/.test(up) && /profile_jd/.test(up);
  const resumeInPrompt = /<candidate_resume_evidence/.test(up) && /profile_resume/.test(up);
  const jdOk = !c.wantJdEvidence || ((diag?.jdEvidenceCount ?? 0) > 0 && jdInPrompt);
  const resumeOk = c.wantResumeEvidence ? ((diag?.resumeEvidenceCount ?? 0) > 0 && resumeInPrompt) : true;
  const absenceOk = !c.wantAbsence || up.includes('does not specify') || /missing_info/.test(up) || diag?.missingInfoDetected === true;
  const ok = Boolean(evidence) && jdOk && resumeOk && absenceOk;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} type=${plan.answerType.padEnd(22)} jdEv=${diag?.jdEvidenceCount ?? 0} resEv=${diag?.resumeEvidenceCount ?? 0} jdBlock=${jdInPrompt} resBlock=${resumeInPrompt} | ${c.q}`);
  if (!ok) console.log(`     want jdEv=${c.wantJdEvidence} resEv=${c.wantResumeEvidence} absence=${c.wantAbsence || false} | evidence=${Boolean(evidence)} jdOk=${jdOk} resumeOk=${resumeOk} absenceOk=${absenceOk}`);
}
console.log(`\n${pass}/${cases.length} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
