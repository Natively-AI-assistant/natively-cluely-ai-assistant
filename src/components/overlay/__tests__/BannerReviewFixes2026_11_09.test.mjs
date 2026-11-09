// Review of the 2026-11-09 banner fixes: what a close hides, what a milder
// warning does, what a recovery or a rebuild clears, and what reopens a hidden
// overlay. Renderer-only and pure where it can be; the same on macOS and
// Windows (the permission losses below are reported by main on macOS; the
// overlay handles the flag the same on both).
//
//  D1  a closed "Transcription Stopped" hid every later stop in the meeting.
//  D3  a milder warning was thrown away; main said it once, so it was lost.
//  D4  a recovery cleared advice that arrived after the warning it recovers.
//  D5  a rebuild after "gave up" took a still-true permission warning with it.
//  O2  a permission lost mid-meeting (sent as stuck) did not reopen the overlay.
//  O8  the cap could hold back the audio banner that stands in for "Stopped".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EMPTY_AUDIO_WARNINGS,
  clearAudioWarning,
  clearedByRebuild,
  clearedByRecovery,
  dismissShownAudioWarning,
  isPermissionWarning,
  offerAudioWarning,
  shownAudioWarning,
} from '../audioWarningSlots.mjs';
import { audioBannerId, pickOverlayBanners } from '../overlayBannerSlots.mjs';
import { forgetSettledSttOutages, sttReconnectingKey, sttStoppedKey } from '../sttBannerKeys.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const overlay = fs.readFileSync(path.resolve(here, '../../NativelyInterface.tsx'), 'utf8');

const W = (o) => ({ kind: 'audio-capture-failure', message: 'm', ...o });
const offer = (...ws) => ws.reduce((s, w) => offerAudioWarning(s, w), EMPTY_AUDIO_WARNINGS);

// ── D1 ──────────────────────────────────────────────────────────────────────

test('D1: a stop on another channel is another banner', () => {
  const micOnly = sttStoppedKey('failed', 'connected');
  const both = sttStoppedKey('failed', 'failed');
  const systemOnly = sttStoppedKey('connected', 'failed');
  assert.equal(new Set([micOnly, both, systemOnly]).size, 3);
  // Closing the mic's stop does not hide the interviewer channel's.
  const dismissed = [micOnly];
  assert.ok(!dismissed.includes(both));
  assert.notEqual(sttReconnectingKey('reconnecting', 'connected'), sttReconnectingKey('connected', 'reconnecting'));
});

test('D1: once both channels are healthy, a closed outage is forgotten and the next one shows', () => {
  const closed = [sttStoppedKey('failed', 'connected'), 'pack:ended', 'backup:x'];
  assert.equal(forgetSettledSttOutages(closed, 'failed', 'connected'), closed, 'still down: still closed');
  assert.equal(forgetSettledSttOutages(closed, 'connected', 'reconnecting'), closed, 'one channel still out');
  assert.deepEqual(forgetSettledSttOutages(closed, 'connected', 'awaiting-audio'), ['pack:ended', 'backup:x'], 'other closes hold');
  // The same outage 20 minutes later is shown again.
  const after = forgetSettledSttOutages([...closed, sttReconnectingKey('reconnecting', 'connected')], 'connected', 'connected');
  assert.ok(!after.includes(sttStoppedKey('failed', 'connected')));
  assert.ok(!after.some((k) => k.startsWith('reconnecting')));
});

test('D1: the overlay keys the stop by channel and forgets closed outages on recovery', () => {
  const chain = overlay.slice(overlay.indexOf('const sttStatusBanner:'), overlay.indexOf('const sttStatusBannerOpen'));
  assert.doesNotMatch(chain, /key: 'stopped'/);
  assert.doesNotMatch(chain, /key: 'reconnecting'/);
  assert.match(overlay, /useEffect\(\(\) => \{\s*setSttBannerDismissed\(\(prev\) => forgetSettledSttOutages\(prev, sttUserStatus, sttInterviewerStatus\)\);\s*\}, \[sttUserStatus, sttInterviewerStatus\]\);/);
});

// ── D3 / D5 ─────────────────────────────────────────────────────────────────

