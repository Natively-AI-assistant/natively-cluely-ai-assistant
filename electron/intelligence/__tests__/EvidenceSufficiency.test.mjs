// Canonical pre-dispatch evidence policy tests. These exercise the compiled
// production module under Electron's Node runtime, including entity coverage,
// refusal reasons, and bounded smallest-sufficient selection.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../../../dist-electron/electron');
const {
  deriveEvidenceSufficiency,
  MIN_ANSWER_CONFIDENCE,
  selectSmallestSufficientEvidence,
} = await import(pathToFileURL(path.join(distDir, 'intelligence/context-os/evidenceSufficiency.js')).href);

const item = ({
  id,
  text,
  entity,
  property = 'unknown',
  score = 0.9,
}) => ({
  evidenceId: id,
  sourceKind: 'mode_reference_chunk',
  sourceId: 'file-1',
  sourceOwner: 'reference_files',
  authority: 'evidence',
  trustLevel: 'user_uploaded',
  text,
  supports: { entity, property },
  score: { final: score },
  reasonIncluded: 'test evidence',
});

const pack = (items, requestedProperty = 'unknown', conflicts = []) => ({
  items,
  requestedProperty,
  coverage: {
    hasDirectEvidence: items.length > 0,
    propertySatisfied: false,
    entityMatched: false,
    sourceOwnerSatisfied: true,
    confidence: 0,
  },
  conflicts,
});

