#!/usr/bin/env node
// scripts/intent-benchmark/errorAnalysis.mjs
//
// Phase 5: categorise every failure by CAUSE, not just count them.
//
// The brief asks for this specifically, and the reason is that an accuracy
// number cannot tell you what to do next. "67% on needs_response" is the same
// number whether the remaining 33% is a model that needs more data, a taxonomy
// with two labels nobody can tell apart, or rows whose correct answer is not
// recoverable from the text at all. Those three call for more training, a
// taxonomy change, and a different input respectively.
//
// Categories are the brief's, verbatim:
//   bad_model                  the answer was recoverable and the model missed it
//   bad_label                  the ground truth is wrong; the prediction is right
//   overlapping_labels         both are defensible; the taxonomy does not separate them
//   context_missing            unanswerable from this turn; needs history or app state
//   inherently_multi_intent    the turn genuinely carries several, one label cannot hold it
//   deterministic_signal_missing  a rule or prosody feature would settle it, not a model
//   should_never_be_classified the turn should not have reached a classifier
//
// A cloud LLM does the categorising because it is a judgement over natural
// language, and it sees the utterance, the history, the mode, the truth and the
// prediction. It never sees which model produced the prediction, so it cannot
// flatter or punish a particular candidate.
//
// Usage:
//   node scripts/intent-benchmark/errorAnalysis.mjs --provider head-minilm --axis needs_response

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateJson, readApiKey } from './lib/gemini.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i > -1 && args[i + 1] ? args[i + 1] : d; };

const PROVIDER = val('--provider', 'head-minilm');
const AXIS = val('--axis', 'needs_response');
const BATCH = Number(val('--batch', 15));
const MODEL = val('--model', 'gemini-3.1-flash-lite');

const CATEGORIES = [
  'bad_model', 'bad_label', 'overlapping_labels', 'context_missing',
  'inherently_multi_intent', 'deterministic_signal_missing', 'should_never_be_classified',
];

const rowsPath = path.resolve(__dirname, `reports/${PROVIDER}.rows.json`);
if (!fs.existsSync(rowsPath)) {
  console.error(`no per-row file at ${rowsPath}. Re-run with --save-rows.`);
  process.exit(2);
}
const rows = JSON.parse(fs.readFileSync(rowsPath, 'utf8'));
const failures = rows.filter((r) => r.expected?.[AXIS] != null && r.predicted?.[AXIS] !== r.expected[AXIS]);

console.log(`\n${PROVIDER} / ${AXIS}: ${failures.length} failures of ${rows.length} rows (${((failures.length / rows.length) * 100).toFixed(1)}%)\n`);
if (failures.length === 0) process.exit(0);

try { readApiKey(); } catch (e) { console.error(e.message); process.exit(2); }

const SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          category: { type: 'string', enum: CATEGORIES },
          reason: { type: 'string' },
        },
        required: ['id', 'category', 'reason'],
      },
    },
  },
  required: ['verdicts'],
};

function buildPrompt(batch) {
  return `You are auditing a live-conversation intent router's mistakes on the "${AXIS}" axis.

For each row you get the raw speech-to-text turn, the mode, which channel it came
in on, a little history, the CORRECT label and the label the router PREDICTED.

Assign exactly one cause:

bad_model — the correct answer WAS recoverable from what the router saw, and it
  simply got it wrong. This is the default when nothing else applies.
bad_label — the ground truth is wrong and the prediction is actually right.
overlapping_labels — both labels are defensible for this turn. The taxonomy does
  not cleanly separate them, so no model could be reliably right.
context_missing — not answerable from this turn. It needs earlier conversation,
  who was being addressed, or app state that was not provided.
inherently_multi_intent — the turn genuinely carries more than one thing and a
  single label cannot represent it.
deterministic_signal_missing — a rule or an audio cue would settle it and a
  language model is the wrong tool. For example a rising pitch marking a
  question, a long pause, or the speaker's own name being used.
should_never_be_classified — the turn should not have reached a classifier at
  all: pure noise, an empty fragment, or an artifact of transcription.

Be strict about bad_model. Only reach for the other categories when the evidence
in the row supports them. If the correct answer is plainly there in the text and
the router missed it, that is bad_model.

ROWS:
${batch.map((r) => JSON.stringify({
    id: r.id, mode: r.mode, channel: r.channel,
    history: (r.history ?? []).slice(-2),
    turn: r.input,
    correct: r.expected[AXIS],
    predicted: r.predicted[AXIS],
  })).join('\n')}`;
}

const verdicts = new Map();
for (let i = 0; i < failures.length; i += BATCH) {
  const batch = failures.slice(i, i + BATCH);
  process.stdout.write(`  categorising ${i + 1}-${Math.min(i + BATCH, failures.length)} of ${failures.length}\r`);
  try {
    const { data } = await generateJson({ prompt: buildPrompt(batch), responseSchema: SCHEMA, model: MODEL, temperature: 0 });
    for (const v of data?.verdicts ?? []) verdicts.set(v.id, v);
  } catch (e) {
    console.warn(`\n  batch failed: ${e.message.slice(0, 90)}`);
  }
}

const counts = {};
for (const c of CATEGORIES) counts[c] = 0;
let uncategorised = 0;
for (const f of failures) {
  const v = verdicts.get(f.id);
  if (!v) { uncategorised++; continue; }
  counts[v.category] = (counts[v.category] ?? 0) + 1;
}

const total = failures.length;
console.log(`\n\ncause                          n     share of failures`);
console.log('-'.repeat(56));
for (const [c, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  if (n === 0) continue;
  console.log(`  ${c.padEnd(30)} ${String(n).padStart(3)}   ${((n / total) * 100).toFixed(1).padStart(5)}%`);
}
if (uncategorised) console.log(`  ${'(uncategorised)'.padEnd(30)} ${String(uncategorised).padStart(3)}`);

const out = path.resolve(__dirname, `reports/errors-${PROVIDER}-${AXIS}.json`);
fs.writeFileSync(out, JSON.stringify({
  provider: PROVIDER, axis: AXIS, totalRows: rows.length, failures: total, counts, uncategorised,
  examples: failures.slice(0, 400).map((f) => ({
    id: f.id, mode: f.mode, channel: f.channel, input: f.input,
    correct: f.expected[AXIS], predicted: f.predicted[AXIS],
    category: verdicts.get(f.id)?.category ?? null,
    reason: verdicts.get(f.id)?.reason ?? null,
  })),
}, null, 2));
console.log(`\nwritten to ${path.relative(process.cwd(), out)}\n`);
