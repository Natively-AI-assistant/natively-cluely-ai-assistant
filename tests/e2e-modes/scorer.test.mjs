// tests/e2e-modes/scorer.test.mjs
// Unit tests for the hybrid deterministic+semantic scorer.
// Run: node --test tests/e2e-modes/scorer.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  scoreAnswer,
  mergeSemantic,
  classifyFact,
  factPresent,
  looksLikeRefusal,
  aggregate,
} from './scorer.mjs';

// A tiny helper: run scoreAnswer then merge with a mocked judge that passes/fails
// each semantic criterion by index (or a predicate).
function scoreWithJudge(question, answer, judgeFn) {
  const det = scoreAnswer(question, answer);
  const verdicts = judgeFn
    ? det.semanticCriteria.map((sc, i) => judgeFn(sc, i))
    : null;
  return mergeSemantic(det, verdicts, { judgeUnavailable: judgeFn === undefined ? false : false });
}

// ---------------------------------------------------------------------------
// classifyFact
// ---------------------------------------------------------------------------

test('classifyFact: numbers and measurements are anchors', () => {
  assert.equal(classifyFact('28.4'), 'anchor');
  assert.equal(classifyFact('152 layers'), 'anchor');
  assert.equal(classifyFact('44%'), 'anchor');
  assert.equal(classifyFact('301139947'), 'anchor');
});

test('classifyFact: proper nouns / products / acronyms are anchors', () => {
  assert.equal(classifyFact('AgenticVLA'), 'anchor');
  assert.equal(classifyFact('Mercury X1'), 'anchor');
  assert.equal(classifyFact('Tableau'), 'anchor');
  assert.equal(classifyFact('Ville Kyrki'), 'anchor');
  assert.equal(classifyFact('UTF-8'), 'anchor');
  assert.equal(classifyFact('MUST'), 'anchor');
});

test('classifyFact: paraphrasable prose is semantic', () => {
  assert.equal(classifyFact('these documents'), 'semantic');
  assert.equal(classifyFact('not present'), 'semantic');
  assert.equal(classifyFact('data quality'), 'semantic');
  assert.equal(classifyFact('baseline'), 'semantic');
  // a long phrase that merely contains a digit is prose, not an anchor
  assert.equal(classifyFact('24 transformer layers and 16 heads'), 'semantic');
});

// ---------------------------------------------------------------------------
// factPresent
// ---------------------------------------------------------------------------

test('factPresent: exact + numeric + separator tolerance', () => {
  assert.equal(factPresent('BLEU of 28.4 on WMT', '28.4'), true);
  assert.equal(factPresent('a 152-layer network', '152 layers'), true);
  assert.equal(factPresent('population 301,139,947 people', '301139947'), true);
  assert.equal(factPresent('44 percent success', '44%'), true);
  assert.equal(factPresent('about 110 million params', '110M'), true);
  assert.equal(factPresent('no number here', '28.4'), false);
});

// ---------------------------------------------------------------------------
// ANCHOR strict matching
// ---------------------------------------------------------------------------

test('anchor fact present -> anchorPass true; missing -> deterministic fail (not hardFail)', () => {
  const q = { rubric: { requiredFacts: ['AgenticVLA', 'Mercury X1'], refusalExpected: false } };
  const ok = scoreAnswer(q, 'The AgenticVLA system runs on the Mercury X1 robot.');
  assert.equal(ok.anchorPass, true);
  assert.equal(ok.deterministicPass, true);
  assert.equal(ok.hardFail, false);

  const miss = scoreAnswer(q, 'The teleoperation system runs on the Mercury X1 robot.');
  assert.equal(miss.anchorPass, false);
  assert.equal(miss.deterministicPass, false);
  assert.equal(miss.hardFail, false, 'a missing anchor is a soft fail, not a hallucination hardFail');
});

// ---------------------------------------------------------------------------
// SEMANTIC path via mocked judge
// ---------------------------------------------------------------------------

