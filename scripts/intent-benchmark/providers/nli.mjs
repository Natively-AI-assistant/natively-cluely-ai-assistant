// scripts/intent-benchmark/providers/nli.mjs
//
// Zero-shot NLI candidates: the MobileBERT baseline and every DeBERTa /
// ModernBERT escalation, differing only in model id and dtype.
//
// TWO CONFIGURATIONS, AND THE DIFFERENCE IS THE POINT.
//
//   'legacy'  reproduces production exactly: the eight hypothesis strings from
//             IntentClassifier.ts, one softmax over them, top-1, threshold
//             0.35. This is the control.
//
//   'frame'   asks the same model for the IntentFrame axes, one zero-shot pass
//             per axis. It exists to measure the cost the brief names as fault
//             5: MNLI zero-shot runs ONE FORWARD PASS PER LABEL. The legacy
//             config is 8 passes; the frame config is 44. If a candidate is
//             fast enough at 8 and hopeless at 44, that is a finding about the
//             architecture rather than about the model, and it is invisible
//             unless both are measured.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Provider, emptyFrame } from './contract.mjs';
import { WorkerHost } from './workerHost.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

/**
 * The production hypothesis strings, verbatim from
 * electron/llm/IntentClassifier.ts ZERO_SHOT_LABELS. Copied deliberately and
 * ONLY here: they are the control's definition, so if production changes them
 * the control should NOT silently follow — the comparison would stop being
 * against the thing that was measured.
 */
export const LEGACY_HYPOTHESES = {
  'asking for clarification or explanation': 'clarification',
  'asking about what happened next or follow-up': 'follow_up',
  'requesting more detail or deeper explanation': 'deep_dive',
  'asking for a personal experience or behavioral example': 'behavioral',
  'requesting a concrete example or instance': 'example_request',
  'summarizing or confirming understanding': 'summary_probe',
  'asking about code, programming, or implementation': 'coding',
  'general conversation or question': 'general',
};

/** Production's threshold. Below it, the model result is discarded entirely. */
export const LEGACY_THRESHOLD = 0.35;

/** Per-axis hypothesis sets for the 'frame' configuration. */
export const AXIS_HYPOTHESES = {
  needs_response: {
    'a turn that the assistant should respond to': 'yes',
    'background talk that needs no response at all': 'no',
  },
  dialogue_act: {
    'a question or a request for something': 'ask',
    'a statement of fact or opinion': 'statement',
    'an answer to an earlier question': 'answer',
    'a brief acknowledgement like mhm or right': 'backchannel',
    'an interruption': 'interruption',
  },
  task: {
    'answering something': 'answer',
    'explaining a concept': 'explain',
    'creating or writing something new': 'create',
    'debugging or fixing a problem': 'debug',
    'summarizing': 'summarize',
    'comparing options': 'compare',
    'rewriting existing text': 'rewrite',
    'planning next steps': 'plan',
    'researching current information': 'research',
    'extracting specific facts': 'extract',
    'no task at all': 'none',
  },
  answer_form: {
    'source code': 'code',
    'a short factual answer': 'fact',
    'an explanation': 'explanation',
    'a concrete example': 'example',
    'a recommendation': 'recommendation',
    'a summary': 'summary',
    'a rebuttal or counterargument': 'rebuttal',
    'step by step instructions': 'steps',
    'a table': 'table',
    'no answer needed': 'none',
  },
  grounding: {
    "the user's own background or resume": 'profile',
    'files attached to this mode': 'mode_files',
    'a product knowledge base': 'knowledge_base',
    'what was said earlier in this conversation': 'conversation_memory',
    'no external source': 'none',
  },
};

export class NliProvider extends Provider {
  /**
   * @param {{id, modelId, dtype?, mode?: 'legacy'|'frame', localOnly?, modeIntents?: Record<string,string[]>}} opts
   */
  constructor(opts) {
    super(opts.id);
    this.opts = { dtype: 'q8', mode: 'legacy', localOnly: true, ...opts };
    this.host = null;
    this.passes = 0;
  }

  async load() {
    this.host = new WorkerHost(
      path.join(__dirname, 'zeroShotWorker.mjs'),
      {
        modelId: this.opts.modelId,
        dtype: this.opts.dtype,
        localOnly: this.opts.localOnly,
        modelPath: path.join(repoRoot, 'resources/models'),
        cacheDir: path.join(repoRoot, 'resources/models'),
      },
      { timeoutMs: 30_000 },
    );
    await this.host.start();
  }

  async classify(input) {
    const frame = emptyFrame('primary');
    const text = input.input;
    let workerMs = 0;

    // Legacy axis, always: it is how every candidate is compared to the control.
    const legacyKeys = Object.keys(LEGACY_HYPOTHESES);
    const r = await this.host.ask({ type: 'classify', text, labels: legacyKeys });
    workerMs += r.ms;
    this.passes += legacyKeys.length;
    if (r.scores?.[0] >= LEGACY_THRESHOLD) {
      frame.legacy_intent = LEGACY_HYPOTHESES[r.labels[0]] ?? null;
      frame.confidence.legacy_intent = r.scores[0];
      frame.alternatives.legacy_intent = r.labels.slice(0, 3).map((l, i) => [LEGACY_HYPOTHESES[l] ?? l, r.scores[i]]);
    } else {
      // Production discards a sub-threshold result outright and falls through.
      // Reproducing that is the difference between measuring the model and
      // measuring the model as it is actually used.
      frame.legacy_intent = null;
      frame.confidence.legacy_intent = r.scores?.[0] ?? 0;
    }

    if (this.opts.mode === 'frame') {
      for (const [axis, hyps] of Object.entries(AXIS_HYPOTHESES)) {
        const keys = Object.keys(hyps);
        const a = await this.host.ask({ type: 'classify', text, labels: keys });
        workerMs += a.ms;
        this.passes += keys.length;
        frame[axis] = hyps[a.labels[0]] ?? null;
        frame.confidence[axis] = a.scores[0];
        frame.alternatives[axis] = a.labels.slice(0, 3).map((l, i) => [hyps[l] ?? l, a.scores[i]]);
      }
      // mode_intent is per-mode, so its label set comes from the row's mode.
      const intents = this.opts.modeIntents?.[input.mode];
      if (intents?.length) {
        const m = await this.host.ask({ type: 'classify', text, labels: intents });
        workerMs += m.ms;
        this.passes += intents.length;
        frame.mode_intent = m.labels[0];
        frame.confidence.mode_intent = m.scores[0];
      }
    }

    frame.workerMs = workerMs;
    return frame;
  }

  async unload() { if (this.host) await this.host.stop(); }

  meta() {
    return {
      family: 'nli-zero-shot',
      params: 0,
      sizeOnDiskMB: 0,
      runtime: 'onnx',
      ortBinding: 'transformers.js',
      config: this.opts.mode,
      modelId: this.opts.modelId,
      forwardPassesTotal: this.passes,
    };
  }
}
