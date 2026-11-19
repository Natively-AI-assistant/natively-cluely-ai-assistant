// Local Whisper with a user dictionary is prompted with "Glossary: A, B, C."
// and, like the cloud Whisper paths, returns that prompt for audio with no
// speech in it. RestSTT and OpenAIStreamingSTT dropped the echo; LocalWhisperSTT
// emitted it as a transcript line (2026-11-18).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import os from 'os';
import Module from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-glossary-echo-'));
const origLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') {
    return { app: { getPath: (k) => (k === 'userData' ? userData : os.tmpdir()), isReady: () => true } };
  }
  return origLoad.apply(this, arguments);
};

const { LocalWhisperSTT } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/audio/LocalWhisperSTT.js')).href
);

test('a final that only repeats the glossary prompt is dropped; real speech is kept', () => {
  const lws = new LocalWhisperSTT('Xenova/whisper-tiny.en');
  lws.contextPromptSentToWorker = 'Glossary: Natively, Kubernetes.';
  assert.equal(lws.cleanResult('Glossary: Natively, Kubernetes.'), '');
  assert.equal(lws.cleanResult('Glossary, Natively.'), '');
  assert.equal(lws.cleanResult('We deploy Natively on Kubernetes.'), 'We deploy Natively on Kubernetes.');
});

test('without a prompt nothing is treated as an echo', () => {
  const lws = new LocalWhisperSTT('Xenova/whisper-tiny.en');
  assert.equal(lws.cleanResult('Glossary: Natively.'), 'Glossary: Natively.');
});
