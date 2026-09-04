// scripts/intent-benchmark/providers/embeddingPrototype.mjs
//
// PROTOTYPE candidates: embed the turn once, then classify every axis by
// similarity to per-label centroids built from the training split.
//
// The appeal is the cost profile. One forward pass answers ALL axes, against
// the NLI baseline's one pass per label (8 in production's config, 44 for the
// full frame). And the encoder for the first variant is already resident in the
// app for retrieval, so on that variant the marginal cost of routing is a
// vector comparison rather than a second model.
//
// PROTOTYPES ARE BUILT FROM THE TRAIN SPLIT ONLY. That is not a formality: a
// centroid built over held-out rows would encode the answers it is later
// scored against, and the resulting numbers would be meaningless while looking
// excellent. The build asserts it.
//
// TWO DECISION RULES, both measured, because the brief asks for both and they
// fail differently. Nearest-centroid is stable but blurs a label whose examples
// form several clusters ("small_talk" is not one thing). Top-k vote handles
// multi-cluster labels but is swayed by a single odd neighbour in a sparse
// region, which this corpus has plenty of.
//
// Prototypes live in a JSON cache rather than natively.db via sqlite-vec. For
// PRODUCTION the brief specifies sqlite-vec and that is right; for measurement
// the storage layer changes nothing and a DB dependency would add setup that
// the benchmark does not need. The vectors and the arithmetic are identical.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Provider, emptyFrame, SCORED_AXES } from './contract.mjs';
import { WorkerHost } from './workerHost.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

/** Axes a prototype can speak to. `voice` is derived, so it is not learned. */
const PROTOTYPE_AXES = SCORED_AXES.filter((a) => a !== 'voice');

/** Same text shape the fine-tuned heads see, so the comparison is like for like. */
export function buildText(row) {
  const hist = (row.history ?? []).slice(-2).join(' ');
  const mode = row.custom_mode_key ?? row.mode;
  return `[mode] ${mode} [channel] ${row.channel} [files] ${row.mode_has_reference_files ? 'yes' : 'no'} [history] ${hist} [turn] ${row.input}`;
}

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

export class EmbeddingPrototypeProvider extends Provider {
  /**
   * @param {{id, modelId, dtype?, localOnly?, rule?: 'centroid'|'topk', k?: number,
   *          trainRows: Array, cacheDir?: string}} opts
   */
  constructor(opts) {
    super(opts.id);
    this.opts = { dtype: 'q8', localOnly: true, rule: 'centroid', k: 15, ...opts };
    this.host = null;
    this.centroids = {};   // axis -> label -> Float64Array
    this.examples = {};    // axis -> [{vec, label}]  (top-k rule only)
    this.dim = 0;
    this.temperature = 20;
  }

