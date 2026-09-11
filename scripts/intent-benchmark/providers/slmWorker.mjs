// scripts/intent-benchmark/providers/slmWorker.mjs
//
// Local small language model (Qwen3-0.6B, GGUF, node-llama-cpp) emitting an
// IntentFrame as grammar-constrained JSON.
//
// GRAMMAR CONSTRAINT IS NOT A CONVENIENCE. An unconstrained 0.6B model asked
// for JSON produces invalid JSON often enough that the failure rate would
// dominate the accuracy measurement, and "the model was wrong" and "the model
// emitted a stray backtick" are different findings. A grammar makes every
// completion parseable by construction, so what is measured is the routing
// decision rather than the formatting.
//
// Runs in its own worker like every other model here. llama.cpp is native code
// with its own memory arena, so it has the same co-residency hazards as ORT.

import { parentPort, workerData } from 'node:worker_threads';

if (!parentPort) throw new Error('slmWorker must be run as a Worker thread');

let model = null;
let context = null;
let grammar = null;
let llama = null;
let sequence = null;

const AXES = {
  needs_response: ['yes', 'no'],
  dialogue_act: ['ask', 'statement', 'answer', 'backchannel', 'interruption'],
  task: ['answer', 'explain', 'create', 'debug', 'summarize', 'compare', 'rewrite', 'plan', 'research', 'extract', 'none'],
  answer_form: ['code', 'fact', 'explanation', 'example', 'recommendation', 'summary', 'rebuttal', 'steps', 'table', 'none'],
  grounding: ['profile', 'mode_files', 'knowledge_base', 'conversation_memory', 'none'],
};

async function ensureLoaded() {
  if (context) return;
  const t0 = performance.now();
  const nlc = await import('node-llama-cpp');
  llama = await nlc.getLlama();
  model = await llama.loadModel({ modelPath: workerData.modelPath, gpuLayers: workerData.gpuLayers ?? 0 });
  context = await model.createContext({ contextSize: 2048, batchSize: 512 });
  // ONE sequence, created once and reused.
  //
  // A context ships with a fixed number of sequences (one by default), and
  // LlamaChatSession.dispose() does NOT return the sequence to the pool. Taking
  // a fresh sequence per row therefore succeeds exactly once and then fails
  // every subsequent call with "No sequences left" — which the harness records
  // as an unresolved row, so the provider reports near-zero accuracy that looks
  // like a hopeless model rather than a leaked handle. 11 of 12 rows failed
  // that way before this.
  sequence = context.getSequence();

  // A JSON schema grammar over exactly the axes, with enums. The model cannot
  // emit a label outside the vocabulary, so an out-of-vocabulary answer — the
  // most common small-model failure on a constrained task — is impossible
  // rather than merely unlikely.
  grammar = await llama.createGrammarForJsonSchema({
    type: 'object',
    properties: Object.fromEntries(
      Object.entries(AXES).map(([axis, vals]) => [axis, { enum: vals }]),
    ),
    required: Object.keys(AXES),
  });
  parentPort.postMessage({ type: 'loaded', ms: performance.now() - t0 });
}

function buildPrompt({ text, mode, channel, history }) {
  const hist = (history ?? []).slice(-2).join('\n');
  return `You route turns in a live conversation assistant.

MODE: ${mode}
CHANNEL: ${channel} (system = the other party spoke, mic = the user spoke)
RECENT:
${hist || '(nothing yet)'}
TURN: ${text}

Decide:

needs_response — describe BOTH directions, because the answer is genuinely
  split roughly evenly in real conversation:
  "yes"  the other party asked the user something, requested something, or
         addressed them by name and expects a reply. Most questions arriving on
         the system channel are "yes".
  "no"   backchannels ("mhm", "right"), the other party thinking aloud, two
         other people talking to each other, admin chatter, and the user's OWN
         speech on their own mic.

dialogue_act — what the turn IS: question, request, statement, answer,
  backchannel, interruption.

task, answer_form, grounding — what answering it would need. Use "none" when
  needs_response is "no".

Answer with JSON only.`;
}

parentPort.on('message', async (msg) => {
  try {
    if (msg.type === 'init') { await ensureLoaded(); parentPort.postMessage({ type: 'ok', id: msg.id }); return; }
    if (msg.type === 'classify') {
      await ensureLoaded();
      const nlc = await import('node-llama-cpp');
      const t0 = performance.now();
      // A fresh session per turn. Carrying a session across rows would let one
      // row's answer condition the next, which on a benchmark is leakage
      // between test items rather than helpful context.
      // Reset rather than re-allocate. Clearing history also enforces the
      // isolation we want: one row must not condition the next, which on a
      // benchmark would be leakage between test items.
      await sequence.clearHistory();
      const session = new nlc.LlamaChatSession({ contextSequence: sequence });
      const out = await session.prompt(buildPrompt(msg), { grammar, maxTokens: 120, temperature: 0 });
      parentPort.postMessage({ type: 'result', id: msg.id, frame: grammar.parse(out), ms: performance.now() - t0 });
      return;
    }
    parentPort.postMessage({ type: 'error', id: msg.id, error: `unknown message ${msg.type}` });
  } catch (e) {
    parentPort.postMessage({ type: 'error', id: msg?.id, error: e?.message ?? String(e) });
  }
});
