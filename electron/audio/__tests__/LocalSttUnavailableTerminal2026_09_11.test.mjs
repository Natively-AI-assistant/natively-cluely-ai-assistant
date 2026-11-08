// electron/audio/__tests__/LocalSttUnavailableTerminal2026_09_11.test.mjs
//
// Review finding (2026-09-11): a local STT worker that cannot start (no ONNX
// slot within 20s, or the model never reported ready) used to be classified by
// main's stt.on('error') as a retryable blip — the overlay then showed "STT
// reconnecting" for the rest of the meeting on a channel nothing restarts, and
// the actionable message never surfaced. Also pinned: the mic provider's
// finalize() result travels to the renderer so the Answer/Stop tail wait can
// keep the gate open for a local model's multi-second final, and a capture
// whose Rust thread exited retires its monitor so a later start() cannot hit
// "Capture already running".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(dirname, rel), 'utf8');
const main = read('../../main.ts');
const ipc = read('../../ipcHandlers.ts');
const preload = read('../../preload.ts');
const capture = read('../SystemAudioCapture.ts');
const whisper = read('../LocalWhisperSTT.ts');

test('main classifies local_stt_unavailable as terminal (failed), not reconnecting', async () => {
  // Classification moved to sttErrorClassifier.mjs (2026-11-01).
  const { classifySttError } = await import(new URL('../sttErrorClassifier.mjs', import.meta.url).href);
  assert.equal(classifySttError(Object.assign(new Error('x'), { code: 'local_stt_unavailable' })).kind, 'local_unavailable');
  assert.match(main, /const isLocalSttUnavailable = verdict\.kind === 'local_unavailable';/);
  assert.match(main, /if \(isAuthError \|\| isLocalSttUnavailable\) \{/);
  assert.match(whisper, /export const LOCAL_STT_UNAVAILABLE_CODE = 'local_stt_unavailable';/);
});

test("finalizeMicSTT's pending report reaches the renderer end to end", () => {
  assert.match(main, /public finalizeMicSTT\(\): \{ pending: boolean \}/);
  assert.match(main, /return \{ pending: r === true \};/);
  assert.match(ipc, /safeHandle\('finalize-mic-stt', async \(\) => \{\n    return appState\.finalizeMicSTT\(\);/);
  assert.match(preload, /finalizeMicSTT: \(\) => Promise<\{ pending: boolean \} \| void>;/);
});

test('a callback error retires the finished native monitor and publishes the teardown promise', () => {
  const branch = capture.slice(capture.indexOf("console.error('[SystemAudioCapture] Callback error:', err);"), capture.indexOf("this.emit('error', err);"));
  assert.match(branch, /this\.monitor = null;/, 'BUG: a later start() on the same instance would throw "Capture already running"');
  assert.match(branch, /dying\.stop\(\)/);
  assert.match(branch, /this\._teardownPromise = retire;/, 'destroy() must still await the native release (F-104)');
});

// 2026-09-21, reproduced live: a profile whose selected local model was missing
// (then: present but incomplete, so the app purged it) sat on "STT reconnecting"
// for the whole meeting. Both messages are ACTIONABLE and TERMINAL — "download /
// reinstall the model in Settings → Audio" — and nothing restarts a
// LocalWhisperSTT, yet the model-load-failure branch emitted a bare Error, so
// main filed it under "retryable" (1 of 5 errors, forever). The helper that
// exists for exactly this case was simply not applied there.
test('a model that is missing / was purged / is unsupported fails TERMINALLY, not "reconnecting"', () => {
  // The three hand-written messages became one classifier (whisper/loadFailure.ts)
  // on 2026-10-14. What must not regress is unchanged: EVERY load failure leaves
  // LocalWhisperSTT through markLocalSttUnavailable, on both paths that can see one.
  const helper = whisper.slice(whisper.indexOf('private modelLoadFailure(message: string): Error {'));
  assert.ok(helper.length > 0 && helper.length < whisper.length, 'fixture: modelLoadFailure moved');
  const body = helper.slice(0, helper.indexOf('\n    }\n'));
  assert.match(body, /return markLocalSttUnavailable\(new Error\(describeLocalModelLoadFailure\(/, 'BUG: the pill reads "STT reconnecting" forever instead of "STT needs attention" + the message');
  // The worker-message path (every model) and the shared-worker path (Nemotron).
  assert.match(whisper, /this\.emit\('error', this\.modelLoadFailure\(msg\.message\)\);/);
  assert.match(whisper, /throw this\.modelLoadFailure\(message\);/);
  const loadFailure = read('../whisper/loadFailure.ts');
  // The macOS sentence moved to onnxMacSupport.ts (one copy for every gate, 2026-10-21).
  assert.match(loadFailure, /return ONNX_MAC_UNSUPPORTED_MESSAGE;/);
  for (const msg of ['incomplete and have been removed', 'could not be loaded']) {
    assert.ok(loadFailure.includes(msg), `the terminal message must still exist: ${msg}`);
  }
});

