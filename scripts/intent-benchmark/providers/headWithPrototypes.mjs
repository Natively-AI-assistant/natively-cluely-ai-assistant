// scripts/intent-benchmark/providers/headWithPrototypes.mjs
//
// ONE session, one forward pass, two decision rules.
//
// The fine-tuned heads own the low-cardinality axes, and a nearest-centroid
// lookup over the SAME model's pooled embedding owns mode_intent. Both come out
// of a single inference.
//
// WHY THIS EXISTS RATHER THAN TWO MODELS
//
// Measured, in this order:
//
//   The head wins needs_response (66.3 vs 50.8) and dialogue_act (52.7 vs 33.0)
//   against a static-embedding prototype, and LOSES mode_intent badly, 14.4
//   against 36.0 — beaten in ELEVEN OF TWELVE modes, several by twenty points.
//   The cause is cardinality: 3 and 6 classes have hundreds of training
//   examples each, while 79 classes have about twenty, and a softmax head over
//   79 ways cannot learn from twenty examples where a centroid still can.
//
//   So a two-model composite was built, and it worked: mode_intent 14.4 -> 36.0
//   with every other axis unchanged. It also cost p95 39.3ms against the head's
//   14.1ms, which is over budget.
//
//   The cost was not concurrency. Running the two sequentially changed nothing
//   (39.35ms). The head alone measured 15.31ms, and 33.93ms with a second
//   session merely RESIDENT, doing 0.37ms of work. A second ONNX session taxes
//   the first about 66%, and the obvious mitigations make it worse: disabling
//   ORT's thread spinning gave 35.27ms and dropping to one intra-op thread gave
//   42.49ms, against 21.15ms for the untouched default.
//
// Hence one session. The encoder already computes a pooled vector on the way to
// the heads; the export now emits it, so the centroid lookup is a dot product
// against something already in hand rather than a second model.
//
// Centroids are built from the TRAIN split only, and the provider refuses to
// build if a held-out row reaches it.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Provider, emptyFrame } from './contract.mjs';
import { WorkerHost } from './workerHost.mjs';
import { buildText } from './embeddingPrototype.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

export class HeadWithPrototypesProvider extends Provider {
  /**
   * @param {{id, dir, trainRows, prototypeAxes?: string[]}} opts
   */
  constructor(opts) {
    super(opts.id);
    this.opts = { prototypeAxes: ['mode_intent'], ...opts };
    this.host = null;
    this.centroids = {};
    this.temperature = 20;
  }

  async load() {
    this.host = new WorkerHost(
      path.join(__dirname, 'multiheadWorker.mjs'),
      { dir: path.resolve(repoRoot, this.opts.dir), threads: 2 },
      { timeoutMs: 60_000 },
    );
    await this.host.start();

    const train = this.opts.trainRows ?? [];
    if (!train.length) throw new Error(`${this.id}: no training rows supplied`);
    const leaked = train.filter((r) => r.split === 'holdout');
    if (leaked.length) {
      throw new Error(`${this.id}: ${leaked.length} held-out rows reached prototype building. Refusing.`);
    }

    // Embed the training split THROUGH THE HEAD, so the centroids live in the
    // same space the model produces at inference. Using a different encoder's
    // space here would make the dot products meaningless.
    const vectors = [];
    for (const row of train) {
      const r = await this.host.ask({ type: 'classify', text: buildText(row) });
      vectors.push(r.pooled);
    }
    if (!vectors[0]) throw new Error(`${this.id}: the model does not emit a pooled output. Re-export it.`);
    const dim = vectors[0].length;

    for (const axis of this.opts.prototypeAxes) {
      const sums = new Map();
      const counts = new Map();
      train.forEach((row, i) => {
        const label = axis === 'legacy_intent' ? row.legacy_intent : row.labels?.[axis];
        if (label == null || !vectors[i]) return;
        if (!sums.has(label)) { sums.set(label, new Float64Array(dim)); counts.set(label, 0); }
        const s = sums.get(label);
        for (let d = 0; d < dim; d++) s[d] += vectors[i][d];
        counts.set(label, counts.get(label) + 1);
      });
      const cents = {};
      for (const [label, s] of sums) {
        const n = counts.get(label);
        const c = new Float64Array(dim);
        let norm = 0;
        for (let d = 0; d < dim; d++) { c[d] = s[d] / n; norm += c[d] * c[d]; }
        norm = Math.sqrt(norm) || 1;
        for (let d = 0; d < dim; d++) c[d] /= norm;
        cents[label] = c;
      }
      this.centroids[axis] = cents;
    }
  }

  async classify(input) {
    const frame = emptyFrame('primary');
    const r = await this.host.ask({ type: 'classify', text: buildText(input) });
    frame.workerMs = r.ms;

    for (const [axis, ranked] of Object.entries(r.axes ?? {})) {
      if (!ranked?.length) continue;
      frame[axis] = ranked[0][0];
      frame.confidence[axis] = ranked[0][1];
      frame.alternatives[axis] = ranked;
    }

    // The prototype axes OVERRIDE the head's own answer for those axes, using
    // the pooled vector the same pass already produced.
    if (r.pooled) {
      for (const axis of this.opts.prototypeAxes) {
        const cents = this.centroids[axis];
        if (!cents) continue;
        const scored = Object.entries(cents)
          .map(([label, c]) => [label, dot(r.pooled, c)])
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);
        if (!scored.length) continue;
        frame[axis] = scored[0][0];
        const mx = scored[0][1];
        const exps = scored.map(([, s]) => Math.exp((s - mx) * this.temperature));
        const z = exps.reduce((a, b) => a + b, 0) || 1;
        frame.confidence[axis] = exps[0] / z;
        frame.alternatives[axis] = scored.map(([l], i) => [l, exps[i] / z]);
      }
    }
    return frame;
  }

  async unload() { if (this.host) await this.host.stop(); }

  meta() {
    return {
      family: 'head-with-prototypes', params: 0, sizeOnDiskMB: 0, runtime: 'onnx',
      ortBinding: 'onnxruntime-node', modelId: this.opts.dir,
      prototypeAxes: this.opts.prototypeAxes,
      forwardPassesPerRow: 1,
      sessions: 1,
    };
  }
}
