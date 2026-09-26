// electron/audio/__tests__/LocalSttMemoryRefusalTerminal2026_09_21.test.mjs
//
// Live-reproduced 2026-09-21 (real worker harness, both channels,
// NATIVELY_ONNX_AVAILABLE_MEM_GB=1.5): when available memory is under the ONNX
// floor, spawnWorker refuses with a BARE Error. main.ts files a bare local-STT
// error under "retryable" -> stt-status 'reconnecting' with attempts=1. The
// instance has already torn itself down and nothing restarts a LocalWhisperSTT,
// so no further error and no transcript ever arrives: the overlay reads
// "STT reconnecting" for the whole meeting while nothing is reconnecting.
//
// The three other start failures (no ONNX slot, model never ready, model files
// missing/corrupt) already carry LOCAL_STT_UNAVAILABLE_CODE, which main.ts
// classifies as 'failed' with the actionable message. The memory refusal was
// the one start failure left out. This EXECUTES the refusal (no source grep)
// on both branches that can raise it: the standard cold path and Nemotron.
//
// Platform note: the refusal branch is platform-independent. Only the memory
// MEASUREMENT differs per OS (vm_stat on darwin, os.freemem() on win32), and it
// is forced here through the documented env override, so this exercises the
// same code a macOS and a Windows user would hit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import os from 'os';
import Module from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.NATIVELY_ONNX_AVAILABLE_MEM_GB = '0.1';
process.env.NATIVELY_ONNX_MIN_FREE_GB = '8';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-memrefusal-'));
const origLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') {
    return { app: { getPath: (k) => (k === 'userData' ? userData : os.tmpdir()), isReady: () => true } };
  }
  return origLoad.apply(this, arguments);
};

const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');
const { LocalWhisperSTT, LOCAL_STT_UNAVAILABLE_CODE } = await import(
  pathToFileURL(path.join(distRoot, 'LocalWhisperSTT.js')).href
);

const tick = () => new Promise((r) => setTimeout(r, 25));

async function refuse(modelId) {
  const lws = new LocalWhisperSTT(modelId);
  const errors = [];
  lws.on('error', (e) => errors.push(e));
  lws.start();
  await tick();
  await tick();
  return { lws, errors };
}

for (const [label, modelId] of [
  ['standard cold path', 'Xenova/whisper-tiny.en'],
  ['Nemotron shared-worker path', 'onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4'],
]) {
  test(`${label}: a memory refusal is TERMINAL, not "reconnecting"`, async () => {
    const { lws, errors } = await refuse(modelId);
    assert.equal(errors.length, 1, 'exactly one error event');
    assert.equal(LOCAL_STT_UNAVAILABLE_CODE, 'local_stt_unavailable');
    assert.equal(
      errors[0].code,
      LOCAL_STT_UNAVAILABLE_CODE,
      'BUG: a bare Error is filed by main.ts as retryable, so the overlay shows "STT reconnecting" for the whole meeting',
    );
    assert.equal(lws['isActive'], false, 'the instance must still tear down cleanly');
  });

  test(`${label}: the message says what happened and what to do, for either OS`, async () => {
    const { errors } = await refuse(modelId);
    const msg = String(errors[0].message);
    // Existing contract (LocalWhisperSpawnFailTeardown2026_07_10) — keep the phrase.
    assert.match(msg, /insufficient available memory/i);
    assert.match(msg, /close other apps|smaller local model|cloud STT provider/i, 'must be actionable');
    // A local engine has no network: never send the user to check a connection,
    // and never name one OS's tools to the other OS's user.
    assert.doesNotMatch(msg, /internet|network|reconnect/i);
    assert.doesNotMatch(msg, /Activity Monitor|Task Manager|System Settings|Control Panel/i);
    // sttErrorMapper titles anything containing "unavailable" as
    // "Service Unavailable ... Trying to reconnect" — the exact lie this fixes.
    assert.doesNotMatch(msg, /unavailable/i);
  });
}
