// scripts/intent-benchmark/providers/composite.mjs
//
// PER-AXIS COMPOSITE: two models, both run on every turn, each owning the axes
// it is actually better at.
//
// This is NOT the brief's escalation ladder, which was measured and ruled out
// on p95 grounds (docs/natively-router-frontier-2026-09-04.md). A ladder runs
// the second model CONDITIONALLY on uncertain turns, and any escalation rate
// above five percent drags p95 to the escalation's latency. This runs both
// UNCONDITIONALLY, so p95 is simply the sum, and the sum is affordable because
// one of the two costs 0.1ms.
//
// WHY SPLIT BY AXIS AT ALL
//
// The two families fail in opposite places, and the reason is cardinality.
//
//   needs_response has 3 classes, dialogue_act has 6. With ~1,589 training
//   rows that is hundreds of examples per class, and a fine-tuned softmax head
//   learns them: 66.3 and 52.7 macro F1, against the prototype's 50.8 and 33.0.
//
//   mode_intent has 79 classes partitioned across modes. That is roughly twenty
//   examples per class, and a softmax head over 79 ways cannot learn from it —
//   it scores 14.4. Nearest-centroid degrades far more gracefully in that
//   regime, because a centroid over twenty examples is still a usable point
//   even when a decision boundary over twenty examples is not. The prototype
//   scores 36.0, and wins per-mode in ELEVEN OF TWELVE modes, several by more
//   than twenty points.
//
// So the split is not tuning. It is two different low-data behaviours, and the
// composite takes each where it holds.
//
// Both providers must share an ONNX binding. A hybrid mixing onnxruntime-node
// with transformers.js's bundled ORT aborts the process with an uncaught
// Napi::Error even across separate workers, so the constructor refuses it.

import { Provider, emptyFrame } from './contract.mjs';

export class CompositeProvider extends Provider {
  /**
   * @param {{id, axisOwners: Record<string, 'a'|'b'>, a, b, legacyFrom?: 'a'|'b'}} opts
   */
  constructor(opts) {
    super(opts.id);
    this.opts = { legacyFrom: 'a', ...opts };
  }

  async load() {
    const bindings = [this.opts.a, this.opts.b]
      .map((p) => p.meta()?.ortBinding).filter(Boolean);
    if (new Set(bindings).size > 1) {
      throw new Error(
        `${this.id}: refusing to mix ONNX bindings (${[...new Set(bindings)].join(' + ')}). ` +
        'Two native ORT instances in one process abort it, worker isolation notwithstanding.',
      );
    }
    await this.opts.a.load();
    await this.opts.b.load();
  }

  async classify(input) {
    // SEQUENTIAL, not concurrent, and this was measured rather than assumed.
    //
    // Promise.all looked obviously right: two independent models, two workers,
    // run them together. It cost p95 39.8ms against 14.1ms for the expensive
    // model alone and 0.08ms for the cheap one. Nearly 3x the sum of the parts.
    //
    // Two ONNX sessions running at once contend for cores. Each worker is
    // already bounded to two intra-op threads precisely so several models
    // cannot collectively saturate the machine, and overlapping them defeats
    // that: both slow down, and the expensive one slows down most.
    //
    // Sequential is free here because the second model costs 0.08ms. There is
    // nothing to parallelise away.
    const a = await this.opts.a.classify(input);
    const b = await this.opts.b.classify(input);

    const frame = emptyFrame('primary');
    for (const [axis, owner] of Object.entries(this.opts.axisOwners)) {
      const src = owner === 'a' ? a : b;
      frame[axis] = src?.[axis] ?? null;
      if (src?.confidence?.[axis] != null) frame.confidence[axis] = src.confidence[axis];
      if (src?.alternatives?.[axis]) frame.alternatives[axis] = src.alternatives[axis];
    }
    const legacySrc = this.opts.legacyFrom === 'a' ? a : b;
    frame.legacy_intent = legacySrc?.legacy_intent ?? null;
    if (legacySrc?.confidence?.legacy_intent != null) {
      frame.confidence.legacy_intent = legacySrc.confidence.legacy_intent;
    }

    // They run one after the other, so the turn costs the SUM. Reporting the
    // max would understate it, and the whole point of this candidate is that
    // the sum is affordable.
    frame.workerMs = (a?.workerMs ?? 0) + (b?.workerMs ?? 0);
    return frame;
  }

  async unload() {
    await this.opts.a.unload();
    await this.opts.b.unload();
  }

  meta() {
    return {
      family: 'per-axis-composite', params: 0, sizeOnDiskMB: 0, runtime: 'onnx',
      ortBinding: this.opts.a.meta()?.ortBinding,
      a: this.opts.a.id, b: this.opts.b.id,
      axisOwners: this.opts.axisOwners,
      forwardPassesPerRow: 2,
    };
  }
}
