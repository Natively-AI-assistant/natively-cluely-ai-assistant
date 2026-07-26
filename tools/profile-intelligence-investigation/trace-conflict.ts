// tools/profile-intelligence-investigation/trace-conflict.ts
//
// Read-only investigation harness that plays the canonical conflict test case
// + 5 synthetic conflict cases and emits, for each: source ordering, fast-path
// outcome, expected LLM-facing prompt labels, observed failure mode, suspected
// root cause.
//
// IMPORTANT: this file does NOT modify any state. It does NOT call any
// provider. It exercises pure modules (planAnswer + buildContextRoute +
// tryBuildManualProfileFastPathAnswer).
//
// Run with: npx tsx tools/profile-intelligence-investigation/trace-conflict.ts

import { planAnswer, type AnswerSource } from '../../electron/llm/AnswerPlanner';
import { buildContextRoute } from '../../electron/llm/contextRoute';
import { tryBuildManualProfileFastPathAnswer } from '../../electron/llm/manualProfileIntelligence';

const PROFILE = {
  identity: { name: 'Evin John' },
  experience: [
    {
      role: 'Product Engineer',
      company: 'Company X',
      bullets: ['Built Natively, a desktop AI interview assistant'],
      start_date: '2024-06',
      end_date: null,
    },
  ],
  projects: [
    {
      name: 'Project A',
      description: 'A flagship frontend-heavy project',
      technologies: ['React', 'TypeScript'],
    },
    {
      name: 'Project B',
      description: 'A backend infra project',
      technologies: ['Go', 'Kubernetes'],
    },
  ],
  skills: { languages: ['TypeScript'], frameworks: ['React'], cloud: ['AWS'] },
};

const JD = { title: 'AI Product Engineer', company: 'Acme', requirements: ['RAG', 'LLM', 'backend infra'] };

interface ConflictCase {
  name: string;
  q: string;
  src: AnswerSource;
  mode?: string;
  customContext?: string;
  expected: 'fastpath' | 'llm';
  observed_failure: string;
  suspected_root_cause: string;
}

const CASES: ConflictCase[] = [
  {
    name: 'Case 1 — Resume says employed, custom context says jobless',
    q: 'Are you currently working anywhere?',
    src: 'manual_input',
    customContext: 'I am currently jobless and actively looking for a job.',
    expected: 'llm',
    observed_failure: 'Fast-path returns null (no regex matches). LLM receives resume + custom context with no source headers. Model blends or hedges.',
    suspected_root_cause: 'No source metadata in prompt + no conflict policy. Custom context is NOT read by the fast-path.',
  },
  {
    name: 'Case 2 — Resume says project A is most important, persona says always pitch project B',
    q: 'Tell me about your most important project',
    src: 'manual_input',
    customContext: 'When asked about projects, always pitch Project B (the backend infra project).',
    expected: 'llm',
    observed_failure: 'Fast-path returns the projects list (resume-led). On the LLM path, persona instruction sits in customContext tail; resume sits earlier in prompt; resume wins by recency-of-position.',
    suspected_root_cause: 'Bad prompt order + no source metadata + no priority rule for persona vs resume.',
  },
  {
    name: 'Case 3 — JD wants backend infra, resume has frontend, custom context says highlight infra',
    q: 'How do I fit this role?',
    src: 'manual_input',
    customContext: 'When answering fit questions, highlight the backend infra work even though my resume leads with frontend.',
    expected: 'fastpath',
    observed_failure: 'Fast-path matches `JD_FIT_PATTERNS` → `formatJDFit` reads only profile + jd structured data. Custom context "highlight infra" is NOT consulted. Output is a resume-vs-JD anchor with no emphasis override.',
    suspected_root_cause: 'Fast-path ignores customContext. customContextClassifier exists but is not invoked on the fast-path.',
  },
  {
    name: 'Case 4 — Reference file contains thesis content, user asks "what are my projects?"',
    q: 'What are your projects?',
    src: 'manual_input',
    expected: 'fastpath',
    observed_failure: 'Fast-path returns "Your projects include Project A; Project B" (resume-only). LLM path: reference files ride in <reference_files> block but resume is earlier; resume wins.',
    suspected_root_cause: 'No source-type weighting in ModeHybridRetriever; resume is positioned first.',
  },
  {
    name: 'Case 5 — Transcript asks an interviewer question, "what to answer" must answer as candidate using profile',
    q: 'What would you say was your biggest accomplishment?',
    src: 'what_to_answer',
    expected: 'llm',
    observed_failure: 'For "what to answer" WTA path, transcript is required layer; candidate profile rides as <profile_context>. Both labeled but unlabeled sources; model uses whichever is more salient.',
    suspected_root_cause: 'No source metadata; no rule that profile facts override transcript questions.',
  },
  {
    name: 'Case 6 — Mode says answer only from uploaded seminar file, profile has resume facts',
    q: 'Summarize the key findings from the seminar',
    src: 'what_to_answer',
    mode: 'custom-doc-grounded',
    expected: 'llm',
    observed_failure: 'documentGroundedCustomModeActive === true → resume facts are dropped from the packet. OKF Knowledge Cards augmented. Reference file content drives the answer. NO conflict, but profile intelligence is fully suppressed (which can hurt quality when resume facts would help).',
    suspected_root_cause: 'doc-grounded mode is well-isolated but overly aggressive — it does not even allow candidate facts when the question is profile-shaped.',
  },
];

const out = (line: string) => process.stdout.write(line + '\n');

for (const tc of CASES) {
  out('================================================================');
  out(tc.name);
  out(`  Question     : "${tc.q}"`);
  out(`  Source       : ${tc.src}`);
  out(`  CustomContext: ${tc.customContext || '(none)'}`);
  out(`  Expected     : ${tc.expected}`);
  out('------------------------------------------------------------');

  const plan = planAnswer({
    question: tc.q,
    source: tc.src,
    hasCandidateProfile: true,
    hasJobDescription: true,
    activeMode: tc.mode ? ({ id: tc.mode, templateType: tc.mode as any, name: tc.mode, isCustom: false } as any) : null,
  });
  const route = buildContextRoute(plan);

  out(`  Routing result:`);
  out(`    answerType             : ${plan.answerType}`);
  out(`    profileContextPolicy   : ${plan.profileContextPolicy}`);
  out(`    required layers        : ${plan.requiredContextLayers.join(', ') || '(none)'}`);
  out(`    forbidden layers       : ${plan.forbiddenContextLayers.join(', ') || '(none)'}`);
  out(`    Route selectedLayers   : ${route.selectedLayers.join(', ') || '(none)'}`);

  const fp = tryBuildManualProfileFastPathAnswer({
    question: tc.q,
    profile: PROFILE as any,
    jobDescription: JD as any,
    source: tc.src,
  });

  out(`  Fast-path result:`);
  if (fp) {
    out(`    Matched! answerType=${fp.answerType}`);
    out(`    Answer: ${fp.answer.slice(0, 200)}${fp.answer.length > 200 ? '…' : ''}`);
  } else {
    out(`    No match. Will go to LLM.`);
  }

  out(`  Observed failure mode    :`);
  out(`    ${tc.observed_failure}`);
  out(`  Suspected root cause     :`);
  out(`    ${tc.suspected_root_cause}`);
  out('');
}

out('================================================================');
out('Done. Conflict-case trace. No state changed. No provider called.');