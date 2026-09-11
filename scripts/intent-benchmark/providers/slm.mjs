// scripts/intent-benchmark/providers/slm.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Provider, emptyFrame } from './contract.mjs';
import { WorkerHost } from './workerHost.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

export class SlmProvider extends Provider {
  constructor(opts) { super(opts.id); this.opts = opts; this.host = null; }

  async load() {
    this.host = new WorkerHost(
      path.join(__dirname, 'slmWorker.mjs'),
      { modelPath: path.resolve(repoRoot, this.opts.gguf), gpuLayers: this.opts.gpuLayers ?? 0 },
      // Generous: a 0.6B model generating constrained JSON is far slower than
      // any encoder here, and a timeout that fired routinely would report a
      // crash rate rather than a latency.
      { timeoutMs: 120_000 },
    );
    await this.host.start();
  }

  async classify(input) {
    const frame = emptyFrame('escalation');
    const r = await this.host.ask({
      type: 'classify', text: input.input, mode: input.mode,
      channel: input.channel, history: input.history,
    });
    frame.workerMs = r.ms;
    for (const [k, v] of Object.entries(r.frame ?? {})) {
      if (k in frame) frame[k] = v;
      // The grammar guarantees a value but not a probability, so there is no
      // confidence to report. Recording a fabricated one would corrupt the
      // calibration column, so the axis is simply left without.
    }
    return frame;
  }

  async unload() { if (this.host) await this.host.stop(); }

  meta() {
    return {
      family: 'local-slm', params: 600e6, sizeOnDiskMB: 409, runtime: 'gguf',
      ortBinding: 'llama.cpp', modelId: this.opts.gguf, forwardPassesPerRow: 1,
    };
  }
}
