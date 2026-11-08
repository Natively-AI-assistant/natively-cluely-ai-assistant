/**
 * TrialEndsWhenAiAllowanceUsed2026_11_03.test.mjs
 *
 * When a trial's AI allowance runs out, main ends the trial and sends
 * trial-ended { choice: 'allowance', expiresAt, showEndedCard }. This pins the
 * renderer's side: the overlay shows "Free trial ended" (with See plans) at
 * that moment instead of forgetting the trial, and the launcher opens the
 * Trial ended card instead of closing it.
 *
 * The rule (overlayTrialNotice: an expiry at or before now is 'ended') is
 * executed in src/lib/trial/__tests__; main's side runs compiled in
 * electron/services/__tests__/TrialEndsWhenAiAllowanceUsed2026_11_03.test.mjs.
 * Source-level (`node --test`, no JSX renderer in this repo).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { overlayTrialNotice } from '../../lib/trial/overlayTrialNotice.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const hook = read('src/components/overlay/useOverlayTrial.ts');
const app = read('src/App.tsx');

test('the overlay moves the trial to its end instead of forgetting it', () => {
  const at = hook.indexOf('api?.onTrialEnded?.((data) => {');
  assert.ok(at > 0, 'the overlay reads the trial-ended payload');
  const body = hook.slice(at, at + 600);
  assert.match(body, /data\?\.choice === 'allowance'/);
  assert.match(body, /f\.expiresAt = Math\.min\(f\.expiresAt, endedAt\)/);
  assert.ok(body.indexOf('forgetTrial()') > body.indexOf("'allowance'"), 'every other ending still forgets the trial');
});

test('a trial that ended early in this meeting is drawn as ended, with no countdown', () => {
  const now = Date.parse('2026-11-03T12:00:00Z');
  const notice = overlayTrialNotice({
    now,
    expiresAt: now - 1,
    announcedAt: null,
    liveThisMeeting: true,
    startFailed: null,
    dismissed: {},
    durationMs: 30 * 60_000,
  });
  assert.equal(notice.banner, 'ended');
  assert.equal(notice.chip, null);
});

test('the launcher opens the Trial ended card for it, and stops the poll', () => {
  const at = app.indexOf('const removeTrialListener = window.electronAPI?.onTrialEnded?.((data) => {');
  assert.ok(at > 0);
  const body = app.slice(at, at + 900);
  const branch = body.slice(body.indexOf("data?.choice === 'allowance'"), body.indexOf('return;') + 7);
  assert.ok(branch.length > 20, 'an allowance branch');
  assert.match(branch, /if \(data\.showEndedCard && ownsTrialClock\) setShowTrialExpiredModal\(true\)/);
  assert.match(branch, /clearInterval\(trialPollId\)/);
  assert.ok(!branch.includes('setShowTrialExpiredModal(false)'), 'it must not close the card it just opened');
});
