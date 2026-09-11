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

test('main classifies local_stt_unavailable as terminal (failed), not reconnecting', () => {
  assert.match(main, /const isLocalSttUnavailable = \(err as any\)\?\.code === 'local_stt_unavailable';/);
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
