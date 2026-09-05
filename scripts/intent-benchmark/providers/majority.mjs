// scripts/intent-benchmark/providers/majority.mjs
//
// THE FLOOR. Always predict the most common label, fitted on the TRAIN split.
//
// This exists because the shipped classifier has no needs_response output at
// all, so "beats production on needs_response" is satisfied by anything that
// emits the axis. It says nothing about whether a model learned the task.
//
// The majority baseline is the number that does say it. On an axis whose prior
// is skewed, a model can post a respectable accuracy while having learned
// nothing, and only the comparison with always-guessing reveals it. Macro F1
// punishes the constant guesser correctly, which is exactly why the campaign
// reports macro F1, but the floor still belongs in the table so the margin is
// visible rather than asserted.
//
// Fitted on train, never on holdout: the majority class is a parameter, and a
// parameter read off the test set is a leak like any other.

import { Provider, emptyFrame } from './contract.mjs';
import { SCORED_AXES } from './contract.mjs';

export class MajorityProvider extends Provider {
  constructor({ trainRows = [] } = {}) {
    super('majority');
    this.trainRows = trainRows;
    this.majority = {};
  }

  async load() {
    for (const axis of SCORED_AXES) {
      const counts = new Map();
      for (const r of this.trainRows) {
        const v = r.labels?.[axis];
        if (v == null || Array.isArray(v)) continue;
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      if (counts.size === 0) { this.majority[axis] = null; continue; }
      this.majority[axis] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
  }

  async classify() {
    const frame = emptyFrame('majority');
    for (const axis of SCORED_AXES) {
      if (this.majority[axis] != null) frame[axis] = this.majority[axis];
    }
    // A constant predictor has no meaningful confidence. Reporting a made-up
    // number here would feed the calibration check a value it would score as if
    // it meant something, so every axis gets the same 1.0 and the ECE check
    // flags it degenerate, which is the truthful outcome.
    frame.confidence = Object.fromEntries(SCORED_AXES.map((a) => [a, 1]));
    return frame;
  }

  meta() {
    return {
      family: 'majority-class', params: '0', sizeOnDiskMB: 0, runtime: 'none',
      majority: this.majority,
    };
  }
}