  async load() {
    this.host = new WorkerHost(
      path.join(__dirname, this.opts.staticEmbed ? 'staticEmbedWorker.mjs' : 'embeddingWorker.mjs'),
      {
        modelId: this.opts.modelId,
        dtype: this.opts.dtype,
        localOnly: this.opts.localOnly,
        modelPath: path.join(repoRoot, 'resources/models'),
        cacheDir: path.join(repoRoot, 'resources/models'),
      },
      { timeoutMs: 120_000 },
    );
    await this.host.start();

    const train = this.opts.trainRows ?? [];
    if (train.length === 0) throw new Error(`${this.id}: no training rows supplied`);
    const leaked = train.filter((r) => r.split === 'holdout');
    if (leaked.length) {
      throw new Error(`${this.id}: ${leaked.length} held-out rows reached prototype building. Refusing: the result would be meaningless.`);
    }

    const texts = train.map(buildText);
    const vectors = await this.#embedAll(texts);
    this.dim = vectors[0]?.length ?? 0;

    // `legacy_intent` is built alongside the frame axes so this candidate is
    // directly comparable to the control. It lives on the ROW, not inside
    // `labels`, which is why it needs the explicit lookup below rather than
    // riding along with the others.
    for (const axis of [...PROTOTYPE_AXES, 'legacy_intent']) {
      const sums = new Map();
      const counts = new Map();
      const ex = [];
      train.forEach((row, i) => {
        const label = axis === 'legacy_intent' ? row.legacy_intent : row.labels?.[axis];
        if (label == null) return;
        const v = vectors[i];
        if (!sums.has(label)) { sums.set(label, new Float64Array(this.dim)); counts.set(label, 0); }
        const s = sums.get(label);
        for (let d = 0; d < this.dim; d++) s[d] += v[d];
        counts.set(label, counts.get(label) + 1);
        ex.push({ vec: v, label });
      });
      const cents = {};
      for (const [label, s] of sums) {
        const n = counts.get(label);
        const c = new Float64Array(this.dim);
        let norm = 0;
        for (let d = 0; d < this.dim; d++) { c[d] = s[d] / n; norm += c[d] * c[d]; }
        // Re-normalise: the mean of unit vectors is not itself a unit vector,
        // and comparing an un-normalised centroid by dot product silently
        // rewards labels with tightly clustered examples.
        norm = Math.sqrt(norm) || 1;
        for (let d = 0; d < this.dim; d++) c[d] /= norm;
        cents[label] = c;
      }
      this.centroids[axis] = cents;
      this.examples[axis] = ex;
    }

    this.temperature = this.#fitTemperature(train, vectors);
  }

  /**
   * Pick the softmax temperature that minimises expected calibration error on
   * the TRAINING split, over `needs_response` — the axis the campaign turns on.
   *
   * Fitting on train and not on holdout matters: a temperature tuned against
   * the held-out rows would be a hyperparameter fitted to the test set, and
   * every confidence and ECE figure downstream would be optimistic.
   */
  #fitTemperature(train, vectors) {
    const axis = 'needs_response';
    const cents = this.centroids[axis];
    if (!cents) return 20;
    const rows = train
      .map((row, i) => ({ actual: row.labels?.[axis], v: vectors[i] }))
      .filter((r) => r.actual != null);
    if (!rows.length) return 20;

    const ranked = rows.map((r) => ({
      actual: r.actual,
      scored: Object.entries(cents).map(([l, c]) => [l, dot(r.v, c)]).sort((a, b) => b[1] - a[1]).slice(0, 5),
    }));

