// Regression tests for the "Input device 'NativelySystemAudioTap' not found"
// meeting failure (2026-08-26, v2.8.7 production).
//
// Chain: speaker/core_audio.rs builds a PRIVATE CoreAudio aggregate named
// NativelySystemAudioTap to capture system audio. "Private" hides it from other
// processes, NOT from ours — cpal's host.input_devices() enumerates it inside
// the Natively main process while the tap is live, so it appeared in the
// microphone dropdown and could be persisted as preferredInputDeviceId. The mic
// channel starts BEFORE the tap is created, so every later meeting resolved a
// device that did not exist, and Rust's resolve_input_device() hard-errors with
// no default fallback.
//
// These are behavioural tests against the real module (no source assertions):
// electron/audio/audioDeviceSelection.mjs is the single choke point that the
// picker (AudioDevices), the pipeline (main.ts) and the launcher (App.tsx) all
// share.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  INTERNAL_CAPTURE_DEVICE_NAMES,
  filterSelectableDevices,
  isInternalCaptureDevice,
  normalizeDeviceName,
  resolveRequestedInputDevice,
} from '../audioDeviceSelection.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The exact list the failing production machine enumerated, plus the tap in the
// position cpal actually returned it (between the two real mics — which is why
// it was plausible to click).
const DEVICES_WITH_TAP = [
  { id: 'default', name: 'Default Microphone' },
  { id: 'iPhone Microphone', name: 'iPhone Microphone' },
  { id: 'NativelySystemAudioTap', name: 'NativelySystemAudioTap' },
  { id: 'MacBook Air Microphone', name: 'MacBook Air Microphone' },
];

const DEVICES_WITHOUT_TAP = [
  { id: 'default', name: 'Default Microphone' },
  { id: 'iPhone Microphone', name: 'iPhone Microphone' },
  { id: 'MacBook Air Microphone', name: 'MacBook Air Microphone' },
];

test('the system-audio tap is never offered as a selectable microphone', () => {
  const selectable = filterSelectableDevices(DEVICES_WITH_TAP);
  assert.deepEqual(
    selectable.map(d => d.id),
    ['default', 'iPhone Microphone', 'MacBook Air Microphone'],
    'BUG: NativelySystemAudioTap is back in the mic picker. Selecting it poisons ' +
    'preferredInputDeviceId and breaks every subsequent meeting.',
  );
});

test('filtering keeps real devices untouched and tolerates junk input', () => {
  assert.deepEqual(filterSelectableDevices(DEVICES_WITHOUT_TAP), DEVICES_WITHOUT_TAP);
  assert.deepEqual(filterSelectableDevices(null), []);
  assert.deepEqual(filterSelectableDevices(undefined), []);
  assert.deepEqual(filterSelectableDevices([null, undefined]), []);
});

test('isInternalCaptureDevice matches case and dash variants, not real mics', () => {
  assert.equal(isInternalCaptureDevice('NativelySystemAudioTap'), true);
  assert.equal(isInternalCaptureDevice('nativelysystemaudiotap'), true);
  assert.equal(isInternalCaptureDevice('  NativelySystemAudioTap  '), true);
  assert.equal(isInternalCaptureDevice('MacBook Air Microphone'), false);
  assert.equal(isInternalCaptureDevice(''), false);
  assert.equal(isInternalCaptureDevice(null), false);
  assert.equal(isInternalCaptureDevice(undefined), false);
});

test('a stored tap id resolves as MISSING so callers fall back to default', () => {
  // This is the production failure: the preference survives, but the tap is not
  // in the list at mic-start time because it has not been created yet.
  const resolution = resolveRequestedInputDevice('NativelySystemAudioTap', DEVICES_WITHOUT_TAP);
  assert.equal(resolution.status, 'missing');
  assert.deepEqual(resolution.available, ['iPhone Microphone', 'MacBook Air Microphone']);
});

test('no preference resolves to default without consulting the list', () => {
  for (const value of [null, undefined, '', '   ', 'default', 'DEFAULT', ' Default ']) {
    assert.equal(
      resolveRequestedInputDevice(value, DEVICES_WITHOUT_TAP).status,
      'default',
      `expected "${value}" to mean "system default"`,
    );
  }
});

test('the synthetic "default" row is never a match candidate', () => {
  // Rust's host.input_devices() does not return it — list_input_devices()
  // prepends it. Matching it here would let a stored "Default Microphone"
  // resolve in JS and then fail in Rust.
  const resolution = resolveRequestedInputDevice('Default Microphone', DEVICES_WITHOUT_TAP);
  assert.equal(resolution.status, 'missing');
  assert.ok(!resolution.available.includes('Default Microphone'));
});

