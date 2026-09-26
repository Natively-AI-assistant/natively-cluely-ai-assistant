// electron/audio/__tests__/NemotronLanguageFailClosed2026_08_12.test.mjs
//
// Task 12: LocalWhisperSTT.setRecognitionLanguage() wires Nemotron's
// language selection through to NemotronEngine.setLanguage() via a resolved
// lang_id (see electron/audio/whisper/nemotron/languageTable.ts). Two real
// bugs were found and fixed while wiring this, both landmines that a later
// "simplification" could silently reintroduce with no other test catching
// it — this file pins both directly, following the same
// compiled-JS/private-field access pattern as
// NemotronDeltaDispatch2026_08_10.test.mjs (LocalWhisperSTT can't be driven
// end-to-end here without a real worker / downloaded model).
//
// Bug 1 (fail-closed synchronous emit): createSTTProvider() (main.ts) calls
// setRecognitionLanguage() SYNCHRONOUSLY at construction time, before
// stt.on('error', ...) is wired a few lines later in the same synchronous
// function. An unmapped locale's fail-closed path previously would have
// emitted 'error' synchronously right there — with zero listeners attached
// yet, Node's EventEmitter throws on an unhandled 'error' event, crashing
// STT provider creation. Fixed by deferring the emit one tick via
// setImmediate(). This test proves the synchronous call never throws, even
// with no listener attached at call time.
//
// Bug 2 ('auto' fail-closed): 'auto' ("Auto Detect") is a real,
// user-selectable RECOGNITION_LANGUAGES entry (electron/config/languages.ts)
// — an earlier assumption that this app "never sends Nemotron literal auto"
// was wrong. Nemotron has no real auto-detect mode, so this must follow the
// same precedent AppState.setRecognitionLanguage already applies for every
// other non-NativelyProSTT provider: normalize 'auto' -> 'english-us'
// (lang_id 0), not fail closed. Without this fix, any user who previously
// picked "Auto Detect" would hit the fail-closed path on every app launch
// while on the Nemotron model (createSTTProvider reads the persisted
// language RAW, unlike the runtime 'set-recognition-language' IPC path,
// which does normalize 'auto').
//
// Run: npm test (globs electron/audio/__tests__/**/*.test.mjs), or directly:
// ELECTRON_RUN_AS_NODE=1 electron --test electron/audio/__tests__/NemotronLanguageFailClosed2026_08_12.test.mjs

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import os from 'os';
import Module from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// LocalWhisperSTT pulls in `electron` transitively via modelManager /
// modelPreloader for getModelsDir() / app.getPath('userData').
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nemotron-lang-failclosed-'));
const origLoad = Module._load;
Module._load = function patched(request, _p, _m) {
  if (request === 'electron') {
    return {
      app: {
        getPath: (k) => (k === 'userData' ? userData : os.tmpdir()),
        isReady: () => true,
      },
    };
  }
  return origLoad.apply(this, arguments);
};

const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');
const { LocalWhisperSTT } = await import(
  pathToFileURL(path.join(distRoot, 'LocalWhisperSTT.js')).href
);

const NEMOTRON_MODEL_ID = 'onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('Nemotron language selection fail-closed behaviour (Task 12)', () => {
  let lws;

  afterEach(() => {
    lws = undefined;
  });

  test('setRecognitionLanguage("english-us") resolves nemotronLangId to 0 (matches NemotronEngine DEFAULT_LANG_ID)', () => {
    lws = new LocalWhisperSTT(NEMOTRON_MODEL_ID);
    lws.setRecognitionLanguage('english-us');
    assert.equal(lws['nemotronLangId'], 0);
  });

  test('setRecognitionLanguage("russian") resolves nemotronLangId to 11 (ru-RU)', () => {
    lws = new LocalWhisperSTT(NEMOTRON_MODEL_ID);
    lws.setRecognitionLanguage('russian');
    assert.equal(lws['nemotronLangId'], 11);
  });

  test('an unmapped locale does NOT throw synchronously even with no "error" listener attached yet', async () => {
    // Reproduces createSTTProvider()'s real ordering (main.ts): the
    // constructor + setRecognitionLanguage() call happen before
    // stt.on('error', ...) is wired. A synchronous emit('error', ...) here
    // with zero listeners would throw per Node's EventEmitter contract.
    lws = new LocalWhisperSTT(NEMOTRON_MODEL_ID);
    assert.doesNotThrow(() => {
      lws.setRecognitionLanguage('chinese'); // bcp47 'zh-CN', not in the 19-locale table
    }, 'BUG REGRESSION: fail-closed path must defer its error emit (e.g. via setImmediate), not emit synchronously — an unmapped locale must never crash STT provider construction.');
    // The deferred emit still fires ~1 tick later (proven by the next test) —
    // attach a listener here too so it doesn't surface as an unhandled
    // 'error' / uncaughtException against THIS test's own process-wide
    // listener once the setImmediate callback runs after this test body
    // returns.
    lws.on('error', () => {});
    await sleep(50);
  });

  test('an unmapped locale eventually emits a deferred "error" and leaves nemotronLangId at its previous value', async () => {
    lws = new LocalWhisperSTT(NEMOTRON_MODEL_ID);
    lws.setRecognitionLanguage('chinese');
    const errorMessage = await new Promise((resolve) => {
      lws.on('error', (err) => resolve(err.message));
      setTimeout(() => resolve(null), 500);
    });
    assert.ok(errorMessage, 'expected a deferred "error" event for an unmapped locale');
    assert.match(errorMessage, /chinese/);
    assert.match(errorMessage, /not in the transcription-ready set/);
    assert.equal(lws['nemotronLangId'], 0, 'fail-closed: must keep the previous (default) lang_id, not silently fall back or corrupt state');
  });

  test('"auto" normalizes to English (lang_id 0), does NOT trigger the fail-closed path', async () => {
    // Regression for the specific bug found during Task 12 review: 'auto' IS
    // a real, selectable RECOGNITION_LANGUAGES entry, not an impossible
    // input — must be normalized to 'english-us' before table lookup, the
    // same precedent AppState.setRecognitionLanguage already applies for
    // every other non-NativelyProSTT provider.
    lws = new LocalWhisperSTT(NEMOTRON_MODEL_ID);
    let errored = false;
    lws.on('error', () => { errored = true; });
    lws.setRecognitionLanguage('auto');
    await sleep(200);
    assert.equal(lws['nemotronLangId'], 0, 'BUG REGRESSION: "auto" must resolve to English (lang_id 0), not fail closed.');
    assert.equal(errored, false, 'BUG REGRESSION: "auto" must not emit a fail-closed error — it is a real, always-possible input, not an out-of-tier locale.');
  });

  test('a non-Nemotron model never runs the Nemotron language resolution path at all', async () => {
    lws = new LocalWhisperSTT('Xenova/whisper-tiny.en');
    let errored = false;
    lws.on('error', () => { errored = true; });
    lws.setRecognitionLanguage('chinese'); // would be unmapped for Nemotron; irrelevant here
    await sleep(200);
    assert.equal(errored, false, 'BUG REGRESSION: a non-Nemotron model must never run the Nemotron fail-closed language path.');
    assert.equal(lws['nemotronLangId'], 0, 'field stays at its unused default — resolveAndApplyNemotronLanguage() must never run for a non-Nemotron model');
  });
});
