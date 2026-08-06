// Settings Audio live-STT sandbox — transcript event emission (ticket 05).
// Mock provider OK; asserts real transcript payloads, not level samples.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const {
  resolveLiveSttSandboxStart,
  wireLiveSttSandbox,
} = require(path.join(repoRoot, 'dist-electron/electron/audio/liveSttSandbox.js'));

test('resolveLiveSttSandboxStart: STT unready → stt_unready (no fake listening)', () => {
  const result = resolveLiveSttSandboxStart(false);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'stt_unready');
});

test('resolveLiveSttSandboxStart: STT ready → ok', () => {
  const result = resolveLiveSttSandboxStart(true);
  assert.equal(result.ok, true);
});

test('wireLiveSttSandbox: mic chunks reach STT.write and transcript events emit', () => {
  const capture = new EventEmitter();
  const stt = new EventEmitter();
  const written = [];
  stt.write = (chunk) => { written.push(chunk); };
  stt.start = () => {};
  stt.stop = () => {};
  stt.setSampleRate = () => {};
  capture.getSampleRate = () => 16000;

  const transcripts = [];
  const dispose = wireLiveSttSandbox({
    stt,
    capture,
    emitTranscript: (payload) => transcripts.push(payload),
    now: () => 1_700_000_000_000,
  });

  const chunk = Buffer.alloc(320, 1);
  capture.emit('data', chunk);
  assert.equal(written.length, 1);
  assert.equal(written[0], chunk);

  stt.emit('transcript', { text: 'hello partial', isFinal: false, confidence: 0.5 });
  stt.emit('transcript', { text: 'hello final', isFinal: true, confidence: 0.9 });

  assert.equal(transcripts.length, 2);
  assert.deepEqual(transcripts[0], {
    text: 'hello partial',
    final: false,
    confidence: 0.5,
    speaker: 'user',
    timestamp: 1_700_000_000_000,
  });
  assert.equal(transcripts[1].text, 'hello final');
  assert.equal(transcripts[1].final, true);

  dispose();
  capture.emit('data', Buffer.alloc(4));
  stt.emit('transcript', { text: 'after dispose', isFinal: true });
  assert.equal(written.length, 1, 'dispose must detach capture→write');
  assert.equal(transcripts.length, 2, 'dispose must detach transcript emits');
});

test('wireLiveSttSandbox: isCurrent=false drops late transcripts (stop/epoch)', () => {
  const capture = new EventEmitter();
  const stt = new EventEmitter();
  stt.write = () => {};
  const transcripts = [];
  let current = true;
  wireLiveSttSandbox({
    stt,
    capture,
    emitTranscript: (payload) => transcripts.push(payload),
    isCurrent: () => current,
  });

  stt.emit('transcript', { text: 'alive', isFinal: true });
  current = false;
  stt.emit('transcript', { text: 'stale', isFinal: true });
  assert.equal(transcripts.length, 1);
  assert.equal(transcripts[0].text, 'alive');
});

test('main/preload/types/Settings expose sandbox transcript IPC (not only levels)', () => {
  const mainSrc = fs.readFileSync(path.join(repoRoot, 'electron/main.ts'), 'utf8');
  const preloadSrc = fs.readFileSync(path.join(repoRoot, 'electron/preload.ts'), 'utf8');
  const dtsSrc = fs.readFileSync(path.join(repoRoot, 'src/types/electron.d.ts'), 'utf8');
  const ipcSrc = fs.readFileSync(path.join(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');
  const overlaySrc = fs.readFileSync(path.join(repoRoot, 'src/components/SettingsOverlay.tsx'), 'utf8');

  assert.match(mainSrc, /startLiveSttSandbox/, 'main must expose startLiveSttSandbox');
  assert.match(mainSrc, /audio-test-transcript/, 'main must emit audio-test-transcript');
  assert.match(mainSrc, /wireLiveSttSandbox/, 'main must reuse wireLiveSttSandbox');
  assert.match(mainSrc, /resolveLiveSttSandboxStart/, 'main must gate unready via resolveLiveSttSandboxStart');

  assert.match(ipcSrc, /start-live-stt-sandbox/);
  assert.match(ipcSrc, /stop-live-stt-sandbox/);

  assert.match(preloadSrc, /startLiveSttSandbox/);
  assert.match(preloadSrc, /onAudioTestTranscript/);
  assert.match(preloadSrc, /audio-test-transcript/);

  assert.match(dtsSrc, /startLiveSttSandbox/);
  assert.match(dtsSrc, /onAudioTestTranscript/);

  assert.match(overlaySrc, /startLiveSttSandbox|onAudioTestTranscript/);
  assert.match(overlaySrc, /live-stt-sandbox/);
  assert.match(
    overlaySrc,
    /Test Connection|credential/,
    'credential ping must remain available',
  );
});