describe('EvidenceSufficiency', () => {
  test('requires each target entity and excludes entity-irrelevant evidence from usable confidence', () => {
    const alpha = item({ id: 'alpha', entity: 'Alpha', text: 'Alpha achieved a 90% success rate.', property: 'result_metric', score: 0.6 });
    const beta = item({ id: 'beta', entity: 'Beta', text: 'Beta achieved an 80% success rate.', property: 'result_metric', score: 0.7 });
    const distractor = item({ id: 'distractor', entity: 'Gamma', text: 'Gamma achieved a 99% success rate.', property: 'result_metric', score: 0.99 });

    const result = deriveEvidenceSufficiency({
      pack: pack([alpha, beta, distractor], 'result_metric'),
      targetEntities: ['Alpha', 'Beta'],
    });

    assert.equal(result.answerable, true);
    assert.equal(result.confidence, 0.7, 'irrelevant Gamma evidence cannot inflate confidence');
    assert.deepEqual(result.usableEvidenceIds, ['alpha', 'beta']);
  });

  test('returns deterministic property, entity, conflict, and low-confidence failures', () => {
    const alphaMetric = item({ id: 'alpha-metric', entity: 'Alpha', text: 'Alpha achieved a 90% success rate.', property: 'result_metric', score: 0.9 });

    assert.equal(
      deriveEvidenceSufficiency({ pack: pack([alphaMetric], 'funding_source'), targetEntities: ['Alpha'] }).reason,
      'property_missing',
    );
    assert.equal(
      deriveEvidenceSufficiency({ pack: pack([alphaMetric], 'result_metric'), targetEntities: ['Beta'] }).reason,
      'entity_missing',
    );
    assert.equal(
      deriveEvidenceSufficiency({
        pack: pack([alphaMetric], 'result_metric', [{ leftEvidenceId: 'a', rightEvidenceId: 'b', conflictType: 'value', resolution: 'unresolved' }]),
        targetEntities: ['Alpha'],
      }).reason,
      'conflicting',
    );
    assert.equal(
      deriveEvidenceSufficiency({
        pack: pack([item({ id: 'low', entity: 'Alpha', text: 'Alpha achieved a 90% success rate.', property: 'result_metric', score: MIN_ANSWER_CONFIDENCE - 0.01 })], 'result_metric'),
        targetEntities: ['Alpha'],
      }).reason,
      'low_confidence',
    );
  });

  test('covers every target entity and observes answer-shape caps', () => {
    const alpha = item({ id: 'alpha', entity: 'Alpha', text: 'Alpha metric', property: 'result_metric', score: 0.8 });
    const beta = item({ id: 'beta', entity: 'Beta', text: 'Beta metric', property: 'result_metric', score: 0.7 });
    const extras = Array.from({ length: 8 }, (_, index) => item({
      id: `extra-${index}`,
      entity: 'Alpha',
      text: `Alpha metric evidence ${index}`,
      property: 'result_metric',
      score: 0.6 - index / 100,
    }));

    // No distinctiveTerms supplied → answer-relevance is 0 for all, so selection
    // degrades to the prior raw-score ordering and fills to the answer-shape cap.
    const general = selectSmallestSufficientEvidence({
      items: [alpha, beta, ...extras], requestedProperty: 'result_metric', answerShape: 'general', targetEntities: ['Alpha', 'Beta'],
    });
    const list = selectSmallestSufficientEvidence({
      items: [alpha, beta, ...extras], requestedProperty: 'result_metric', answerShape: 'list', targetEntities: ['Alpha', 'Beta'],
    });
    const comparison = selectSmallestSufficientEvidence({
      items: [alpha, beta, ...extras], requestedProperty: 'result_metric', answerShape: 'comparison', targetEntities: ['Alpha', 'Beta'],
    });

    // Both entities are always covered, regardless of which item represents each.
    for (const set of [general, list, comparison]) {
      assert.ok(set.some((e) => /alpha/i.test(e.text)), 'Alpha covered');
      assert.ok(set.some((e) => /beta/i.test(e.text)), 'Beta covered');
    }
    // Grounding-campaign fix (2026-07-17): the default/'numeric' cap was
    // raised from 3 to 5 (matching 'list') — confirmed live that 3 was too
    // aggressive on a long document and discarded a genuinely-retrieved
    // answer-bearing chunk (thesis benchmark THESIS-079/THESIS-094).
    assert.equal(general.length, 5);
    assert.equal(list.length, 5);
    assert.equal(comparison.length, 6);
  });

  test('raw retrieval remains primary while answer-aware features break close scores', () => {
    // The value chunk has a slightly lower raw score, but its direct answer term
    // and answer-shaped value should settle a near-tie. A large raw-score gap is
    // intentionally NOT overturned by coincidental literal overlap.
    const topical = item({ id: 'topical', entity: 'Mercury', text: 'The Mercury robot is an advanced manipulation platform used in the lab.', property: 'unknown', score: 0.55 });
    const valueChunk = item({ id: 'value', entity: 'Mercury', text: 'The Mercury main controller is an NVIDIA Jetson Xavier NX board.', property: 'unknown', score: 0.55 });
    const selected = selectSmallestSufficientEvidence({
      items: [topical, valueChunk],
      requestedProperty: 'unknown',
      answerShape: 'general',
      targetEntities: ['Mercury'],
      distinctiveTerms: ['controller'],
    });
    assert.equal(selected[0].evidenceId, 'value', 'answer-aware features must resolve close retrieval scores');
  });

  test('THESIS-079: stronger raw hardware evidence beats camera-view term-overlap decoys', () => {
    // The real failure had a top raw-retrieved answer chunk naming Logitech C920,
    // while model-architecture chunks repeated every literal question term
    // (camera/model/views). Ranking must not discard the higher-confidence
    // answer just because it uses different wording.
    const answer = item({
      id: 'logitech',
      text: 'The two USB cameras are both Logitech C920 HD Webcams.',
      property: 'hardware_component',
      score: 0.5169,
    });
    const decoyA = item({
      id: 'model-decoy-a',
      text: 'The OpenVLA-OFT model processes camera views from multiple inputs.',
      property: 'hardware_component',
      score: 0.49,
    });
    const decoyB = item({
      id: 'model-decoy-b',
      text: 'The camera model supports multiple views during finetuning.',
      property: 'hardware_component',
      score: 0.48,
    });
    const selected = selectSmallestSufficientEvidence({
      items: [answer, decoyA, decoyB],
      requestedProperty: 'hardware_component',
      answerShape: 'list',
      targetEntities: [],
      distinctiveTerms: ['camera', 'model', 'views'],
    });
    assert.equal(selected[0].evidenceId, 'logitech');
  });

  test('dynamic stop: once every distinctive term is covered, no topical filler is added beyond the cap', () => {
    const answer = item({ id: 'answer', text: 'The learning rate schedule and the batch size are both specified here.', property: 'unknown', score: 0.6 });
    const fillerA = item({ id: 'filler-a', text: 'General discussion of the training loop and its stages.', property: 'unknown', score: 0.9 });
    const fillerB = item({ id: 'filler-b', text: 'More background prose about experiments and evaluation.', property: 'unknown', score: 0.85 });
    const selected = selectSmallestSufficientEvidence({
      items: [answer, fillerA, fillerB],
      requestedProperty: 'unknown',
      answerShape: 'general',
      targetEntities: [],
      distinctiveTerms: ['learning', 'rate', 'batch', 'size'],
    });
    assert.ok(selected.some((e) => e.evidenceId === 'answer'), 'answer chunk selected');
    assert.ok(selected.length <= 3, 'bounded by the general-shape cap');
  });

  // Regression (2026-07-17, THESIS-093): the dynamic early-stop above used to
  // fire once the UNION of coverage across ALL selected items included every
  // distinctive term — even when no single selected item individually covered
  // more than half of them. Real failure: for "What two objects are visible
  // but never interacted with?" (distinctive terms: objects/visible/never/
  // interacted), the top-ranked chunk discussed a DIFFERENT pair of objects
  // but happened to contain the literal phrase "never interacted with", and
  // the next two ranked chunks were generic "objects visible" filler from
  // unrelated sections — together these 3 weak partial matches "covered" all
  // 4 terms and triggered early-stop at the floor (3), one slot before the
  // 4th-ranked chunk that actually answered the question (using different
  // wording: "no interaction is performed with them" instead of the
  // question's "never interacted with"). The fix requires at least one
  // SELECTED item to individually reach strict-majority term coverage before
  // the union-based early-stop may fire.
  test('early-stop requires at least one single item with strong (strict-majority) term coverage — several weak partial matches must not mask a missing strong chunk', () => {
    const decoyPhrase = item({ id: 'decoy-phrase', text: 'The second fruit was never interacted with by the finetuned model.', property: 'unknown', score: 0.95 });
    const decoyObjects1 = item({ id: 'decoy-objects-1', text: 'Objects visible in the workspace are logged by the scene interpretation module.', property: 'unknown', score: 0.90 });
    const decoyObjects2 = item({ id: 'decoy-objects-2', text: 'All visible objects are tracked across frames for anomaly detection.', property: 'unknown', score: 0.85 });
    const correctAnswer = item({ id: 'correct-answer', text: 'Other objects such as an apple and an orange are visible in the scene, but no interaction is performed with them.', property: 'unknown', score: 0.80 });
    const moreFiller = item({ id: 'more-filler', text: 'Objects visible from the top-down camera are cropped before processing.', property: 'unknown', score: 0.75 });

    const selected = selectSmallestSufficientEvidence({
      items: [decoyPhrase, decoyObjects1, decoyObjects2, correctAnswer, moreFiller],
      requestedProperty: 'unknown',
      answerShape: 'general',
      targetEntities: [],
      distinctiveTerms: ['objects', 'visible', 'never', 'interacted'],
    });
    assert.ok(
      selected.some((e) => e.evidenceId === 'correct-answer'),
      'the genuinely answer-bearing chunk must survive selection even though no single decoy nor itself covers a strict majority of the distinctive terms',
    );
  });
});
