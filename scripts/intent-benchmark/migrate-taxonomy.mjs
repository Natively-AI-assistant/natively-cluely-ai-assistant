#!/usr/bin/env node
// scripts/intent-benchmark/migrate-taxonomy.mjs
//
// v1 -> v2 taxonomy. Two changes, both decided from the Phase 5 error analysis
// rather than from taste.
//
// 1. dialogue_act: `question` and `request` MERGE into `ask`.
//
//    39.4% of dialogue_act failures were cases where both labels are defensible,
//    and half of all those overlaps were this one pair: 27 of 54. "whats the
//    status on the q three report" is a question in grammatical form and a
//    request in conversational function, and forcing a choice between them
//    carries no information while costing accuracy. Nothing downstream treats
//    the two differently today.
//
//    The merged label is named `ask` rather than keeping either original name,
//    because calling a direct instruction a "question" or calling "how does
//    this work" a "request" would each be wrong half the time.
//
// 2. needs_response: `optional` is REMOVED. The axis becomes binary.
//
//    Nine of eleven overlapping-label failures on this axis were `optional`
//    against `yes`. A middle category that neither a human labeller nor a model
//    separates reliably is not carrying information, and this is the axis with
//    the clearest product consequence, since it decides whether Natively speaks
//    at all.
//
//    Where the 226 optional rows GO was decided by looking at what they
//    actually are, not by picking a side:
//
//      70% arrived on the MIC channel and 80% were `statement` — the user
//      thinking aloud mid-sentence ("so we could uh we could try the local
//      cache for"). That is not "could go either way", it is the user talking
//      in their own meeting, which the corpus already labels `no` elsewhere.
//
//      The system-channel ones are the other party saying something the user
//      should address ("i see you listed ruby on rails but we mainly use
//      python", "the compensation range we are looking at is sort of eighty
//      thousand"). Those are responsive moments.
//
//    So: an optional turn that is an `ask` becomes `yes` whatever the channel,
//    since someone is asking for something. Otherwise mic becomes `no` and
//    system becomes `yes`.
//
// IDS ARE PRESERVED, so the held-out split is unchanged and v1 and v2 results
// are comparable row for row.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonl } from './lib/schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i > -1 && args[i + 1] ? args[i + 1] : d; };
const IN = path.resolve(__dirname, val('--in', 'dataset/v1.jsonl'));
const OUT = path.resolve(__dirname, val('--out', 'dataset/v2.jsonl'));

const { rows } = parseJsonl(fs.readFileSync(IN, 'utf8'));

const stats = {
  askMerged: 0,
  optionalToYes: 0,
  optionalToNo: 0,
  optionalAskToYes: 0,
  voiceFixed: 0,
  answerFormFixed: 0,
  groundingFixed: 0,
};

for (const r of rows) {
  const L = r.labels;

  if (L.dialogue_act === 'question' || L.dialogue_act === 'request') {
    L.dialogue_act = 'ask';
    stats.askMerged++;
  }

  if (L.needs_response === 'optional') {
    if (L.dialogue_act === 'ask') {
      L.needs_response = 'yes';
      stats.optionalAskToYes++;
    } else if (r.channel === 'mic') {
      L.needs_response = 'no';
      stats.optionalToNo++;
    } else {
      L.needs_response = 'yes';
      stats.optionalToYes++;
    }
  }

  // A turn that just became `no` must also become silent, and must carry no
  // task. The schema enforces both, so skipping this would produce a corpus the
  // validator rejects.
  if (L.needs_response === 'no') {
    if (L.voice !== 'silent') { L.voice = 'silent'; stats.voiceFixed++; }
    L.task = 'none';
    L.secondary_tasks = [];
    // answer_form and grounding too. The first version of this migration set
    // only voice and task, so 149 rows folded from `optional` kept an
    // answer_form and a grounding source describing an answer that would never
    // be produced. The hand check caught it at 10.3% disagreement on
    // answer_form, over the bar.
    if (L.answer_form !== 'none') { L.answer_form = 'none'; stats.answerFormFixed++; }
    if (L.grounding !== 'none') { L.grounding = 'none'; stats.groundingFixed++; }
  }
}

fs.writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

console.log(`\n${path.relative(process.cwd(), IN)} -> ${path.relative(process.cwd(), OUT)}`);
console.log(`  question/request -> ask        ${stats.askMerged}`);
console.log(`  optional -> yes (was an ask)   ${stats.optionalAskToYes}`);
console.log(`  optional -> yes (system chan)  ${stats.optionalToYes}`);
console.log(`  optional -> no  (own mic)      ${stats.optionalToNo}`);
console.log(`  voice corrected to silent      ${stats.voiceFixed}`);
console.log(`  answer_form corrected to none  ${stats.answerFormFixed}`);
console.log(`  grounding corrected to none    ${stats.groundingFixed}`);
console.log(`  ids and splits preserved, so v1 and v2 compare row for row\n`);
