#!/usr/bin/env node
// scripts/intent-benchmark/handcheck.mjs
//
// The founder review loop the brief requires: sample 20% of the corpus, get a
// human verdict per axis, and compute the disagreement rate. If any axis
// exceeds 10%, that axis's DEFINITION is wrong and it must be rewritten and
// relabelled before Phase 4 spends money on adapters.
//
// Two subcommands:
//   export  writes a TSV a human can fill in a spreadsheet
//   score   reads the filled TSV back and reports per-axis disagreement
//
// The output is TSV, not markdown or JSON, for one reason: a person has to fill
// in several hundred rows, and a spreadsheet is the only tool where that is not
// miserable. Tabs rather than commas because the `input` field is full of
// commas and quoting rules are where CSV review files go to die.
//
// Usage:
//   node scripts/intent-benchmark/handcheck.mjs export --in dataset/v1.jsonl --out reports/handcheck-v1.tsv
//   node scripts/intent-benchmark/handcheck.mjs score  --in reports/handcheck-v1.filled.tsv

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { parseJsonl } from './lib/schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const cmd = args[0];
const val = (f, d) => { const i = args.indexOf(f); return i > -1 && args[i + 1] ? args[i + 1] : d; };

/** Axes a human is asked to rule on. Deliberately the ones a router acts on. */
const REVIEW_AXES = [
  'dialogue_act', 'needs_response', 'voice', 'task',
  'mode_intent', 'answer_form', 'grounding',
];

const SAMPLE_SHARE = 0.20;

/** Stable 20% review sample, independent of the train/holdout split. */
function inReviewSample(id) {
  const h = crypto.createHash('sha256').update(`handcheck:${id}`).digest();
  return (h.readUInt32BE(0) % 100) < SAMPLE_SHARE * 100;
}

const tsvEscape = (s) => String(s ?? '').replace(/[\t\r\n]+/g, ' ').trim();

function doExport() {
  const IN = path.resolve(__dirname, val('--in', 'dataset/v1.jsonl'));
  const OUT = path.resolve(__dirname, val('--out', 'reports/handcheck-v1.tsv'));
  const { rows, bad } = parseJsonl(fs.readFileSync(IN, 'utf8'));
  if (bad.length) console.warn(`[handcheck] ${bad.length} torn lines skipped`);

  const sample = rows.filter((r) => inReviewSample(r.id));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  const header = [
    'id', 'mode', 'lang', 'channel', 'has_files', 'input', 'restored',
    ...REVIEW_AXES,
    'WRONG_AXES', 'CORRECTION', 'COMMENT',
  ];
  const lines = [
    '# Natively interaction-router dataset, hand check',
    `# ${sample.length} rows sampled from ${rows.length} (${(SAMPLE_SHARE * 100).toFixed(0)}%).`,
    '#',
    '# HOW TO FILL THIS IN',
    '# Read `input` in the context of `mode` and `channel`, then read the label',
    '# columns. If a label is WRONG, put that axis name in WRONG_AXES (comma',
    '# separated for several). Put what it should have been in CORRECTION.',
    '# Leave WRONG_AXES empty when the row is fine. That is the common case and',
    '# an empty cell counts as agreement.',
    '#',
    '# TWO LABELS CHANGED since the benchmark ran, so read these definitions',
    '# rather than assuming:',
    '#   dialogue_act "ask" now covers BOTH questions and requests. They used to',
    '#     be separate and could not be told apart: "whats the status on the q3',
    '#     report" is a question in form and a request in function.',
    '#   needs_response is now just yes/no. "optional" is gone; it had become a',
    '#     bin for the user thinking aloud on their own mic, which is "no".',
    '#',
    '# The one that matters most is needs_response. "no" means Natively should',
    '# stay silent: backchannels, the other party thinking aloud, your own voice',
    '# on your own mic, admin chatter.',
    '#',
    '# The `lang` column marks Hinglish and Manglish rows. Those were generated',
    '# without a speaker of either language checking them, so they need your eye',
    '# most: is the code-switching where a real speaker would put it, and do the',
    '# mis-transcriptions look like what a model actually gets wrong? They are',
    '# reported separately and never gated on, so a verdict of "unnatural" is a',
    '# useful answer, not a failure.',
    '#',
    '# `restored` is candidate P output (punctuation + truecasing). You are NOT',
    '# reviewing it; it is there because a question mark often makes the correct',
    '# label obvious.',
    '# stay silent: backchannels, the other party thinking aloud, your own voice',
    '# Any axis where you disagree on more than 10% of rows means that axis is',
    '# DEFINED wrong, not labelled wrong, and gets rewritten before Phase 4.',
    '#',
    header.join('\t'),
  ];

  for (const r of sample) {
    lines.push([
      r.id, r.mode, r.language ?? 'en', r.channel, r.mode_has_reference_files ? 'Y' : 'N',
      tsvEscape(r.input), tsvEscape(r.input_punctuated ?? ''),
      ...REVIEW_AXES.map((a) => tsvEscape(r.labels?.[a])),
      '', '', '',
    ].join('\t'));
  }

  fs.writeFileSync(OUT, lines.join('\n') + '\n');
  console.log(`\nwrote ${sample.length} rows to ${path.relative(process.cwd(), OUT)}`);
  console.log(`open it in a spreadsheet, fill WRONG_AXES, save as TSV, then:`);
  console.log(`  node scripts/intent-benchmark/handcheck.mjs score --in <filled file>\n`);

  const byMode = {};
  for (const r of sample) byMode[r.mode] = (byMode[r.mode] ?? 0) + 1;
  console.log('sample per mode: ' + Object.entries(byMode).map(([k, v]) => `${k}=${v}`).join('  '));
}

