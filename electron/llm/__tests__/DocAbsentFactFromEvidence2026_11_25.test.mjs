// electron/llm/__tests__/DocAbsentFactFromEvidence2026_11_25.test.mjs
//
// A reference-file mode decided a fact was "absent" from the QUESTION'S WORDS:
// any question with cost, price, budget, expense, cloud provider, vendor,
// participant(s) or leaderboard was typed document_absent_fact_refusal before
// retrieval, its passages scored lower, and the validator replaced a correct
// answer with "not in the uploaded material" when the score fell under 0.18.
// "How does the study measure participant engagement?" over a study that
// describes exactly that was refused (found 2026-11-25 while tracing #794).
//
// Now: no question is typed absent from its wording. computeEvidenceCoverage
// reads absence from the evidence: the question asks for a cost, a cloud
// provider or a participant count (requestedPropertyDetector) AND nothing
// retrieved can prove it (textCanProveProperty). Other properties gained no
// refusal gate. A caller's explicit absent type still works when the question
// names no property.
//
// Pure: no platform branches. Runs on the built dist-electron bundles.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const d = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/documentGroundedPrompt.js')).href);

const snippet = (section, text) => `<snippet><text>[Section ${section}] ${text}</text></snippet>`;
const STUDY = snippet('3.2 | p12', 'We recruited 24 participants for the user study. Engagement was measured with a 7-point questionnaire after each session.');
const ROBOT = snippet('4.1 | p40', 'The teleoperation system uses a Mercury X1 robot controlled by an NVIDIA Jetson Xavier main controller. Data was collected over 200 episodes.');
const COST = snippet('6 | p70', 'The total cost of the build was $12,400.');

describe('no question is "absent" from its wording', () => {
  for (const q of [
    'How does the study measure participant engagement?',
    'What was the total cost of building the teleoperation system?',
    'What is the budget for phase two?',
    'Which cloud provider did they use?',
    'Who was the vendor?',
    'Where did the model rank on the public leaderboard?',
    'How many participants took part?',
  ]) {
    test(q, () => assert.notEqual(d.classifyDocumentQuestionShape(q), 'document_absent_fact_refusal'));
  }
});

describe('absence is read from the evidence', () => {
  test('the reported case: a correct answer about participants ships', () => {
    const question = 'How does the study measure participant engagement?';
    const v = d.validateDocumentGroundedAnswer({
      question,
      answer: 'They measured engagement with a 7-point questionnaire after each session.',
      retrievedBlock: STUDY,
    });
    assert.equal(v.action, 'ship', v.reason);
    assert.equal(v.coverage.shouldRefuse, false);
  });

  test('a cost question over evidence with no cost is absent, and refuses', () => {
    const c = d.computeEvidenceCoverage({ question: 'What was the total cost of building the teleoperation system?', retrievedBlock: ROBOT });
    assert.equal(c.requestedProperty, 'cost_or_price');
    assert.equal(c.propertyEvidenceMissing, true);
    assert.equal(c.shouldRefuse, true);
    assert.equal(c.reason, 'absent_fact_no_answer_coverage');
  });

  test('the same cost question over evidence WITH the cost is answered', () => {
    const c = d.computeEvidenceCoverage({ question: 'What was the total cost of building the teleoperation system?', retrievedBlock: ROBOT + COST });
    assert.equal(c.propertyEvidenceMissing, false);
    assert.equal(c.shouldRefuse, false);
  });

  test('a fabricated cost over evidence with no cost is still refused; an honest "not mentioned" ships', () => {
    const question = 'What was the total cost of building the teleoperation system?';
    const fabricated = d.validateDocumentGroundedAnswer({ question, answer: 'The total cost was $50,000.', retrievedBlock: ROBOT });
    assert.equal(fabricated.action, 'refuse');
    const honest = d.validateDocumentGroundedAnswer({ question, answer: 'I could not find that in the retrieved sections of the document.', retrievedBlock: ROBOT });
    assert.equal(honest.action, 'ship');
  });

  test('a cloud-provider question over evidence that names none refuses', () => {
    const c = d.computeEvidenceCoverage({ question: 'Which cloud provider did they use?', retrievedBlock: ROBOT });
    assert.equal(c.requestedProperty, 'cloud_provider');
    assert.equal(c.shouldRefuse, true);
  });

  test('a participant count over evidence that has participants is not absent', () => {
    const c = d.computeEvidenceCoverage({ question: 'How many participants took part?', retrievedBlock: STUDY });
    assert.equal(c.requestedProperty, 'human_participants');
    assert.equal(c.propertyEvidenceMissing, false);
    assert.equal(c.shouldRefuse, false);
  });

  test('other properties gained no refusal gate (methodology over unrelated evidence)', () => {
    const c = d.computeEvidenceCoverage({ question: 'What methodology did they use?', retrievedBlock: ROBOT });
    assert.notEqual(c.requestedProperty, 'unknown');
    assert.equal(c.shouldRefuse, false);
  });

  // Vendor and ranking have no canonical property; a plain invented name
  // ("Siemens") or an ordinal ("3rd") slips past the numeric/entity claim
  // checks, so they keep an evidence-read absent probe of their own.
  const VENDOR = snippet('2 | p8', 'The arm was supplied by Elephant Robotics and assembled in our lab.');
  const RANK = snippet('5 | p50', 'Our model ranked 3rd on the public leaderboard.');

  test('an invented vendor over evidence that names none is refused; a supplied vendor ships', () => {
    const invented = d.validateDocumentGroundedAnswer({ question: 'Who was the vendor?', answer: 'The vendor was Siemens.', retrievedBlock: ROBOT });
    assert.equal(invented.coverage.requestedProperty, 'vendor_or_supplier');
    assert.equal(invented.action, 'refuse');
    const grounded = d.validateDocumentGroundedAnswer({ question: 'Who was the vendor?', answer: 'The arm was supplied by Elephant Robotics.', retrievedBlock: VENDOR });
    assert.equal(grounded.action, 'ship', grounded.reason);
  });

  test('an invented leaderboard rank is refused; a rank the evidence states ships', () => {
    const question = 'Where did the model rank on the public leaderboard?';
    const answer = 'It ranked 3rd on the public leaderboard.';
    assert.equal(d.validateDocumentGroundedAnswer({ question, answer, retrievedBlock: ROBOT }).action, 'refuse');
    assert.equal(d.validateDocumentGroundedAnswer({ question, answer, retrievedBlock: RANK }).action, 'ship');
  });

  test('"how do they rank the candidates" is a method question, not a leaderboard probe', () => {
    const c = d.computeEvidenceCoverage({ question: 'How do they rank the candidates?', retrievedBlock: ROBOT });
    assert.notEqual(c.requestedProperty, 'ranking');
    assert.equal(c.shouldRefuse, false);
  });

  test('an explicit absent type still works when the question names no property', () => {
    const c = d.computeEvidenceCoverage({ question: 'What did the authors conclude?', retrievedBlock: ROBOT, queryShape: 'document_absent_fact_refusal' });
    assert.equal(c.requestedProperty, 'unknown');
    assert.equal(c.shouldRefuse, true);
  });

  test('an explicit absent type does NOT refuse when the evidence proves the property', () => {
    const c = d.computeEvidenceCoverage({ question: 'What was the total cost of building the teleoperation system?', retrievedBlock: ROBOT + COST, queryShape: 'document_absent_fact_refusal' });
    assert.equal(c.shouldRefuse, false);
  });
});

