// Listen transport policy — InterviewMan arming / pause / resume / end.
// Pure module; no Electron. Glossary: listen-transport-arming.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const {
  listenTransportOnMeetingStart,
  listenTransportPause,
  listenTransportResume,
  listenTransportOnMeetingEnd,
  listenTransportToggle,
} = require(path.join(repoRoot, 'dist-electron/electron/audio/listenTransport.js'));

test('meeting start with STT ready and Ambient off → armed, capture on', () => {
  const snap = listenTransportOnMeetingStart({
    ambientChatEnabled: false,
    sttReady: true,
  });
  assert.equal(snap.state, 'armed');
  assert.equal(snap.captureShouldRun, true);
  assert.equal(snap.reason, 'armed');
});

test('meeting start with Ambient on → idle, capture off (ambient reason)', () => {
  const snap = listenTransportOnMeetingStart({
    ambientChatEnabled: true,
    sttReady: true,
  });
  assert.equal(snap.state, 'idle');
  assert.equal(snap.captureShouldRun, false);
  assert.equal(snap.reason, 'ambient');
});

test('meeting start with STT unready → unready, capture off', () => {
  const snap = listenTransportOnMeetingStart({
    ambientChatEnabled: false,
    sttReady: false,
  });
  assert.equal(snap.state, 'unready');
  assert.equal(snap.captureShouldRun, false);
  assert.equal(snap.reason, 'stt_unready');
});

test('Ambient wins over STT unready at meeting start', () => {
  const snap = listenTransportOnMeetingStart({
    ambientChatEnabled: true,
    sttReady: false,
  });
  assert.equal(snap.reason, 'ambient');
  assert.equal(snap.captureShouldRun, false);
});

test('pause from armed → paused, capture off', () => {
  const snap = listenTransportPause('armed');
  assert.equal(snap.state, 'paused');
  assert.equal(snap.captureShouldRun, false);
  assert.equal(snap.reason, 'paused');
});

test('pause is a no-op when already paused', () => {
  const snap = listenTransportPause('paused');
  assert.equal(snap.state, 'paused');
  assert.equal(snap.captureShouldRun, false);
});

test('resume from paused with STT ready → armed', () => {
  const snap = listenTransportResume('paused', true);
  assert.equal(snap.state, 'armed');
  assert.equal(snap.captureShouldRun, true);
});

test('resume from paused with STT unready → unready', () => {
  const snap = listenTransportResume('paused', false);
  assert.equal(snap.state, 'unready');
  assert.equal(snap.captureShouldRun, false);
});

test('resume from unready when STT becomes ready → armed', () => {
  const snap = listenTransportResume('unready', true);
  assert.equal(snap.state, 'armed');
  assert.equal(snap.captureShouldRun, true);
});

test('meeting end → idle, capture off', () => {
  const snap = listenTransportOnMeetingEnd();
  assert.equal(snap.state, 'idle');
  assert.equal(snap.captureShouldRun, false);
  assert.equal(snap.reason, 'ended');
});

test('toggle armed → paused; toggle paused → armed', () => {
  const paused = listenTransportToggle('armed', true);
  assert.equal(paused.state, 'paused');
  const armed = listenTransportToggle('paused', true);
  assert.equal(armed.state, 'armed');
  assert.equal(armed.captureShouldRun, true);
});