function doScore() {
  const IN = path.resolve(__dirname, val('--in', 'reports/handcheck-v1.filled.tsv'));
  const text = fs.readFileSync(IN, 'utf8');
  const lines = text.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  const header = lines.shift().split('\t');
  const iWrong = header.indexOf('WRONG_AXES');
  if (iWrong < 0) { console.error('no WRONG_AXES column found'); process.exit(2); }

  const disagreements = Object.fromEntries(REVIEW_AXES.map((a) => [a, 0]));
  const unknownAxes = new Map();
  let reviewed = 0;

  for (const line of lines) {
    const cols = line.split('\t');
    reviewed++;
    const wrong = (cols[iWrong] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    for (const w of wrong) {
      if (w in disagreements) disagreements[w]++;
      else unknownAxes.set(w, (unknownAxes.get(w) ?? 0) + 1);
    }
  }

  console.log(`\nreviewed ${reviewed} rows\n`);
  const failing = [];
  for (const axis of REVIEW_AXES) {
    const n = disagreements[axis];
    const rate = reviewed ? n / reviewed : 0;
    const flag = rate > 0.10 ? '  <-- EXCEEDS 10%, REWRITE THIS AXIS' : '';
    console.log(`  ${axis.padEnd(16)} ${String(n).padStart(4)}  ${(rate * 100).toFixed(1).padStart(5)}%${flag}`);
    if (rate > 0.10) failing.push(axis);
  }
  if (unknownAxes.size) {
    console.log(`\n  unrecognised axis names in WRONG_AXES (typos?): ${[...unknownAxes.keys()].join(', ')}`);
  }

  if (failing.length) {
    console.log(`\nBLOCKED. ${failing.length} axis/axes exceed the 10% bar: ${failing.join(', ')}`);
    console.log('Per the campaign brief, rewrite those axis definitions and relabel before continuing.\n');
    process.exit(1);
  }
  console.log(`\nAll axes within the 10% bar. Cleared to proceed.\n`);
}

if (cmd === 'export') doExport();
else if (cmd === 'score') doScore();
else { console.error('usage: handcheck.mjs export|score [--in <f>] [--out <f>]'); process.exit(2); }