test('paraphrased required fact is routed to the semantic path and passed by the judge', () => {
  const q = {
    rubric: {
      requiredFacts: ['these documents'], // paraphrasable -> semantic
      refusalExpected: true, // this is a no-answer question; a disclaimer IS expected
    },
  };
  const answer = 'That figure is not present in the retrieved materials or the uploaded file.';
  const det = scoreAnswer(q, answer);
  // refusal is expected and met -> deterministic side is clean
  assert.equal(det.refusalPass, true);
  assert.equal(det.hardFail, false);
  // the paraphrasable "these documents" fact is deferred to the judge
  assert.equal(det.semanticCriteria.length, 1);
  assert.equal(det.pass, undefined, 'pass is deferred until the judge runs');

  // judge says the paraphrase conveys the required meaning
  const passMerged = mergeSemantic(det, [{ pass: true, reason: 'conveys absence from the docs' }]);
  assert.equal(passMerged.pass, true);

  // judge says it does NOT -> final fail, but still not a hardFail
  const failMerged = mergeSemantic(det, [{ pass: false, reason: 'did not convey it' }]);
  assert.equal(failMerged.pass, false);
  assert.equal(failMerged.hardFail, false);
});

test('format constraints become semantic criteria for the judge', () => {
  const q = {
    rubric: {
      requiredFacts: ['data quality'],
      refusalExpected: false,
      formatConstraints: ['uses a STAR structure', 'grounds the answer in the JD'],
    },
  };
  const det = scoreAnswer(q, 'Situation... Task... Action... Result... about data quality.');
  // 1 semantic requiredFact + 2 format constraints = 3 semantic criteria
  assert.equal(det.semanticCriteria.length, 3);
  const merged = mergeSemantic(det, det.semanticCriteria.map(() => ({ pass: true })));
  assert.equal(merged.pass, true);
});

// ---------------------------------------------------------------------------
// FORBIDDEN facts stay strict + hard
// ---------------------------------------------------------------------------

test('forbidden fact present is a HARD FAIL that the judge cannot rescue', () => {
  const q = {
    rubric: {
      requiredFacts: ['baseline'],
      forbiddenFacts: ['91%'],
      refusalExpected: false,
    },
  };
  const det = scoreAnswer(q, 'AgenticVLA hit a 91% success rate versus the baseline.');
  assert.equal(det.hardFail, true);
  assert.equal(det.forbiddenPass, false);
  // even if the judge passes every semantic criterion, hardFail keeps pass=false
  const merged = mergeSemantic(det, det.semanticCriteria.map(() => ({ pass: true })));
  assert.equal(merged.pass, false);
  assert.equal(merged.hardFail, true);
});

test('no-answer question answered with fabricated content is a HARD FAIL', () => {
  const q = {
    rubric: {
      requiredFacts: ['not', 'unemployment'],
      forbiddenFacts: ['8.4%'],
      refusalExpected: true,
    },
  };
  const det = scoreAnswer(q, 'Germany had an unemployment rate of 8.4% in 2007.');
  assert.equal(det.hardFail, true, 'fabricated forbidden number + did-not-refuse');
});

// ---------------------------------------------------------------------------
// REFUSAL detection — expected refusals met by the new phrasings
// ---------------------------------------------------------------------------

test('looksLikeRefusal catches the model real-world refusal phrasings', () => {
  const refusals = [
    'None of the retrieved excerpts contain the row values for that.',
    "The retrieved materials don't include the CS231n lecture 1 slides.",
    "aren't something I can pull off the top of my head",
    "Not covered in the provided documents.",
    "That isn't addressed in the provided documents.",
    'I could not find that in the retrieved sections of the document.',
    'That specific metric is not disclosed in the materials we have shared.',
    'The PDF appears image-only with no extractable text layer.',
    "I can't ground this answer in the deck.",
  ];
  for (const r of refusals) assert.equal(looksLikeRefusal(r), true, `should refuse: ${r}`);
});

test('a real substantive answer that merely uses the word "not" is NOT a refusal', () => {
  const answers = [
    'The Transformer uses Adam, not SGD, with warmup_steps = 4000 over the training run.',
    'BERTBASE has 110M parameters while BERTLARGE has 340M; the objectives are Masked LM and Next Sentence Prediction.',
    'Japan has the highest life expectancy at 82.603 and Norway the highest GDP per capita at 49357.',
  ];
  for (const a of answers) assert.equal(looksLikeRefusal(a), false, `should NOT refuse: ${a}`);
});

