// Real-model, real-worker integration test for dual-channel Nemotron (the
// "one shared worker, two isolated channels" fix — see
// .superpowers/sdd/2026-08-10-nemotron-local-stt/dual-channel-fix-brief.md).
//
// Unlike integration.test.mjs (which drives NemotronEngine.create() directly
// and never touches the worker/registry), this file drives the REAL
// compiled worker (dist-electron/.../whisperWorker.js) through the REAL
// sharedWorkerRegistry.ts, exactly the path two real LocalWhisperSTT
// instances (mic + system-audio) go through in production. Gated the same
// way integration.test.mjs is: skipped when the real model/fixtures/build
// aren't present, never a hard CI requirement.
//
// What this proves, with real evidence, not just "no error was thrown":
//   1. Two channels joining back-to-back result in exactly ONE weight:3 ONNX
//      slot acquisition, not two (checked directly against the shared
//      semaphore's own counters, not merely "did NemotronEngine.create()
//      get called twice").
//   2. Two channels can run concurrently and each gets back ITS OWN correct
//      transcript — fed two genuinely different real phrases (English +
//      German, reusing the multi-language verification's own already-proven
//      real de-DE fixture/lang_id/expected-output rather than fabricating a
//      new one), so any cross-wiring between the two channels' engines or
//      chains would show up as either channel's text bleeding into the
//      other's, or being replaced by it.
//   3. Refcount correctness: one channel releasing does NOT kill the worker
//      or the ONNX slot while the other is still live; the other channel
//      keeps working correctly afterward. Releasing the LAST channel DOES
//      terminate the worker and DOES free the slot — verified by directly
//      reading the shared semaphore's counters AND by a subsequent real
//      acquireOnnxSlot('high', 3) call resolving promptly.
//   4. A worker crash while both channels are live is visible to a listener
//      attached directly on the shared worker object (proving Node's
//      multi-listener guarantee this design relies on actually holds), and
//      a fresh acquireSharedNemotronWorker call afterward successfully
//      cold-starts a brand-new worker rather than getting stuck on stale
//      registry state.
//
// Run: npm test (globs electron/audio/whisper/nemotron/__tests__/**), or
// directly:
// ELECTRON_RUN_AS_NODE=1 electron --test electron/audio/whisper/nemotron/__tests__/dualChannel.test.mjs
// (run `npm run build:electron` first if dist-electron is stale.)

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const distElectronRoot = path.resolve(__dirname, '../../../../../dist-electron/electron');
const registryJsPath = path.join(distElectronRoot, 'audio/whisper/nemotron/sharedWorkerRegistry.js');
const workerJsPath = path.join(distElectronRoot, 'audio/whisper/whisperWorker.js');
const onnxConfigJsPath = path.join(distElectronRoot, 'utils/onnxThreadConfig.js');

const registryPresent = fs.existsSync(registryJsPath);
const workerPresent = fs.existsSync(workerJsPath);
const onnxConfigPresent = fs.existsSync(onnxConfigJsPath);

// ── MODEL_DIR resolution — same convention as integration.test.mjs ────────
function defaultAppUserDataDir() {
  const appName = 'natively';
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', appName);
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), appName);
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), appName);
}
const modelManagerJsPath = path.join(distElectronRoot, 'audio/whisper/modelManager.js');
const NEMOTRON_MODEL_ID_FALLBACK = 'onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4';
let realCatalogModelId = NEMOTRON_MODEL_ID_FALLBACK;
if (fs.existsSync(modelManagerJsPath)) {
  const { MODEL_CATALOG } = await import(pathToFileURL(modelManagerJsPath).href);
  const entry = MODEL_CATALOG.find((m) => m.sessionLayout === 'nemotron-rnnt');
  if (entry) realCatalogModelId = entry.id;
}
const MODEL_DIR = process.env.NEMOTRON_TEST_MODEL_DIR
  || path.join(defaultAppUserDataDir(), 'whisper-models', realCatalogModelId);
