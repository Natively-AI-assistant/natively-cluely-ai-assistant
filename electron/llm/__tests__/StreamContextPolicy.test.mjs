// electron/llm/__tests__/StreamContextPolicy.test.mjs
//
// D1: the pure policy that makes the routing decision authoritative at the
// streamChat execution choke-point. Proves inclusion AND exclusion per spec §12.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const {
  profileInterceptAllowedByRoute,
  modeAnswerType,
} = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/streamContextPolicy.js')).href
);
const { planAnswer } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/AnswerPlanner.js')).href
);

const routeFor = (question, source = 'manual_input') => {
  const plan = planAnswer({ question, source });
  return { answerType: plan.answerType, forbiddenContextLayers: plan.forbiddenContextLayers };
};

describe('D1: profileInterceptAllowedByRoute', () => {
  test('no route options → allowed (legacy behavior preserved)', () => {
    assert.equal(profileInterceptAllowedByRoute(undefined), true);
    assert.equal(profileInterceptAllowedByRoute({}), true);
    assert.equal(profileInterceptAllowedByRoute({ forbiddenContextLayers: [] }), true);
  });

  test('EXCLUDES profile for a coding question', () => {
    const r = routeFor('write a function to solve two sum');
    assert.equal(profileInterceptAllowedByRoute(r), false, `coding route should forbid profile: ${JSON.stringify(r)}`);
  });

  test('EXCLUDES profile for a generic technical-concept question', () => {
    const r = routeFor('explain how BFS works');
    assert.equal(profileInterceptAllowedByRoute(r), false, `technical-concept route: ${JSON.stringify(r)}`);
  });

  test('EXCLUDES profile for a sales question', () => {
    const r = routeFor('why is your product so expensive compared to competitors?');
    assert.equal(profileInterceptAllowedByRoute(r), false, `sales route: ${JSON.stringify(r)}`);
  });

  test('EXCLUDES profile for a lecture question', () => {
    const r = routeFor('explain what the professor meant on this slide');
    assert.equal(profileInterceptAllowedByRoute(r), false, `lecture route: ${JSON.stringify(r)}`);
  });

  test('INCLUDES profile for an identity question', () => {
    const r = routeFor('what is my name?');
    assert.equal(profileInterceptAllowedByRoute(r), true, `identity route: ${JSON.stringify(r)}`);
  });

  test('INCLUDES profile for a projects question', () => {
    const r = routeFor('what projects have I worked on?');
    assert.equal(profileInterceptAllowedByRoute(r), true, `projects route: ${JSON.stringify(r)}`);
  });

  test('INCLUDES profile for a JD-fit question', () => {
    const r = routeFor('why am I a good fit for this role?');
    assert.equal(profileInterceptAllowedByRoute(r), true, `jd-fit route: ${JSON.stringify(r)}`);
  });

  test('INCLUDES profile for a behavioral question', () => {
    const r = routeFor('tell me about a time you handled a crisis');
    assert.equal(profileInterceptAllowedByRoute(r), true, `behavioral route: ${JSON.stringify(r)}`);
  });
});

describe('D1: modeAnswerType', () => {
  test('defaults to general_meeting_answer when no route (matches prior hardcoded value)', () => {
    assert.equal(modeAnswerType(undefined), 'general_meeting_answer');
    assert.equal(modeAnswerType({}), 'general_meeting_answer');
  });

  test('uses the real answer type so custom-context sensitivity gating is correct', () => {
    assert.equal(modeAnswerType({ answerType: 'negotiation_answer' }), 'negotiation_answer');
    assert.equal(modeAnswerType({ answerType: 'coding_question_answer' }), 'coding_question_answer');
  });

  test('a real negotiation answer type can surface sensitive context (was impossible when hardcoded)', () => {
    const r = routeFor('what salary should I ask for?');
    assert.equal(r.answerType, 'negotiation_answer');
    assert.equal(modeAnswerType(r), 'negotiation_answer');
  });
});
