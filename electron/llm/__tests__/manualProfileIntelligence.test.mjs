import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  tryBuildManualProfileFastPathAnswer,
  isAssistantIdentityQuestion,
  logManualProfileRoute,
  hasUnhandledQualifier,
} = require('../../../dist-electron/electron/llm/manualProfileIntelligence.js');

const PROFILE = {
  identity: { name: 'Test Candidate' },
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
    { institution: 'State University', degree: 'BS', field: 'Computer Science' },
  ],
};

const JD = {
  title: 'Data Analyst',
  company: 'ExampleCo',
  skills: ['SQL', 'dashboards', 'stakeholder communication'],
};

function fast(question, perspective = 'manual_input') {
  return tryBuildManualProfileFastPathAnswer({
    question,
    profile: PROFILE,
    jobDescription: JD,
    source: perspective,
  });
}

describe('manual Profile Intelligence deterministic fast path', () => {
  test('MANUAL-PI-IDENTITY-001: answers name from structured resume without provider', () => {
    const result = fast('what is my name?');
    assert.ok(result);
    assert.equal(result.providerUsed, false);
    assert.equal(result.answer, 'Your name is Test Candidate.');
    assert.deepEqual(result.selectedContextLayers, ['stable_identity', 'resume']);
    assert.ok(result.excludedContextLayers.includes('assistant_identity'));
  });

  test('MANUAL-PI-EXPERIENCE-001: a "your experiences" question (asking the CANDIDATE) answers in FIRST person', () => {
    // Manual regression fix 2026-06-08: "your experiences" addresses the candidate, so
    // a profile-loaded manual answer is first-person candidate voice ("My experience…"),
    // not "Your experience…". (A "my experiences" self-query stays second-person.)
    const result = fast('what are your experiences?');
    assert.ok(result);
    assert.match(result.answer, /My experience includes/i);
    assert.match(result.answer, /Acme Analytics/);
    assert.match(result.answer, /Data Analyst/);
    assert.match(result.answer, /Northstar Labs/);
    assert.doesNotMatch(result.answer, /OpenOffer|AI assistant/i);
    assert.equal(result.providerUsed, false);
  });

  test('MANUAL-PI-PROJECTS-001: a "projects you have done" question answers in FIRST person', () => {
    const result = fast('what all projects have you done?');
    assert.ok(result);
    assert.match(result.answer, /My projects include/i);
    assert.match(result.answer, /Revenue Forecasting/);
    assert.match(result.answer, /Churn Dashboard/);
    assert.doesNotMatch(result.answer, /OpenOffer|AI assistant/i);
  });

  test('MANUAL-PI-SKILLS-001: answers skills from structured resume', () => {
    const result = fast('what are my skills?');
    assert.ok(result);
    assert.match(result.answer, /Your skills include/i);
    assert.match(result.answer, /Python/);
    assert.match(result.answer, /SQL/);
    assert.match(result.answer, /Tableau/);
  });

  test('manual education and role facts work before AOT', () => {
    const education = fast('what is my education?');
    assert.ok(education);
    assert.match(education.answer, /State University/);
    assert.match(education.answer, /Computer Science/);

    const role = fast('what role am I applying for?');
    assert.ok(role);
    assert.match(role.answer, /Data Analyst/);
  });

  test('resume-only profile facts still work and JD role does not fabricate', () => {
    for (const question of [
      'what is my name?',
      'what are my experiences?',
      'what are my skills?',
      'what all projects have you done?',
      'what is my education?',
    ]) {
      const result = tryBuildManualProfileFastPathAnswer({
        question,
        profile: PROFILE,
        jobDescription: null,
        source: 'manual_input',
      });
      assert.ok(result, `${question} should work without a JD`);
      assert.equal(result.providerUsed, false);
    }

    const role = tryBuildManualProfileFastPathAnswer({
      question: 'what role am I applying for?',
      profile: PROFILE,
      jobDescription: null,
      source: 'manual_input',
    });
    assert.equal(role, null, 'target role must not be fabricated when no JD exists');
  });

  test('WTA/interviewer perspective uses first-person candidate wording', () => {
    const result = tryBuildManualProfileFastPathAnswer({
      question: 'Interviewer: What is your name?',
      profile: PROFILE,
      jobDescription: JD,
      source: 'what_to_answer',
    });
    assert.ok(result);
    assert.equal(result.answer, 'My name is Test Candidate.');
  });

  test('GENUINE assistant-meta still bails to the assistant (not hijacked by profile)', () => {
    // Release 2026-06-06b: narrowed to TRUE assistant-meta — what-is-OpenOffer,
    // who-built-you, are-you-an-AI/model. These legitimately address the app.
    for (const question of ['what is OpenOffer?', 'who made you?', 'are you an AI?', 'what model do you use?', 'are you a bot?']) {
      assert.equal(isAssistantIdentityQuestion(question), true, `${question} should be assistant identity`);
      assert.equal(fast(question), null, `${question} must not use candidate profile facts`);
    }
  });

  test('identity asks ("who are you", "what is your name") now answer AS the candidate (2026-06-06b)', () => {
    // In an interview-prep product with a loaded profile, "who are you" / "what is
    // your name" are the candidate's identity questions and must be answered as the
    // candidate (real manual-chat log: they leaked "I'm OpenOffer, an AI assistant").
    for (const question of ['who are you?', 'what is your name?', "what's your name?"]) {
      assert.equal(isAssistantIdentityQuestion(question), false, `${question} is now a candidate identity ask`);
      const r = fast(question);
      assert.ok(r, `${question} should fast-path to a candidate answer`);
      assert.match(r.answer, /Test Candidate/, `${question} answers with the loaded candidate name`);
      assert.doesNotMatch(r.answer, /OpenOffer|AI assistant/i, `${question} must NOT leak the assistant identity`);
    }
  });

  test('JD-only role question uses structured JD without requiring resume facts', () => {
    const role = tryBuildManualProfileFastPathAnswer({
      question: 'what role am I applying for?',
      profile: null,
      jobDescription: JD,
      source: 'manual_input',
    });
    assert.ok(role);
    assert.equal(role.providerUsed, false);
    assert.equal(role.answer, 'You are applying for the Data Analyst role.');
  });

  test('safe route log redacts question and never logs raw profile facts', () => {
    const result = fast('what is my name?');
    const log = logManualProfileRoute({
      source: 'manual_input',
      question: 'what is my name?',
      route: result,
      profileFactsReady: true,
    });
    assert.equal(log.question, undefined);
    assert.match(log.questionHash, /^[a-f0-9]{12}$/);
    assert.equal(log.profileFactsReady, true);
    assert.equal(log.usedDeterministicFastPath, true);
    assert.equal(log.providerUsed, false);
    assert.doesNotMatch(JSON.stringify(log), /Test Candidate|Acme Analytics|Revenue Forecasting/);
  });
});

