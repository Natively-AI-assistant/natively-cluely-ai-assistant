// electron/llm/__tests__/WtaRegression.test.mjs
//
// Release-blocking "What to answer?" regression cases (Phase 13 / Phase 15).
// Ties the deterministic transcript extractor → answer planner together for the
// exact interviewer-question scenarios the report enumerates, asserting:
//   - correct answer type,
//   - first-person-candidate output perspective (WTA speaks AS the candidate),
//   - coding questions isolate context (no resume/JD/negotiation),
//   - identity/profile questions are NOT mis-routed to coding/negotiation.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  extractLatestQuestion,
  planAnswer,
  isCodingAnswerType,
  WhatToAnswerLLM,
} from '../../../dist-electron/electron/llm/index.js';
import {
  localInterviewContextKindsForRoute,
  profileInterceptAllowedByRoute,
} from '../../../dist-electron/electron/llm/streamContextPolicy.js';

// Build a transcript turn list (interviewer asks, candidate may have spoken).
const turns = (...lines) =>
  lines.map(([role, text], i) => ({ role, text, timestamp: 1_000_000 + i * 1000 }));

// Plan a WTA answer the way IntelligenceEngine.runWhatShouldISay does: extract
// the latest interviewer question, then plan with source='what_to_answer' and
// the extracted speaker.
function planFromTranscript(transcriptTurns) {
  const extracted = extractLatestQuestion(transcriptTurns);
  const plan = planAnswer({
    question: undefined,
    source: 'what_to_answer',
    speakerPerspective: extracted.detectedSpeaker === 'interviewer' ? 'interviewer' : 'user',
    extractedQuestion: extracted,
  });
  return { extracted, plan };
}

async function captureWtaStreamRoute(question, plan, transcript) {
  const calls = [];
  const llmHelper = {
    getCapabilities: () => ({ outputBudgetTokens: 2000 }),
    getPromptTier: () => 'full',
    fitContextForCurrentModel: text => text,
    canUseLocalFallback: async () => false,
    thinkingBudgetForAnswerType: () => 0,
    async *streamChat(...args) {
      calls.push(args);
      yield 'ok';
    },
  };
  const modesManager = {
    getActiveModeSystemPromptSuffix: () => '',
    getActiveModePinnedInstructions: () => '',
    buildRetrievedActiveModeContextBlock: () => '',
    buildActiveModeContextBlock: () => '',
  };
  const answerer = new WhatToAnswerLLM(llmHelper, modesManager);
  for await (const _chunk of answerer.generateStream(
    transcript || `[INTERVIEWER]: ${question}`,
    undefined,
    { intent: 'answer_question', answerShape: 'concise spoken answer' },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    '<candidate_profile>INTRODUCTION_SENTINEL</candidate_profile>',
    plan,
  )) {
    // Drain the real WTA assembly path; the helper captures provider arguments.
  }
  assert.equal(calls.length, 1, 'WTA must make exactly one provider stream call');
  return { message: calls[0][0], route: calls[0][9] };
}

