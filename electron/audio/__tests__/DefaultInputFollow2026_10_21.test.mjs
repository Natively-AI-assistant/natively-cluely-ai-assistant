// A meeting on the default mic kept the device cpal opened when the system
// default changed (USB headset plugged in, mic picked in system settings), on
// macOS and Windows alike. Interview Coder restarts capture on every device
// change; Natively now follows the default within the meeting-start rules.
//
// Run: node scripts/build-electron.js && ELECTRON_RUN_AS_NODE=1 npx electron --test electron/audio/__tests__/DefaultInputFollow2026_10_21.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { defaultInputDecision } = require(path.join(repoRoot, 'dist-electron/electron/audio/defaultInputFollow.js'));
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const base = {
  meetingActive: true, pinnedInput: undefined, hasCapture: true, busy: false,
  previous: 'MacBook Air Microphone', current: 'Jabra Evolve2 30', currentIsBluetooth: false, builtInAvailable: false, currentSelectable: true,
};

test('a new default mic is followed when the meeting uses the default', () => {
  assert.equal(defaultInputDecision(base), 'follow');
  // Windows names look the same to the rule.
  assert.equal(defaultInputDecision({ ...base, previous: 'Microphone Array (Realtek(R) Audio)', current: 'Headset Microphone (Jabra Evolve2 30)' }), 'follow');
});

test('a mic the user picked, or meeting start switched to, is never left', () => {
  assert.equal(defaultInputDecision({ ...base, pinnedInput: 'MacBook Air Microphone' }), 'observe');
});

test('a Bluetooth default is not taken while a built-in mic exists (call mode), but is when it is the only mic', () => {
  assert.equal(defaultInputDecision({ ...base, current: 'AirPods Pro', currentIsBluetooth: true, builtInAvailable: true }), 'observe');
  assert.equal(defaultInputDecision({ ...base, current: 'AirPods Pro', currentIsBluetooth: true, builtInAvailable: false }), 'follow');
});

test('nothing happens without a change, a meeting, a capture, or while another rebuild runs', () => {
  assert.equal(defaultInputDecision({ ...base, current: base.previous }), 'skip');
  assert.equal(defaultInputDecision({ ...base, current: '' }), 'skip', 'no default device: keep what we have');
  assert.equal(defaultInputDecision({ ...base, meetingActive: false }), 'skip');
  assert.equal(defaultInputDecision({ ...base, hasCapture: false }), 'skip');
  assert.equal(defaultInputDecision({ ...base, busy: true }), 'skip', 'retried on the next tick, not dropped');
});

test('main.ts: the watcher runs with the output watcher and hands a change to the mic recovery', () => {
  const main = read('electron/main.ts');
  assert.equal([...main.matchAll(/this\.startDefaultInputWatcher\(\);/g)].length, 1);
  assert.equal([...main.matchAll(/this\.stopDefaultInputWatcher\(\);/g)].length, 2, 'meeting end + shutdown');
  const body = main.slice(main.indexOf('private startDefaultInputWatcher(): void {'), main.indexOf('private stopDefaultInputWatcher(): void {'));
  assert.match(body, /pinnedInput: this\._lastRequestedInputDeviceId/);
  assert.match(body, /busy: this\._micRecoveryInProgress \|\| this\._defaultOutputSwitchInProgress \|\| this\._systemAudioRecoveryInProgress/);
  assert.match(body, /mic!\.emit\('error', new Error\(`Default microphone changed to/);
  // The recovery reopens on the requested device, which is empty for the default.
  assert.match(main, /this\.microphoneCapture = new MicrophoneCapture\(this\._lastRequestedInputDeviceId\);/);
});

test('native: the default input is exported on both platforms and declared for JS', () => {
  assert.match(read('native-module/src/lib.rs'), /pub fn get_default_input_device_id\(\) -> String \{\s*microphone::default_input_device_name\(\)/);
  assert.match(read('native-module/src/microphone.rs'), /pub fn default_input_device_name\(\) -> String \{\s*cpal::default_host\(\)\s*\.default_input_device\(\)/);
  assert.match(read('native-module/index.js'), /module\.exports\.getDefaultInputDeviceId = nativeBinding\.getDefaultInputDeviceId/);
  assert.match(read('native-module/index.d.ts'), /export declare function getDefaultInputDeviceId\(\): string/);
});

test('a default the input list does not offer is noted, not followed', () => {
  // Following runs the mic recovery: an unopenable default would replace a
  // working mic with "gave up", and Natively's own tap device is filtered out
  // of the list, so it is never taken as the user's mic.
  assert.equal(defaultInputDecision({ ...base, currentSelectable: false }), 'observe');
  const main = read('electron/main.ts');
  const watcher = main.slice(main.indexOf('private startDefaultInputWatcher'), main.indexOf('private stopDefaultInputWatcher'));
  assert.match(watcher, /!isInternalCaptureDevice\(current\)/);
  assert.match(watcher, /AudioDevices\.getInputDevices\(\)\.some\(/);
  assert.match(watcher, /currentSelectable: selectable/);
});
