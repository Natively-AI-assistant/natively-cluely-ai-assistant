// The overlay's audio banner: per channel, by severity, cleared on recovery and
// at the meeting's end, and never stealing focus (2026-11-09).
//
//  O1  the warning outlived its meeting (the overlay window is reused) and its
//      own recovery. It ends with the meeting, and a `recovered` report clears
//      its channel.
//  O2  a warning reopened a hidden overlay with show()+focus(), taking the
//      keyboard from the call. Only a blocked permission or a capture that gave
//      up reopens it, and without focus (isStealthRef first).
//  O7  a milder warning replaced a more serious one in the single slot.
//  O10 advice (a Bluetooth mic in call mode) reaches the user, once per meeting,
//      and its button goes to Settings › Audio on macOS and Windows alike.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EMPTY_AUDIO_WARNINGS,
  audioWarningSeverity,
  clearAudioWarning,
  dismissShownAudioWarning,
  offerAudioWarning,
  resetAudioWarnings,
  shownAudioWarning,
} from '../audioWarningSlots.mjs';
import { audioWarningAction } from '../../../lib/audioWarningAction.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const overlay = fs.readFileSync(path.resolve(here, '../../NativelyInterface.tsx'), 'utf8');
const notes = fs.readFileSync(path.resolve(here, '../../NotesWindow.tsx'), 'utf8');

const W = (o) => ({ kind: 'audio-capture-failure', message: 'm', ...o });
const offer = (...ws) => ws.reduce((s, w) => offerAudioWarning(s, w), EMPTY_AUDIO_WARNINGS);

test('severity: permission or terminal > stuck > advice', () => {
  assert.equal(audioWarningSeverity({ kind: 'screen-recording-permission', message: '' }), 3);
  assert.equal(audioWarningSeverity(W({ terminal: true })), 3);
  assert.equal(audioWarningSeverity(W({ stuck: true })), 2);
  assert.equal(audioWarningSeverity(W({})), 1);
  assert.equal(audioWarningSeverity(null), 0);
});

test('a milder warning never replaces a more serious one on its channel; an equal one does', () => {
  const blocked = W({ channel: 'mic', terminal: true, message: 'Microphone blocked' });
  const s = offer(blocked, W({ channel: 'mic', stuck: true, message: 'silent' }), W({ channel: 'mic', message: 'bluetooth' }));
  assert.equal(shownAudioWarning(s).message, 'Microphone blocked');
  const s2 = offerAudioWarning(s, W({ channel: 'mic', terminal: true, message: 'gave up' }));
  assert.equal(shownAudioWarning(s2).message, 'gave up');
});

test('one slot per channel: the most serious shows, the other is held and shows once the first clears', () => {
  const s = offer(W({ channel: 'system', terminal: true, message: 'system gave up' }), W({ channel: 'mic', stuck: true, message: 'mic silent' }));
  assert.equal(shownAudioWarning(s).message, 'system gave up');
  const afterClose = dismissShownAudioWarning(s);
  assert.equal(shownAudioWarning(afterClose).message, 'mic silent');
  // Same severity on both: the latest.
  const tie = offer(W({ channel: 'system', stuck: true, message: 'a' }), W({ channel: 'mic', stuck: true, message: 'b' }));
  assert.equal(shownAudioWarning(tie).message, 'b');
});

test('recovery clears only its channel, and never a warning real audio does not fix', () => {
  const s = offer(W({ channel: 'mic', stuck: true, message: 'mic silent' }), W({ channel: 'system', terminal: true, clearsOnRecovery: false, message: 'stt' }));
  const recovered = (st, ch) => clearAudioWarning(st, ch, (w) => w.kind === 'audio-capture-failure' && w.clearsOnRecovery !== false);
  const afterMic = recovered(s, 'mic');
  assert.equal(afterMic.slots.mic, undefined);
  assert.equal(shownAudioWarning(afterMic).message, 'stt');
  assert.equal(recovered(afterMic, 'system'), afterMic, 'an STT provider fault stays');
});

test('advice is shown once per meeting, and the meeting end forgets everything', () => {
  const bt = W({ channel: 'mic', message: 'Your mic is in low-quality Bluetooth call mode.' });
  let s = offer(bt);
  assert.equal(shownAudioWarning(s).message, bt.message);
  s = dismissShownAudioWarning(s);
  assert.equal(offerAudioWarning(s, bt), s, 'the same advice again stays quiet');
  s = resetAudioWarnings();
  assert.equal(shownAudioWarning(offerAudioWarning(s, bt)).message, bt.message, 'a new meeting may say it again');
});

