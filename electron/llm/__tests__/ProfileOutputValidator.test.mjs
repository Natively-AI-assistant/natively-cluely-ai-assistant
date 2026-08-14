// electron/llm/__tests__/ProfileOutputValidator.test.mjs
//
// Spec §7 / §12.9: the ProfileOutputValidator must catch each output failure mode
// and pass clean answers. Pure functions — plain node.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { planAnswer } from '../../../dist-electron/electron/llm/AnswerPlanner.js';
import { validateProfileOutput, buildProfileRepairInstruction } from '../../../dist-electron/electron/llm/ProfileOutputValidator.js';

const planFor = (q, sp = 'interviewer') => planAnswer({ question: q, source: 'what_to_answer', speakerPerspective: sp });

const validate = (answer, q, opts = {}) => validateProfileOutput({
  answer,
  plan: planFor(q, opts.speaker || 'interviewer'),
  profileAvailable: opts.profileAvailable !== false,
  candidateDirected: opts.candidateDirected !== false,
});

describe('ProfileOutputValidator: clean answers pass', () => {
  test('correct first-person identity answer passes', () => {
    const r = validate('My name is Evin John.', 'What is your name?');
    assert.equal(r.ok, true, JSON.stringify(r.violations));
  });
  test('correct first-person experience answer passes', () => {
    const r = validate("I worked on Natively, an AI meeting assistant, and interned building WebRTC pipelines.", 'Tell me about your experience.');
    assert.equal(r.ok, true, JSON.stringify(r.violations));
  });
  test('correct skill answer passes', () => {
    const r = validate('Yes, I have used Python and AWS extensively.', 'Have you used Python?');
    assert.equal(r.ok, true, JSON.stringify(r.violations));
  });
  test('a salary answer with figures is fine (negotiation type allows it)', () => {
    const r = validate("I'm targeting a range of $120k to $140k based on the role.", 'What salary are you expecting?');
    assert.equal(r.ok, true, JSON.stringify(r.violations));
  });
  test('empty answer is vacuously ok', () => {
    const r = validate('', 'What is your name?');
    assert.equal(r.ok, true);
  });
});

describe('ProfileOutputValidator: catches the spec §7 failure modes', () => {
  test('1. assistant-identity leak ("I am Natively") on an identity question', () => {
    const r = validate("I am Natively, an AI assistant.", 'What is your name?');
    assert.equal(r.ok, false);
    assert.ok(r.errorCodes.includes('assistant_identity_leak'));
  });

  test('2. "I am an AI assistant" leak on a profile question', () => {
    const r = validate("I'm an AI assistant and don't have a personal name.", 'What is your name?');
    assert.equal(r.ok, false);
    assert.ok(r.errorCodes.includes('assistant_identity_leak'));
  });

  test('3. false "no access" refusal when profile exists', () => {
    const r = validate("I don't have access to your personal information.", 'What are my skills?', { speaker: 'user', candidateDirected: false });
    assert.equal(r.ok, false);
    assert.ok(r.errorCodes.includes('false_no_access_refusal'));
  });

  test('4. false "no experience" when profile exists', () => {
    const r = validate("I don't have personal experience with that.", 'Tell me about your experience.');
    assert.equal(r.ok, false);
    assert.ok(r.errorCodes.includes('false_no_experience_refusal'));
  });

  test('5. third-person about the user instead of first person', () => {
    const r = validate("The user's name is Evin John and their experience includes Natively.", 'What is your name?');
    assert.equal(r.ok, false);
    assert.ok(r.errorCodes.includes('wrong_perspective_not_first_person'));
  });

  test('6. negotiation-strategy leak in a non-salary (skills) answer', () => {
    const r = validate("My skills include Python. Also, anchor high and use your BATNA as leverage point.", 'What are my skills?', { speaker: 'user', candidateDirected: false });
    assert.equal(r.ok, false);
    assert.ok(r.errorCodes.includes('sensitive_salary_leak'));
  });

  test('7. resume/JD leak in a generic coding answer', () => {
    const r = validate("Here is the code. Based on the candidate's resume and the job description, use a hash map.", 'Write a function for two sum', { candidateDirected: false });
    assert.equal(r.ok, false);
    assert.ok(r.errorCodes.includes('profile_in_generic_answer'));
  });

  test('coding answer that mentions "the JD" is flagged', () => {
    const r = validate("Looking at the JD, here is a BFS implementation.", 'Explain BFS', { candidateDirected: false });
    assert.equal(r.ok, false);
    assert.ok(r.errorCodes.includes('profile_in_generic_answer'));
  });
});

describe('ProfileOutputValidator: missing-profile fallback (spec §9)', () => {
  test('"no access" is NOT flagged when profile is genuinely absent', () => {
    const r = validate("I don't have your profile loaded yet, so I can't answer that accurately.", 'What is your name?', { profileAvailable: false });
    assert.equal(r.ok, true, JSON.stringify(r.violations));
  });
});

describe('ProfileOutputValidator: repair instructions', () => {
  test('clean result yields empty instruction', () => {
    const r = validate('My name is Evin John.', 'What is your name?');
    assert.equal(buildProfileRepairInstruction(r), '');
  });
  test('identity leak yields a first-person correction', () => {
    const r = validate('I am Natively, an AI assistant.', 'What is your name?');
    const instr = buildProfileRepairInstruction(r);
    assert.match(instr, /first person/i);
    assert.match(instr, /Never say you are Natively/i);
  });
  test('coding leak yields a remove-profile correction', () => {
    const r = validate("Based on the candidate's resume, here is the code.", 'Write two sum', { candidateDirected: false });
    const instr = buildProfileRepairInstruction(r);
    assert.match(instr, /technical answer/i);
  });
});

describe('ProfileOutputValidator: does not over-flag legitimate answers', () => {
  test('candidate saying "I" many times is fine', () => {
    const r = validate("I'm a software engineer. I built Natively and I led the WebRTC work.", 'Tell me about yourself.');
    assert.equal(r.ok, true, JSON.stringify(r.violations));
  });
  test('a generic technical answer with no profile mention passes', () => {
    const r = validate("BFS explores a graph level by level using a queue.", 'Explain BFS', { candidateDirected: false });
    assert.equal(r.ok, true, JSON.stringify(r.violations));
  });
  test('mentioning "my approach" in coding is not a profile leak', () => {
    const r = validate("My approach is to use a hash map for O(n) lookup.", 'Write two sum', { candidateDirected: false });
    assert.equal(r.ok, true, JSON.stringify(r.violations));
  });
});
