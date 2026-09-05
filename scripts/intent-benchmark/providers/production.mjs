// scripts/intent-benchmark/providers/production.mjs
//
// THE BASELINE THE CAMPAIGN IS ARGUING AGAINST: the shipped classifier, whole.
//
// The `rules` provider isolates tier 1. This one runs all three tiers by
// calling the real `classifyIntent` out of the compiled bundle, so the number
// it produces is what production does today, not a reconstruction of it:
//
//   tier 1  detectIntentByPattern, ten regex rules, first match wins
//   tier 2  MobileBERT zero-shot NLI in its own worker, gated on the turn being
//           longer than five characters and the top score reaching 0.35
//   tier 3  detectIntentByContext, a heuristic that cannot return null
//
// MobileBERT runs in the production worker, which is the architecture rule and
// also the only honest way to measure it: an in-process session would skip the
// round-trip production pays and flatter the baseline.
//
// WHAT IT CANNOT DO IS THE MEASUREMENT.
//
// The pipeline resolves `legacy_intent` and the two axes that intent implies.
// It has no output for needs_response or dialogue_act. Not a weak output, no
// output: nothing in the ten rules, the eight NLI hypotheses or the context
// heuristic is about whether the assistant should speak. Those axes come back
// null and are scored wrong, and that is the finding rather than a handicap.
//
// So a candidate beating this on needs_response is not evidence of much. The
// `majority` provider is the honest floor for that axis.

import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Provider, emptyFrame } from './contract.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

/** Legacy intent -> the axes it genuinely implies. Kept identical to rules.mjs. */
const INTENT_TO_AXES = {
  coding:          { task: 'debug',     answer_form: 'code' },
  clarification:   { task: 'explain',   answer_form: 'explanation' },
  follow_up:       { task: 'answer',    answer_form: 'explanation' },
  deep_dive:       { task: 'explain',   answer_form: 'explanation' },
  behavioral:      { task: 'answer',    answer_form: 'example' },
  example_request: { task: 'answer',    answer_form: 'example' },
  summary_probe:   { task: 'summarize', answer_form: 'summary' },
  general:         { task: 'answer',    answer_form: 'explanation' },
};

export class ProductionProvider extends Provider {
  constructor() { super('production'); this.classifyIntent = null; this.mod = null; }

  async load() {
    // The zero-shot tier resolves its model directory from
    // `process.resourcesPath`, which only Electron sets. Under plain node it is
    // undefined and the path collapses to the relative string "models", so the
    // worker would fail to load and tier 2 would silently never fire. Setting
    // it here is what makes this the real three-tier pipeline rather than tiers
    // 1 and 3 wearing its name.
    if (!process.resourcesPath) {
      process.resourcesPath = path.join(repoRoot, 'resources');
    }
    const mod = await import(
      pathToFileURL(path.join(repoRoot, 'dist-electron/electron/llm/IntentClassifier.js')).href
    );
    if (typeof mod.classifyIntent !== 'function') {
      throw new Error('classifyIntent is not exported from the compiled IntentClassifier');
    }
    this.mod = mod;
    this.classifyIntent = mod.classifyIntent;
  }

  async classify(input) {
    const frame = emptyFrame('production');
    // Production is called with the last interviewer turn, the recent
    // transcript, and how many times the assistant has already spoken. The
    // corpus row carries the first two directly. The third drives tier 3 only,
    // and the corpus has no turn counter, so it is passed as the history length,
    // which is the closest honest reading of "how far into this exchange are we".
    const recentTranscript = (input.history ?? []).join('\n');
    const assistantMessageCount = (input.history ?? []).length;
    const res = await this.classifyIntent(input.input, recentTranscript, assistantMessageCount);
    if (!res || !res.intent) return frame;

    frame.legacy_intent = res.intent;
    const axes = INTENT_TO_AXES[res.intent] ?? {};
    frame.task = axes.task ?? null;
    frame.answer_form = axes.answer_form ?? null;
    // needs_response and dialogue_act stay null. See the header.
    frame.confidence = {
      legacy_intent: res.confidence, task: res.confidence, answer_form: res.confidence,
    };
    return frame;
  }

  async unload() {
    // NOTHING TO DO, AND THAT IS NOT AN OVERSIGHT.
    //
    // `ZeroShotClassifier` is a private class with no exported teardown, so
    // this provider cannot dispose the worker it started. An earlier version of
    // this method optional-chained its way to `ZeroShotClassifier.getInstance()`
    // and read as if it released the worker; that expression is `undefined` at
    // every step and the method was a no-op wearing a cleanup comment.
    //
    // It is safe because the harness runs each provider in its own `node
    // run.mjs` process, and the production code unrefs the worker, so the
    // process exits and the OS reaps it. Verified: exit code 0 in about a
    // second, with no `intentClassifierWorker` left behind.
    //
    // If this provider is ever run in-process alongside others, the stray
    // worker WILL hold an ONNX slot and tax every latency measured after it.
  }

  meta() {
    return {
      family: 'production-3tier', params: '25M (MobileBERT) + 10 regex rules',
      sizeOnDiskMB: 121, runtime: 'onnx-worker + regex',
    };
  }
}
