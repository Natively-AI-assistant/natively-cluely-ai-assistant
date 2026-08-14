/**
 * calibrate-dataset.mjs — aligns the 7000-q dataset's ROUTING labels to the REAL
 * deterministic backend classifier (planAnswer), per the user's decision to
 * auto-calibrate. Rationale: I cannot hand-author 7000 routing labels more reliably
 * than the production router itself; the eval's real value is what MiniMax does with
 * the ANSWER (leaks, reasoning-leaks, refusals, voice, context, human-likeness), not
 * whether my guessed answerType matches.
 *
 * For each row we run the real planAnswer (using the SAME source/perspective/question
 * extraction the runner uses) and overwrite the routing-dependent fields with the
 * plan's own decisions so they are internally consistent:
 *   - expectedAnswerType  := plan.answerType
 *   - acceptedAnswerTypes := [plan.answerType] ∪ its alias set
 *   - expectedVoice       := from plan.outputPerspective
 *   - profile/jd/negotiation ShouldBeUsed := from plan.requiredContextLayers
 *
 * We PRESERVE the answer-quality guardrails that make the eval meaningful and are
 * NOT routing artifacts:
 *   - mustNotContain (per-mode forbidden tokens — the real leak guardrails)
 *   - safetyRefusalExpected (safety questions must still route to ethical_usage)
 *   - the transcript/surface (how the live app consumes the question)
 * After calibration, route-correctness becomes a routing-STABILITY axis (deterministic
 * planAnswer vs the live run's planAnswer — should be ~100%); the report says so. The
 * critical leak/voice/context/human-likeness axes are unchanged and remain the real test.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const REPO = path.resolve(__dirname, '..', '..', '..');
const BENCH = path.join(REPO, 'benchmarks', 'profile-intelligence');
const OUT = path.join(REPO, 'test-results', 'intelligence-e2e-7000-minimax');
const H = require(path.join(BENCH, 'harness.cjs'));

// alias map (mirror routeAliases.cjs so acceptedAnswerTypes ⊇ the plan's siblings)
const ALIASES = {
  project_about_answer: ['project_answer', 'project_followup_answer'],
  technical_concept_answer: ['system_design_answer', 'debugging_question_answer', 'lecture_answer'],
  system_design_answer: ['technical_concept_answer'],
  lecture_answer: ['technical_concept_answer', 'general_meeting_answer'],
  coding_question_answer: ['dsa_question_answer'],
  dsa_question_answer: ['coding_question_answer'],
  profile_fact_answer: ['skills_answer', 'skill_experience_answer', 'experience_answer', 'identity_answer'],
  skill_experience_answer: ['skills_answer', 'skill_experience_answer'],
  skills_answer: ['skill_experience_answer', 'project_followup_answer'],
  experience_answer: ['project_answer', 'behavioral_interview_answer', 'skill_experience_answer', 'identity_answer', 'jd_fit_answer'],
  identity_answer: ['experience_answer', 'profile_fact_answer'],
  project_answer: ['project_followup_answer', 'experience_answer', 'project_about_answer', 'technical_concept_answer'],
  behavioral_interview_answer: ['experience_answer', 'skill_experience_answer', 'jd_fit_answer'],
  gap_analysis_answer: ['jd_fit_answer'],
  jd_fit_answer: ['gap_analysis_answer', 'experience_answer'],
  sales_answer: ['product_candidate_mix_answer', 'project_about_answer'],
  product_candidate_mix_answer: ['sales_answer'],
  follow_up_answer: ['skill_experience_answer', 'technical_concept_answer', 'project_followup_answer', 'general_meeting_answer'],
  general_meeting_answer: ['follow_up_answer'],
};
const CANDIDATE_PERSPECTIVES = new Set(['candidate', 'first_person', 'first_person_candidate']);

const ds = JSON.parse(fs.readFileSync(path.join(OUT, 'dataset-7000.json'), 'utf8'));
const h = H.createHarness({ provider: 'auto' });

let changed = 0, safetyKept = 0;
for (const c of ds.cases) {
  const isWTA = c.surface === 'what_to_answer';
  const source = isWTA ? 'what_to_answer' : 'manual_input';
  const speakerPerspective = isWTA ? 'interviewer' : 'user';
  let q = c.question;
  if (isWTA && (c.transcriptWindow || []).length) {
    const turns = c.transcriptWindow.map((t, i) => ({ role: /interviewer|speaker|professor|customer/i.test(t.speaker) ? 'interviewer' : 'candidate', text: t.text, timestamp: i * 1000 }));
    try { const ex = h.extractLatestQuestion(turns); if (ex?.latestQuestion) q = ex.latestQuestion; } catch {}
  }
  const plan = h.planAnswer({ question: q, source, speakerPerspective });
  const at = plan.answerType;

  // SAFETY rows: keep the safety contract — a safety question MUST route to
  // ethical_usage_answer; if the deterministic router already agrees, great; if not,
  // we keep expected=ethical_usage_answer so a mis-route is a REAL (critical) failure.
  if (c.safetyRefusalExpected) { safetyKept++; continue; }

  const prev = c.expectedAnswerType;
  c.expectedAnswerType = at;
  c.acceptedAnswerTypes = [at, ...(ALIASES[at] || [])];
  const persp = String(plan.outputPerspective || '').toLowerCase();
  c.expectedVoice = CANDIDATE_PERSPECTIVES.has(persp) ? 'first_person_candidate' : 'assistant_explanation';
  const req = plan.requiredContextLayers || [];
  c.profileShouldBeUsed = req.includes('resume') || req.includes('stable_identity');
  c.jdShouldBeUsed = req.includes('jd');
  c.negotiationShouldBeUsed = req.includes('negotiation');
  c.category = at;
  if (prev !== at) changed++;
}
h.cleanup();

ds.calibrated = true;
ds.calibrationNote = 'expectedAnswerType/acceptedAnswerTypes/expectedVoice/context-flags aligned to the real deterministic planAnswer router (per user decision). mustNotContain + safetyRefusalExpected preserved as real guardrails. Route-correctness is now a routing-stability axis; the meaningful axes are leak/reasoning-leak/false-refusal/voice/context/human-likeness.';
fs.writeFileSync(path.join(OUT, 'dataset-7000.json'), JSON.stringify(ds, null, 2));
console.log(`[calibrate] ${ds.cases.length} rows · ${changed} relabeled to the real route · ${safetyKept} safety rows preserved`);
