// F-102 regression pin (audit/autopilot-2026-08-14).
//
// The three system-capture rebuild flows (route-change watcher, system-audio
// recovery, restartCapturesAfterResume) guard each other only pairwise via
// mutexes; resume takes no mutex and clears both flags. Interleaved rebuilds
// (fired in one synchronous turn, both suspending on
// resolveMacScreenCaptureCapability) left one FRESH capture orphaned: started,
// wired, never destroyed, still pumping PCM into the live STT socket because
// the data write had no instance-identity guard. Live-reproduced in
// scripts/audit/F-102-repro.mjs (orphanCount 1 pre-fix, 0 post-fix).
//
// Contracts pinned here:
//   1. wireSystemCapture / wireMicCapture data paths only write to STT when
//      the emitting capture still owns its AppState field.
//   2. Each of the three rebuild flows re-validates field ownership after its
//      awaits (the "rebuilt by another flow" guard) before constructing a
//      fresh capture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.ts'), 'utf8');

test('system-audio data path is instance-identity guarded', () => {
  const writeIdx = source.indexOf('this.googleSTT?.write(chunk)');
  assert.notEqual(writeIdx, -1, 'system STT write not found');
  const guardIdx = source.lastIndexOf('this.systemAudioCapture === capture', writeIdx);
  assert.notEqual(guardIdx, -1, 'no identity guard before the system STT write');
  assert.ok(writeIdx - guardIdx < 600, 'identity guard must be adjacent to the system STT write (F-102)');
});

test('mic data path is instance-identity guarded', () => {
  const writeIdx = source.indexOf('this.googleSTT_User?.write(chunk)');
  assert.notEqual(writeIdx, -1, 'mic STT write not found');
  const guardIdx = source.lastIndexOf('this.microphoneCapture === capture', writeIdx);
  assert.notEqual(guardIdx, -1, 'no identity guard before the mic STT write');
  assert.ok(writeIdx - guardIdx < 600, 'identity guard must be adjacent to the mic STT write (F-102)');
});

test('all three rebuild flows re-validate ownership after their awaits', () => {
  const guards = source.match(/rebuilt by another flow mid-await/g) ?? [];
  assert.ok(
    guards.length >= 3,
    `expected ownership-revalidation guards in route-change, recovery AND resume flows; found ${guards.length}`
  );
});