test('D3: a milder warning under a serious one is held, and shows once the first is closed', () => {
  const providerDown = W({ channel: 'mic', terminal: true, clearsOnRecovery: false, message: 'provider could not start for your mic' });
  const micBlocked = W({ channel: 'mic', stuck: true, permission: true, titleKey: 'Microphone Blocked', message: 'mic zero-fill' });
  const silent = W({ channel: 'mic', stuck: true, message: 'Microphone Is Silent' });
  let s = offer(providerDown, silent);
  assert.equal(shownAudioWarning(s).message, providerDown.message);
  s = dismissShownAudioWarning(s);
  assert.equal(shownAudioWarning(s)?.message, 'Microphone Is Silent', 'the stuck warning was held, not lost');
  // Advice after a stuck warning waits too.
  let a = offer(silent, W({ channel: 'mic', message: 'Bluetooth call mode' }));
  a = dismissShownAudioWarning(a);
  assert.equal(shownAudioWarning(a)?.message, 'Bluetooth call mode');
  // A repeat refreshes its copy rather than stacking a second one.
  const twice = offer(micBlocked, micBlocked);
  assert.equal(dismissShownAudioWarning(twice).held.length, 0);
});

test('D5: a rebuild clears the capture that gave up, never the permission warning', () => {
  const screenBlocked = { kind: 'screen-recording-permission', channel: 'system', message: 'Screen Recording blocked' };
  const gaveUp = W({ channel: 'system', terminal: true, message: 'System audio gave up' });
  const s = offer(screenBlocked, gaveUp);
  assert.equal(shownAudioWarning(s).message, 'System audio gave up', 'the newer of equal severity shows');
  const rebuilt = clearAudioWarning(s, 'system', clearedByRebuild);
  assert.equal(shownAudioWarning(rebuilt)?.message, 'Screen Recording blocked', 'still true, still shown');
  // A permission loss flagged by main is left by a rebuild too.
  const tccLost = W({ channel: 'system', terminal: true, permission: true, message: 'System Audio Recording denied' });
  assert.equal(clearedByRebuild(tccLost), false);
});

// ── D4 ──────────────────────────────────────────────────────────────────────

test('D4: a recovery clears what said the channel was not heard, not advice that came after it', () => {
  const silent = W({ channel: 'mic', stuck: true, message: 'Microphone Is Silent' });
  const advice = W({ channel: 'mic', message: 'Bluetooth call mode' });
  const s = offer(silent, advice);
  const recovered = clearAudioWarning(s, 'mic', clearedByRecovery);
  assert.equal(recovered.held.length, 1);
  assert.equal(shownAudioWarning(recovered).message, 'Bluetooth call mode');
  assert.equal(clearedByRecovery(W({ terminal: true, clearsOnRecovery: false })), false);
});

// ── O2 gap ──────────────────────────────────────────────────────────────────

test('O2: a permission lost mid-meeting is a permission warning and reopens the overlay, quietly', () => {
  assert.equal(isPermissionWarning(W({ stuck: true, permission: true })), true);
  assert.equal(isPermissionWarning({ kind: 'screen-recording-permission', message: '' }), true);
  assert.equal(isPermissionWarning(W({ stuck: true })), false, 'a silent channel main still retries is not');
  const handler = overlay.slice(overlay.indexOf('window.electronAPI?.onAudioCaptureFailed?.((payload) => {'));
  const body = handler.slice(0, handler.indexOf('return () => unsub?.();'));
  assert.match(body, /permission: !!payload\.permission,/);
  assert.match(body, /if \(payload\.terminal \|\| payload\.permission\) revealOverlayForWarning\(\);/);
});

// ── O8 ──────────────────────────────────────────────────────────────────────

test('O8: the audio banner standing in for "Transcription Stopped" is never held back by the cap', () => {
  const stuckId = audioBannerId(2, true);
  // The stop steps down (no stt-error wanted); auto-stop and stt-not-configured want slots.
  const shown = pickOverlayBanners({ 'auto-stop': true, 'stt-not-configured': true, [stuckId]: true });
  assert.ok(shown.has(stuckId), 'one of the pair is on screen');
  // Not standing in: a stuck warning keeps its own, lower rank.
  assert.equal(audioBannerId(2, false), 'audio-stuck');
});