test('advice opens Settings › Audio on both platforms, never a privacy pane', () => {
  for (const platform of ['darwin', 'win32']) {
    const advice = audioWarningAction({ platform, kind: 'audio-capture-failure', channel: 'mic', message: 'Your mic is in low-quality Bluetooth call mode.', advisory: true });
    assert.deepEqual(advice, { type: 'settings-tab', tab: 'audio' }, platform);
  }
  // Unchanged without the flag: a silent mic on macOS still opens the Microphone pane.
  assert.equal(audioWarningAction({ platform: 'darwin', kind: 'audio-capture-failure', channel: 'mic', message: 'x' }).type, 'external');
  assert.equal(audioWarningAction({ platform: 'win32', kind: 'audio-capture-failure', channel: 'mic', titleKey: 'Microphone Is Silent', message: 'x' }).type, 'mic-privacy');
});

// ── NativelyInterface wiring ────────────────────────────────────────────────

const handler = (() => {
  const at = overlay.indexOf('window.electronAPI?.onAudioCaptureFailed?.((payload) => {');
  return overlay.slice(at, overlay.indexOf('return () => unsub?.();', at));
})();

test('overlay: recovered clears; terminal/stuck are offered; advice too; transient reports still dropped', () => {
  assert.match(handler, /if \(payload\.recovered\) \{\s*setAudioWarnings\(\(s\) => clearAudioWarning\(s, payload\.channel, \(w\) => w\.kind === 'audio-capture-failure' && w\.clearsOnRecovery !== false\)\);\s*return;/);
  assert.match(handler, /if \(payload\.terminal \|\| payload\.stuck\) \{/);
  assert.match(handler, /\} else if \(payload\.advisory\) \{/);
  assert.doesNotMatch(handler, /setIsExpanded\(true\)/);
  assert.match(handler, /if \(payload\.terminal\) revealOverlayForWarning\(\);/, 'only a terminal fault reopens the overlay');
});

test('overlay: reopening is quiet (no focus) and leaves an open overlay alone (O2)', () => {
  const at = overlay.indexOf('const revealOverlayForWarning = useCallback(() => {');
  const fn = overlay.slice(at, overlay.indexOf('}, []);', at));
  assert.match(fn, /if \(isExpandedRef\.current\) return;\s*isStealthRef\.current = true;\s*setIsExpanded\(true\);/);
  const denied = overlay.slice(overlay.indexOf('onSystemAudioPermissionDenied?.((message: string, titleKey?: string) => {'));
  assert.match(denied.slice(0, 700), /revealOverlayForWarning\(\);/);
  assert.doesNotMatch(denied.slice(0, 700), /setIsExpanded\(true\)/);
});

test('overlay: the warnings end with the meeting, not on the start-side session reset (O1)', () => {
  assert.match(overlay, /onMeetingStateChanged\?\.\(\(data\) => \{\s*if \(!data\?\.isActive\) setAudioWarnings\(resetAudioWarnings\(\)\);/);
  // main checks permissions BEFORE the start-side reset; clearing there would
  // wipe this meeting's "Screen Recording Blocked" as it arrives.
  const reset = overlay.slice(overlay.indexOf("console.log('[NativelyInterface] Resetting session state...');"));
  assert.doesNotMatch(reset.slice(0, 9000), /setAudioWarnings/);
});

test('overlay: the ✕ closes the warning it shows; a rebuilt capture clears a terminal system warning', () => {
  assert.match(overlay, /onDismiss=\{\(\) => setAudioWarnings\(dismissShownAudioWarning\)\}/);
  assert.match(overlay, /setAudioWarnings\(\(s\) => clearAudioWarning\(s, 'system', \(w\) => w\.kind === 'audio-capture-failure' && !!w\.terminal\)\);/);
  // Advice does not stand in for "Transcription Stopped".
  assert.match(overlay, /const audioFailureBannerActive = systemAudioWarning\?\.kind === 'audio-capture-failure' && audioWarningSeverity\(systemAudioWarning\) >= 2;/);
});

test('notes window mirrors the recovery, except for problems audio does not fix', () => {
  assert.match(notes, /if \(p\?\.recovered\) \{\s*if \(stickyCaptureProblems\.current\.has\(key\)\) return;/);
  assert.match(notes, /if \(p\.clearsOnRecovery === false\) stickyCaptureProblems\.current\.add\(key\);/);
});
