// electron/services/__tests__/PhoneMirrorPhoneStt.test.mjs
//
// Ticket 07 — phone STT source → session merge (ADR 0015).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const require = createRequire(import.meta.url);
const commandsPath = path.resolve(
  here,
  '../../../dist-electron/electron/services/phoneMirrorCommands.js',
);

async function loadCommands() {
  return import(pathToFileURL(commandsPath).href);
}

test('parsePhoneCommand accepts phone-stt arm/disarm', async () => {
  const { parsePhoneCommand } = await loadCommands();
  assert.deepEqual(parsePhoneCommand({ type: 'phone-stt', op: 'arm' }), {
    type: 'phone-stt',
    op: 'arm',
  });
  assert.deepEqual(parsePhoneCommand({ type: 'phone-stt', op: 'disarm' }), {
    type: 'phone-stt',
    op: 'disarm',
  });
  assert.equal(parsePhoneCommand({ type: 'phone-stt', op: 'nope' }), null);
  assert.equal(parsePhoneCommand({ type: 'phone-stt' }), null);
});

test('parsePhoneCommand accepts phone-stt-transcript with size / final validation', async () => {
  const { parsePhoneCommand } = await loadCommands();
  assert.deepEqual(
    parsePhoneCommand({ type: 'phone-stt-transcript', text: '  hello  ', final: true }),
    { type: 'phone-stt-transcript', text: 'hello', final: true },
  );
  assert.deepEqual(
    parsePhoneCommand({ type: 'phone-stt-transcript', text: 'partial' }),
    { type: 'phone-stt-transcript', text: 'partial' },
  );
  assert.equal(
    parsePhoneCommand({ type: 'phone-stt-transcript', text: 'x'.repeat(2001) }),
    null,
  );
  assert.equal(parsePhoneCommand({ type: 'phone-stt-transcript', text: '   ' }), null);
  assert.equal(
    parsePhoneCommand({ type: 'phone-stt-transcript', text: 'hi', final: 'yes' }),
    null,
  );
});

test('formatPhoneSttAck maps arm/disarm to toast messages', async () => {
  const { formatPhoneSttAck } = await loadCommands();
  assert.deepEqual(formatPhoneSttAck('arm', 'phone'), {
    action: 'phone-stt:arm',
    message: 'Phone mic STT armed',
  });
  assert.deepEqual(formatPhoneSttAck('disarm', 'desktop'), {
    action: 'phone-stt:disarm',
    message: 'Phone mic STT released — desktop mic',
  });
});

test('phone final ingest plan would call handleTranscript / display path', () => {
  const {
    armPhoneUserSttSource,
    planPhoneSttIngest,
  } = require(path.join(root, 'dist-electron/electron/audio/userSttSource.js'));

  const active = armPhoneUserSttSource('desktop');
  const plan = planPhoneSttIngest(active, 'I am speaking on the phone', true);
  assert.equal(plan.accept, true);
  assert.equal(plan.speaker, 'user');
  assert.equal(plan.origin, 'stt');
  assert.equal(plan.final, true);
  assert.equal(plan.text, 'I am speaking on the phone');

  // Simulate the desktop ingest surface (AppState.ingestPhoneSttTranscript).
  const calls = { handleTranscript: [], sendThrottledTranscript: [] };
  if (plan.accept) {
    calls.handleTranscript.push({
      speaker: plan.speaker,
      text: plan.text,
      final: plan.final,
      origin: plan.origin,
    });
    calls.sendThrottledTranscript.push({
      speaker: plan.speaker,
      text: plan.text,
      final: plan.final,
    });
  }
  assert.equal(calls.handleTranscript.length, 1);
  assert.equal(calls.sendThrottledTranscript.length, 1);
  assert.equal(calls.handleTranscript[0].speaker, 'user');
});

test('ipcHandlers wires phone-stt arm/disarm + transcript ingest', () => {
  const ipc = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
  assert.match(ipc, /cmd\.type === 'phone-stt'/);
  assert.match(ipc, /armPhoneUserStt\(\)/);
  assert.match(ipc, /disarmPhoneUserStt\(\)/);
  assert.match(ipc, /formatPhoneSttAck/);
  assert.match(ipc, /cmd\.type === 'phone-stt-transcript'/);
  assert.match(ipc, /ingestPhoneSttTranscript/);
  assert.match(ipc, /user-stt-source:get/);
});

test('main ignores desktop user-mic while phone is active source', () => {
  const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
  assert.match(main, /shouldAcceptUserSttFrom\(this\._userSttSource, 'desktop'\)/);
  assert.match(main, /ingestPhoneSttTranscript/);
  assert.match(main, /armPhoneUserStt/);
  assert.match(main, /user-stt-source-changed/);
});

test('phone Mirror client exposes phone mic STT arm + Web Speech transcripts', () => {
  const src = fs.readFileSync(
    path.join(root, 'electron/services/phoneMirrorClient.ts'),
    'utf8',
  );
  assert.match(src, /phoneSttBtn/);
  assert.match(src, /type: 'phone-stt'/);
  assert.match(src, /type: 'phone-stt-transcript'/);
  assert.match(src, /SpeechRecognition|webkitSpeechRecognition/);
  assert.match(src, /Phone mic/);
});

test('overlay indicates active user-STT source', () => {
  const ui = fs.readFileSync(
    path.join(root, 'src/components/NativelyInterface.tsx'),
    'utf8',
  );
  assert.match(ui, /user-stt-source-pill/);
  assert.match(ui, /getUserSttSource/);
  assert.match(ui, /onUserSttSourceChanged/);
  assert.match(ui, /userSttSource\.label/);
});