// REGRESSION: the deterministic fast path used to fire a canned "your projects
// include ..." dump for ANY question containing "projects", ignoring filters like
// "...that I used REST API". Those qualified questions must DEFER to the grounded
// LLM (return null) so it can actually reason over the filter, not dump verbatim.
describe('manual Profile Intelligence: qualified questions defer to the LLM', () => {
  test('bare listing questions still FIRE the fast path', () => {
    assert.ok(fast('what are my projects?'), 'plain projects listing should fast-path');
    assert.ok(fast('what are my skills?'), 'plain skills listing should fast-path');
    assert.ok(fast('what is my name?'), 'name lookup should fast-path');
    assert.ok(fast('what are your experiences?'), 'plain experience listing should fast-path');
  });

  test('FILTERED project question DEFERS (the reported "dumb" bug)', () => {
    assert.equal(fast('what are my projects that i have used rest api'), null,
      'a project question with a tech filter must defer to the grounded LLM');
    assert.equal(fast('which project used graphql'), null);
    assert.equal(fast('tell me about my projects related to machine learning'), null);
    assert.equal(fast('any projects with kubernetes'), null);
  });

  test('FILTERED skill question DEFERS', () => {
    assert.equal(fast('what skills do i have in python'), null);
    assert.equal(fast('which skills are most relevant for this role'), null);
  });

  test('comparison / how / why questions DEFER', () => {
    assert.equal(fast('how did i use redis in my projects'), null);
    assert.equal(fast('why are my projects a good fit'), null);
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
