#!/usr/bin/env node
// Verifies the installed @huggingface/transformers for the internals
// whisperWorker.ts relies on (Auto Detect per final + encoder reuse), and on
// success records the version in electron/audio/whisper/transformersVerified.json,
// which WhisperInternalsContract2026_10_21.test.mjs requires.
//
// Upgrade steps:
//   1. set the new exact version in package.json and install it;
//   2. npm run verify:transformers
//
// It runs, in order:
//   - the contract test (fake sessions, no model) on the installed copy;
//   - the REAL compiled worker on a multilingual model with Auto Detect, on
//     committed French, English, French clips, and checks that each final is
//     detected in its own language, transcribed in it, and that the encoder
//     runs exactly once per final (the reuse works).
// The model (Xenova/whisper-tiny, about 120 MB) is downloaded once into the
// cache directory unless it is already there.
//
// Options: --cache <dir> (default: <os tmpdir>/natively-transformers-verify)
//          --model <id>  (default: Xenova/whisper-tiny; must be multilingual)
//          --skip-build  (dist-electron is already current)
//          --dry-run     (check only, do not record the version)
// Pure Node APIs, so it runs the same on macOS and Windows.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { isEntryScript } from './lib/is-entry-script.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = '@huggingface/transformers';
const VERIFIED_FILE = path.join(repo, 'electron', 'audio', 'whisper', 'transformersVerified.json');
const FIXTURES = path.join(repo, 'electron', 'audio', 'whisper', '__tests__', 'fixtures');
const CLIPS = [
  { file: 'auto-detect-fr.wav', language: 'french', text: /bonjour/i },
  { file: 'auto-detect-en.wav', language: 'english', text: /hello/i },
  { file: 'auto-detect-fr.wav', language: 'french', text: /bonjour/i },
];
// The app's Whisper dtype (fp32 encoder, q8 decoders).
const DTYPE = { encoder_model: 'fp32', decoder_model: 'q8', decoder_model_merged: 'q8', decoder_with_past_model: 'q8', model: 'q8' };

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(name);
const fail = (msg) => { console.error(`\n✖ ${msg}`); process.exit(1); };

