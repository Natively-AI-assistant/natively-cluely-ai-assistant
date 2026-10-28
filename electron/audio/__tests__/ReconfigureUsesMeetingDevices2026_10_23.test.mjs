// electron/audio/__tests__/ReconfigureUsesMeetingDevices2026_10_23.test.mjs
//
// A mid-meeting STT rebuild that has to build the captures opens the devices
// the meeting asked for, not the system defaults.
//
// BACKGROUND (user log, 2026-10-14/15, v2.9.2, macOS)
// Every meeting started with Ambient AI Chat on, so startMeetingTransition
// built no captures. Re-picking the STT provider in Settings › Audio then ran
// _doReconfigureSttProvider, whose setupSystemAudioPipeline() built both
// captures with no device id:
//   Starting Meeting... {"audio":{"inputDeviceId":"MacBook Pro Microphone","outputDeviceId":"BuiltInSpeakerDevice"}}
//   [MicrophoneCapture] Initialized wrapper (lazy). Device ID: default
// Same mic on that Mac by luck; with a pinned USB mic or headset it records the
// wrong one. The logic is platform-neutral (no process.platform branch), so
// the source contract below covers macOS and Windows alike.
//
// Run via: node --test electron/audio/__tests__/ReconfigureUsesMeetingDevices2026_10_23.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const main = fs.readFileSync(path.resolve(__dirname, '../../main.ts'), 'utf8');

function methodBody(signature) {
  const at = main.indexOf(signature);
  assert.ok(at >= 0, `could not find ${signature}`);
  // The body opens at the first `{` after the parameter list (these three
  // methods have no `)` inside their parameters and return Promise<void>).
  let i = main.indexOf('{', main.indexOf(')', at) + 1);
  const open = i;
  let depth = 1;
  i++;
  while (i < main.length && depth > 0) {
    if (main[i] === '{') depth++;
    else if (main[i] === '}') depth--;
    i++;
  }
  return main.slice(open, i);
}

test('startMeetingTransition records the devices the meeting asked for, ambient or not', () => {
  const body = methodBody('private async startMeetingTransition(');
  const record = body.indexOf('this._meetingAudioRequest = metadata?.audio');
  const ambientGate = body.indexOf('if (!this._ambientChatEnabled)');
  assert.ok(record >= 0, 'the meeting must remember metadata.audio');
  assert.ok(ambientGate >= 0 && record < ambientGate, 'recorded before the Ambient AI Chat gate, so ambient meetings keep it too');
  assert.match(body, /this\._meetingAudioRequest = metadata\?\.audio\s*\?\s*\{[^}]*\}\s*:\s*null;/, 'a meeting without metadata.audio clears the previous meeting\'s devices');
});

test('the STT rebuild builds missing captures on the meeting\'s devices before the pipeline setup', () => {
  const body = methodBody('private async _doReconfigureSttProvider(');
  const reconfigure = body.indexOf('await this.reconfigureAudio(');
  const setup = body.indexOf('await this.setupSystemAudioPipeline();');
  const start = body.indexOf("this.startCaptureChannels('reconfigureSttProvider');");
  assert.ok(reconfigure >= 0, 'missing captures must go through reconfigureAudio (device choice, conflict and availability checks)');
  assert.ok(reconfigure < setup && setup < start, 'reconfigureAudio, then setup (STT providers), then the one start');

  const call = body.slice(reconfigure, body.indexOf(');', reconfigure));
  assert.match(call, /this\.followedInputDeviceId\(meetingAudio\.inputDeviceId\)/, 'input = the meeting\'s, through the same follow-mic rule as the meeting start');
  assert.match(call, /meetingAudio\.outputDeviceId/, 'output = the meeting\'s');
  assert.match(call, /\{\s*start:\s*false\s*\}/, 'must not start captures before the STT providers exist');

  const guard = body.slice(body.lastIndexOf('if (', reconfigure), reconfigure);
  assert.match(guard, /meetingAudio && !this\.systemAudioCapture && !this\.microphoneCapture/,
    'only when the meeting has no captures: a working (or recovery-retargeted) mic is left alone');
});

test('reconfigureAudio can build without starting; every other caller still starts', () => {
  const body = methodBody('private async reconfigureAudio(');
  const optOut = body.indexOf('if (options.start === false) return;');
  const start = body.indexOf("this.startCaptureChannels('reconfigureAudio');");
  assert.ok(optOut >= 0 && optOut < start, 'start:false returns before the start, and only then');
  const others = [...main.matchAll(/this\.reconfigureAudio\(([^;]*?)\);/g)].map((m) => m[1]);
  const withOptions = others.filter((args) => /start:\s*false/.test(args));
  // The STT rebuild, and Ambient AI Chat's "Turn on mic" (startAudioForMeetingWithoutAudio).
  assert.equal(withOptions.length, 2, 'only the STT rebuild and the Ambient "Turn on mic" opt out of the start');
});
