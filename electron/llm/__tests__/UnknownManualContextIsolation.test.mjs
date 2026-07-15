// Unmatched manual questions must fail closed at the central route/choke point:
// no resume, JD, negotiation, or local interview-profile injection. Explicit
// candidate questions must remain profile-grounded.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const plannerPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/AnswerPlanner.js');
const policyPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/streamContextPolicy.js');
const helperPath = path.resolve(__dirname, '../../../dist-electron/electron/LLMHelper.js');
const ipcHandlersPath = path.resolve(__dirname, '../../ipcHandlers.ts');
const { planAnswer } = await import(pathToFileURL(plannerPath).href);
const { profileInterceptAllowedByRoute } = await import(pathToFileURL(policyPath).href);
const { LLMHelper } = await import(pathToFileURL(helperPath).href);

const manualPlan = (question) => planAnswer({
  question,
  source: 'manual_input',
  speakerPerspective: 'user',
  hasCandidateProfile: true,
});

const routeFor = (plan) => ({
  answerType: plan.answerType,
  forbiddenContextLayers: plan.forbiddenContextLayers,
  currentQuestion: plan.question,
});

describe('unknown manual context isolation', () => {
  for (const question of [
    'como fala eu que agradeço?',
    'how do I say thank you?',
    'traduz: eu que agradeço',
    'Olá',
  ]) {
    test(`${JSON.stringify(question)} fails closed before local profile injection`, () => {
      const plan = manualPlan(question);
      assert.equal(plan.answerType, 'unknown_answer');
      assert.equal(plan.profileContextPolicy, 'forbidden');
      for (const layer of ['resume', 'jd', 'negotiation']) {
        assert.ok(plan.forbiddenContextLayers.includes(layer), `${layer} must be forbidden`);
      }

      const route = routeFor(plan);
      assert.equal(profileInterceptAllowedByRoute(route), false);

      // Exercise the real LLMHelper injection method with the exact policy value
      // used by both chatWithGemini and _streamChatInner. Because shouldInject is
      // false, it must return before loading/reading any local interview documents.
      // Bypass the Electron-dependent constructor; this test exercises the pure
      // early-return branch of the real prototype method and needs no provider,
      // app path, or local document service.
      const helper = Object.create(LLMHelper.prototype);
      const applied = helper.applyLocalInterviewContext(
        question,
        undefined,
        undefined,
        profileInterceptAllowedByRoute(route),
        false,
        { live: true, question },
      );
      assert.equal(applied.context, undefined);
      assert.equal(applied.systemPromptOverride, undefined);
    });
  }

  test('explicit identity and project questions still allow required profile evidence', () => {
    for (const question of ['Tell me about yourself.', 'What projects have I worked on?']) {
      const plan = manualPlan(question);
      assert.equal(plan.profileContextPolicy, 'required', `${question} -> ${plan.answerType}`);
      assert.ok(plan.requiredContextLayers.includes('resume'));
      assert.ok(!plan.forbiddenContextLayers.includes('resume'));
      assert.equal(profileInterceptAllowedByRoute(routeFor(plan)), true);
    }
  });

  test('manual JIT profile evidence cannot reopen a planner-forbidden route', () => {
    const ipcHandlers = fs.readFileSync(ipcHandlersPath, 'utf8');
    const gateStart = ipcHandlers.indexOf('const profileEvidenceEligible =');
    assert.notEqual(gateStart, -1, 'manual profile-evidence gate must exist');
    const gate = ipcHandlers.slice(gateStart, gateStart + 1200);
    assert.match(
      gate,
      /answerPlan\.profileContextPolicy\s*!==\s*['"]forbidden['"]/,
      'secondary JIT selector must honor the authoritative AnswerPlan profile boundary',
    );
  });
});