export function readWavMono16k(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${file}: not a WAV file`);
  let fmt = null;
  for (let off = 12; off + 8 <= b.length;) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = { format: b.readUInt16LE(body), channels: b.readUInt16LE(body + 2), rate: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) };
    } else if (id === 'data') {
      if (!fmt || fmt.channels !== 1 || fmt.rate !== 16000) throw new Error(`${file}: expected 16 kHz mono`);
      if (fmt.format === 1 && fmt.bits === 16) {
        const out = new Float32Array(size / 2);
        for (let i = 0; i < out.length; i++) out[i] = b.readInt16LE(body + i * 2) / 32768;
        return out;
      }
      if (fmt.format === 3 && fmt.bits === 32) return new Float32Array(b.buffer.slice(b.byteOffset + body, b.byteOffset + body + size));
      throw new Error(`${file}: unsupported sample format ${fmt.format}/${fmt.bits}`);
    }
    off = body + size + (size & 1);
  }
  throw new Error(`${file}: no data chunk`);
}

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { cwd: repo, stdio: 'inherit', env: { ...process.env, ...env } });
  return r.status === 0;
}

function checkPin() {
  const declared = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).dependencies[PKG];
  const installed = JSON.parse(fs.readFileSync(path.join(repo, 'node_modules', PKG, 'package.json'), 'utf8')).version;
  if (!/^\d+\.\d+\.\d+$/.test(declared)) fail(`package.json must pin ${PKG} to an exact version, not "${declared}".`);
  if (declared !== installed) fail(`package.json says ${PKG} ${declared} but ${installed} is installed. Install the pinned version first.`);
  return installed;
}

// Counts encoder session runs inside the worker: every ONNX run fed
// input_features is an encoder pass. Added to each 'result' message.
const COUNTER = `
const ort = require(${JSON.stringify(path.join(repo, 'node_modules', 'onnxruntime-node'))});
const orig = ort.InferenceSession.prototype.run;
let encoderRuns = 0;
ort.InferenceSession.prototype.run = function (feeds, ...rest) {
  if (feeds && Object.prototype.hasOwnProperty.call(feeds, 'input_features')) encoderRuns++;
  return orig.call(this, feeds, ...rest);
};
const { parentPort } = require('worker_threads');
const post = parentPort.postMessage.bind(parentPort);
parentPort.postMessage = (m, t) => post(m && m.type === 'result' ? { ...m, encoderRuns } : m, t);
`;

async function runWorker({ model, cache }) {
  const counter = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'natively-verify-')), 'count-encoder.cjs');
  fs.writeFileSync(counter, COUNTER);
  const workerFile = path.join(repo, 'dist-electron', 'electron', 'audio', 'whisper', 'whisperWorker.js');
  if (!fs.existsSync(workerFile)) fail(`${workerFile} is missing; run without --skip-build.`);
  const w = new Worker(workerFile, { execArgv: ['-r', counter], stdout: true, stderr: true });
  const logs = [];
  const collect = (s) => s.on('data', (d) => { for (const line of String(d).split(/\r?\n/)) if (line) logs.push(line); });
  collect(w.stdout);
  collect(w.stderr);

  const finals = [];
  await new Promise((resolve, reject) => {
    let i = 0;
    const next = () => {
      if (i >= CLIPS.length) { w.postMessage({ type: 'shutdown' }); return; }
      const audio = readWavMono16k(path.join(FIXTURES, CLIPS[i].file));
      i++;
      w.postMessage({ type: 'transcribe', taskId: `t${i}`, audio, language: 'auto', streaming: false });
    };
    const timer = setTimeout(() => reject(new Error('the worker did not finish within 10 minutes')), 600_000);
    w.on('message', (m) => {
      if (m.type === 'progress') return;
      if (m.type === 'ready') next();
      else if (m.type === 'result') { finals.push(m); next(); }
      else if (m.type === 'error') { clearTimeout(timer); reject(new Error(m.message)); }
    });
    w.on('error', (e) => { clearTimeout(timer); reject(e); });
    w.on('exit', () => { clearTimeout(timer); resolve(); });
    w.postMessage({ type: 'init', modelId: model, cacheDir: cache, dtype: DTYPE, executionProviders: ['cpu'], expectedBytes: 0 });
  }).catch((e) => fail(`the worker failed: ${e.message}\n${logs.slice(-20).join('\n')}`));
  return { finals, logs };
}

export function checkWorkerRun({ finals, logs }) {
  const problems = [];
  const broken = logs.filter((l) => /Auto Detect failed|Reusing the encoder output failed|off until restart/.test(l));
  if (broken.length) problems.push(`an internal failed:\n    ${broken.join('\n    ')}`);
  if (finals.length !== CLIPS.length) problems.push(`expected ${CLIPS.length} results, got ${finals.length}`);
  // Detection logs one line per change of language; expected: french, english, french.
  const detected = logs.map((l) => /Auto Detect: (\w+) \(/.exec(l)?.[1]).filter(Boolean);
  const expectedSwitches = CLIPS.map((c) => c.language).filter((l, i, a) => i === 0 || a[i - 1] !== l);
  if (JSON.stringify(detected) !== JSON.stringify(expectedSwitches)) {
    problems.push(`detected ${JSON.stringify(detected)}, expected ${JSON.stringify(expectedSwitches)}`);
  }
  let previous = 0;
  finals.forEach((m, i) => {
    const clip = CLIPS[i];
    if (clip && !clip.text.test(m.text ?? '')) problems.push(`clip ${i + 1} (${clip.language}) came back as "${m.text}"`);
    const runs = m.encoderRuns - previous;
    previous = m.encoderRuns;
    if (runs !== 1) problems.push(`clip ${i + 1}: the encoder ran ${runs} times, expected once (encoder output not reused)`);
  });
  return { problems, detected: CLIPS.map((c) => c.language) };
}

const USAGE = `Usage: npm run verify:transformers -- [--cache <dir>] [--model <id>] [--skip-build] [--dry-run]
Checks the installed ${PKG} on a real Whisper model (downloads about 120 MB once)
and records the version in electron/audio/whisper/transformersVerified.json.`;

async function main() {
  if (flag('--help') || flag('-h')) { console.log(USAGE); return; }
  const known = new Set(['--cache', '--model', '--skip-build', '--dry-run']);
  const unknown = process.argv.slice(2).filter((a, i, all) => a.startsWith('-') && !known.has(a) && !['--cache', '--model'].includes(all[i - 1]));
  if (unknown.length) fail(`unknown option ${unknown.join(' ')}\n${USAGE}`);
  const version = checkPin();
  const model = arg('--model', 'Xenova/whisper-tiny');
  const cache = path.resolve(arg('--cache', path.join(os.tmpdir(), 'natively-transformers-verify')));
  fs.mkdirSync(cache, { recursive: true });
  console.log(`Verifying ${PKG} ${version} with ${model} (cache ${cache})`);

  if (!flag('--skip-build') && !run(process.execPath, [path.join('scripts', 'build-electron.js')])) fail('build-electron failed.');

  console.log('\n1/2 Contract test on the installed copy');
  const test = path.join('electron', 'audio', 'whisper', '__tests__', 'WhisperInternalsContract2026_10_21.test.mjs');
  if (!run(process.execPath, ['--test', test], { NATIVELY_TRANSFORMERS_VERIFYING: version })) {
    fail(`the contract test failed: ${PKG} ${version} changed an internal whisperWorker.ts uses. Adapt the worker before recording it.`);
  }

  console.log('\n2/2 Real model: French, English, French on Auto Detect');
  const result = checkWorkerRun(await runWorker({ model, cache }));
  if (result.problems.length) fail(`real-model check failed for ${PKG} ${version}:\n  ${result.problems.join('\n  ')}`);
  console.log('  each final detected and transcribed in its language, encoder once per final');

  if (flag('--dry-run')) { console.log(`\n✔ ${PKG} ${version} passes (dry run, not recorded)`); return; }
  const file = JSON.parse(fs.readFileSync(VERIFIED_FILE, 'utf8'));
  file.verified = file.verified.filter((v) => v.version !== version);
  file.verified.push({ version, date: new Date().toISOString().slice(0, 10), model, detected: result.detected, encoderRunsPerFinal: 1 });
  fs.writeFileSync(VERIFIED_FILE, `${JSON.stringify(file, null, 2)}\n`);
  console.log(`\n✔ ${PKG} ${version} recorded in ${path.relative(repo, VERIFIED_FILE)}`);
}

if (isEntryScript(import.meta.url)) await main();
