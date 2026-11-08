// Local Whisper on a slow computer, and Whisper's "Auto Detect" (issue #668
// follow-up, 2026-10-21). Platform independent: the worker code is the same on
// macOS and Windows; only how fast the CPU runs it differs.
//
//  1. The worker started every transcribe as it arrived. ONNX runs block the
//     worker thread, so when a model ran slower than speech the passes shared
//     the CPU and none finished until speech stopped: with whisper-tiny posted
//     every 300 ms, 0 of 26 results while audio arrived, the first 19 s after
//     it stopped. whisperTaskQueue.ts runs one at a time, finals first, and
//     answers a superseded partial as skipped. Same run after: first result at
//     1.2 s, all 26 in order.
//  2. transformers.js 3.8.1 transcribes a null language as English, so Auto on
//     a multilingual Whisper turned French into English sentences. The worker
//     now detects the language of every final from the first decoder step
//     (detectedWhisperLanguage), reusing the encoder output for the
//     transcription (one encoder run per final, counted on the real model).
//     Real whisper-tiny run, French, English, French on Auto in one session:
//     each came back in its own language, identical to setting it by hand.
//  3. A failed final reached only the log; the overlay kept saying it was
//     listening. LocalWhisperSTT now emits it as an error.
//
// Run: node scripts/build-electron.js && ELECTRON_RUN_AS_NODE=1 npx electron --test electron/audio/__tests__/WhisperQueueAndAutoLanguage2026_10_21.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { createWhisperTaskQueue } = require(path.join(repoRoot, 'dist-electron/electron/audio/whisper/whisperTaskQueue.js'));
const { detectedWhisperLanguage } = require(path.join(repoRoot, 'dist-electron/electron/audio/whisper/modelLanguageSupport.js'));

function harness({ behindAfterMs = 30_000 } = {}) {
  const log = [];
  let clock = 0;
  const pending = [];
  const q = createWhisperTaskQueue({
    now: () => clock,
    behindAfterMs,
    run: (task) => { log.push(`start ${task.taskId}`); return new Promise((resolve) => pending.push(() => { log.push(`done ${task.taskId}`); resolve(); })); },
    skip: (task) => log.push(`skip ${task.taskId}`),
    behind: (ms) => log.push(`behind ${ms}`),
  });
  const finishOne = async () => { pending.shift()(); await new Promise((r) => setImmediate(r)); };
  return { q, log, finishOne, tick: (ms) => { clock += ms; }, running: () => pending.length };
}

test('one pass at a time: nothing starts while another runs', async () => {
  const h = harness();
  h.q.push({ taskId: 't1', streaming: false });
  h.q.push({ taskId: 't2', streaming: false });
  h.q.push({ taskId: 't3', streaming: false });
  assert.equal(h.running(), 1);
  assert.equal(h.q.waiting, 2);
  await h.finishOne();
  await h.finishOne();
  await h.finishOne();
  assert.deepEqual(h.log, ['start t1', 'done t1', 'start t2', 'done t2', 'start t3', 'done t3']);
});

test('finals go before a waiting partial, and only the newest partial runs', async () => {
  const h = harness();
  h.q.push({ taskId: 't1', streaming: false });
  h.q.push({ taskId: 's2', streaming: true });
  h.q.push({ taskId: 's3', streaming: true }); // supersedes s2
  assert.deepEqual(h.log, ['start t1', 'skip s2']);
  h.q.push({ taskId: 't4', streaming: false }); // closes the segment s3 previewed
  assert.deepEqual(h.log, ['start t1', 'skip s2', 'skip s3']);
  await h.finishOne();
  h.q.push({ taskId: 's5', streaming: true });
  await h.finishOne();
  await h.finishOne();
  assert.deepEqual(h.log.slice(3), ['done t1', 'start t4', 'done t4', 'start s5', 'done s5']);
  assert.equal(h.q.waiting, 0);
});

