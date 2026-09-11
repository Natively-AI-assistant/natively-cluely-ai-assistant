// electron/audio/__tests__/SckReprobeAfterSystemStop2026_09_11.test.mjs
//
// Live-reproduced 2026-09-11: after display sleep stopped the SCK stream, the
// recovery rebuilt the capture while displays were still gone, SCK init
// failed ("No displays found") and the Rust side fell back to the CoreAudio
// tap — which then stayed for the rest of the meeting even after the display
// woke. Users who chose SCK because the CoreAudio tap does not work with their
// device (#540) silently lost the backend they picked.
//
// Pinned: the native module reports the active backend and whether SCK can
// see a display; main polls both while the meeting runs on the 'sck' route
// and rebuilds on SCK when displays return, bounded and mutex-disciplined.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(dirname, rel), 'utf8');
const main = read('../../main.ts');
const capture = read('../SystemAudioCapture.ts');
const dts = read('../../../native-module/index.d.ts');
const lib = read('../../../native-module/src/lib.rs');

function method(name) {
  let from = main.indexOf(`private ${name}(`);
  if (from < 0) from = main.indexOf(`private async ${name}(`);
  assert.ok(from >= 0, `${name} must exist`);
  return main.slice(from, main.indexOf('\n  }\n', from));
}

test('the native module exposes the active backend and display availability', () => {
  assert.match(dts, /getActiveBackend\(\): string/);
  assert.match(dts, /export declare function screenCaptureDisplaysAvailable\(\): boolean/);
  assert.match(lib, /speaker::active_display_count\(\) > 0/);
  assert.match(capture, /public getActiveBackend\(\): string/);
});

test('the re-probe watcher is armed on the sck route only and stopped with the meeting', () => {
  const w = method('startSckReprobeWatcher');
  assert.match(w, /if \(process\.platform !== 'darwin'\) return;/);
  assert.match(w, /if \(this\._lastRequestedOutputDeviceId !== 'sck'\) return;/);
  assert.match(w, /capture\.getActiveBackend\(\)/);
  assert.match(w, /NativeModule\.screenCaptureDisplaysAvailable\(\)/);
  assert.match(w, /SCK_REPROBE_MAX_REBUILDS\) return;/, 'a flapping display must not rebuild forever');
  // Respect the cross-flow mutexes shared with route-change and recovery.
  assert.match(w, /if \(this\._defaultOutputSwitchInProgress \|\| this\._systemAudioRecoveryInProgress\) return;/);
  const endMeeting = main.slice(main.indexOf('this.stopDefaultOutputWatcher();\n    this.stopSckReprobeWatcher();'));
  assert.ok(endMeeting.length > 0, 'endMeeting must stop the re-probe watcher next to the route watcher');
  assert.match(main, /this\.startDefaultOutputWatcher\(\);\n\s+this\.startSckReprobeWatcher\(\);/);
});

test('the SCK rebuild follows the destroy-await-revalidate discipline and requests sck explicitly', () => {
  const r = method('rebuildSystemCaptureForSck');
  assert.match(r, /this\._defaultOutputSwitchInProgress = true;/);
  assert.match(r, /await oldCapture\?\.destroy\(\);/);
  assert.match(r, /if \(this\.systemAudioCapture\) \{/, 'must re-validate ownership after the await (F-102)');
  assert.match(r, /new SystemAudioCapture\('sck'\)/);
  assert.match(r, /this\._systemAudioRecoveryAttempts = 0;/, 'a fresh backend gets a fresh recovery budget');
  assert.match(r, /finally \{\n\s+this\._defaultOutputSwitchInProgress = false;/);
});
