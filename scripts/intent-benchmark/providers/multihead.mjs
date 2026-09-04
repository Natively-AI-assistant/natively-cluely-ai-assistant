// scripts/intent-benchmark/providers/multihead.mjs
//
// The fine-tuned multi-head candidate: one shared encoder, one small head per
// IntentFrame axis, trained on the corpus TRAIN split only.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Provider, emptyFrame } from './contract.mjs';
import { WorkerHost } from './workerHost.mjs';
import { buildText } from './embeddingPrototype.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

export class MultiHeadProvider extends Provider {
  constructor(opts) {
    super(opts.id);
    this.opts = opts;
    this.host = null;
  }

  async load() {
    this.host = new WorkerHost(
      path.join(__dirname, 'multiheadWorker.mjs'),
      { dir: path.resolve(repoRoot, this.opts.dir), threads: 2 },
      { timeoutMs: 60_000 },
    );
    await this.host.start();
  }

  async classify(input) {
    const frame = emptyFrame('primary');
    // Identical text construction to the prototype candidates and to training,
    // so the comparison is like for like and the model sees at inference
    // exactly the shape it saw during fitting.
    const r = await this.host.ask({ type: 'classify', text: buildText(input) });
    frame.workerMs = r.ms;
    for (const [axis, ranked] of Object.entries(r.axes ?? {})) {
      if (!ranked?.length) continue;
      frame[axis] = ranked[0][0];
      frame.confidence[axis] = ranked[0][1];
      frame.alternatives[axis] = ranked;
    }
    return frame;
  }

  async unload() { if (this.host) await this.host.stop(); }

  meta() {
    return {
      family: 'fine-tuned-multihead',
      params: 0,
      sizeOnDiskMB: 0,
      runtime: 'onnx',
      ortBinding: 'onnxruntime-node',
      modelId: this.opts.dir,
      forwardPassesPerRow: 1,
    };
  }
}
