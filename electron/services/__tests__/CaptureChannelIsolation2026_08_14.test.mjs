// F-105 regression pin (audit/autopilot-2026-08-14).
//
// MicrophoneCapture.start() rethrows by design (lazy native open). The
// meeting-start / reconfigureAudio / reconfigureSttProvider audio blocks ran
// the four channel starts as one bare sequence, so a mic throw skipped the
// system channel, live indexing and the route watcher — a wired-but-never-
// started system capture emits no 'start', the stuck watchdog never arms, and
// the meeting runs with both channels dead behind one generic banner.
// Live-reproduced through the real startMeeting() path in
// scripts/audit/F-105-repro.mjs.
//
// Contracts pinned here: the shared per-channel isolation helper exists with
// both channel banners, all three call sites use it, and no bare
// userSTT→system adjacent start sequence remains.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.ts'), 'utf8');

test('startCaptureChannels helper isolates both channels', () => {
  const def = source.indexOf('private startCaptureChannels(');
  assert.notEqual(def, -1, 'startCaptureChannels helper missing');
  const body = source.slice(def, def + 2500);
  assert.ok(/mic channel failed to start/.test(body), 'mic-channel catch/banner missing');
  assert.ok(/system channel failed to start/.test(body), 'system-channel catch/banner missing');
});

test('all three audio-start sites use the isolation helper', () => {
  for (const ctx of ['startMeeting', 'reconfigureAudio', 'reconfigureSttProvider']) {
    assert.ok(
      source.includes(`startCaptureChannels('${ctx}')`),
      `call site missing for context '${ctx}' (F-105)`
    );
  }
});

test('no bare cross-channel start sequence remains', () => {
  assert.ok(
    !/googleSTT_User\?\.start\(\);\s*\n\s*this\.systemAudioCapture\?\.start\(\)/.test(source),
    'found a bare userSTT→system start adjacency — a mic throw would kill the system channel again (F-105)'
  );
});
