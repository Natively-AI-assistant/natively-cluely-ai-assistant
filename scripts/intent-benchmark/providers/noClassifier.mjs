// scripts/intent-benchmark/providers/noClassifier.mjs
//
// THE BASELINE THE CAMPAIGN SHOULD HAVE STARTED WITH: no classifier at all.
//
// Evin's question, and it is the correct one. If the product works without any
// classifier then every model in this matrix is complexity being justified after
// the fact.
//
// "No classifier" is not one thing, so this is two:
//
//   always_answer   never stay silent. Generate on every turn. This is what the
//                   system does today if you delete the needs_response axis.
//   always_general  one generic answer shape for every turn. This is what the
//                   system does today if you delete the eight label taxonomy and
//                   stop selecting an Answer Shape fragment.
//
// Both are deliberately trivial. That is the point: a candidate that cannot beat
// a constant is not earning the worker thread it runs in.
//
// READ THE PRODUCTION-WEIGHTED COLUMN, NOT MACRO F1, FOR THIS ONE.
//
// Macro F1 averages classes equally, which punishes a constant predictor
// correctly and is why it is the campaign's headline metric. But the question
// being asked here is a product question, not a modelling one: on real traffic,
// how often is the constant simply right? That is the production-weighted
// figure, and for a skewed axis a constant can beat a real classifier on it
// while losing badly on macro F1. Both numbers are true and they answer
// different questions.

import { Provider, emptyFrame } from './contract.mjs';

export class NoClassifierProvider extends Provider {
  /**
   * @param {'always_answer'|'always_general'} variant
   */
  constructor({ id, variant = 'always_answer' } = {}) {
    super(id ?? `none-${variant}`);
    this.variant = variant;
  }

  async load() { /* there is nothing to load, which is the argument */ }

  async classify() {
    const frame = emptyFrame(this.id);
    // Never stay silent. The turn always gets a response.
    frame.needs_response = 'yes';
    // The most common act, so the axis is answered rather than abstained on.
    frame.dialogue_act = 'ask';
    frame.task = 'answer';
    frame.answer_form = 'explanation';
    frame.grounding = 'none';
    frame.legacy_intent = 'general';
    // A constant predictor has no meaningful confidence. Every axis gets the
    // same value so the calibration check flags it degenerate, which is the
    // truthful outcome rather than a fabricated number.
    frame.confidence = {
      needs_response: 1, dialogue_act: 1, task: 1, answer_form: 1,
      grounding: 1, mode_intent: 1, legacy_intent: 1,
    };
    return frame;
  }

  meta() {
    return {
      family: 'no-classifier', params: '0', sizeOnDiskMB: 0, runtime: 'none',
      variant: this.variant,
    };
  }
}