test('every skipped or run task is answered once; none is lost', async () => {
  const h = harness();
  const ids = [];
  for (let i = 0; i < 20; i++) {
    const id = `${i % 3 === 0 ? 't' : 's'}${i}`;
    ids.push(id);
    h.q.push({ taskId: id, streaming: id.startsWith('s') });
  }
  while (h.running()) await h.finishOne();
  const answered = h.log.filter((l) => l.startsWith('skip') || l.startsWith('done')).map((l) => l.split(' ')[1]);
  assert.deepEqual([...answered].sort(), [...ids].sort());
  const finalsDone = h.log.filter((l) => /^done t/.test(l)).map((l) => l.split(' ')[1]);
  assert.deepEqual(finalsDone, ids.filter((id) => id.startsWith('t')), 'finals in the order they arrived');
});

test('a final that waited past the limit reports "behind", at most once per limit', async () => {
  const h = harness({ behindAfterMs: 30_000 });
  h.q.push({ taskId: 't1', streaming: false });
  h.q.push({ taskId: 't2', streaming: false });
  h.q.push({ taskId: 't3', streaming: false });
  h.tick(31_000);
  await h.finishOne(); // t2 starts after 31 s waiting
  await h.finishOne(); // t3 too, but within the same report window
  assert.deepEqual(h.log.filter((l) => l.startsWith('behind')), ['behind 31000']);
  await h.finishOne();
});

test('a run() that throws does not stop the queue', async () => {
  const seen = [];
  const q = createWhisperTaskQueue({
    run: async (t) => { seen.push(t.taskId); if (t.taskId === 't1') throw new Error('boom'); },
    skip: () => {},
  });
  q.push({ taskId: 't1', streaming: false });
  q.push({ taskId: 't2', streaming: false });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(seen, ['t1', 't2']);
});

test('Auto Detect: the supported language token with the highest logit wins, with its probability', () => {
  const langToId = { '<|en|>': 1, '<|fr|>': 2, '<|de|>': 3, '<|haw|>': 4, '<|zz|>': 5 };
  // '<|haw|>' and '<|zz|>' score higher but are not languages the app maps.
  const fr = detectedWhisperLanguage(new Float32Array([9, 1, 7, 2, 50, 60]), langToId);
  assert.equal(fr.language, 'french');
  const expected = Math.exp(7) / (Math.exp(1) + Math.exp(7) + Math.exp(2));
  assert.ok(Math.abs(fr.probability - expected) < 1e-9, `softmax over supported tokens only: ${fr.probability}`);
  const even = detectedWhisperLanguage(new Float32Array([0, 3, 3, 3]), langToId);
  assert.ok(Math.abs(even.probability - 1 / 3) < 1e-9, 'a three-way tie is 1/3, an unsure guess');
  assert.ok(detectedWhisperLanguage(new Float32Array([0, 1000, -1000, -1000]), langToId).probability > 0.999, 'no overflow on large logits');
  assert.equal(detectedWhisperLanguage(new Float32Array(2), { '<|fr|>': 99 }), null, 'id outside the logits');
  assert.equal(detectedWhisperLanguage(new Float32Array(4), {}), null);
});

