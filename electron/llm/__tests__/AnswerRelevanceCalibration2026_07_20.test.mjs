// Calibration harness — replays every press from run-047 (the most recent
// full 3-script judged benchmark, post-every-fix-live) through the REAL
// checkAnswerRelevance classifier in observe-only mode, captures the
// confidence distribution vs the gold-standard G3 judge verdict, and
// writes a sorted classification report to /tmp/relevance_calibration.tsv.
//
// CRITICAL: this is a CALIBRATION run, not a test. Any threshold
// discovered here MUST be validated against this same corpus by hand
// before being promoted into the guard's ANSWER_RELEVANCE_THRESHOLD
// constant in AnswerRelevanceChecker.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const re = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/AnswerRelevanceChecker.js')).href);
const intentMod = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/IntentClassifier.js')).href);
const { checkAnswerRelevance } = re;

// Warm the classifier before the corpus replay so the first press doesn't
// pay the cold-start cost (30s timeout on the first call) — subsequent
// inferences are <100ms each.
try { intentMod.warmupIntentClassifier(); } catch { /* not in main-process context */ }

// A CALIBRATION HARNESS, not a regression test. It replays a recorded live run
// (run-047) to produce a TSV for threshold tuning, and that recording lives in
// /tmp — machine-local and ephemeral, so it is absent on CI and on any laptop
// that has rebooted. Read at module scope, its absence threw before any test
// registered and the whole file counted as a failure on every run.
//
// Skipped explicitly with the path in the reason, so it runs untouched wherever
// the corpus exists and states plainly why it did not otherwise.
const CORPUS_PATH = '/tmp/corpus/run-047.json';
const CORPUS_MISSING = !fs.existsSync(CORPUS_PATH)
  ? `skip: ${CORPUS_PATH} not present — this is a calibration replay over a recorded live run, not a self-contained test`
  : false;
const corpus = CORPUS_MISSING ? [] : JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf8'));

test('replay every press from run-047 through real checkAnswerRelevance, write /tmp/relevance_calibration.tsv', { skip: CORPUS_MISSING }, async () => {
  // Warmup call (first inference) — discards its result but gets the
  // model loaded into the worker.
  try {
    await checkAnswerRelevance('warmup question', 'warmup answer for warmup question');
  } catch { /* fine */ }

  const rows = [['pressId', 'script', 'goldG3', 'classifierConfidence', 'classifiedRelevant', 'wouldGuardRegenerate']];
  for (const r of corpus) {
    let conf = null;
    try {
      const out = await checkAnswerRelevance(r.question, r.answer);
      conf = out ? out.confidence : null;
    } catch { conf = null; }
    const would = conf !== null && conf < 0.15;
    rows.push([
      r.pressId,
      r.script,
      r.pass === true ? 'pass' : r.pass === false ? 'FAIL' : 'unknown',
      conf === null ? 'null' : conf.toFixed(4),
      conf !== null && conf >= 0.15 ? 'relevant' : conf === null ? 'null' : 'IRRELEVANT',
      would ? 'YES' : conf === null ? 'N/A' : 'no',
    ]);
  }
  const tsv = rows.map(r => r.join('\t')).join('\n');
  fs.writeFileSync('/tmp/relevance_calibration.tsv', tsv);
  const pass = rows.filter(r => r[2] === 'pass').length;
  const fail = rows.filter(r => r[2] === 'FAIL').length;
  const nonNull = rows.slice(1).filter(r => r[3] !== 'null').length;
  console.log(`Corpus: ${pass} G3-pass, ${fail} G3-fail, ${rows.length - 1} total, ${nonNull} non-null classifier outputs`);
  assert.ok(nonNull > 0, 'classifier should produce real confidences for at least some corpus entries');
});