    let best = { t: 20, ece: Infinity };
    for (const t of [5, 10, 20, 40, 60, 80, 120, 160, 240, 320]) {
      const bins = Array.from({ length: 10 }, () => ({ n: 0, correct: 0, conf: 0 }));
      for (const r of ranked) {
        const mx = r.scored[0][1];
        const exps = r.scored.map(([, s]) => Math.exp((s - mx) * t));
        const z = exps.reduce((a, b) => a + b, 0) || 1;
        const conf = exps[0] / z;
        const b = bins[Math.min(9, Math.floor(conf * 10))];
        b.n++; b.conf += conf;
        if (r.scored[0][0] === r.actual) b.correct++;
      }
      let ece = 0;
      for (const b of bins) if (b.n) ece += (b.n / ranked.length) * Math.abs(b.correct / b.n - b.conf / b.n);
      if (ece < best.ece) best = { t, ece };
    }
    return best.t;
  }

  async #embedAll(texts, batch = 64) {
    const out = [];
    for (let i = 0; i < texts.length; i += batch) {
      const chunk = texts.slice(i, i + batch);
      const r = await this.host.ask({ type: 'embed', texts: chunk });
      const dim = r.dims[r.dims.length - 1];
      for (let j = 0; j < chunk.length; j++) {
        out.push(Float64Array.from(r.data.slice(j * dim, (j + 1) * dim)));
      }
    }
    return out;
  }

  async classify(input) {
    const frame = emptyFrame('primary');
    const r = await this.host.ask({ type: 'embed', texts: [buildText(input)] });
    frame.workerMs = r.ms;
    const dim = r.dims[r.dims.length - 1];
    const v = Float64Array.from(r.data.slice(0, dim));

    for (const axis of PROTOTYPE_AXES) {
      const scored = this.opts.rule === 'topk'
        ? this.#topKVote(axis, v)
        : this.#nearestCentroid(axis, v);
      if (!scored.length) continue;
      frame[axis] = scored[0][0];
      const top = scored.slice(0, 5);

      // TEMPERATURE IS FITTED, NOT GUESSED.
      //
      // The first version used exp(s * 10) on cosine similarities. Cosines
      // against different centroids cluster tightly — 0.55, 0.54, 0.53 — so
      // multiplying by 10 leaves 5.5, 5.4, 5.3 and the softmax comes out almost
      // uniform. Measured on the held-out split, the top-two gap had a MEDIAN
      // of 0.011 and a p90 of 0.031.
      //
      // That is not a cosmetic problem with the confidence number. The hybrid
      // gates escalation on that gap, so every threshold from 0.10 to 0.50
      // escalated 100% of rows, and all four hybrid variants collapsed into
      // "the escalation model, plus overhead" — strictly worse than running the
      // escalation alone, while looking like a working ladder.
      //
      // `#fitTemperature` picks the value that minimises calibration error on
      // the TRAIN split, so confidence means something and the margin can gate.
      const t = this.temperature;
      const mx = Math.max(...top.map(([, s]) => s));
      const exps = top.map(([, s]) => Math.exp((s - mx) * t));
      const z = exps.reduce((a, b) => a + b, 0) || 1;
      frame.confidence[axis] = exps[0] / z;
      frame.alternatives[axis] = top.map(([l, s], i) => [l, exps[i] / z]);
      // The RAW cosine ranking travels alongside, so a caller that wants to gate
      // on similarity rather than on a squashed probability can.
      (frame.rawScores ??= {})[axis] = top;
    }
    // The legacy control axis, so this candidate is comparable to the baseline.
    const legacy = this.#nearestCentroid('legacy_intent', v);
    if (legacy.length) {
      frame.legacy_intent = legacy[0][0];
      frame.confidence.legacy_intent = legacy[0][1];
    }
    return frame;
  }

  #nearestCentroid(axis, v) {
    const cents = this.centroids[axis];
    if (!cents) return [];
    return Object.entries(cents)
      .map(([label, c]) => [label, dot(v, c)])
      .sort((a, b) => b[1] - a[1]);
  }

  #topKVote(axis, v) {
    const ex = this.examples[axis];
    if (!ex?.length) return [];
    const sims = ex.map((e) => [e.label, dot(v, e.vec)]).sort((a, b) => b[1] - a[1]).slice(0, this.opts.k);
    const tally = new Map();
    // Similarity-weighted votes: an exact neighbour should count for more than
    // the fifteenth-nearest one, which an unweighted vote treats identically.
    for (const [label, s] of sims) tally.set(label, (tally.get(label) ?? 0) + s);
    const total = [...tally.values()].reduce((a, b) => a + b, 0) || 1;
    return [...tally.entries()].map(([l, s]) => [l, s / total]).sort((a, b) => b[1] - a[1]);
  }

  async unload() { if (this.host) await this.host.stop(); }

  meta() {
    return {
      family: 'embedding-prototype',
      params: 0,
      sizeOnDiskMB: 0,
      runtime: 'onnx',
      ortBinding: this.opts.staticEmbed ? 'onnxruntime-node' : 'transformers.js',
      modelId: this.opts.modelId,
      rule: this.opts.rule,
      k: this.opts.rule === 'topk' ? this.opts.k : undefined,
      dim: this.dim,
      temperature: this.temperature,
      forwardPassesPerRow: 1,
    };
  }
}
