#!/usr/bin/env node
// scripts/answer-quality/fetch-mode-transcripts.mjs
//
// Real speech per Natively mode, for testing the router on what it will
// actually see.
//
// WHY REAL RECORDINGS AND NOT WRITTEN ONES.
//
// A transcript I write is a transcript shaped by what I expect the classifier to
// do with it, and that bias has already bitten this campaign once: a hand
// written set of coding questions gave "no classifier" 5 of 5 on code delivery,
// and real held out questions gave it 3 of 6. The convenience sample flattered
// the conclusion I was leaning toward.
//
// Auto-captions of real conversations carry the disfluencies for free. The
// hesitations, the restarts, the half-finished clauses and the transcription
// errors are all there because a person actually said it that way and a model
// actually mis-heard it. That is the input Natively gets.
//
// The captions are used as a local benchmark fixture only. Nothing is
// redistributed and no transcript is reproduced in any report.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'transcripts');

// One search per mode, aimed at the shape of conversation that mode assumes.
// The user's role and the system channel differ per mode, which is exactly what
// the router is meant to handle and what a single interview corpus cannot test.
const MODES = {
  'technical-interview': 'mock technical coding interview full',
  'looking-for-work': 'mock behavioral interview tell me about yourself full',
  'sales': 'real sales discovery call recording software',
  'recruiting': 'recruiter screening call candidate mock',
  'team-meet': 'engineering team standup meeting recording',
  'lecture': 'computer science lecture full class',
  'seminar': 'conference talk with audience question and answer',
  'call-center': 'customer support call centre real call recording',
  'general': 'podcast technical discussion two people',
};

async function fetchCaptions(query, tag) {
  const dest = path.join('/tmp', `mode-${tag}`);
  try {
    await exec('yt-dlp', [
      '--skip-download', '--write-auto-subs', '--write-subs',
      '--sub-lang', 'en.*', '--sub-format', 'vtt',
      '--match-filter', 'duration > 420 & duration < 5400',
      '-o', `${dest}.%(ext)s`, `ytsearch3:${query}`,
    ], { timeout: 240000 });
  } catch { /* some searches return nothing usable */ }
  const found = fs.readdirSync('/tmp').filter((f) => f.startsWith(`mode-${tag}`) && f.endsWith('.vtt'));
  return found.length ? path.join('/tmp', found[0]) : null;
}

/** VTT to continuous text: strip cues, timing tags, and the rolling duplicates. */
function vttToText(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const lines = [];
  for (let ln of raw.split('\n')) {
    if (/^(WEBVTT|Kind:|Language:|NOTE)/.test(ln) || ln.includes('-->') || !ln.trim()) continue;
    ln = ln.replace(/<[^>]+>/g, '').trim();
    if (ln) lines.push(ln);
  }
  const seen = new Set();
  const uniq = lines.filter((l) => (seen.has(l) ? false : (seen.add(l), true)));
  return uniq.join(' ').replace(/\s+/g, ' ').trim();
}

const summary = [];
for (const [mode, query] of Object.entries(MODES)) {
  process.stdout.write(`${mode.padEnd(22)} searching... `);
  const vtt = await fetchCaptions(query, mode);
  if (!vtt) { console.log('NO CAPTIONS FOUND'); summary.push({ mode, words: 0, note: 'no captioned result' }); continue; }
  const text = vttToText(vtt);
  fs.writeFileSync(path.join(OUT, `${mode}.raw.txt`), text);
  console.log(`${String(text.split(' ').length).padStart(6)} words`);
  summary.push({ mode, words: text.split(' ').length, source: path.basename(vtt) });
}
fs.writeFileSync(path.join(OUT, 'sources.json'), JSON.stringify(summary, null, 2));
console.log('\nraw text per mode in transcripts/, sources recorded in sources.json');
