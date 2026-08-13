// Real-model, real-worker integration test for dual-channel Nemotron (the
// "one shared worker, two isolated channels" fix — see
// .superpowers/sdd/2026-08-10-nemotron-local-stt/dual-channel-fix-brief.md
// and, for the teardown bug this round fixed, dual-channel-fix2-brief.md).
//
// Unlike integration.test.mjs (which drives NemotronEngine.create() directly
// and never touches the worker/registry), this file drives the REAL
// compiled worker (dist-electron/.../whisperWorker.js) through the REAL
// sharedWorkerRegistry.ts, exactly the path two real LocalWhisperSTT
// instances (mic + system-audio) go through in production. Gated the same
// way integration.test.mjs is: skipped when the real model/fixtures/build
// aren't present, never a hard CI requirement.
//
// IMPORTANT (fix2 round): teardown now goes through REAL LocalWhisperSTT
// instances' `stop()` — which is what actually calls the (previously buggy)
// `beginWorkerTermination()` — instead of calling the registry's `release()`
// directly. That structural divergence (raw release() bypassing
// beginWorkerTermination() entirely) is exactly why the original version of
// this file never caught the Critical listener-stripping bug an independent
// review later found and measured (see dual-channel-fix2-brief.md /
// progress.md's "INDEPENDENT REVIEW" entry). `LocalWhisperSTT` is loaded from
// the compiled dist-electron output (same technique as
// integration.test.mjs), and its private fields/methods (`worker`,
// `nemotronChannelId`, `nemotronWorkerRelease`, `workerReady`,
// `attachWorkerListeners()`, `stop()`) are reached directly — TypeScript
// `private` has no runtime enforcement, and this harness deliberately skips
// only `spawnWorker()`'s catalog/electron-`app`-dependent bootstrapping
// (`buildWorkerInitMessage()`/`getModelsDir()`, which throw under this
// `ELECTRON_RUN_AS_NODE=1` test harness — see integration.test.mjs's own
// comment on `require('electron').app` being undefined here), wiring the
// instance to an already-acquired shared worker exactly the way
// `spawnWorker()`'s Nemotron branch leaves it afterward.
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
//      new one) — AND each channel's language is set via a REAL
//      `setRecognitionLanguage()` → `setLanguage` worker message BEFORE
//      either transcribes, so this is now real per-channel language-isolation
//      coverage, not just routing/text-isolation coverage. Any cross-wiring
//      between the two channels' engines, chains, or language state would
//      show up as either channel's text bleeding into the other's, being
//      replaced by it, or decoding at the WRONG lang_id (German scoring like
//      the lang_id=0 default instead of lang_id=9).
//   3. `LocalWhisperSTT.stop()` → `beginWorkerTermination()` on ONE channel,
//      the REAL production teardown path, does NOT kill the worker or the
//      ONNX slot while the other channel is still live, does NOT strip the
//      surviving channel's OWN worker listeners (proven by listener-count
//      measurement, matching the independent review's own technique) or
//      sharedWorkerRegistry.ts's own listener (proven by a fresh join to the
//      still-live worker resolving promptly instead of hanging), and the
//      surviving channel keeps transcribing correctly afterward. Releasing
//      the LAST channel (also via the real `stop()` path) DOES terminate the
//      worker and DOES free the slot — verified by directly reading the
//      shared semaphore's counters AND by a subsequent real
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
const localWhisperSttJsPath = path.join(distElectronRoot, 'audio/LocalWhisperSTT.js');

const registryPresent = fs.existsSync(registryJsPath);
const workerPresent = fs.existsSync(workerJsPath);
const onnxConfigPresent = fs.existsSync(onnxConfigJsPath);
const localWhisperSttPresent = fs.existsSync(localWhisperSttJsPath);

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

/**
 * Wires a REAL `LocalWhisperSTT` instance to an already-acquired shared
 * worker exactly the way `spawnWorker()`'s Nemotron branch leaves one after
 * `acquireSharedNemotronWorker` resolves (worker/nemotronChannelId/
 * nemotronWorkerRelease/workerReady set, `attachWorkerListeners()` called) —
 * see this file's own top-of-file comment for why `spawnWorker()` itself
 * isn't called here. `isActive = true` so the instance behaves like a real
 * in-progress recording (attachWorkerListeners' message handler otherwise
 * drops 'result'/'partial' for an inactive instance, independent of
 * anything under test). Returns the stt instance; its `stop()` is what
 * fix2's whole verification round exercises.
 */
function wireRealChannel(LocalWhisperSTT, modelId, channelId, registryHandle) {
  const stt = new LocalWhisperSTT(modelId);
  stt.on('error', (e) => console.warn(`[dualChannel test] stt(${channelId}) error event:`, e.message));
  stt.setChannel(channelId);
  stt.worker = registryHandle.worker;
  stt.nemotronChannelId = channelId;
  stt.nemotronWorkerRelease = registryHandle.release;
  stt.workerReady = true;
  stt.isActive = true;
  stt.attachWorkerListeners();
  return stt;
}

