import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  selectManualProfileEvidence,
  tryBuildManualProfileFastPathAnswer,
  isAssistantIdentityQuestion,
  logManualProfileRoute,
  hasUnhandledQualifier,
  buildLiveFallbackAnswer,
} = require('../../../dist-electron/electron/llm/manualProfileIntelligence.js');

const PROFILE = {
  identity: { name: 'Evin John' },
  skills: ['Python', 'SQL', 'Tableau'],
  experience: [
    { company: 'Acme Analytics', role: 'Data Analyst', bullets: ['Built KPI dashboards'] },
    { company: 'Northstar Labs', role: 'Business Analyst', bullets: ['Automated reporting workflows'] },
  ],
  projects: [
    { name: 'Revenue Forecasting', description: 'Predicted quarterly revenue with Python' },
    { name: 'Churn Dashboard', description: 'Tableau dashboard for retention metrics' },
  ],
  education: [
    { institution: 'State University', degree: 'BS', field: 'Computer Science', cgpa: '7.5/10' },
  ],
};

const JD = {
  title: 'Data Analyst',
  company: 'ExampleCo',
  requirements: ['SQL', 'dashboards', 'stakeholder communication'],
};

function route(question, perspective = 'manual_input') {
  return selectManualProfileEvidence({
    question,
    profile: PROFILE,
    jobDescription: JD,
    source: perspective,
  });
}

function values(result) {
  return JSON.stringify(result?.items?.map((item) => item.value) ?? []);
}

describe('manual Profile Intelligence evidence selector (Full-JIT)', () => {
  test('MANUAL-PI-IDENTITY-001: selects name evidence without rendering final prose', () => {
    const result = route('what is my name?');
    assert.ok(result);
    assert.equal(result.answer, undefined);
    assert.equal(result.usedDeterministicFastPath, false);
    assert.equal(result.usedDeterministicEvidenceSelection, true);
    assert.equal(result.providerUsed, true);
    assert.equal(result.finalGenerationMode, 'jit_llm');
    assert.equal(result.answerType, 'identity_answer');
    assert.deepEqual(result.selectedContextLayers, ['stable_identity', 'resume']);
    assert.ok(result.excludedContextLayers.includes('assistant_identity'));
    assert.deepEqual(result.items.map((item) => item.field), ['identity.name']);
    assert.match(values(result), /Evin John/);
  });

  test('MANUAL-PI-EXPERIENCE-001: selects experience entries as evidence only', () => {
    const result = route('what are your experiences?');
    assert.ok(result);
    assert.equal(result.answer, undefined);
    assert.equal(result.answerType, 'experience_answer');
    assert.equal(result.selectedExperiences.length, 2);
    assert.match(values(result), /Acme Analytics/);
    assert.match(values(result), /Data Analyst/);
    assert.match(values(result), /Northstar Labs/);
    assert.doesNotMatch(values(result), /Natively|AI assistant/i);
  });

  test('MANUAL-PI-PROJECTS-001: selects project evidence only', () => {
    const result = route('what all projects have you done?');
    assert.ok(result);
    assert.equal(result.answer, undefined);
    assert.equal(result.answerType, 'project_answer');
    assert.equal(result.selectedProjects.length, 2);
    assert.match(values(result), /Revenue Forecasting/);
    assert.match(values(result), /Churn Dashboard/);
  });

  test('MANUAL-PI-SKILLS-001: selects skills evidence', () => {
    const result = route('what are my skills?');
    assert.ok(result);
    assert.equal(result.answer, undefined);
    assert.equal(result.answerType, 'skills_answer');
    assert.deepEqual(result.selectedSkills, ['Python', 'SQL', 'Tableau']);
  });

  test('manual education and role facts are selected before AOT/JIT generation', () => {
    const education = route('what is my education?');
    assert.ok(education);
    assert.equal(education.answer, undefined);
    assert.match(values(education), /State University/);
    assert.match(values(education), /Computer Science/);
    assert.match(values(education), /7.5\/10/);

    const role = route('what role am I applying for?');
    assert.ok(role);
    assert.equal(role.answer, undefined);
    assert.equal(role.items.find((item) => item.field === 'job.title')?.value, 'Data Analyst');
  });

  test('resume-only profile facts still select and JD role does not fabricate', () => {
    for (const question of [
      'what is my name?',
      'what are my experiences?',
      'what are my skills?',
      'what all projects have you done?',
      'what is my education?',
    ]) {
      const result = selectManualProfileEvidence({ question, profile: PROFILE, jobDescription: null, source: 'manual_input' });
      assert.ok(result, `${question} should select evidence without a JD`);
      assert.equal(result.answer, undefined);
      assert.equal(result.providerUsed, true);
    }

    const role = selectManualProfileEvidence({
      question: 'what role am I applying for?',
      profile: PROFILE,
      jobDescription: null,
      source: 'manual_input',
    });
    assert.equal(role, null, 'target role must not be fabricated when no JD exists');
  });

  test('deprecated wrapper is evidence-only too', () => {
    const result = tryBuildManualProfileFastPathAnswer({
      question: 'Interviewer: What is your name?',
      profile: PROFILE,
      jobDescription: JD,
      source: 'what_to_answer',
    });
    assert.ok(result);
    assert.equal(result.answer, undefined);
    assert.equal(result.usedDeterministicFastPath, false);
    assert.match(values(result), /Evin John/);
  });

  test('GENUINE assistant-meta still bails to the assistant (not hijacked by profile)', () => {
    for (const question of ['what is Natively?', 'who made you?', 'are you an AI?', 'what model do you use?', 'are you a bot?']) {
      assert.equal(isAssistantIdentityQuestion(question), true, `${question} should be assistant identity`);
      assert.equal(route(question), null, `${question} must not select candidate profile facts`);
    }
  });

  test('identity asks are candidate profile evidence, not assistant identity', () => {
    for (const question of ['who are you?', 'what is your name?', "what's your name?"]) {
      assert.equal(isAssistantIdentityQuestion(question), false, `${question} is a candidate identity ask`);
      const r = route(question);
      assert.ok(r, `${question} should select candidate identity evidence`);
      assert.match(values(r), /Evin John/);
      assert.doesNotMatch(values(r), /Natively|AI assistant/i);
    }
  });

  test('JD-only role question uses structured JD without requiring resume facts', () => {
    const role = selectManualProfileEvidence({
      question: 'what role am I applying for?',
      profile: null,
      jobDescription: JD,
      source: 'manual_input',
    });
    assert.ok(role);
    assert.equal(role.answer, undefined);
    assert.equal(role.providerUsed, true);
    assert.equal(role.items.find((item) => item.field === 'job.title')?.value, 'Data Analyst');
  });

  test('safe route log redacts question and never logs raw profile facts', () => {
    const result = route('what is my name?');
    const log = logManualProfileRoute({
      source: 'manual_input',
      question: 'what is my name?',
      route: result,
      profileFactsReady: true,
    });
    assert.equal(log.question, undefined);
    assert.match(log.questionHash, /^[a-f0-9]{12}$/);
    assert.equal(log.profileFactsReady, true);
    assert.equal(log.usedDeterministicFastPath, false);
    assert.equal(log.providerUsed, true);
    assert.doesNotMatch(JSON.stringify(log), /Evin John|Acme Analytics|Revenue Forecasting/);
  });

  test('live fallback never returns deterministic profile prose on provider failure', () => {
    assert.equal(buildLiveFallbackAnswer({ question: 'what is my name?', answerType: 'identity_answer', profile: PROFILE, jobDescription: JD }), null);
  });
});

