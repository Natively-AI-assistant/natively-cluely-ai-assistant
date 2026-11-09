// Banners that could not be closed, or would not stay closed, or never went
// (2026-11-09). Renderer-only; the same on macOS and Windows.
//
//  O6  the transcription banner (pack ended, stopped, reconnecting, backup,
//      falling behind) had no ✕; nor did trial "ending" (up to five minutes)
//      and "ended" (the rest of the meeting). A close holds for this meeting,
//      and a banner that says something new shows again.
//  O4  a local model that is behind has its own notice, translated.
//  O9  "Answer was retried without the browser border" never expired and
//      leaked into the next meeting.
//  O13 the stealth-hotkey conflict present at launch was never shown, and a
//      full re-registration reopened a closed one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { overlayTrialNotice } from '../../lib/trial/overlayTrialNotice.mjs';
import { categorizeSttError, sttLocalModelCause } from '../../lib/sttErrorMapper.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '../..');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const overlay = read('components/NativelyInterface.tsx');

test('O6: every transcription banner has the ✕, keyed so a new one shows again', () => {
  const start = overlay.indexOf('const sttStatusBanner:');
  const chain = overlay.slice(start, overlay.indexOf('const sttStatusBannerOpen', start));
  assert.match(chain, /key: `pack:\$\{packEndedReason\}`/);
  assert.match(chain, /key: 'stopped'/);
  assert.match(chain, /key: 'reconnecting'/);
  assert.match(chain, /key: `backup:\$\{sttInterviewerFallback \|\| sttUserFallback\}`/);
  assert.match(chain, /key: 'behind'/);
  assert.match(overlay, /const sttStatusBannerOpen = !!sttStatusBanner && !sttBannerDismissed\.includes\(sttStatusBanner\.key\);/);
  const fold = overlay.slice(overlay.indexOf('testId="fold-stt-status"'), overlay.indexOf('testId="fold-capture-fallback"'));
  assert.match(fold, /onDismiss=\{\(\) => setSttBannerDismissed\(\(prev\) => \(prev\.includes\(sttStatusBanner\.key\) \? prev : \[\.\.\.prev, sttStatusBanner\.key\]\)\)\}/);
  assert.match(fold, /dismissLabel=\{t\('Dismiss'\)\}/);
});

test('O6: closes and once-per-meeting notices reset with the meeting', () => {
  const reset = overlay.slice(overlay.indexOf("console.log('[NativelyInterface] Resetting session state...');"));
  const body = reset.slice(0, reset.indexOf('analytics.trackConversationStarted();'));
  assert.match(body, /setSttBehind\(false\);/);
  assert.match(body, /setSttBannerDismissed\(\[\]\);/);
  assert.match(body, /setRefusalRetryNotice\(null\);/, 'O9: the retry note does not leak into the next meeting');
});

test('O6: trial ending and ended close for the meeting; the next state still shows', () => {
  const t0 = 1_800_000_000_000;
  const base = { now: t0 + 27 * 60_000, expiresAt: t0 + 30 * 60_000, announcedAt: t0, liveThisMeeting: true };
  assert.equal(overlayTrialNotice(base).banner, 'ending');
  assert.equal(overlayTrialNotice({ ...base, dismissed: { ending: true } }).banner, null);
  assert.equal(overlayTrialNotice({ ...base, dismissed: { ending: true } }).chip?.tone, 'warning', 'the countdown still says it');
  const ended = { ...base, now: t0 + 31 * 60_000 };
  assert.equal(overlayTrialNotice({ ...ended, dismissed: { ending: true } }).banner, 'ended', 'the end is new news');
  const closed = overlayTrialNotice({ ...ended, dismissed: { ended: true } });
  assert.equal(closed.banner, null);
  assert.equal(closed.closed, 'ended');
  // Closed, it still keeps "Transcription Not Configured" away.
  assert.match(overlay, /trial\.closed === 'ended'/);
  // The failed banner stays without a close.
  assert.equal(overlayTrialNotice({ now: t0, startFailed: 'unreachable', dismissed: { ended: true, ending: true } }).banner, 'failed');
});

test('O4: the falling-behind notice and its advice are translated, and the mapper reads it', async () => {
  const raw = 'Transcription is 34 seconds behind: this model is too slow for this computer. Choose a lighter one, such as Moonshine, in Settings › Audio.';
  // The exact wording LocalWhisperSTT raises.
  assert.ok(fs.readFileSync(path.join(SRC, '../electron/audio/LocalWhisperSTT.ts'), 'utf8').includes('this model is too slow for this computer.'));
  assert.equal(sttLocalModelCause([raw]), 'slow');
  assert.equal(categorizeSttError(raw).title, 'Transcription Falling Behind');
  assert.equal(categorizeSttError(raw).category, 'local_model');
  // A real stop still wins over a slow model.
  assert.equal(sttLocalModelCause([raw, 'The local model could not be loaded because this computer ran out of memory.']), 'memory');
  const table = await import(pathToFileURL(path.join(SRC, 'i18n.sttStatus.ts')).href);
  for (const en of ['Transcription Falling Behind', 'This local model is too slow for this computer, so text arrives later and later. Choose a lighter local model in Settings → Audio.']) {
    for (const lang of ['RU', 'ZH', 'JA', 'ES']) assert.ok(table[`STT_STATUS_${lang}`][en], `${lang}: ${en}`);
  }
  // The renderer takes `behind` as a notice, not a state change.
  assert.match(overlay, /if \(data\.behind\) \{\s*setSttBehind\(true\);\s*return;\s*\}/);
});

test('O9: the retry note expires after 20 s, like the page-capture note', () => {
  assert.match(overlay, /if \(!refusalRetryNotice\) return;\s*const timer = setTimeout\(\(\) => setRefusalRetryNotice\(null\), 20_000\);\s*return \(\) => clearTimeout\(timer\);/);
});

test('O13: the conflict is read on mount, and a close holds while the failure is the same', () => {
  const at = overlay.indexOf('const dismissedHotkeyConflictRef = useRef<string | null>(null);');
  assert.ok(at > 0);
  const block = overlay.slice(at, overlay.indexOf('// ── Click-to-activate', at));
  assert.match(block, /if \(dismissedHotkeyConflictRef\.current === accelerator\) return;/);
  assert.match(block, /onKeybindRegistrationSucceeded\?\.\(\(\{ id \}\) => \{[\s\S]*?dismissedHotkeyConflictRef\.current = null;\s*setStealthHotkeyConflict\(null\);/);
  assert.match(block, /api\.getKeybindRegistrationFailures\?\.\(\)\s*\.then\(\(failures\) => \{\s*if \(heardLive\) return;/);
  assert.match(block, /failures\?\.find\(\(f\) => f\.id === 'chat:focusInput'\)/);
  assert.match(overlay, /onDismiss=\{\(\) => \{\s*dismissedHotkeyConflictRef\.current = stealthHotkeyConflict;\s*setStealthHotkeyConflict\(null\);/);
});
