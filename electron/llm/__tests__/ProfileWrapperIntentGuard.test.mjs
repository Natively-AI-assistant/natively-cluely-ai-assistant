import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  isCodingAnswerType,
  planAnswer,
} from '../../../dist-electron/electron/llm/index.js';
import { profileInterceptAllowedByRoute } from '../../../dist-electron/electron/llm/streamContextPolicy.js';

const manualPlan = (question) => planAnswer({
  question,
  source: 'manual_input',
  speakerPerspective: 'user',
  hasCandidateProfile: true,
});

const routeFor = (plan) => ({
  answerType: plan.answerType,
  requiredContextLayers: plan.requiredContextLayers,
  forbiddenContextLayers: plan.forbiddenContextLayers,
});

const assertProfileForbidden = (plan, label) => {
  assert.equal(plan.profileContextPolicy, 'forbidden', label);
  assert.ok(plan.forbiddenContextLayers.includes('resume'), `${label}: resume must be forbidden`);
  assert.ok(plan.forbiddenContextLayers.includes('jd'), `${label}: jd must be forbidden`);
  assert.equal(profileInterceptAllowedByRoute(routeFor(plan)), false, label);
};

describe('quoted profile questions obey their outer request', () => {
  test('translation wrappers stay neutral and never inject profile context', () => {
    const questions = [
      "Traduza 'What is your current role?' para PT-BR.",
      "Traduza: 'Where did you study?'",
      "Como traduzo 'How many years of experience do you have?' para português?",
      "Traduza para inglês: 'Você consegue ver meu currículo?'",
    ];

    for (const question of questions) {
      const plan = manualPlan(question);
      assert.equal(plan.answerType, 'unknown_answer', question);
      assert.equal(plan.requiresLLM, true, question);
      assert.equal(plan.profileFactIntent, undefined, question);
      assertProfileForbidden(plan, question);
    }
  });

  test('explanation and correction wrappers do not treat quoted inventory text as intent', () => {
    const questions = [
      "Explique o significado da frase 'Meus arquivos de perfil estão disponíveis?'",
      'Não consulte meu perfil; apenas corrija a frase: Eu já anexei meu currículo?',
    ];

    for (const question of questions) {
      const plan = manualPlan(question);
      assert.notEqual(plan.answerType, 'profile_fact_answer', question);
      assert.equal(plan.profileFactIntent, undefined, question);
      assertProfileForbidden(plan, question);
    }
  });

  test('Portuguese coding imperatives stay coding even when UI copy looks like a profile question', () => {
    const questions = [
      "Monte um formulário React que pergunte 'Qual é a minha formação?'.",
      "Implemente em TypeScript um detector para a frase 'Eu já anexei meu currículo?'",
    ];

    for (const question of questions) {
      const plan = manualPlan(question);
      assert.equal(plan.answerType, 'coding_question_answer', question);
      assert.equal(isCodingAnswerType(plan.answerType), true, question);
      assert.equal(plan.profileFactIntent, undefined, question);
      assertProfileForbidden(plan, question);
    }
  });

  test('genuine direct profile questions remain profile-grounded', () => {
    const questions = [
      'What is your current role?',
      'Where did you study?',
      'How many years of experience do you have?',
      'Qual é a minha formação?',
      'Você consegue ver meu currículo?',
      'Where did you study? Responda em inglês e depois traduza para PT-BR.',
    ];

    for (const question of questions) {
      const plan = manualPlan(question);
      assert.notEqual(plan.answerType, 'unknown_answer', question);
      assert.ok(!isCodingAnswerType(plan.answerType), question);
      assert.equal(plan.profileContextPolicy, 'required', question);
      assert.ok(plan.requiredContextLayers.includes('resume'), question);
      assert.ok(!plan.forbiddenContextLayers.includes('resume'), question);
      assert.equal(profileInterceptAllowedByRoute(routeFor(plan)), true, question);
    }
  });
});
