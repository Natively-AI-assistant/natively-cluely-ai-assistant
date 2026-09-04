#!/usr/bin/env node
// scripts/intent-benchmark/analyze-telemetry.mjs
//
// Extract the REAL production priors for the interaction-router campaign from
// the local marker-only telemetry log.
//
// Why this exists. Phase 2 has to weight a synthetic dataset, and the honest
// alternative to guessing is the distribution the shipped classifier actually
// produced. logs/telemetry.jsonl carries `intent_classified`,
// `answer_type_selected` and `fallback_answer_used` as MARKER-ONLY events: an
// enum label, a request id, a source. No question text, no answer text, no
// transcript. So this reads real usage without reading anyone's content.
//
// It is a script, not a test, and it never writes to the dataset. Its output is
// a report the dataset generator reads, so the weighting is reproducible and
// auditable rather than a number pasted into a doc.
//
// Usage:
//   node scripts/intent-benchmark/analyze-telemetry.mjs [--log <path>] [--json]

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const args = process.argv.slice(2);
const argVal = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i > -1 && args[i + 1] ? args[i + 1] : dflt;
};
const LOG = path.resolve(argVal('--log', 'logs/telemetry.jsonl'));
const AS_JSON = args.includes('--json');

if (!fs.existsSync(LOG)) {
  console.error(`[analyze-telemetry] no log at ${LOG}`);
  console.error('This log is local and gitignored. Absent is NOT an error: the');
  console.error('dataset generator falls back to uniform weights and says so.');
  process.exit(2);
}

/** Events we count, and the marker field that carries the label. */
const COUNTERS = {
  intent_classified: 'intent',
  answer_type_selected: 'answerType',
  fallback_answer_used: 'finalGenerationMode',
};

const tally = {
  intent: new Map(),
  intentBySource: new Map(),
  answerType: new Map(),
  fallbackMode: new Map(),
  // one of these is emitted per runWhatShouldISay invocation, so together they
  // are the denominator for any per-turn rate
  invocations: { what_to_answer_clicked: 0, question_submitted: 0 },
  // silence, split by source and by the answer type it landed on
  silenceBySource: new Map(),
  silenceByAnswerType: new Map(),
  malformed: 0,
  total: 0,
};

const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);

const rl = readline.createInterface({
  input: fs.createReadStream(LOG, { encoding: 'utf8' }),
  crlfDelay: Infinity,
});

for await (const line of rl) {
  if (!line.trim()) continue;
  tally.total++;
  let rec;
  try {
    rec = JSON.parse(line);
  } catch {
    // A crashed write can leave a torn final line. Count it, never abort: an
    // unreadable tail must not invalidate 30k good rows.
    tally.malformed++;
    continue;
  }
  const name = rec?.name;
  const props = rec?.properties ?? {};

  if (name in tally.invocations) tally.invocations[name]++;

  if (name === 'intent_classified' && props.intent) {
    bump(tally.intent, props.intent);
    bump(tally.intentBySource, `${props.source ?? 'unknown'}`);
  }
  if (name === 'answer_type_selected' && props.answerType) {
    bump(tally.answerType, props.answerType);
  }
  if (name === 'fallback_answer_used' && props[COUNTERS.fallback_answer_used]) {
    const mode = props.finalGenerationMode;
    bump(tally.fallbackMode, mode);
    if (mode === 'nonanswer_sentinel_fallback') {
      bump(tally.silenceBySource, props.source ?? 'unknown');
      if (props.answerType) bump(tally.silenceByAnswerType, props.answerType);
    }
  }
}

const sorted = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);
const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
const pct = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : 'n/a');

const invocations = tally.invocations.what_to_answer_clicked + tally.invocations.question_submitted;
const silenceTotal = tally.fallbackMode.get('nonanswer_sentinel_fallback') ?? 0;

const report = {
  source: LOG,
  linesRead: tally.total,
  malformedLines: tally.malformed,
  invocations: { ...tally.invocations, total: invocations },
  intent: Object.fromEntries(sorted(tally.intent)),
  intentTotal: sum(tally.intent),
  intentBySource: Object.fromEntries(sorted(tally.intentBySource)),
  answerType: Object.fromEntries(sorted(tally.answerType)),
  answerTypeTotal: sum(tally.answerType),
  silence: {
    // FLOOR, not the true rate. The sentinel branch only marks
    // fallback_answer_used when !isSpeculative; the speculative branch returns
    // null after emitting an engine-level discard that never reaches this log.
    // So speculative silence is entirely uncounted here.
    countedIsFloor: true,
    nonanswerSentinelFallback: silenceTotal,
    ofInvocations: pct(silenceTotal, invocations),
    bySource: Object.fromEntries(sorted(tally.silenceBySource)),
    byAnswerType: Object.fromEntries(sorted(tally.silenceByAnswerType)),
  },
};

if (AS_JSON) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} else {
  const it = report.intentTotal;
  console.log(`\nlog            ${LOG}`);
  console.log(`lines          ${report.linesRead}${report.malformedLines ? ` (${report.malformedLines} malformed, skipped)` : ''}`);
  console.log(`invocations    ${invocations}  (clicked ${tally.invocations.what_to_answer_clicked}, typed ${tally.invocations.question_submitted})`);

  console.log(`\nINTENT  n=${it}`);
  for (const [k, v] of sorted(tally.intent)) {
    console.log(`  ${k.padEnd(16)} ${String(v).padStart(6)}  ${pct(v, it).padStart(6)}`);
  }

  const at = report.answerTypeTotal;
  console.log(`\nANSWER TYPE  n=${at}  (top 10)`);
  for (const [k, v] of sorted(tally.answerType).slice(0, 10)) {
    console.log(`  ${k.padEnd(30)} ${String(v).padStart(6)}  ${pct(v, at).padStart(6)}`);
  }

  console.log(`\nSILENCE  (floor: speculative silence is not logged)`);
  console.log(`  nonanswer_sentinel_fallback  ${silenceTotal}  = ${pct(silenceTotal, invocations)} of invocations`);
  for (const [k, v] of sorted(tally.silenceBySource)) {
    console.log(`    source ${k.padEnd(16)} ${String(v).padStart(5)}`);
  }
  console.log(`  landed on:`);
  for (const [k, v] of sorted(tally.silenceByAnswerType).slice(0, 5)) {
    console.log(`    ${k.padEnd(30)} ${String(v).padStart(5)}  ${pct(v, silenceTotal).padStart(6)} of silences`);
  }
  console.log('');
}