describe('WTA interviewer-question regressions', () => {
  test('Interviewer: "What is your name?" → identity, first-person candidate', () => {
    const { plan } = planFromTranscript(turns(['interviewer', 'What is your name?']));
    assert.equal(plan.answerType, 'identity_answer');
    assert.equal(plan.outputPerspective, 'first_person_candidate', 'WTA answers AS the candidate');
    assert.ok(!plan.requiredContextLayers.includes('negotiation'));
  });

  test('Interviewer: "Tell me about your projects." → project/profile, uses resume, not negotiation', () => {
    const { plan } = planFromTranscript(turns(['interviewer', 'Tell me about your projects.']));
    assert.ok(['project_answer', 'experience_answer', 'profile_fact_answer', 'behavioral_interview_answer'].includes(plan.answerType), `got ${plan.answerType}`);
    assert.ok(plan.requiredContextLayers.includes('resume'), 'projects must use resume');
    assert.ok(!plan.forbiddenContextLayers.includes('resume'));
  });

  test('Interviewer: "Can you write code to check if a number is odd or even?" → coding, isolated', () => {
    const { plan } = planFromTranscript(turns(['interviewer', 'Can you write code to check whether a number is odd or even?']));
    assert.ok(isCodingAnswerType(plan.answerType), `got ${plan.answerType}`);
    assert.equal(plan.shouldShowImmediateScaffold, true);
    for (const layer of ['resume', 'jd', 'negotiation']) {
      assert.ok(plan.forbiddenContextLayers.includes(layer), `coding must forbid ${layer}`);
    }
  });

  test('Interviewer: "Can you solve two sum?" → dsa, hash-map class, isolated', () => {
    const { plan } = planFromTranscript(turns(['interviewer', 'Can you solve two sum?']));
    assert.equal(plan.answerType, 'dsa_question_answer', `got ${plan.answerType}`);
    assert.equal(plan.shouldShowImmediateScaffold, true);
    assert.ok(plan.forbiddenContextLayers.includes('resume'));
  });

  test('Interviewer: "What is the time complexity?" (follow-up) → coding/dsa or follow-up, not profile dump', () => {
    const { plan } = planFromTranscript(turns(
      ['interviewer', 'Can you solve two sum?'],
      ['candidate', 'Sure, I would use a hash map.'],
      ['interviewer', 'What is the time complexity?'],
    ));
    // Complexity is a technical question → coding/dsa, technical_concept, or
    // follow-up. Any of these is fine; the CONTRACT is it must NOT pull resume/JD.
    assert.ok(
      isCodingAnswerType(plan.answerType)
        || plan.answerType === 'technical_concept_answer'
        || plan.answerType === 'follow_up_answer',
      `got ${plan.answerType}`,
    );
    // The real invariant: no profile layers for a complexity question.
    assert.ok(plan.forbiddenContextLayers.includes('resume'), 'must forbid resume');
    assert.ok(plan.forbiddenContextLayers.includes('jd'), 'must forbid jd');
  });

  test('Interviewer: "Can you explain that project in more detail?" → follow-up, uses transcript', () => {
    const { extracted, plan } = planFromTranscript(turns(
      ['interviewer', 'Tell me about your projects.'],
      ['candidate', 'I built a recommendation engine.'],
      ['interviewer', 'Can you explain that project in more detail?'],
    ));
    assert.ok(extracted.isFollowUp || plan.answerType === 'follow_up_answer' || plan.answerType === 'project_answer', `got ${plan.answerType}, follow=${extracted.isFollowUp}`);
    assert.ok(!plan.forbiddenContextLayers.includes('live_transcript'));
  });

  test('Interviewer: "Why do you fit this role?" → jd_fit, uses resume + jd', () => {
    const { plan } = planFromTranscript(turns(['interviewer', 'Why do you fit this role?']));
    assert.equal(plan.answerType, 'jd_fit_answer', `got ${plan.answerType}`);
    assert.ok(plan.requiredContextLayers.includes('resume'));
    assert.ok(plan.requiredContextLayers.includes('jd'));
    assert.ok(plan.forbiddenContextLayers.includes('negotiation'));
  });

  test('latest project design-decision question wins over an earlier intro and never becomes jd_fit', () => {
    const exactQuestion = 'Could you explain why you used a deterministic evidence gate in the Atlas Verify project?';
    const { extracted, plan } = planFromTranscript(turns(
      ['interviewer', 'Could you briefly introduce yourself?'],
      ['candidate', 'I am a software engineer focused on reliable product delivery.'],
      ['interviewer', exactQuestion],
    ));

    assert.match(extracted.latestQuestion, /deterministic evidence gate/i, 'must use the latest interviewer question');
    assert.notEqual(extracted.questionType, 'jd_alignment');
    assert.equal(plan.answerType, 'project_followup_answer', `got ${plan.answerType}`);
    assert.ok(plan.requiredContextLayers.includes('resume'), 'project decision must use project/profile evidence');
    assert.ok(!plan.requiredContextLayers.includes('jd'), 'project decision must not turn into a JD-fit pitch');
    assert.match(plan.responseTemplate, /EXACT drill-in asked/i, 'contract must answer the design decision, not summarize the profile');
  });

  test('real interview trade-offs question forwards resume exclusion to the provider choke point', async () => {
    const exactQuestion = 'What trade-offs did you make when designing the solution?';
    const { plan } = planFromTranscript(turns(
      ['interviewer', 'Could you briefly introduce yourself?'],
      ['candidate', 'I am a software engineer focused on reliable product delivery.'],
      ['interviewer', exactQuestion],
    ));

    assert.equal(plan.answerType, 'general_meeting_answer', `got ${plan.answerType}`);
    assert.ok(plan.forbiddenContextLayers.includes('resume'), 'precondition: this answer must reject profile context');

    const { message, route } = await captureWtaStreamRoute(exactQuestion, plan);
    assert.equal(route.answerType, plan.answerType);
    assert.deepEqual(route.forbiddenContextLayers, plan.forbiddenContextLayers);
    assert.equal(route.currentQuestion, plan.question);
    assert.equal(profileInterceptAllowedByRoute(route), false, 'local interview profile injection must remain disabled');
    assert.doesNotMatch(message, /INTRODUCTION_SENTINEL/, 'candidate presentation must not reach a profile-forbidden answer');
  });

  test('Atlas Verify drill-in forwards its exact question for relevant project grounding', async () => {
    const exactQuestion = 'Could you explain why you used a deterministic evidence gate in the Atlas Verify project?';
    const { plan } = planFromTranscript(turns(['interviewer', exactQuestion]));

    assert.equal(plan.answerType, 'project_followup_answer', `got ${plan.answerType}`);
    const { message, route } = await captureWtaStreamRoute(
      exactQuestion,
      plan,
      `[INTERVIEWER]: Could you briefly introduce yourself?\n[CANDIDATE]: I am a software engineer.\n[INTERVIEWER]: ${exactQuestion}`,
    );
    assert.equal(route.currentQuestion, plan.question);
    assert.deepEqual(route.requiredContextLayers, plan.requiredContextLayers);
    assert.deepEqual(route.forbiddenContextLayers, plan.forbiddenContextLayers);
    assert.equal(profileInterceptAllowedByRoute(route), true, 'project facts remain available for the actual project drill-in');
    assert.deepEqual(localInterviewContextKindsForRoute(route), ['professional'], 'project drill-in may attach only the professional/project document');
    assert.match(message, /currentQuestion: Could you explain why you used a deterministic evidence gate/i, 'the exact current task must be pinned explicitly');
    assert.doesNotMatch(message, /Could you briefly introduce yourself/i, 'an earlier intro question must not enter a route that excludes live_transcript');
    assert.match(message, /Earlier transcript questions and earlier assistant answers are context only/i);
  });

  test('explicit JD-fit wording still wins even when a project is mentioned', () => {
    const { plan } = planFromTranscript(turns([
      'interviewer',
      'Why does your Atlas Verify project make you a good fit for this role?',
    ]));
    assert.equal(plan.answerType, 'jd_fit_answer', `got ${plan.answerType}`);
    assert.ok(plan.requiredContextLayers.includes('jd'));
  });

  test('generic technical rationale is not captured as a profile project follow-up', () => {
    const { plan } = planFromTranscript(turns([
      'interviewer',
      'Could you explain why you used a hash map for this algorithm?',
    ]));
    assert.notEqual(plan.answerType, 'project_followup_answer');
    assert.ok(plan.forbiddenContextLayers.includes('resume'), `got ${plan.answerType}`);
  });

  test('Interviewer: "What salary are you expecting?" → negotiation, not coding', () => {
    const { plan } = planFromTranscript(turns(['interviewer', 'What salary are you expecting?']));
    assert.equal(plan.answerType, 'negotiation_answer', `got ${plan.answerType}`);
    assert.ok(!isCodingAnswerType(plan.answerType));
  });

  test('A coding question never routes to negotiation even if it mentions a big number', () => {
    const { plan } = planFromTranscript(turns(['interviewer', 'Write code to sum an array of 100k integers.']));
    assert.ok(isCodingAnswerType(plan.answerType), `got ${plan.answerType}`);
    assert.notEqual(plan.answerType, 'negotiation_answer');
  });

  test('Manual input perspective differs from WTA: identity manual = second-person', () => {
    const manual = planAnswer({ question: 'what is my name?', source: 'manual_input', speakerPerspective: 'user' });
    assert.equal(manual.outputPerspective, 'second_person_user', 'manual identity answers the USER ("Your name is…")');
    const wta = planAnswer({ question: undefined, source: 'what_to_answer', speakerPerspective: 'interviewer', extractedQuestion: extractLatestQuestion(turns(['interviewer', 'what is your name?'])) });
    assert.equal(wta.outputPerspective, 'first_person_candidate', 'WTA identity answers AS the candidate ("My name is…")');
  });
});
