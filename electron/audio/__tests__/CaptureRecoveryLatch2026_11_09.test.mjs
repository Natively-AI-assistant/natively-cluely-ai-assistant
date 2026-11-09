// A capture warning clears once its channel carries real audio again, and the
// main-process audio warnings say what to do, not the raw error (2026-11-09).
//
//  O1  "Microphone Is Silent", the 12 s watchdog, "gave up" stayed up until
//      their ✕, also after the channel came back. Main arms a latch with each
//      stuck/terminal warning and, once the channel carries signal for 3 s,
//      tells the surfaces `{ channel, recovered: true }` on the same channel.
//  O10 "System audio failed to restart after microphone recovery" was sent as
//      neither terminal nor stuck, so the overlay dropped it: terminal now. The
//      Bluetooth call-mode note is flagged as advice.
//  O11 "…Last error: <raw exception>" in a live-call banner: the raw error is
//      logged, the banner says what to do.
//
// The chunk test is the same int16 PCM check on macOS and Windows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CaptureRecoveryLatch, CAPTURE_RECOVERY_SPAN_MS, warningArmsRecovery } from '../captureRecoveryLatch.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const main = fs.readFileSync(path.resolve(here, '../../main.ts'), 'utf8');

test('only a warning that says the channel is not heard arms the latch', () => {
  assert.equal(warningArmsRecovery({ channel: 'mic', stuck: true }), true);
  assert.equal(warningArmsRecovery({ channel: 'system', terminal: true }), true);
  assert.equal(warningArmsRecovery({ channel: 'mic' }), false, 'a transient recovery attempt');
  assert.equal(warningArmsRecovery({ channel: 'mic', advisory: true }), false, 'advice');
  assert.equal(warningArmsRecovery({ channel: 'system', terminal: true, clearsOnRecovery: false }), false, 'an STT provider fault');
  assert.equal(warningArmsRecovery({ channel: 'mic', recovered: true }), false);
});

test('real audio for the whole span clears the channel once; quiet or zero-filled chunks never do', () => {
  const latch = new CaptureRecoveryLatch();
  assert.equal(CAPTURE_RECOVERY_SPAN_MS, 3_000);
  latch.noteWarning({ channel: 'mic', stuck: true });
  assert.equal(latch.isArmed('mic'), true);
  assert.equal(latch.isArmed('system'), false, 'per channel');
  // Zero-filled for a minute: still the warning's truth.
  for (let t = 0; t <= 60_000; t += 100) assert.equal(latch.noteAudio('mic', t, false), false);
  // Signal, a pause in speech, signal again 3 s after the first.
  assert.equal(latch.noteAudio('mic', 61_000, true), false);
  assert.equal(latch.noteAudio('mic', 62_000, false), false);
  assert.equal(latch.noteAudio('mic', 63_999, true), false);
  assert.equal(latch.noteAudio('mic', 64_000, true), true);
  assert.equal(latch.isArmed('mic'), false, 'disarmed: said once');
  assert.equal(latch.noteAudio('mic', 70_000, true), false);
});

test('a fresh warning restarts the span; the meeting end disarms everything', () => {
  const latch = new CaptureRecoveryLatch();
  latch.noteWarning({ channel: 'system', terminal: true });
  latch.noteAudio('system', 0, true);
  latch.noteWarning({ channel: 'system', stuck: true }); // it is broken again now
  assert.equal(latch.noteAudio('system', 3_000, true), false);
  assert.equal(latch.noteAudio('system', 6_000, true), true);
  latch.noteWarning({ channel: 'mic', stuck: true });
  latch.reset();
  assert.equal(latch.isArmed('mic'), false);
});

test('main: every warning sent arms the latch; recovery goes out on the same channel', () => {
  assert.match(main, /public sendAudioCaptureFailed\(payload: any\): void \{[\s\S]{0,300}this\._captureRecovery\.noteWarning\(payload\);\s*\n\s*this\.sendToMeetingSurfaces\('audio-capture-failed', payload\);/);
  assert.match(main, /this\.sendToMeetingSurfaces\('audio-capture-failed', \{ channel, recovered: true,/);
  assert.match(main, /if \(!this\.isMeetingActive\) return;\s*\n\s*if \(!this\._captureRecovery\.noteAudio\(channel, nowMs, hasSignal\)\) return;/);
});

test('main: both data paths report armed channels, measured like the zero-fill detectors', () => {
  assert.match(main, /if \(this\.systemAudioCapture === capture && this\._captureRecovery\.isArmed\('system'\)\) \{\s*this\.noteCaptureAudio\('system', now, systemAudioHealth\.lastMeaningfulSignalAtMs === now\);/);
  assert.match(main, /if \(this\.microphoneCapture === capture && this\._captureRecovery\.isArmed\('mic'\)\) \{\s*this\.noteCaptureAudio\('mic', now, peakToPeakInt16LE\(chunk\) > 100\);/);
  // Disarmed as the meeting ends, beside the end-side session reset.
  assert.match(main, /'session-reset'\);\s*\n(?:\s*\/\/[^\n]*\n)*\s*this\._captureRecovery\.reset\(\);/);
});

test('main: warnings that real audio does not fix are marked so', () => {
  const sttStart = main.match(/could not start for (?:system audio|your microphone)\. Check its API key in Settings\.`,[\s\S]{0,260}?\}\);/g) || [];
  assert.equal(sttStart.length, 2);
  for (const block of sttStart) assert.match(block, /clearsOnRecovery: false/);
  const route = main.slice(main.indexOf("titleKey: permissionTitleKey('output-route-mismatch'),"));
  assert.match(route.slice(0, 300), /clearsOnRecovery: false/);
});

test('main: the restart that fails after a mic recovery is terminal (O10); Bluetooth call mode is advice', () => {
  const at = main.indexOf("console.error('[MicRecovery] Failed to restart system audio after mic recovery pause:', restartErr);");
  const block = main.slice(at, main.indexOf('});', at) + 3);
  assert.match(block, /terminal: true/);
  assert.doesNotMatch(block, /restartErr as Error\)\?\.message/, 'the raw error stays in the log line');
  const bt = main.slice(main.indexOf('Your mic is in low-quality Bluetooth call mode.'));
  assert.match(bt.slice(0, 500), /advisory: true/);
  assert.match(bt.slice(0, 500), /terminal: false,\s*stuck: false,/);
});

test('main: no raw "Last error" or exception text in a banner message; it is logged instead (O11)', () => {
  const payloads = main.match(/sendAudioCaptureFailed\(\s*\{[\s\S]*?\}\);/g) || [];
  assert.ok(payloads.length > 15, `found ${payloads.length}`);
  for (const p of payloads) {
    assert.doesNotMatch(p, /Last error/, p);
    assert.doesNotMatch(p, /\(err as Error\)\?\.message/, p);
  }
  assert.match(main, /console\.error\(`\[AudioRecovery\] System audio capture gave up after 3 attempts\. Last error: \$\{err\.message\}`\);/);
  assert.match(main, /console\.error\(`\[MicRecovery\] Microphone capture gave up after 3 attempts\. Last error: /);
  // The start failures keep their cause in the log line just above.
  assert.match(main, /console\.error\(`\[Main\] \$\{context\}: mic channel failed to start:`, err\);/);
  assert.match(main, /console\.error\(`\[Main\] \$\{context\}: system channel failed to start:`, err\);/);
});
