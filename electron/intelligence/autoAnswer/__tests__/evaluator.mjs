#!/usr/bin/env node
/**
 * Offline Auto Answer evaluator (V2 §35 + V3 Amendment 5 calibration).
 *
 * Runs every fixture through every provider dialect and reports:
 *   question_precision / question_recall
 *   answer_opportunity_precision / answer_opportunity_recall
 *   false_trigger_rate, duplicate_trigger_rate, premature_trigger_rate
 *   question_reconstruction_accuracy
 *   median/p95 endpoint_to_decision_ms (per dialect)
 *   median_decision_to_first_token_ms  — null offline (no LLM in the harness)
 *   calibration: predicted answerability bucket vs observed precision
 *
 * NOT part of the default suite: `npm run test:auto-answer:eval`. Exit code is
 * 0 unless --gate is passed, in which case false_trigger_rate must be 0 and
 * premature_trigger_rate must be 0 (the two metrics V2 §35 prioritises).
 *
 * Usage: node evaluator.mjs [--json out.json] [--gate]
 */
import fs from 'node:fs';
import { loadFixtures, replay, judge, DIALECTS, normalize } from './replay.mjs';

const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const gate = args.includes('--gate');

const fixtures = loadFixtures();
const rows = [];
for (const fixture of fixtures) {
  for (const dialect of DIALECTS) {
    const r = replay(fixture, dialect);
    rows.push({ fixture, dialect, result: r, problems: judge(fixture, r) });
  }
}

const pct = (n, d) => (d === 0 ? null : Number((n / d).toFixed(4)));
const quantile = (xs, q) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.floor(q * (s.length - 1)));
  return s[i];
};

// Question-level: did we fire when a question was asked (label = expected.shouldAnswer)?
let tp = 0, fp = 0, fn = 0, tn = 0;
// Opportunity-level: fired AND reconstructed the right question.
let otp = 0, ofp = 0, ofn = 0;
let falseTriggers = 0, duplicateTriggers = 0, prematureTriggers = 0, dispatches = 0;
let reconOk = 0, reconTotal = 0;
const latencyByDialect = Object.fromEntries(DIALECTS.map(d => [d, []]));
const calib = new Map(); // bucket → {n, positive}
const expectedFailStillFailing = [];
const unexpected = [];

for (const { fixture, dialect, result, problems } of rows) {
  const label = Boolean(fixture.expected?.shouldAnswer);
  const fired = result.shouldAnswer;
  if (label && fired) tp++; else if (!label && fired) fp++; else if (label && !fired) fn++; else tn++;

  const expectedQ = fixture.expected?.question;
  const correctQ = expectedQ ? normalize(result.question) === normalize(expectedQ) : fired;
  if (label && fired && correctQ) otp++; else if (fired && (!label || !correctQ)) ofp++; else if (label && !fired) ofn++;

  const expectedCount = fixture.expected?.triggerCount ?? (label ? 1 : 0);
  if (result.triggerCount > expectedCount) falseTriggers++;
  if (fixture.bucket === 'dedup' && result.triggerCount > 1) duplicateTriggers++;
  for (const d of result.dispatches) {
    dispatches++;
    if (d.at < 0) prematureTriggers++;
  }
  if (label && expectedQ && fired) { reconTotal++; if (correctQ) reconOk++; }
  if (result.latencyMs !== null) latencyByDialect[dialect].push(result.latencyMs);

  for (const c of result.candidates) {
    const b = Math.min(9, Math.floor((c.answerability ?? 0) * 10)) / 10;
    const key = `${b.toFixed(1)}-${(b + 0.1).toFixed(1)}`;
    const entry = calib.get(key) ?? { n: 0, positive: 0 };
    entry.n++;
    if (label) entry.positive++;
    calib.set(key, entry);
  }

  if (fixture.expectedFail) { if (problems.length) expectedFailStillFailing.push(`${fixture.name}/${dialect}`); }
  else if (problems.length) unexpected.push(`${fixture.name}/${dialect}: ${problems.join('; ')}`);
}

const report = {
  fixtures: fixtures.length,
  dialects: DIALECTS,
  runs: rows.length,
  question_precision: pct(tp, tp + fp),
  question_recall: pct(tp, tp + fn),
  answer_opportunity_precision: pct(otp, otp + ofp),
  answer_opportunity_recall: pct(otp, otp + ofn),
  false_trigger_rate: pct(falseTriggers, rows.length),
  duplicate_trigger_rate: pct(duplicateTriggers, rows.filter(r => r.fixture.bucket === 'dedup').length),
  premature_trigger_rate: pct(prematureTriggers, dispatches),
  question_reconstruction_accuracy: pct(reconOk, reconTotal),
  endpoint_to_decision_ms: Object.fromEntries(DIALECTS.map(d => [d, {
    median: quantile(latencyByDialect[d], 0.5), p95: quantile(latencyByDialect[d], 0.95), n: latencyByDialect[d].length,
  }])),
  median_decision_to_first_token_ms: null,
  median_decision_to_first_token_note: 'not measurable offline: the harness stops at dispatch (no LLM in the detection path, V2 §36)',
  calibration: [...calib.entries()].sort().map(([bucket, e]) => ({ bucket, n: e.n, observed_precision: pct(e.positive, e.n) })),
  calibration_note: 'heuristic answerability vs fixture labels; NOT a probability until fitted on the audio corpus (V3 Amendment 5/8 — human work, out of scope)',
  expected_fail_still_failing: expectedFailStillFailing,
  unexpected_failures: unexpected,
};

console.log('\n=== Auto Answer offline evaluation ===');
for (const [k, v] of Object.entries(report)) {
  if (typeof v === 'object' && v !== null) console.log(`${k}: ${JSON.stringify(v)}`);
  else console.log(`${k}: ${v}`);
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2) + '\n');

if (gate) {
  const bad = [];
  if (report.false_trigger_rate !== 0) bad.push(`false_trigger_rate=${report.false_trigger_rate}`);
  if (report.premature_trigger_rate !== 0) bad.push(`premature_trigger_rate=${report.premature_trigger_rate}`);
  if (unexpected.length) bad.push(`${unexpected.length} unexpected failure(s)`);
  if (bad.length) { console.error('GATE FAILED: ' + bad.join(', ')); process.exit(1); }
}