describe('an answer that reports the material lacks the fact stands when the evidence agrees', () => {
  const DECLINES = [
    'The total cost is not mentioned in the uploaded material.',
    'The vendor is not mentioned in the uploaded material.',
    "The vendor isn't stated in the document.",
    "It isn't mentioned in the paper.",
    // How the production model words it (live, Natively API, 2026-11-25).
    'The retrieved excerpts do not state a total cost. From general knowledge, a rig like this usually costs more.',
    "The retrieved excerpts don't mention any dropouts or attrition.",
    'The document does not name a vendor for the robot arm.',
  ];
  for (const a of DECLINES) {
    test(`report: ${a}`, () => assert.equal(d.isMaterialAbsenceReport(a), true));
  }
  for (const a of [
    // A reporting subject: the clause is about what the manual says.
    "The safety manual states the object's exact position is not mentioned in the uploaded material, so the robot queries perception again.",
    // The absence is not located in the material.
    'The Reasoning Tool is not mentioned in the confirmed set.',
    'The vendor is mentioned in the uploaded material: Elephant Robotics.',
    "The study isn't focused on cost, it covers latency.",
    // The material reporting a fact is an answer, not a decline.
    'The retrieved excerpts state the total cost was $12,400.',
    'The document does show the vendor: Elephant Robotics.',
  ]) {
    test(`not a report: ${a}`, () => assert.equal(d.isMaterialAbsenceReport(a), false));
  }

  test('isAssistantRefusal is unchanged for every other caller', () => {
    assert.equal(d.isAssistantRefusal('The retrieved excerpts do not state a total cost.'), false);
    assert.equal(d.isAssistantRefusal('The total cost is not mentioned in the uploaded material.'), false);
    assert.equal(d.isAssistantRefusal('I could not find that in the retrieved sections of the document.'), true);
  });

  test('the model\'s honest absent answer over absent evidence ships as written', () => {
    for (const answer of [DECLINES[0], DECLINES[4]]) {
      const v = d.validateDocumentGroundedAnswer({ question: 'What was the total cost of building the teleoperation system?', answer, retrievedBlock: ROBOT });
      assert.equal(v.action, 'ship', answer);
    }
  });

  test('"the excerpts don\'t state whether anyone dropped out" plus context is not retried as a false refusal', () => {
    const v = d.validateDocumentGroundedAnswer({
      question: 'Did any participants drop out of the study?',
      answer: "The retrieved excerpts don't state whether any participants dropped out. They only report that 24 participants were recruited.",
      retrievedBlock: STUDY,
    });
    assert.equal(v.action, 'ship', v.reason);
  });
});
