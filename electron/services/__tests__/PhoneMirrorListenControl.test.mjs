// electron/services/__tests__/PhoneMirrorListenControl.test.mjs
//
// Ticket 06 — phone Mirror listen transport / end / ask command contract.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const commandsPath = path.resolve(
  here,
  '../../../dist-electron/electron/services/phoneMirrorCommands.js',
);

async function loadCommands() {
  return import(pathToFileURL(commandsPath).href);
}

test('parsePhoneCommand accepts listen-transport toggle/pause/resume', async () => {
  const { parsePhoneCommand } = await loadCommands();
  assert.deepEqual(parsePhoneCommand({ type: 'listen-transport', op: 'toggle' }), {
    type: 'listen-transport',
    op: 'toggle',
  });
  assert.deepEqual(parsePhoneCommand({ type: 'listen-transport', op: 'pause' }), {
    type: 'listen-transport',
    op: 'pause',
  });
  assert.deepEqual(parsePhoneCommand({ type: 'listen-transport', op: 'resume' }), {
    type: 'listen-transport',
    op: 'resume',
  });
  assert.equal(parsePhoneCommand({ type: 'listen-transport', op: 'nope' }), null);
  assert.equal(parsePhoneCommand({ type: 'listen-transport' }), null);
});

test('parsePhoneCommand accepts end-meeting', async () => {
  const { parsePhoneCommand } = await loadCommands();
  assert.deepEqual(parsePhoneCommand({ type: 'end-meeting' }), { type: 'end-meeting' });
  assert.deepEqual(
    parsePhoneCommand({ type: 'end-meeting', ignored: true }),
    { type: 'end-meeting' },
  );
});

test('parsePhoneCommand accepts ask-submit with optional trimmed message ≤2000', async () => {
  const { parsePhoneCommand } = await loadCommands();
  assert.deepEqual(parsePhoneCommand({ type: 'ask-submit' }), { type: 'ask-submit' });
  assert.deepEqual(parsePhoneCommand({ type: 'ask-submit', message: '  hi  ' }), {
    type: 'ask-submit',
    message: 'hi',
  });
  assert.deepEqual(parsePhoneCommand({ type: 'ask-submit', message: '   ' }), {
    type: 'ask-submit',
  });
  assert.equal(
    parsePhoneCommand({ type: 'ask-submit', message: 'x'.repeat(2001) }),
    null,
  );
  assert.equal(parsePhoneCommand({ type: 'ask-submit', message: 12 }), null);
});

test('formatListenTransportAck maps state to action + toast message', async () => {
  const { formatListenTransportAck } = await loadCommands();
  assert.deepEqual(formatListenTransportAck('pause', 'paused'), {
    action: 'listen-transport:pause',
    message: 'Listen paused',
  });
  assert.deepEqual(formatListenTransportAck('resume', 'armed'), {
    action: 'listen-transport:resume',
    message: 'Listen resumed',
  });
  assert.deepEqual(formatListenTransportAck('toggle', 'unready'), {
    action: 'listen-transport:toggle',
    message: 'Listen unready — configure STT',
  });
  assert.deepEqual(formatListenTransportAck('toggle', 'idle'), {
    action: 'listen-transport:toggle',
    message: 'Listen idle',
  });
});

test('ipcHandlers wires listen-transport / end-meeting / ask-submit with acks', () => {
  const ipc = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
  assert.match(ipc, /cmd\.type === 'listen-transport'/);
  assert.match(ipc, /toggleListenTransport\(\)/);
  assert.match(ipc, /getListenTransport\(\)/);
  assert.match(ipc, /formatListenTransportAck/);
  assert.match(ipc, /cmd\.type === 'end-meeting'/);
  assert.match(ipc, /appState\.endMeeting\(\)/);
  assert.match(ipc, /publishAck\('end-meeting'/);
  assert.match(ipc, /cmd\.type === 'ask-submit'|rawCmd\.type === 'ask-submit'/);
  assert.match(ipc, /action: 'answer'/);
  assert.match(ipc, /publishAck\('ask-submit'/);
});

test('phone Mirror client exposes listen pause/resume, end meeting, Ask/Submit', () => {
  const src = fs.readFileSync(
    path.join(root, 'electron/services/phoneMirrorClient.ts'),
    'utf8',
  );
  assert.match(src, /listenPauseBtn/);
  assert.match(src, /listenResumeBtn/);
  assert.match(src, /endMeetingBtn/);
  assert.match(src, /type: 'listen-transport'/);
  assert.match(src, /type: 'end-meeting'/);
  assert.match(src, /type: 'ask-submit'/);
  assert.match(src, /Ask\/Submit/);
  assert.match(src, /listen-transport:/);
  assert.match(src, /end-meeting/);
});