describe('manual Profile Intelligence: qualified questions defer to JIT/general grounding', () => {
  test('bare listing questions still select evidence', () => {
    assert.ok(route('what are my projects?'), 'plain projects listing should select evidence');
    assert.ok(route('what are my skills?'), 'plain skills listing should select evidence');
    assert.ok(route('what is my name?'), 'name lookup should select evidence');
    assert.ok(route('what are your experiences?'), 'plain experience listing should select evidence');
  });

  test('FILTERED project question DEFERS to broader grounded generation', () => {
    assert.equal(route('what are my projects that i have used rest api'), null);
    assert.equal(route('which project used graphql'), null);
    assert.equal(route('tell me about my projects related to machine learning'), null);
    assert.equal(route('any projects with kubernetes'), null);
  });

  test('FILTERED skill question DEFERS', () => {
    assert.equal(route('what skills do i have in python'), null);
    assert.equal(route('which skills are most relevant for this role'), null);
  });

  test('comparison / how / why questions DEFER', () => {
    assert.equal(route('how did i use redis in my projects'), null);
    assert.equal(route('why are my projects a good fit'), null);
  });

  test('hasUnhandledQualifier detects filters but not plain listings', () => {
    assert.equal(hasUnhandledQualifier('what are my projects'), false);
    assert.equal(hasUnhandledQualifier('what are my skills'), false);
    assert.equal(hasUnhandledQualifier('projects that used rest api'), true);
    assert.equal(hasUnhandledQualifier('which project used graphql'), true);
    assert.equal(hasUnhandledQualifier('skills in python'), true);
    assert.equal(hasUnhandledQualifier('how did i build it'), true);
  });
});
