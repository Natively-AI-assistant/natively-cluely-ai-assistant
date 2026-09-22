// scripts/intent-benchmark/providers/rules.mjs
//
// CONTROL: the production regex fast path, alone.
//
// This imports the REAL `detectIntentByPattern` from the compiled app bundle,
// not a copy. That export exists for this provider. A copy would go stale — the
// git history of that function shows three separate corrections landing over
// two months (the "stack up" idiom, the DSA word boundaries, the demonstrative
// "stack") — and a control scoring a stale ruleset understates the baseline and
// flatters every candidate measured against it.
//
// WHAT THIS PROVIDER CANNOT DO IS THE POINT.
//
// It resolves `legacy_intent`, and the two axes that intent implies. It cannot
// resolve needs_response, dialogue_act, voice, mode_intent or grounding,
// because nothing in the ten regex rules is about any of them. Those axes come
// back unresolved and are scored WRONG, which is not a handicap imposed on the
// control: it is a measurement of what the shipped system can and cannot decide
// today, and it is the number the whole campaign is arguing against.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { Provider, emptyFrame } from './contract.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

/** Legacy intent -> the axes it genuinely implies. Anything else stays null. */
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

export class RulesProvider extends Provider {
  constructor() { super('rules'); this.fn = null; }

  async load() {
    const mod = await import(
      pathToFileURL(path.join(repoRoot, 'dist-electron/electron/llm/IntentClassifier.js')).href
    );
    if (typeof mod.detectIntentByPattern !== 'function') {
      throw new Error('detectIntentByPattern is not exported from the compiled IntentClassifier');
    }
    this.fn = mod.detectIntentByPattern;
  }

  async classify(input) {
    const frame = emptyFrame('rules');
    const hit = this.fn(input.input);
    if (!hit) {
      // No rule matched. The production pipeline would fall to the model tier
      // and then to a context heuristic; this control stops here, because its
      // whole purpose is to isolate what the RULES contribute.
      frame.legacy_intent = null;
      return frame;
    }
    frame.legacy_intent = hit.intent;
    const axes = INTENT_TO_AXES[hit.intent] ?? {};
    frame.task = axes.task ?? null;
    frame.answer_form = axes.answer_form ?? null;
    // The confidence is a HARDCODED constant on seven of the ten rules, so it
    // is reported but flagged degenerate by the calibration check downstream.
    frame.confidence = { legacy_intent: hit.confidence, task: hit.confidence, answer_form: hit.confidence };
    return frame;
  }

  meta() {
    return { family: 'regex', params: 0, sizeOnDiskMB: 0, runtime: 'rules' };
  }
}