const modelPresent = fs.existsSync(MODEL_DIR);

// The worker computes modelDir as path.join(cacheDir, ...modelId.split('/')).
// dirname/basename always round-trips through path.join back to the exact
// original path, however many segments deep — so this works whether
// MODEL_DIR is the real nested app-cache shape or a flat directory (e.g.
// Task 1's /tmp/nemotron-inspect inspection copy), without needing the
// worker to know or care that this test's "model id" isn't the real catalog
// string. Only used to locate files already on disk — downloadNemotronFiles
// skips network entirely for any file that already exists with size > 0.
const TEST_CACHE_DIR = path.dirname(MODEL_DIR);
const TEST_MODEL_ID = path.basename(MODEL_DIR);

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const FIXTURE_EN = path.join(FIXTURES_DIR, 'known-phrase-16k-mono.wav');
const FIXTURE_DE = path.join(FIXTURES_DIR, 'lang-de-DE.wav');
const KNOWN_PHRASE_EN = 'the quick brown fox jumps over the lazy dog';
// Real phrase + real lang_id=9, already proven to transcribe at 0.75 overlap
// by the multi-language verification round (multilang-verify-report.md) —
// reusing that already-established real evidence rather than re-deriving a
// second fixture's expected accuracy from scratch.
const KNOWN_PHRASE_DE = 'hallo ich heiße anna';
const fixturesPresent = fs.existsSync(FIXTURE_EN) && fs.existsSync(FIXTURE_DE);

