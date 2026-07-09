// tools/profile-intelligence-investigation/trace-prompt-order.ts
//
// Read-only investigation harness for the LIVE prompt construction order.
// This file does NOT modify any state. It uses the same pure-decision
// modules the runtime uses (planAnswer + decideProfileIntelligence +
// buildContextRoute) to label which sources WOULD ride in the prompt and
// in what order.
//
// NOTE: This file does NOT actually exercise the provider-bound assembly in
// LLMHelper (which would require a live renderer). Instead, it inspects the
// route decision and emits the EXPECTED block order using the same priority
// rules documented in the architecture report.
//
// Run with: npx tsx tools/profile-intelligence-investigation/trace-prompt-order.ts

import { planAnswer, type AnswerSource } from '../../electron/llm/AnswerPlanner';
import { buildContextRoute } from '../../electron/llm/contextRoute';

interface ProfileFact {
  identity?: { name?: string };
  experience?: Array<{ role: string; company: string; bullets?: string[] }>;
}

const out = (line: string) => process.stdout.write(line + '\n');

const CASES: Array<{
  name: string;
  q: string;
  src: AnswerSource;
  mode: string;
  customContext?: string;
  persona?: string;
  hasProfile?: boolean;
  hasJD?: boolean;
}> = [
  {
    name: 'canonical_conflict_test',
    q: 'Are you currently working anywhere?',
    src: 'what_to_answer',
    mode: 'general',
    customContext: 'I am currently jobless and actively looking for a job. When asked about current status, say I am looking for opportunities.',
    persona: 'Answer confidently as a cracked 22-year-old founder who built Natively.',
    hasProfile: true,
    hasJD: true,
  },
  {
    name: 'doc_grounded_custom',
    q: 'What does the paper say about RAG?',
    src: 'what_to_answer',
    mode: 'custom-doc-grounded' as any,
    customContext: 'Answer only from the uploaded material.',
    hasProfile: true,
  },
];

for (const tc of CASES) {
  out('============================================================');
  out(`Case: ${tc.name}`);
  out(`Question: "${tc.q}" | Source: ${tc.src} | Mode: ${tc.mode}`);
  out('------------------------------------------------------------');

  const plan = planAnswer({
    question: tc.q,
    source: tc.src,
    hasCandidateProfile: tc.hasProfile,
    hasJobDescription: tc.hasJD,
    activeMode: tc.mode ? ({ id: tc.mode, templateType: tc.mode as any, name: tc.mode, isCustom: false } as any) : null,
  });
  const route = buildContextRoute(plan);

  out(`answerType             : ${plan.answerType}`);
  out(`profileContextPolicy   : ${plan.profileContextPolicy}`);
  out(`required layers        : ${plan.requiredContextLayers.join(', ') || '(none)'}`);
  out(`forbidden layers       : ${plan.forbiddenContextLayers.join(', ') || '(none)'}`);
  out('');
  out(`Expected prompt block order (according to live wiring):`);

  // Mirror the WTA path order from WhatToAnswerLLM.ts:451-463 and the
  // manual-chat path order from LLMHelper.ts:2127-2227.
  const blocks: Array<{ tag: string; source: string; included: boolean; note?: string }> = [
    { tag: '<system_prompt>', source: 'CORE_IDENTITY + EXECUTION_CONTRACT + UNIVERSAL_WHAT_TO_ANSWER_PROMPT', included: true },
    { tag: '<active_mode_suffix>', source: 'ModesManager.getActiveModeSystemPromptSuffix', included: true },
    { tag: '<skill_prompt>', source: 'activeSkill.promptBlock', included: false, note: 'only when activeSkill set' },
    { tag: '<transcript>', source: 'live_transcript', included: plan.requiredContextLayers.includes('live_transcript') },
    { tag: '<intent_and_shape>', source: 'IntentResult', included: !!plan.intentResult },
    { tag: '<dynamic_action_instruction>', source: 'dynamic-action-engine', included: !!plan.intentResult },
    { tag: '<screen_direct_vision_instruction>', source: 'image-attached', included: false },
    { tag: '<screen_context>', source: 'screen/OCR', included: plan.requiredContextLayers.includes('screen_context') },
    { tag: '<browser_dom>', source: 'phone mirror DOM', included: false },
    { tag: '<reference_files>', source: 'ModeHybridRetriever (active mode chunks)', included: plan.requiredContextLayers.includes('reference_files') },
    { tag: '<pinned_mode_instructions>', source: 'modes.customContext (real-time prompt)', included: !!tc.customContext && plan.profileContextPolicy !== 'forbidden' },
    { tag: '<profile_context>', source: 'premium KnowledgeOrchestrator OR OKF Profile cards', included: plan.requiredContextLayers.includes('resume') },
    { tag: '<ai_persona_style>', source: 'profile_persona row', included: false, note: 'NO LIVE CONSUMER for the persona row' },
    { tag: '<prior_responses>', source: 'TemporalContextBuilder.previousResponses', included: plan.requiredContextLayers.includes('prior_assistant_responses') },
    { tag: '<hindsight_recall>', source: 'LongTermMemoryService (Hindsight)', included: false, note: 'flag-gated, only isBackwardLookingQuery' },
    { tag: '## QUESTION', source: 'user message', included: true },
  ];

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const mark = b.included ? '✓' : '·';
    out(`  ${i + 1}. ${mark} ${b.tag.padEnd(38)} ← ${b.source}${b.note ? `  (${b.note})` : ''}`);
  }

  out('');
  out('Notes for this case:');
  if (tc.customContext && !plan.requiredContextLayers.includes('custom_context') && !plan.requiredContextLayers.includes('active_mode')) {
    out(`  ! custom context would NOT ride in required layers for this answer type (${plan.answerType}).`);
    out(`  ! It would still ride via <pinned_mode_instructions> if the active mode has customContext set.`);
  }
  if (!plan.requiredContextLayers.includes('resume')) {
    out(`  ! resume is NOT in required layers — profile facts will not surface.`);
  }
  if (plan.forbiddenContextLayers.includes('resume')) {
    out(`  ! resume is FORBIDDEN — explicit suppression.`);
  }
  out('');
}

out('Done. Expected prompt block order trace. No state changed.');