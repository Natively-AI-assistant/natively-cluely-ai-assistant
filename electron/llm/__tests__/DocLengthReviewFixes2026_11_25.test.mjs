// electron/llm/__tests__/DocLengthReviewFixes2026_11_25.test.mjs
//
// Three defects found reviewing the merged #800 / #801 (2026-11-25):
//
//   1. The ranking probe read "put in place at" and "what place does X have in"
//      as leaderboard questions, so a fact that IS in the document was refused
//      as absent once retrieval scored low.
//   2. An answer that opened honestly ("The excerpts do not state the vendor.")
//      shipped whatever followed it, including an invented vendor, cost or rank.
//   3. A "usually" anywhere in the sentence turned a length into a default, so
//      "Never go over 50 words, since interviewers usually lose interest" was
//      softened to "usually up to 50 words".
//
// Pure: no platform branches. Runs on the built dist-electron bundles.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/', p)).href;
const d = await import(dist('llm/documentGroundedPrompt.js'));
const uic = await import(dist('llm/userInstructionContract.js'));

const DOC = 'The study recruited 24 participants from two hospitals using a Mercury X1 robot. A weekly review process was put in place at the start of the trial. Training ran 30 hours on a single workstation GPU.';
const coverage = (question, block = DOC) =>
  d.computeEvidenceCoverage({ question, retrievedBlock: block, queryShape: d.classifyDocumentQuestionShape(question) });
const validate = (question, answer, block = DOC) => d.validateDocumentGroundedAnswer({ question, answer, retrievedBlock: block });

describe('1: "place" is a ranking word only beside a result', () => {
  for (const q of [
    'What did they put in place at the start of the trial?',
    'What process was put in place at the hospitals?',
    'What place does the survey have in the design?',
    'What position does the robot hold during calibration?',
    'Where was the sensor placed in the room?',
    'How do they rank the candidates?',
  ]) {
    test(`not a ranking probe: ${q}`, () => {
      const c = coverage(q);
      assert.notEqual(c.requestedProperty, 'ranking');
      assert.notEqual(c.reason, 'absent_fact_no_answer_coverage');
    });
  }
  for (const q of [
    'Where did the policy rank on the public leaderboard?',
    'What rank did the model get?',
    'What position did they finish in?',
    'What place did the team finish?',
    'It placed 3rd, right?',
  ]) {
    test(`ranking probe: ${q}`, () => assert.equal(coverage(q).requestedProperty, 'ranking'));
  }
});

describe('2: an honest opening does not carry an invented fact', () => {
  for (const [q, a] of [
    ['What was the total cost of the system?', 'The excerpts do not state the cost, but it was $5,000.'],
    ['Where did the policy rank on the public leaderboard?', "The excerpts don't state the rank. It placed 3rd."],
    ['Which cloud provider did they use for training?', 'The excerpts do not state a cloud provider. They used AWS.'],
    ['Who was the vendor for the robot arm?', 'The excerpts do not state the vendor. It was Siemens.'],
  ]) {
    test(`refused: ${a}`, () => assert.equal(validate(q, a).action, 'refuse'));
  }
  for (const [q, a] of [
    ['Who was the vendor for the robot arm?', "The retrieved excerpts don't state a vendor; they only name the Mercury X1 robot."],
    ['What was the total cost of the system?', 'The retrieved excerpts do not state a total cost. They describe 24 participants and 30 hours of training. From general knowledge, a rig like this usually costs about $40,000.'],
    ['Who was the vendor for the robot arm?', 'The retrieved excerpts do not name a vendor. (As general knowledge: the Mercury X1 is made by Elephant Robotics.)'],
    ['Who was the vendor for the robot arm?', 'The vendor is not mentioned in the uploaded material.'],
  ]) {
    test(`ships: ${a}`, () => assert.equal(validate(q, a).action, 'ship'));
  }
  // Whole values, not substrings: "200 episodes" and "30 hours" do not vouch for "$20" or "3rd".
  const EPISODES = 'The policy was trained on 200 episodes over 30 hours on a single workstation GPU.';
  for (const [q, a] of [
    ['What was the total cost of the system?', 'The excerpts do not state a total cost. It was $20.'],
    ['What was the total cost of the system?', 'The excerpts do not state a total cost. It was $3.'],
    ['Where did the policy rank on the public leaderboard?', 'The excerpts do not state the rank. It ranked 3rd.'],
  ]) {
    test(`refused against "200"/"30" evidence: ${a}`, () => assert.equal(validate(q, a, EPISODES).action, 'refuse'));
  }
  test('a value the evidence does give still ships, however it is written', () => {
    const block = 'The rig cost $5,000 in total. The policy ranked 3rd on the public leaderboard.';
    assert.equal(d.isMaterialAbsenceReport('The excerpts do not state a per-unit cost. The total was 5000 dollars.', { question: 'What was the per-unit cost?', evidence: block, property: 'cost_or_price' }), true);
    assert.equal(d.isMaterialAbsenceReport('The excerpts do not state the final rank. The policy ranked 3rd at one point.', { question: 'What was the final rank?', evidence: block, property: 'ranking' }), true);
  });
  test('without evidence to check against, the opening alone decides (old single-argument behaviour)', () => {
    assert.equal(d.isMaterialAbsenceReport('The excerpts do not state the vendor. It was Siemens.'), true);
  });
});

describe('3: a default length is scoped to the length itself, never a hard cap', () => {
  const usually = (p) => uic.analyzeUserInstructions(p).length?.usually === true;
  for (const p of [
    'Keep answers to 25-40 words for most questions.',
    'Usually keep answers under 50 words.',
    'Usually, keep answers under 50 words.',
    'Keep answers short (25-40 words for most questions).',
    'Keep answers under 40 words for most questions, longer only if the question is complex.',
    'Answers should be under 60 words by default, and in Spanish.',
  ]) {
    test(`default: ${p}`, () => assert.equal(usually(p), true));
  }
  for (const p of [
    'Never go over 50 words, since interviewers usually lose interest.',
    'Never exceed 50 words for most questions.',
    'Keep it under 50 words. Interviewers usually lose interest.',
    'Answer in at most 40 words, as people generally skim.',
  ]) {
    test(`hard limit kept: ${p}`, () => {
      const t = uic.analyzeUserInstructions(p).length;
      assert.ok(t, 'a length is still read');
      assert.equal(t.usually, undefined);
    });
  }
});
