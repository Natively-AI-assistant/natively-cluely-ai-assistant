// tools/profile-intelligence-investigation/trace-routing.ts
//
// Read-only investigation harness. Given a question + source + mode + presence
// flags, this runs the same pure deciders that the LIVE wiring runs:
//   planAnswer (electron/llm/AnswerPlanner.ts)
//   decideProfileIntelligence (electron/llm/ProfileIntelligenceRouter.ts)
//   buildContextRoute (electron/llm/contextRoute.ts)
// and emits the canonical decision object so an investigator can audit "what
// would the live path choose right now".
//
// IMPORTANT: this file imports the runtime modules directly. It must NOT
// modify state, must NOT call any provider, must NOT touch the database.
// Output is to stdout, formatted for human inspection.
//
// Run with: npx tsx tools/profile-intelligence-investigation/trace-routing.ts

import { planAnswer, type AnswerSource } from '../../electron/llm/AnswerPlanner';
import { decideProfileIntelligence } from '../../electron/llm/ProfileIntelligenceRouter';
import { buildContextRoute } from '../../electron/llm/contextRoute';

const QUESTIONS: Array<{ name: string; q: string; src: AnswerSource; profile?: boolean; jd?: boolean; mode?: string }> = [
  {
    name: 'canonical_conflict_test',
    q: 'Are you currently working anywhere?',
    src: 'what_to_answer',
    profile: true,
    jd: true,
    mode: 'general',
  },
  {
    name: 'jd_fit_explicit',
    q: 'How do I fit this role?',
    src: 'manual_input',
    profile: true,
    jd: true,
    mode: 'general',
  },
  {
    name: 'name_intro',
    q: 'Tell me about yourself',
    src: 'manual_input',
    profile: true,
    jd: true,
    mode: 'general',
  },
  {
    name: 'coding_technical',
    q: 'How do you reverse a linked list?',
    src: 'manual_input',
    profile: true,
    jd: true,
    mode: 'technical-interview',
  },
  {
    name: 'doc_grounded_followup',
    q: 'What does the paper say about RAG?',
    src: 'what_to_answer',
    profile: true,
    jd: true,
    mode: 'doc-grounded-custom-mode' as any,
  },
  {
    name: 'salary_negotiation',
    q: 'What is your expected salary?',
    src: 'manual_input',
    profile: true,
    jd: true,
    mode: 'general',
  },
  {
    name: 'backward_recall',
    q: 'What did we discuss last time about the pricing objection?',
    src: 'what_to_answer',
    profile: true,
    jd: true,
    mode: 'general',
  },
];

const out = (line: string) => process.stdout.write(line + '\n');

for (const tc of QUESTIONS) {
  out('============================================================');
  out(`Case: ${tc.name}`);
  out(`Question: "${tc.q}"`);
  out(`Source: ${tc.src} | Mode: ${tc.mode} | Profile: ${!!tc.profile} | JD: ${!!tc.jd}`);
  out('------------------------------------------------------------');

  const plan = planAnswer({
    question: tc.q,
    source: tc.src,
    hasCandidateProfile: tc.profile,
    hasJobDescription: tc.jd,
    activeMode: tc.mode ? ({ id: tc.mode, templateType: tc.mode as any, name: tc.mode, isCustom: false } as any) : null,
  });

  out(`answerType             : ${plan.answerType}`);
  out(`profileContextPolicy   : ${plan.profileContextPolicy}`);
  out(`voicePerspective       : ${plan.voicePerspective}`);
  out(`requiredContextLayers  : ${plan.requiredContextLayers.join(', ') || '(none)'}`);
  out(`forbiddenContextLayers : ${plan.forbiddenContextLayers.join(', ') || '(none)'}`);
  out(`requiresLLM            : ${plan.requiresLLM}`);
  out(`canUseFastPath         : ${plan.canUseFastPath}`);
  out(`responseTemplate (first 80 chars): ${plan.responseTemplate.slice(0, 80)}…`);

  const route = buildContextRoute(plan);
  out(`Route selectedLayers   : ${route.selectedLayers.join(', ') || '(none)'}`);
  out(`Route excludedLayers   : ${route.excludedLayers.join(', ') || '(none)'}`);
  out(`Route maxTotalPromptTokens: ${route.maxTotalPromptTokens}`);

  const decision = decideProfileIntelligence({
    question: tc.q,
    source: tc.src,
    activeModeInfo: tc.mode ? ({ id: tc.mode, templateType: tc.mode as any, name: tc.mode, isCustom: false } as any) : null,
    profileAvailable: tc.profile,
    jdAvailable: tc.jd,
  });
  out(`shouldUseProfile       : ${decision.shouldUseProfile}`);
  out(`reason                 : ${decision.reason}`);
  out(`answerPerspective      : ${decision.answerPerspective}`);
  out(`sensitiveContextAllowed: ${decision.sensitiveContextAllowed}`);
  out(`confidence             : ${decision.confidence}`);
  out(`fallbackBehavior       : ${decision.fallbackBehavior}`);
  out(`profileContextTypes    : ${decision.profileContextTypes.join(', ') || '(none)'}`);
  out(`excludedContextTypes   : ${decision.excludedContextTypes.join(', ') || '(none)'}`);
  out('');
}

out('Done. Pure routing trace. No state changed.');