test('refusal-expected met -> pass; not-refused -> hard fail', () => {
  const q = { rubric: { requiredFacts: ['not', 'thesis'], refusalExpected: true } };
  const good = scoreAnswer(q, 'That is not present in the thesis, which is academic and has no financial statements.');
  assert.equal(good.refusalPass, true);
  assert.equal(good.hardFail, false);

  const bad = scoreAnswer(q, 'The thesis reports quarterly revenue of $1M and a 20% margin.');
  assert.equal(bad.refusalPass, false);
  assert.equal(bad.hardFail, true);
});

test('empty answer to a no-answer question does NOT count as a safe refusal', () => {
  const q = { rubric: { refusalExpected: true } };
  const det = scoreAnswer(q, '');
  assert.equal(det.refusalPass, false);
  assert.equal(det.hardFail, true);
});

// ---------------------------------------------------------------------------
// FALSE refusal still caught; genuine answer not flagged
// ---------------------------------------------------------------------------

test('false refusal on an answerable question is a HARD FAIL', () => {
  const q = {
    rubric: {
      requiredFacts: ['degradation', 'ILSVRC 2015'],
      refusalExpected: false,
    },
  };
  const det = scoreAnswer(q, 'I could not find that detail in the retrieved sections of the document.');
  assert.equal(det.refusalPass, false);
  assert.equal(det.hardFail, true, 'refusing an answerable question is a product bug');
});

test('a full correct answer with all anchors is NOT flagged as a false refusal', () => {
  const q = {
    rubric: {
      requiredFacts: ['28.4', '41.8'],
      refusalExpected: false,
    },
  };
  const det = scoreAnswer(q, 'The big Transformer reaches 28.4 BLEU on En-De and 41.8 BLEU on En-Fr.');
  assert.equal(det.refusalPass, true);
  assert.equal(det.anchorPass, true);
  assert.equal(det.deterministicPass, true);
});

// ---------------------------------------------------------------------------
// Judge-unavailable fallback
// ---------------------------------------------------------------------------

test('judge unavailable -> lenient pass on semantic criteria, hard checks still stand', () => {
  const q = {
    rubric: {
      requiredFacts: ['data quality'], // semantic
      forbiddenFacts: ['AgenticVLA'],
      refusalExpected: false,
      formatConstraints: ['STAR structure'],
    },
  };
  // clean answer: judge outage should NOT fake a failure
  const detClean = scoreAnswer(q, 'A STAR story about a data quality issue I fixed.');
  const clean = mergeSemantic(detClean, null, { judgeUnavailable: true });
  assert.equal(clean.judgeUnavailable, true);
  assert.equal(clean.pass, true);

  // but a forbidden hit is still a hard fail even with the judge down
  const detBad = scoreAnswer(q, 'AgenticVLA is a great STAR example of data quality.');
  const bad = mergeSemantic(detBad, null, { judgeUnavailable: true });
  assert.equal(bad.pass, false);
  assert.equal(bad.hardFail, true);
});

// ---------------------------------------------------------------------------
// aggregate
// ---------------------------------------------------------------------------

test('aggregate counts passes, hardFails and criteria pass rate', () => {
  const results = [
    { score: mergeSemantic(scoreAnswer({ rubric: { requiredFacts: ['28.4'], refusalExpected: false } }, '28.4 BLEU'), []) },
    { score: mergeSemantic(scoreAnswer({ rubric: { requiredFacts: ['28.4'], forbiddenFacts: ['99'], refusalExpected: false } }, 'it was 99'), []) },
    { detection: { expectedQuestion: true, detected: true, falseFires: 0 } },
  ];
  const agg = aggregate(results);
  assert.equal(agg.total, 2);
  assert.equal(agg.passes, 1);
  assert.equal(agg.hardFails, 1);
  assert.equal(agg.detection.injected, 1);
  assert.equal(agg.detection.correct, 1);
});
