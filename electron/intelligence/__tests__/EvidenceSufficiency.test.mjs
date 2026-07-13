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
    assert.equal(general.length, 3);
    assert.equal(list.length, 5);
    assert.equal(comparison.length, 6);
  });

  test('property-aware ranking pulls the value-bearing chunk above a higher-score topical chunk', () => {
    // The topical chunk has the HIGHER raw retrieval score but only names the
    // subject; the value chunk has a LOWER score but carries the distinctive
    // answer term + an answer-shaped value. Answer-aware selection must rank the
    // value chunk first.
    const topical = item({ id: 'topical', entity: 'Mercury', text: 'The Mercury robot is an advanced manipulation platform used in the lab.', property: 'unknown', score: 0.92 });
    const valueChunk = item({ id: 'value', entity: 'Mercury', text: 'The Mercury main controller is an NVIDIA Jetson Xavier NX board.', property: 'unknown', score: 0.55 });
    const selected = selectSmallestSufficientEvidence({
      items: [topical, valueChunk],
      requestedProperty: 'unknown',
      answerShape: 'general',
      targetEntities: ['Mercury'],
      distinctiveTerms: ['controller'],
    });
    assert.equal(selected[0].evidenceId, 'value', 'the controller-bearing chunk must rank first');
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
});