test('the synthetic default ID resolves as default, never as missing', () => {
  // main.ts's I/O-conflict and HFP auto-switches pick a replacement mic out of
  // AudioDevices.getInputDevices(), whose first row is the synthetic
  // { id: 'default' }. They pass its .id through normalizeDeviceId(), which maps
  // 'default' -> undefined, so the availability gate is skipped entirely. This
  // pins the second line of defence: even if 'default' DID reach the gate it
  // must not be reported as an unavailable device, or the auto-switch would
  // raise an amber banner naming "default" as missing.
  assert.equal(resolveRequestedInputDevice('default', DEVICES_WITHOUT_TAP).status, 'default');
  assert.equal(resolveRequestedInputDevice('default', []).status, 'default');
});

test('an EMPTY enumeration is unverifiable, never "missing"', () => {
  // Rust's list_input_devices() swallows an enumeration error
  // (`if let Ok(devices) = host.input_devices()`) and returns only the
  // synthetic default row; AudioDevices returns [] when the native module is
  // absent or throws. Reporting 'missing' on either would make the gate
  // discard a present, working microphone and pin the session to the default.
  assert.equal(resolveRequestedInputDevice('MacBook Air Microphone', []).status, 'unverifiable');
  assert.equal(resolveRequestedInputDevice('MacBook Air Microphone', null).status, 'unverifiable');
  // Only the synthetic default row survives the candidate filter -> still nothing to compare against.
  assert.equal(
    resolveRequestedInputDevice('MacBook Air Microphone', [{ id: 'default', name: 'Default Microphone' }]).status,
    'unverifiable',
  );
  // But a NON-empty enumeration that genuinely lacks the device is 'missing'.
  assert.equal(
    resolveRequestedInputDevice('Dock Microphone', DEVICES_WITHOUT_TAP).status,
    'missing',
  );
});

test('the tap is filtered out of the OUTPUT list too', () => {
  // Probed: while a tap runs, getOutputDevices() returns the aggregate AHEAD of
  // the real speaker, so it is the first thing the speaker picker offers.
  const outputs = [
    { id: 'NativelySystemAudioTap', name: 'NativelySystemAudioTap' },
    { id: 'BuiltInSpeakerDevice', name: 'MacBook Air Speakers' },
  ];
  assert.deepEqual(
    filterSelectableDevices(outputs).map(d => d.name),
    ['MacBook Air Speakers'],
  );
});

test('resolution tiers mirror Rust resolve_input_device (exact < case < fuzzy)', () => {
  const devices = [{ id: 'MacBook Air Microphone', name: 'MacBook Air Microphone' }];

  const exact = resolveRequestedInputDevice('MacBook Air Microphone', devices);
  assert.equal(exact.status, 'matched');
  assert.equal(exact.tier, 0);

  const caseInsensitive = resolveRequestedInputDevice('macbook air microphone', devices);
  assert.equal(caseInsensitive.status, 'matched');
  assert.equal(caseInsensitive.tier, 1);

  // WASAPI index prefix — the case normalize_device_name exists for.
  const fuzzy = resolveRequestedInputDevice(
    '(2- USB Audio Device)',
    [{ id: 'USB Audio Device', name: 'USB Audio Device' }],
  );
  assert.equal(fuzzy.status, 'matched');
  assert.equal(fuzzy.tier, 2);
});

test('an exact match wins over a fuzzy one regardless of enumeration order', () => {
  const devices = [
    { id: '(2- USB Audio Device)', name: '(2- USB Audio Device)' },
    { id: 'USB Audio Device', name: 'USB Audio Device' },
  ];
  const resolution = resolveRequestedInputDevice('USB Audio Device', devices);
  assert.equal(resolution.status, 'matched');
  assert.equal(resolution.tier, 0);
  assert.equal(resolution.id, 'USB Audio Device');
});

test('normalizeDeviceName mirrors the Rust implementation', () => {
  assert.equal(normalizeDeviceName('(2- USB Audio Device)'), 'usb audio device');
  assert.equal(normalizeDeviceName('AirPods Pro – Hands-Free'), 'airpods pro - hands-free');
  assert.equal(normalizeDeviceName('  AirPods Pro  '), 'airpods pro');
  assert.equal(normalizeDeviceName(''), '');
  assert.equal(normalizeDeviceName(null), '');
});

test('the internal-device name matches the aggregate Rust actually creates', () => {
  // A rename on either side silently re-opens the bug: the picker would stop
  // filtering the real device while filtering a name that no longer exists.
  const coreAudioSource = readFileSync(
    path.resolve(__dirname, '../../../native-module/src/speaker/core_audio.rs'),
    'utf8',
  );
  const match = /let\s+agg_name\s*=\s*cf::String::from_str\("([^"]+)"\)/.exec(coreAudioSource);
  assert.ok(match, 'could not find agg_name in native-module/src/speaker/core_audio.rs');
  assert.ok(
    INTERNAL_CAPTURE_DEVICE_NAMES.includes(match[1]),
    `BUG: core_audio.rs creates an aggregate named "${match[1]}" but ` +
    `INTERNAL_CAPTURE_DEVICE_NAMES is ${JSON.stringify(INTERNAL_CAPTURE_DEVICE_NAMES)}. ` +
    'The mic picker will offer it again.',
  );
});
