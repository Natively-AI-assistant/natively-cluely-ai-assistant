// scripts/intent-benchmark/providers/contract.mjs
//
// The provider interface every candidate implements. This is deliberately the
// SAME shape the production router will use, so a winner does not need
// rewriting to ship: PR 6's primary classifier is a provider that happens to
// live in electron/ instead of here.
//
//   id        stable slug, used as the report key and the replay key
//   load()    bring the model up. MUST spawn a worker for any ONNX or GGUF.
//   classify(input) -> IntentFrame, including per-axis confidence
//   unload()  tear down, releasing the worker and its ONNX slot
//   meta()    family, params, sizeOnDiskMB, runtime
//
// THE WORKER RULE IS NOT NEGOTIABLE, INCLUDING HERE.
//
// Natively already learned this the hard way: multiple ONNX Runtime sessions on
// the Electron main thread caused fatal BFCArena::Extend aborts on macOS. The
// production loaders (IntentClassifier, LocalEmbeddingProvider, LocalReranker,
// Whisper) each run in their own worker_threads.Worker, behind an
// onnxThreadConfig concurrency slot and an on-disk poison sentinel.
//
// A benchmark that loaded six candidate models in-process to "just measure
// them" would not merely risk crashing the harness. It would measure a
// configuration that can never ship, and the latency numbers would be wrong in
// the direction that flatters the biggest model, because it would not be paying
// the worker round-trip that production pays. So the harness measures INSIDE
// the worker and reports the round-trip separately.

/**
 * @typedef {Object} RouterInput
 * @property {string} input               raw STT text for this turn
 * @property {string} [input_punctuated]  restored text, when candidate P has run
 * @property {string} mode                active mode id
 * @property {string} channel             system | mic | typed | screen
 * @property {string} user_channel        which channel carries the user
 * @property {string[]} history           last few turns, newest last
 * @property {Object} app_state           question_pending, coding_task_active, ...
 * @property {boolean} mode_has_reference_files
 */

/**
 * @typedef {Object} IntentFrame
 * @property {string} dialogue_act
 * @property {string} needs_response
 * @property {string} voice
 * @property {string} task
 * @property {string[]} secondary_tasks
 * @property {string} mode_intent
 * @property {string} answer_form
 * @property {string} grounding
 * @property {string[]} capabilities
 * @property {boolean} current_information
 * @property {Record<string, number>} confidence
 * @property {Record<string, Array<[string, number]>>} alternatives
 * @property {'rules'|'primary'|'escalation'|'timeout_fallback'} provenance
 */

/** Axes a provider is scored on. A provider may return a subset; missing axes
 *  are recorded as `null` and scored as wrong, never silently skipped. */
export const SCORED_AXES = [
  'dialogue_act', 'needs_response', 'voice', 'task',
  'mode_intent', 'answer_form', 'grounding',
];

/** Base class. Subclasses override load/classify/unload/meta. */
export class Provider {
  constructor(id) { this.id = id; }
  async load() {}
  // eslint-disable-next-line no-unused-vars
  async classify(_input) { throw new Error(`${this.id}: classify not implemented`); }
  async unload() {}
  meta() { return { family: 'unknown', params: 0, sizeOnDiskMB: 0, runtime: 'rules' }; }
}

/** An empty frame, so a provider that resolves only some axes still type-checks. */
export function emptyFrame(provenance = 'primary') {
  return {
    dialogue_act: null, needs_response: null, voice: null, task: null,
    secondary_tasks: [], mode_intent: null, answer_form: null,
    grounding: null, capabilities: [], current_information: null,
    confidence: {}, alternatives: {}, provenance,
  };
}

/** Turn a dataset row into the input a provider sees. Labels are NOT passed. */
export function rowToInput(row, { punctuated = false } = {}) {
  return {
    input: punctuated && row.input_punctuated ? row.input_punctuated : row.input,
    input_punctuated: row.input_punctuated,
    mode: row.mode,
    channel: row.channel,
    user_channel: row.user_channel,
    history: row.history ?? [],
    app_state: row.app_state ?? {},
    mode_has_reference_files: !!row.mode_has_reference_files,
  };
}
