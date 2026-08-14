// electron/llm/__tests__/WhatToAnswerContract.test.mjs
//
// Issue 2 (P0): the what-to-answer candidate-voice contract. For source
// 'what_to_answer', every profile/identity/JD-fit/behavioral/negotiation answer
// type must route to first_person_candidate voice, and the ProfileOutputValidator
// must FLAG (so the live path repairs) a Natively-identity leak, a false refusal
// when the profile is loaded, and second/third-person voice for a candidate answer.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { planAnswer, validateProfileOutput } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/index.js')).href
);

const wtaPlan = (q) => planAnswer({
  question: null, source: 'what_to_answer', speakerPerspective: 'interviewer',
  extractedQuestion: { latestQuestion: q, detectedSpeaker: 'interviewer', questionType: 'identity', confidence: 0.9, isFollowUp: false, followUpTarget: '' },
});

// The 12 required WTA cases — each must plan to first-person candidate voice.
describe('Issue 2: WTA candidate answer types route to first_person_candidate', () => {
  const cases = [
    'What is your name?', 'What is your full name?', 'Who are you?', 'Tell me about yourself.',
    'Give me a quick introduction.', 'What do you currently do?', 'Where did you study?',
    'What role are you applying for?', 'What projects have you done?', 'Why should we hire you?',
    'Rate your Python skills out of 10.', 'What salary are you expecting?',
  ];
  for (const q of cases) {
    test(`"${q}" → first_person_candidate voice`, () => {
      const p = wtaPlan(q);
      assert.equal(p.voicePerspective, 'first_person_candidate', `${q} → ${p.voicePerspective} (${p.answerType})`);
    });
  }
});

// The validator must FLAG the contract violations (so the live repair fires).
describe('Issue 2: ProfileOutputValidator flags WTA contract violations', () => {
  const plan = wtaPlan('Who are you?'); // identity_answer, first-person required
  const validate = (answer) => validateProfileOutput({ answer, plan, profileAvailable: true, candidateDirected: true });
  const errs = (answer) => validate(answer).violations.filter((v) => v.severity === 'error').map((v) => v.code);

  test('"I am Natively, an AI assistant." → assistant_identity_leak', () => {
    assert.ok(errs('I am Natively, an AI assistant.').includes('assistant_identity_leak'));
  });
  test('"I can\'t share that information." → false_no_access_refusal', () => {
    assert.ok(errs("I can't share that information.").includes('false_no_access_refusal'));
  });
  test('"I don\'t have specific past experience loaded right now." → false refusal', () => {
    const codes = errs("I don't have specific past experience loaded right now.");
    assert.ok(codes.includes('false_no_experience_refusal') || codes.includes('false_no_access_refusal'));
  });
  test('"You are Evin John." (second/third person) → wrong_perspective', () => {
    assert.ok(errs('Your name is Evin John and your experience includes engineering.').includes('wrong_perspective_not_first_person'));
  });
  test('"My name is Evin John." (correct first-person) → no error', () => {
    assert.equal(errs('My name is Evin John.').length, 0);
  });
  test('a legitimate job title "I\'m an AI Engineer" is NOT flagged as a Natively leak', () => {
    assert.ok(!errs("I'm an AI & Full Stack Engineer with experience in data systems.").includes('assistant_identity_leak'));
  });
});

// Issue 6: behavioral never falsely refuses; validator bans the refusal phrases.
describe('Issue 6: behavioral routing + banned no-experience phrases', () => {
  for (const q of ['Tell me about a time you learned something quickly.', 'Tell me about handling ambiguity.',
    'Tell me a time you handled pressure.', 'Give me an example of teamwork.', 'Tell me about a time something went wrong.']) {
    test(`"${q}" → behavioral, profile required`, () => {
      const p = planAnswer({ question: q, source: 'manual_input', speakerPerspective: 'user' });
      assert.equal(p.answerType, 'behavioral_interview_answer', `→ ${p.answerType}`);
      assert.equal(p.profileContextPolicy, 'required');
    });
  }
  const bplan = planAnswer({ question: 'Tell me about a time you learned quickly.', source: 'what_to_answer', speakerPerspective: 'interviewer' });
  const flagged = (a) => validateProfileOutput({ answer: a, plan: bplan, profileAvailable: true, candidateDirected: true }).violations.some((v) => v.severity === 'error');
  for (const phrase of [
    "I don't have specific past experience loaded right now.",
    "I don't have a story loaded.",
    'Sure, if that matches my background, here is an example.',
    "I don't have access to your experience.",
  ]) {
    test(`validator FLAGS banned phrase: "${phrase.slice(0, 30)}…"`, () => {
      assert.ok(flagged(phrase), `should flag: ${phrase}`);
    });
  }
});