function readPcm16Mono(wavPath) {
  const buf = fs.readFileSync(wavPath);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${wavPath} is not a RIFF/WAVE file`);
  }
  let offset = 12;
  let dataStart = -1;
  let dataSize = 0;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === 'data') {
      dataStart = offset + 8;
      dataSize = chunkSize;
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  if (dataStart < 0) throw new Error(`${wavPath}: no 'data' chunk found`);
  const sampleCount = Math.floor(Math.min(dataSize, buf.length - dataStart) / 2);
  const out = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    out[i] = buf.readInt16LE(dataStart + i * 2) / 32768;
  }
  return out;
}

function wordOverlap(text, knownPhrase) {
  const words = knownPhrase.split(' ');
  const hits = words.filter((w) => text.includes(w)).length;
  return hits / words.length;
}

/**
 * Posts a `transcribe` message for one channel and resolves with the
 * matching 'result'/'partial' text, or rejects on a matching 'error' —
 * filtered by BOTH channelId and taskId, mirroring the two-layer filtering
 * LocalWhisperSTT.attachWorkerListeners() itself applies in production.
 */
function transcribeAndWait(worker, channelId, taskId, audio, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.off('message', onMessage);
      reject(new Error(`transcribeAndWait timed out after ${timeoutMs}ms for channel=${channelId} task=${taskId}`));
    }, timeoutMs);
    function onMessage(msg) {
      if (!msg || msg.channelId !== channelId || msg.taskId !== taskId) return;
      if (msg.type === 'result') {
        clearTimeout(timer);
        worker.off('message', onMessage);
        resolve(msg.text);
      } else if (msg.type === 'error') {
        clearTimeout(timer);
        worker.off('message', onMessage);
        reject(new Error(msg.message));
      }
    }
    worker.on('message', onMessage);
    worker.postMessage({
      type: 'transcribe',
      taskId,
      channelId,
      audio,
      language: 'auto',
      streaming: false,
      nemotronReset: true,
    });
  });
}

function readOnnxSemaphore() {
  // Deliberately reads globalThis directly rather than importing
  // onnxThreadConfig.js's own accessor functions for the LIVE counters (no
  // such accessor is exported — by design, see that module's own comment on
  // why the gate is intentionally opaque to ordinary callers). Both
  // sharedWorkerRegistry.js (which inlines onnxThreadConfig.ts per esbuild's
  // per-bundle-entry-point behavior) and this test's own separately-loaded
  // onnxConfigJsPath copy read/write the SAME globalThis key, so this is a
  // real, direct, non-mocked view of the actual semaphore state.
  const g = globalThis;
  return g.__nativelyOnnxSemaphoreV1__ || { inFlightNormal: 0, inFlightHigh: 0 };
}

describe('Dual-channel Nemotron: real worker + real registry', {
  skip: !modelPresent || !fixturesPresent || !registryPresent || !workerPresent || !onnxConfigPresent,
}, () => {
  /** @type {{ acquireSharedNemotronWorker: Function, __resetSharedNemotronWorkerForTests: Function }} */
  let registry;
  /** @type {{ __resetOnnxGateForTests: Function, acquireOnnxSlot: Function }} */
  let onnxConfig;

  before(async () => {
    registry = await import(pathToFileURL(registryJsPath).href);
    onnxConfig = await import(pathToFileURL(onnxConfigJsPath).href);
    onnxConfig.__resetOnnxGateForTests();
    registry.__resetSharedNemotronWorkerForTests();
  });

  after(() => {
    onnxConfig.__resetOnnxGateForTests();
    registry.__resetSharedNemotronWorkerForTests();
  });

  // Shared across the ordered tests below (each builds on the previous
  // one's live state) so the real ~3s model cold-start only happens ONCE
  // for the whole file, matching how a real meeting's two channels share
  // one real load — not an artifact of the test being cheap to fake.
  let channelA; // { worker, channelId, release }
  let channelB;

  test('two channels acquired back-to-back share exactly one ONNX slot acquisition', async () => {
    // Fired WITHOUT awaiting the first before starting the second — the
    // exact "both channels start at meeting-open" race the registry's
    // internal acquireLock exists to serialize correctly. If that lock were
    // missing or broken, both calls could observe no live worker and both
    // cold-start, acquiring the exclusive weight:3 slot twice (or the
    // second would wrongly block/timeout against the first).
    const pA = registry.acquireSharedNemotronWorker(TEST_MODEL_ID, 'test-mic', ['cpu'], TEST_CACHE_DIR, workerJsPath);
    const pB = registry.acquireSharedNemotronWorker(TEST_MODEL_ID, 'test-system', ['cpu'], TEST_CACHE_DIR, workerJsPath);
    [channelA, channelB] = await Promise.all([pA, pB]);

    assert.equal(channelA.worker, channelB.worker, 'both channels must share the exact same Worker object');
    assert.equal(channelA.channelId, 'test-mic');
    assert.equal(channelB.channelId, 'test-system');

    const sem = readOnnxSemaphore();
    assert.equal(sem.inFlightHigh, 3, 'exactly one weight:3 acquisition must be in flight, not two (which would read 6)');
    assert.equal(sem.inFlightNormal, 0);
  });

  test('both channels transcribe concurrently and each gets back its OWN correct transcript', async () => {
    const pcmEn = readPcm16Mono(FIXTURE_EN);
    const pcmDe = readPcm16Mono(FIXTURE_DE);

    // Genuinely concurrent — both promises created before either is awaited,
    // so their underlying worker-side per-channel chains actually overlap in
    // time. If channel routing/engine isolation were broken (e.g. both
    // channels sharing one NemotronEngine, or the lang_id set for one
    // leaking into the other's decode), this is exactly the shape of call
    // that would surface it as either channel's text containing the other's
    // words, or the German channel silently decoding as if it were English
    // (or vice versa).
    const pEn = transcribeAndWait(channelA.worker, 'test-mic', 'en-task', pcmEn);
    const pDe = transcribeAndWait(channelB.worker, 'test-system', 'de-task', pcmDe);
    const [textEn, textDe] = await Promise.all([pEn, pDe]);

    const lowerEn = textEn.trim().toLowerCase();
    const lowerDe = textDe.trim().toLowerCase();
    console.log('Dual-channel EN (test-mic) transcribed:', JSON.stringify(lowerEn));
    console.log('Dual-channel DE (test-system) transcribed:', JSON.stringify(lowerDe));

    const overlapEn = wordOverlap(lowerEn, KNOWN_PHRASE_EN);
    const overlapDe = wordOverlap(lowerDe, KNOWN_PHRASE_DE);
    console.log('EN word overlap vs known phrase:', overlapEn, '· DE word overlap vs known phrase:', overlapDe);

    assert.ok(
      overlapEn >= 0.5,
      `test-mic (English, lang_id defaults to 0) must recognizably transcribe its OWN English audio, got: "${lowerEn}"`,
    );
    assert.ok(
      overlapDe >= 0.4,
      `test-system (German — needs lang_id=9 applied via setLanguage, see below) must recognizably transcribe its OWN German audio, got: "${lowerDe}"`,
    );

    // Direct cross-contamination check, not just "both individually passed
    // their own bar": neither channel's output may contain a hallmark word
    // unique to the OTHER channel's phrase. If the two engines' state (or
    // the worker's channel routing) were cross-wired, this is the check
    // that would catch text bleeding from one channel into the other even
    // if each channel's OWN overlap score happened to still clear its bar.
    assert.ok(!lowerEn.includes('anna') && !lowerEn.includes('heiße'), 'English channel output must not contain German-fixture words');
    assert.ok(!lowerDe.includes('fox') && !lowerDe.includes('lazy'), 'German channel output must not contain English-fixture words');
  });

  test('refcount: releasing one channel does not kill the worker while the other is still live', async () => {
    const worker = channelA.worker;
    channelA.release();
    // release() is synchronous about registry bookkeeping (postMessage +
    // refcount decrement), but does NOT synchronously prove the worker is
    // still alive — confirm via a real functional check, not just "no
    // 'exit' event fired yet".
    const sem = readOnnxSemaphore();
    assert.equal(sem.inFlightHigh, 3, 'the ONNX slot must NOT be released while channel B is still using the shared worker');
    assert.equal(channelB.worker, worker, 'channel B must still be pointed at the SAME live worker');

    const pcmEn = readPcm16Mono(FIXTURE_EN);
    const text = await transcribeAndWait(channelB.worker, 'test-system', 'post-release-task', pcmEn);
    // Channel B's own engine still has lang_id=0 default cache-state from
    // its earlier German run's `reset()` — feed it English audio and expect
    // it to work (proves the worker + channel B's engine are still
    // genuinely alive and responsive, not merely "didn't throw").
    console.log('Post-release channel B transcribed:', JSON.stringify(text));
    assert.ok(text.trim().length > 0, 'channel B must still produce real, non-empty output after channel A released');
  });

  test('refcount: releasing the LAST channel actually terminates the worker and frees the ONNX slot', async () => {
    const worker = channelB.worker;
    let exited = false;
    worker.once('exit', () => { exited = true; });

    channelB.release();

    await new Promise((resolve) => {
      const check = () => (exited ? resolve() : setImmediate(check));
      check();
    });
    assert.ok(exited, 'the shared worker must actually exit once the last channel releases it');

    const sem = readOnnxSemaphore();
    assert.equal(sem.inFlightHigh, 0, 'the ONNX slot must be fully released once the worker is gone');

    // Not just "the counter reads 0" — prove the slot is REALLY free by
    // acquiring it again for real and confirming it resolves promptly
    // (a still-held slot would hang here, since weight:3 > cap runs in
    // exclusive mode and only admits when nothing else is in flight).
    const slotRelease = await Promise.race([
      onnxConfig.acquireOnnxSlot('high', 3),
      new Promise((_, reject) => setTimeout(() => reject(new Error('acquireOnnxSlot did not resolve promptly — slot was not really freed')), 3000)),
    ]);
    assert.equal(typeof slotRelease, 'function');
    slotRelease();
  });

  test('a worker crash while both channels are live is visible to a listener on the shared worker, and a fresh acquire recovers', async () => {
    registry.__resetSharedNemotronWorkerForTests();
    onnxConfig.__resetOnnxGateForTests();

    const pA = registry.acquireSharedNemotronWorker(TEST_MODEL_ID, 'crash-a', ['cpu'], TEST_CACHE_DIR, workerJsPath);
    const pB = registry.acquireSharedNemotronWorker(TEST_MODEL_ID, 'crash-b', ['cpu'], TEST_CACHE_DIR, workerJsPath);
    const [crashChannelA, crashChannelB] = await Promise.all([pA, pB]);
    assert.equal(crashChannelA.worker, crashChannelB.worker);

    // Each real LocalWhisperSTT instance attaches its OWN 'exit' listener
    // directly on the shared worker object (attachWorkerListeners(), not
    // simulated here) — this proves the underlying assumption this whole
    // design leans on: Node's EventEmitter really does deliver one event to
    // every attached listener, not just the first/most-recent one.
    let aSawExit = false;
    let bSawExit = false;
    crashChannelA.worker.once('exit', () => { aSawExit = true; });
    crashChannelB.worker.once('exit', () => { bSawExit = true; });

    // Simulate an unexpected crash (NOT initiated via release()) — a raw
    // terminate() on the worker object itself, bypassing the registry
    // entirely, is a faithful stand-in for a real native ONNX/worker crash
    // from the outside: neither LocalWhisperSTT instance nor the registry
    // asked for this.
    crashChannelA.worker.terminate();

    await new Promise((resolve) => {
      const check = () => (aSawExit && bSawExit ? resolve() : setImmediate(check));
      check();
    });
    assert.ok(aSawExit && bSawExit, 'both channels\' own listeners on the shared worker must see the crash');

    // Give the registry's own listener (attached once at cold-start,
    // separate from the two `.once('exit', ...)` above) a tick to run its
    // reset — it's on the SAME 'exit' event, so it fires in the same
    // microtask batch, but await a real semaphore-state settle rather than
    // assuming ordering.
    await new Promise((resolve) => setImmediate(resolve));
    const sem = readOnnxSemaphore();
    assert.equal(sem.inFlightHigh, 0, 'the registry must reset its own state (and free the slot) on an unexpected crash, not just on release()');

    // The real proof this doesn't get stuck: a FRESH acquire, for a new
    // channel, must cold-start a genuinely NEW worker rather than hanging
    // on stale registry state pointing at the now-dead worker.
    const recovered = await Promise.race([
      registry.acquireSharedNemotronWorker(TEST_MODEL_ID, 'recovered-channel', ['cpu'], TEST_CACHE_DIR, workerJsPath),
      new Promise((_, reject) => setTimeout(() => reject(new Error('acquireSharedNemotronWorker did not recover after a crash — stale registry state')), 15000)),
    ]);
    assert.notEqual(recovered.worker, crashChannelA.worker, 'the recovered worker must be a genuinely NEW Worker instance, not the dead one');
    recovered.release();
    await new Promise((resolve) => {
      const check = () => (readOnnxSemaphore().inFlightHigh === 0 ? resolve() : setImmediate(check));
      check();
    });
  });
});

if (!modelPresent) {
  test('Dual-channel Nemotron test skipped: model dir not found', () => {
    console.log(`[dualChannel.test.mjs] MODEL_DIR ${MODEL_DIR} does not exist — skipping real dual-channel test.`);
  });
}
if (!fixturesPresent) {
  test('Dual-channel Nemotron test skipped: fixture WAV(s) not found', () => {
    console.log(`[dualChannel.test.mjs] ${FIXTURE_EN} / ${FIXTURE_DE} — one or both missing.`);
  });
}
if (!registryPresent || !workerPresent || !onnxConfigPresent) {
  test('Dual-channel Nemotron test skipped: dist-electron build not found', () => {
    console.log('[dualChannel.test.mjs] run `npm run build:electron` first.');
  });
}