test('worker: Whisper passes go through the queue; Auto checks every final and reuses its encoder output', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'electron/audio/whisper/whisperWorker.ts'), 'utf8');
  assert.match(src, /whisperQueue\.push\(msg\);/);
  assert.match(src, /run: runWhisperTranscribe,/);
  assert.match(src, /skipped: true/);
  const run = src.slice(src.indexOf('async function runWhisperTranscribe('));
  // Finals detect (and hand over the encoder output); partials take the last final's language.
  assert.match(run, /if \(streaming\) \{\s*language = autoLanguage;\s*\} else if \(internalsUsable\('detect'\)\) \{[\s\S]{0,200}\(\{ language, encoderOutputs \} = await detectAutoLanguage\(msg\.audio\)\);/);
  // The reuse path falls back to a plain run, so a library change cannot cost a transcript.
  assert.match(run, /result = await pipe\(msg\.audio, \{ \.\.\.opts, encoder_outputs: encoderOutputs \}\);[\s\S]{0,80}\} catch[\s\S]{0,300}result = await pipe\(msg\.audio, opts\);/);
  const detect = src.slice(src.indexOf('async function detectAutoLanguage('), src.indexOf('function letGenerateReuseEncoderOutputs('));
  assert.match(detect, /_prepare_encoder_decoder_kwargs_for_generation\(/, 'the encoder runs once, here');
  assert.match(detect, /await model\(\{\s*encoder_outputs,/, 'the language step reuses it');
  assert.equal(/input_features,\s*decoder_input_ids/.test(detect), false, 'no second encoder pass in the language step');
  assert.match(src, /model\.forward_params = \[\.\.\.model\.forward_params, 'encoder_outputs'\]/);
  const handler = src.slice(src.indexOf("parentPort.on('message'"), src.indexOf('async function runWhisperTranscribe('));
  assert.equal(/await pipe\(/.test(handler), false, 'no pipeline call left outside the queue');
});

test('worker: an unsure guess keeps the previous language', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'electron/audio/whisper/whisperWorker.ts'), 'utf8');
  const fnSrc = src.slice(src.indexOf('function acceptsAutoLanguage('), src.indexOf('async function detectAutoLanguage('));
  const body = fnSrc.replace(/^function acceptsAutoLanguage\([^)]*\): boolean \{/, '').replace(/\}\s*$/, '');
  const make = (prev) => new Function('guess', 'samples', `const autoLanguage = ${JSON.stringify(prev)}; const AUTO_LANGUAGE_MIN_SAMPLES = 24000;${body}`);
  const first = make(null);
  assert.equal(first({ probability: 0.2 }, 8000), true, 'with nothing before it, any guess beats English-by-default');
  assert.equal(first(null, 48000), false);
  const later = make('french');
  assert.equal(later({ probability: 0.6 }, 48000), true, '>= 50% on 1.5 s or more switches');
  assert.equal(later({ probability: 0.4 }, 48000), false);
  assert.equal(later({ probability: 0.7 }, 8000), false, 'a short clip needs 80%');
  assert.equal(later({ probability: 0.85 }, 8000), true);
});

test('host: skipped partials unblock streaming, "behind" and failed finals reach the user', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'electron/audio/LocalWhisperSTT.ts'), 'utf8');
  const skipped = src.slice(src.indexOf("if (msg.type === 'partial' && msg.skipped)"));
  assert.ok(skipped.indexOf("if (msg.type === 'partial' && msg.skipped)") === 0);
  assert.match(skipped.slice(0, 600), /this\.streamingTaskInFlight = false;/);
  assert.ok(src.indexOf("msg.type === 'partial' && msg.skipped") < src.indexOf('this.handleStreamingPartial(msg.text)'), 'checked before the partial is shown');
  assert.match(src, /if \(msg\.type === 'behind'\) \{[\s\S]{0,700}this\.emit\('error'/);
  assert.match(src, /\} else if \(msg\.taskId\?\.startsWith\('t'\)\) \{[\s\S]{0,600}this\.emit\('error', new Error\(\s*`Local transcription could not turn this speech into text\./);
});

// onnxruntime-node 1.22.0's macOS binaries say minos 13.3 (otool -l, arm64 and
// x64): 13.0-13.2 were offered models that never loaded.
test('ONNX gate: macOS 13.3 (Darwin 22.4) and later; Windows always passes it', () => {
  const { onnxRuntimeSupportedOnThisMac, ONNX_MAC_UNSUPPORTED_MESSAGE } = require(path.join(repoRoot, 'dist-electron/electron/audio/whisper/onnxMacSupport.js'));
  for (const [release, ok] of [['21.6.0', false], ['22.1.0', false], ['22.3.0', false], ['22.4.0', true], ['22.6.0', true], ['23.0.0', true], ['27.0.0', true], ['', false], ['x', false]]) {
    assert.equal(onnxRuntimeSupportedOnThisMac('darwin', release), ok, `darwin ${release}`);
  }
  assert.equal(onnxRuntimeSupportedOnThisMac('win32', '10.0.19045'), true);
  assert.match(ONNX_MAC_UNSUPPORTED_MESSAGE, /macOS 13\.3 or later/);
  for (const file of ['electron/audio/whisper/modelManager.ts', 'electron/services/LocalModelDownloadService.ts', 'electron/ipcHandlers.ts']) {
    const src = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    assert.equal(/darwinMajor < 22/.test(src), false, `${file}: old 13.0 gate gone`);
    assert.match(src, /onnxRuntimeSupportedOnThisMac\(\)/, file);
  }
});
