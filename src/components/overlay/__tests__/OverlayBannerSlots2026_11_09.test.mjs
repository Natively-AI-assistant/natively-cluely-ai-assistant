// At most two banners at once in the meeting overlay, by priority (O8,
// 2026-11-09). About a dozen folds could stack, 50-80 px each, and push the
// answer off the screen mid-call. The lower ones are held, not lost.
// Platform-neutral: the macOS-only and Windows-only banners are gated by the
// overlay before they reach the picker, and both go through it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OVERLAY_BANNER_CAP, OVERLAY_BANNER_PRIORITY, audioBannerId, pickOverlayBanners } from '../overlayBannerSlots.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const overlay = fs.readFileSync(path.resolve(here, '../../NativelyInterface.tsx'), 'utf8');

test('two at most, the most important first', () => {
  assert.equal(OVERLAY_BANNER_CAP, 2);
  const all = Object.fromEntries(OVERLAY_BANNER_PRIORITY.map((id) => [id, true]));
  assert.deepEqual([...pickOverlayBanners(all)], ['auto-stop', 'audio-error']);
  // A dead mic and stopped transcription do not hide the auto-stop warning.
  assert.deepEqual([...pickOverlayBanners({ 'audio-error': true, 'stt-error': true, 'auto-stop': true })], ['auto-stop', 'audio-error']);
  assert.deepEqual([...pickOverlayBanners({ 'hotkey-conflict': true, trial: true, 'refusal-retry': true })], ['trial', 'refusal-retry']);
  assert.deepEqual([...pickOverlayBanners({ 'audio-advisory': true })], ['audio-advisory']);
  assert.deepEqual([...pickOverlayBanners({})], []);
});

test('the order: faults that mean nothing is heard, then transcription, then the rest', () => {
  const rank = (id) => OVERLAY_BANNER_PRIORITY.indexOf(id);
  assert.ok(rank('audio-error') < rank('stt-error'));
  assert.ok(rank('stt-error') < rank('stt-warning'));
  assert.ok(rank('stt-warning') < rank('trial'));
  // Auto-stop ends the meeting unless the user acts: never held behind errors.
  assert.equal(rank('auto-stop'), 0);
  assert.ok(rank('trial') < rank('last-time'));
  assert.ok(rank('last-time') < rank('capture-fallback'));
  assert.ok(rank('capture-fallback') < rank('hotkey-conflict'));
  assert.equal(OVERLAY_BANNER_PRIORITY.at(-1), 'audio-advisory', 'advice is last');
  assert.equal(new Set(OVERLAY_BANNER_PRIORITY).size, OVERLAY_BANNER_PRIORITY.length);
});

test('held, not lost: when a slot frees, the next one takes it', () => {
  const wanted = { 'audio-error': true, 'stt-warning': true, trial: true };
  assert.ok(!pickOverlayBanners(wanted).has('trial'));
  assert.ok(pickOverlayBanners({ ...wanted, 'audio-error': false }).has('trial'));
});

test('the audio banner ranks by its severity', () => {
  assert.equal(audioBannerId(3), 'audio-error');
  assert.equal(audioBannerId(2), 'audio-stuck');
  assert.equal(audioBannerId(1), 'audio-advisory');
});

test('every banner fold in the overlay goes through the picker', () => {
  const folds = {
    'fold-audio-warning': /show=\{audioWarningSlotted\}/,
    'fold-last-time': /bannerSlots\.has\('last-time'\)/,
    'fold-trial-notice': /bannerSlots\.has\('trial'\)/,
    'fold-auto-stop': /bannerSlots\.has\('auto-stop'\)/,
    'fold-ambient-mic': /bannerSlots\.has\('ambient-mic'\)/,
    'fold-stt-not-configured': /bannerSlots\.has\('stt-not-configured'\)/,
    'fold-stt-status': /bannerSlots\.has\(sttStatusBanner\?\.tone === 'error' \? 'stt-error' : 'stt-warning'\)/,
    'fold-capture-fallback': /bannerSlots\.has\('capture-fallback'\)/,
    'fold-refusal-retry': /bannerSlots\.has\('refusal-retry'\)/,
    'fold-hotkey-conflict': /bannerSlots\.has\('hotkey-conflict'\)/,
    'fold-accessibility': /isMac && stealthPermissionMissing && bannerSlots\.has\('stealth-permission'\)/,
    'fold-stealth-hook-blocked': /isWindows && stealthPermissionMissing && bannerSlots\.has\('stealth-permission'\)/,
  };
  for (const [testId, re] of Object.entries(folds)) {
    const at = overlay.indexOf(`testId="${testId}"`);
    assert.ok(at > 0, testId);
    const tag = overlay.slice(overlay.lastIndexOf('<ChromeFold', at), at);
    assert.match(tag, re, testId);
  }
  assert.match(overlay, /const bannerSlots = pickOverlayBanners\(\{/);
  assert.match(overlay, /const audioBannerSlotId = audioBannerId\(audioWarningSeverity\(systemAudioWarning\), audioFailureBannerActive && sttFailed\);/);
  assert.match(overlay, /\[audioBannerSlotId\]: !!systemAudioWarning,/);
  // Both stealth banners want the same slot, whichever platform draws one.
  assert.match(overlay, /'stealth-permission': \(isMac \|\| isWindows\) && stealthPermissionMissing,/);
});
