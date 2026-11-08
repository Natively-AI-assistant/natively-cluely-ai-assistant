// Some users got no system-audio transcription on macOS. Interview Coder
// (installed as "systemcontainer") captures system audio with a Core Audio
// process tap (its audiotee helper) and never checks Screen Recording; the tap
// needs only the System Audio Recording grant. Natively had the same tap but
// refused to start it whenever Screen Recording was denied, at every start
// path, so those meetings ran mic-only. And on macOS 14.2 and 14.3 Natively had
// no tap at all (device-bound init is 14.4), so it went to ScreenCaptureKit,
// which does need Screen Recording; audiotee taps from 14.2 with the global tap.
//
// Run: node scripts/build-electron.js && ELECTRON_RUN_AS_NODE=1 npx electron --test electron/audio/__tests__/SystemAudioWithoutScreenRecording2026_10_21.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const {
  systemAudioGrant, macOSAtLeast, zeroFillMeansScreenRecordingLost, systemAudioRecordingBlocked, zeroFillMeansSystemAudioRecordingDenied,
} = require(
  path.join(repoRoot, 'dist-electron/electron/audio/systemAudioPermission.js'),
);
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

test('macOS: 14.2 and later need System Audio Recording, not Screen Recording; older Macs keep the gate', () => {
  for (const v of ['14.2', '14.2.1', '14.3.1', '14.4', '15.0', '15.7.1', '26.0', '27.0']) {
    assert.equal(systemAudioGrant('darwin', v), 'system-audio-recording', v);
  }
  for (const v of ['14.1.2', '14.0', '13.6.9', '12.7', '', 'garbage']) {
    assert.equal(systemAudioGrant('darwin', v), 'screen-recording', `${v}: ScreenCaptureKit only, gate kept`);
  }
  assert.equal(macOSAtLeast('14', 14, 2), false, 'a bare major is 14.0');
});

test('Windows: WASAPI loopback needs no grant; an unsupported OS is refused', () => {
  assert.equal(systemAudioGrant('win32', '10.0.26100'), 'none');
  assert.throws(() => systemAudioGrant('linux', '6.8'), /Unsupported platform: linux/);
});

test('silence is blamed on Screen Recording only for the ScreenCaptureKit backend', () => {
  assert.equal(zeroFillMeansScreenRecordingLost('sck'), true);
  for (const b of ['coreaudio', 'wasapi', '']) assert.equal(zeroFillMeansScreenRecordingLost(b), false, b);
});

test('every system-audio start path uses the tap-aware gate; the raw Screen Recording probe is left for the helper and the ScreenCaptureKit diagnosis', () => {
  const main = read('electron/main.ts');
  for (const ctx of [
    'system audio pipeline setup', 'resume capture restart', 'audio reconfigure', 'system audio recovery',
    'default output route change', 'audio test', 'meeting start', 'startup permission check',
  ]) {
    assert.ok(main.includes(`await resolveMacSystemAudioCapability('${ctx}')`), ctx);
  }
  const rawCalls = [...main.matchAll(/resolveMacScreenCaptureCapability\(/g)].length;
  assert.equal(rawCalls, 3, 'definition + the helper fallback + the zero-fill diagnosis');
  const helper = main.slice(main.indexOf('async function resolveMacSystemAudioCapability('));
  assert.match(helper.slice(0, 600), /systemAudioGrant\('darwin', process\.getSystemVersion\(\)\) === 'system-audio-recording'/);
  assert.match(main, /'sustained-zero-valued-silence' && process\.platform === 'darwin' && zeroFillMeansScreenRecordingLost\(capture\.getActiveBackend\(\)\)/);
});

test('native: the tap is built from macOS 14.2, with the global tap on 14.2 and 14.3 and every selector checked first', () => {
  const rs = read('native-module/src/speaker/core_audio.rs');
  assert.match(rs, /tap_mode\(os_at_least\(14, 4\), os_at_least\(14, 2\), force_global\)/);
  assert.match(rs, /requires macOS 14\.2\+/);
  const global = rs.slice(rs.indexOf('fn global_tap_desc()'), rs.indexOf('pub struct SpeakerInput'));
  for (const sel of ['setProcesses:', 'setExclusive:', 'setMono:', 'setMixdown:']) assert.ok(global.includes(`c"${sel}"`), sel);
  assert.doesNotMatch(global, /set_mute_behavior|init_excluding_processes_and_device/, 'no 14.4 API on the 14.2 path');
  // setMuteBehavior stays on the 14.4 branch only.
  const deviceBound = rs.slice(rs.indexOf('TapMode::DeviceBound => {'), rs.indexOf('TapMode::Global => global_tap_desc()?'));
  assert.match(deviceBound, /set_mute_behavior\(ca::TapMuteBehavior::Unmuted\)/);
});

test('a declined System Audio Recording grant is reported only when it is explicit and Screen Recording does not cover it', () => {
  assert.equal(systemAudioRecordingBlocked('denied', 'denied'), true);
  assert.equal(systemAudioRecordingBlocked('denied', 'not-determined'), true);
  assert.equal(systemAudioRecordingBlocked('denied', 'granted'), false, 'Screen Recording covers system audio');
  for (const unsure of ['unknown', 'granted', '']) assert.equal(systemAudioRecordingBlocked(unsure, 'denied'), false, unsure);
  assert.equal(zeroFillMeansSystemAudioRecordingDenied('coreaudio', 'denied', 'denied'), true);
  assert.equal(zeroFillMeansSystemAudioRecordingDenied('sck', 'denied', 'denied'), false, 'ScreenCaptureKit has its own banner');
  assert.equal(zeroFillMeansSystemAudioRecordingDenied('wasapi', 'denied', 'denied'), false);
});

test('main.ts: the declined grant raises its own banner on silence and at meeting start, never stops capture', () => {
  const main = read('electron/main.ts');
  assert.match(main, /'sustained-zero-valued-silence' && process\.platform === 'darwin' && zeroFillMeansSystemAudioRecordingDenied\(capture\.getActiveBackend\(\), readSystemAudioRecordingPermission\(\), getMacScreenCaptureStatus\(\)\)/);
  const start = main.slice(main.indexOf("await resolveMacSystemAudioCapability('meeting start')"));
  assert.match(start.slice(0, 2500), /systemAudioRecordingBlocked\(readSystemAudioRecordingPermission\(\), screenCapability\.status\)[\s\S]{0,700}sendSystemAudioPermissionDenied\(\s*formatPermissionMessage\('mac-system-audio-recording-denied'\)/);
  // The helper that gates capture never consults the grant.
  const helper = main.slice(main.indexOf('async function resolveMacSystemAudioCapability('), main.indexOf('async function resolveMacScreenCaptureCapability('));
  assert.doesNotMatch(helper, /readSystemAudioRecordingPermission/);
});

test('native: the grant is read through TCCAccessPreflight loaded at run time, never linked', () => {
  const rs = read('native-module/src/speaker/audio_capture_permission.rs');
  assert.match(rs, /dlopen\(\s*c"\/System\/Library\/PrivateFrameworks\/TCC\.framework\/Versions\/A\/TCC"/);
  assert.match(rs, /dlsym\(handle, c"TCCAccessPreflight"/);
  assert.match(rs, /kTCCServiceAudioCapture/);
  assert.match(rs, /if sym\.is_null\(\) \{\s*return AudioCapturePermission::Unknown;/);
  assert.doesNotMatch(read('native-module/.cargo/config.toml'), /framework[= ,"]+TCC/);
  assert.match(read('native-module/index.d.ts'), /export declare function getSystemAudioRecordingPermission\(\): string/);
});
