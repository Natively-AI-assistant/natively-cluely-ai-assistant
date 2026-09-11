// scripts/intent-benchmark/providers/gliclass.mjs
//
// GLiClass candidate: one forward pass per AXIS (not per label), using the
// natural-language label descriptions the NLI candidates use, so the two are
// compared on the same wording and any difference is the architecture.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Provider, emptyFrame } from './contract.mjs';
import { WorkerHost } from './workerHost.mjs';
import { AXIS_HYPOTHESES, LEGACY_HYPOTHESES } from './nli.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

export class GliClassProvider extends Provider {
  constructor(opts) {
    super(opts.id);
    this.opts = opts;
    this.host = null;
    this.passes = 0;
  }

  async load() {
    this.host = new WorkerHost(
      path.join(__dirname, 'gliclassWorker.mjs'),
      {
        modelId: this.opts.modelId,
        graph: this.opts.graph ?? 'model-int8-quantized.onnx',
        modelPath: path.join(repoRoot, 'resources/models'),
        threads: 2,
      },
      { timeoutMs: 60_000 },
    );
    await this.host.start();
  }

  async classify(input) {
    const frame = emptyFrame('primary');
    let workerMs = 0;

    for (const [axis, hyps] of Object.entries(AXIS_HYPOTHESES)) {
      const labels = Object.keys(hyps);
      const r = await this.host.ask({ type: 'classify', text: input.input, labels });
      workerMs += r.ms;
      this.passes += 1;   // one pass for the whole axis, however many labels
      frame[axis] = hyps[r.ranked[0][0]] ?? null;
      frame.confidence[axis] = r.ranked[0][1];
      frame.alternatives[axis] = r.ranked.slice(0, 3).map(([l, s]) => [hyps[l] ?? l, s]);
    }

    const legacyLabels = Object.keys(LEGACY_HYPOTHESES);
    const lr = await this.host.ask({ type: 'classify', text: input.input, labels: legacyLabels });
    workerMs += lr.ms;
    this.passes += 1;
    frame.legacy_intent = LEGACY_HYPOTHESES[lr.ranked[0][0]] ?? null;
    frame.confidence.legacy_intent = lr.ranked[0][1];

    const intents = this.opts.modeIntents?.[input.mode];
    if (intents?.length) {
      const mr = await this.host.ask({ type: 'classify', text: input.input, labels: intents });
      workerMs += mr.ms;
      this.passes += 1;
      frame.mode_intent = mr.ranked[0][0];
      frame.confidence.mode_intent = mr.ranked[0][1];
      frame.alternatives.mode_intent = mr.ranked.slice(0, 3);
    }

    frame.workerMs = workerMs;
    return frame;
  }

  async unload() { if (this.host) await this.host.stop(); }

  meta() {
    return {
      family: 'gliclass-single-pass', params: 0, sizeOnDiskMB: 0, runtime: 'onnx',
      ortBinding: 'onnxruntime-node', modelId: this.opts.modelId,
      forwardPassesPerRow: 7,
    };
  }
}