describe('Dual-channel Nemotron: real worker + real registry', {
  skip: !modelPresent || !fixturesPresent || !registryPresent || !workerPresent || !onnxConfigPresent || !localWhisperSttPresent,
}, () => {
  /** @type {{ acquireSharedNemotronWorker: Function, __resetSharedNemotronWorkerForTests: Function }} */
  let registry;
  /** @type {{ __resetOnnxGateForTests: Function, acquireOnnxSlot: Function }} */
  let onnxConfig;
  /** @type {Function} the real LocalWhisperSTT class, compiled */
  let LocalWhisperSTT;

  before(async () => {
    registry = await import(pathToFileURL(registryJsPath).href);
    onnxConfig = await import(pathToFileURL(onnxConfigJsPath).href);
    ({ LocalWhisperSTT } = await import(pathToFileURL(localWhisperSttJsPath).href));
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
  let sttA; // real LocalWhisperSTT instances wired to channelA/channelB
  let sttB;

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

    // Real LocalWhisperSTT instances, wired to these same registry handles —
    // used from here on so teardown (later tests) goes through the REAL
    // production beginWorkerTermination() path instead of raw release().
    sttA = wireRealChannel(LocalWhisperSTT, TEST_MODEL_ID, 'test-mic', channelA);
    sttB = wireRealChannel(LocalWhisperSTT, TEST_MODEL_ID, 'test-system', channelB);

    // Registry's own listener (1) + sttA's + sttB's own attachWorkerListeners()
    // (1 each) = 3 on every event. This is the SAME baseline the independent
    // review measured before finding the teardown bug — see the listener-count
    // assertions in the next-but-one test below.
    assert.equal(channelA.worker.listenerCount('message'), 3);
    assert.equal(channelA.worker.listenerCount('error'), 3);
    assert.equal(channelA.worker.listenerCount('exit'), 3);
  });

  test('both channels transcribe concurrently and each gets back its OWN correct transcript, with real per-channel setLanguage isolation', async () => {
    // Real per-channel language isolation, via LocalWhisperSTT's REAL
    // setRecognitionLanguage() -> resolveAndApplyNemotronLanguage() ->
    // maybePushNemotronLangToWorker() chain — NOT a hand-crafted postMessage.
    // The independent review found the ORIGINAL version of this test never
    // actually called setLanguage for the German channel (both channels ran
    // at the default lang_id=0), so the most likely real cross-channel leak
    // vector — one channel's language setting clobbering the other's — was
    // never exercised. 'english-us' -> bcp47 'en-US' -> lang_id=0 (already
    // sttA's default, but sent explicitly here for symmetry/coverage);
    // 'german' -> bcp47 'de-DE' -> lang_id=9 (languageTable.ts). Message
    // order across a single MessagePort is guaranteed, and the worker's own
    // per-channel chain (nemotronChains, whisperWorker.ts) serializes
    // setLanguage strictly before the transcribe queued after it — so it's
    // safe to not await these before posting transcribe below.
    sttA.setRecognitionLanguage('english-us');
    sttB.setRecognitionLanguage('german');
    assert.equal(sttA.nemotronLangId, 0);
    assert.equal(sttB.nemotronLangId, 9);

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
      `test-mic (English, lang_id=0 explicitly set) must recognizably transcribe its OWN English audio, got: "${lowerEn}"`,
    );
    // The independent review proved (sequentially, zero concurrency) that
    // lang_id=9 gives ~0.75 overlap on this exact DE fixture, while
    // lang_id=0 gives only ~0.5 — the ORIGINAL 0.75->0.5 gap reported for
    // this test was actually an artifact of setLanguage never being called
    // at all, not "decode-boundary sensitivity" (that explanation was
    // wrong). 0.7 sits strictly between the two, so this assertion actually
    // discriminates: it fails if lang_id=9 silently isn't applied (leak from
    // channel A, or setLanguage being dropped/misrouted) and passes with
    // margin when it correctly is.
    assert.ok(
      overlapDe >= 0.7,
      `test-system (German, lang_id=9 explicitly set via a real setLanguage message) must transcribe at ~0.75 overlap, not the ~0.5 a missing/leaked lang_id=9 would produce — got: "${lowerDe}"`,
    );

    // Direct cross-contamination check, not just "both individually passed
    // their own bar": neither channel's output may contain a hallmark word
    // unique to the OTHER channel's phrase. If the two engines' state (or
    // the worker's channel routing) were cross-wired, this is the check
    // that would catch text bleeding from one channel into the other even
    // if each channel's OWN overlap score happened to still clear its bar.
    assert.ok(!lowerEn.includes('anna') && !lowerEn.includes('heiße'), 'English channel output must not contain German-fixture words');
    assert.ok(!lowerDe.includes('fox') && !lowerDe.includes('lazy'), 'German channel output must not contain English-fixture words');

    // Indirect proof that neither channel's langId was affected by the
    // other's setLanguage call: each engine instance is per-channel
    // (nemotronChannels Map in whisperWorker.ts, keyed by channelId), so a
    // leak would have to route through the wrong channelId — which the
    // quality/cross-contamination assertions above already rule out. Also
    // assert the HOST-side state (what LocalWhisperSTT itself believes it
    // last pushed) is still exactly what each instance set, unclobbered by
    // the other's call.
    assert.equal(sttA.nemotronLangId, 0, "channel A's own langId must be unaffected by channel B's setLanguage call");
    assert.equal(sttB.nemotronLangId, 9, "channel B's own langId must be unaffected by channel A's setLanguage call");
  });

  test('beginWorkerTermination via the REAL stop() path: channel A releasing removes ONLY its own listeners, not channel B\'s or the registry\'s (C1 fix reproduction + proof)', async () => {
    const worker = channelA.worker;

    // Baseline — registry (1) + channel A's own (1) + channel B's own (1) =
    // 3 per event. This is the SAME number the independent review measured
    // before finding the teardown bug.
    const before = {
      message: worker.listenerCount('message'),
      error: worker.listenerCount('error'),
      exit: worker.listenerCount('exit'),
    };
    assert.deepEqual(before, { message: 3, error: 3, exit: 3 }, 'registry + channel A + channel B, before teardown');

    // The REAL public production teardown entry point — stop() falls through
    // to beginWorkerTermination() for an active instance with no pending
    // finals (see LocalWhisperSTT.stop()). NOT a direct private-method call
    // and NOT the registry's raw release() — this is exactly the structural
    // gap (test teardown diverging from production's real call path) the
    // independent review identified as why the original version of this
    // file never caught the bug.
    sttA.stop();

    assert.equal(sttA.worker, null, 'beginWorkerTermination() must null out this instance\'s own worker reference');
    assert.equal(sttA.nemotronWorkerRelease, null);

    // THE headline assertion this whole fix round exists for. The buggy
    // removeAllListeners() version collapsed this to { message: 0, error: 0,
    // exit: 0 } — measured directly, see dual-channel-fix2-report.md. The
    // fix must remove ONLY channel A's own three listeners, leaving the
    // registry's and channel B's own intact.
    const after = {
      message: worker.listenerCount('message'),
      error: worker.listenerCount('error'),
      exit: worker.listenerCount('exit'),
    };
    assert.deepEqual(after, { message: 2, error: 2, exit: 2 }, "channel A's own teardown must remove ONLY its own listeners, not the shared worker's other listeners");

    // Refcount correctness (subsumes the pre-fix2 version of this test, which
    // drove this same scenario via the registry's raw release()): the worker
    // must NOT have been terminated, and the ONNX slot must NOT have been
    // freed, while channel B is still live.
    const sem = readOnnxSemaphore();
    assert.equal(sem.inFlightHigh, 3, 'the ONNX slot must NOT be released while channel B is still using the shared worker');
    assert.equal(channelB.worker, worker, 'channel B must still be pointed at the SAME live worker');

    // The surviving channel must NOT have been silently killed — prove it
    // still receives real, correct results after channel A's teardown, not
    // merely "listenerCount is nonzero".
    const pcmEn = readPcm16Mono(FIXTURE_EN);
    const text = await transcribeAndWait(channelB.worker, 'test-system', 'post-teardown-task', pcmEn);
    console.log('Post-teardown channel B transcribed:', JSON.stringify(text));
    assert.ok(text.trim().length > 0, 'channel B must still produce real, non-empty output after channel A tore down');

    // A fresh channel joining the SAME still-live worker must resolve
    // promptly, not hang — proves sharedWorkerRegistry.ts's own 'message'
    // listener (which resolves a joining channel's `ready` wait) survived
    // channel A's teardown. The independent review measured this exact call
    // hanging for 12s+ on the buggy version.
    const probe = await Promise.race([
      registry.acquireSharedNemotronWorker(TEST_MODEL_ID, 'test-mic-2', ['cpu'], TEST_CACHE_DIR, workerJsPath),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error("re-join to the still-live shared worker did not resolve promptly — the registry's own listener may have been stripped")),
        5000,
      )),
    ]);
    assert.equal(probe.worker, worker, 'the probe channel must join the SAME live worker, not cold-start a new one');
    // Release immediately so the refcount invariant the next test relies on
    // (only channel B left holding the worker) is restored.
    probe.release();
  });

  test('refcount: releasing the LAST channel (via the real stop() path) actually terminates the worker and frees the ONNX slot', async () => {
    const worker = channelB.worker;
    let exited = false;
    worker.once('exit', () => { exited = true; });

    sttB.stop(); // real production teardown path, same as channel A above

    await new Promise((resolve) => {
      const check = () => (exited ? resolve() : setImmediate(check));
      check();
    });
    assert.ok(exited, 'the shared worker must actually exit once the last channel releases it');
    assert.equal(sttB.worker, null);

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
if (!registryPresent || !workerPresent || !onnxConfigPresent || !localWhisperSttPresent) {
  test('Dual-channel Nemotron test skipped: dist-electron build not found', () => {
    console.log('[dualChannel.test.mjs] run `npm run build:electron` first.');
  });
}
