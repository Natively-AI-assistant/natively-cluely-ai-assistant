import { test } from 'node:test';
import assert from 'node:assert/strict';

import { overlayTrialNotice, TRIAL_ENDING_MS, TRIAL_STARTED_BANNER_MS } from '../overlayTrialNotice.mjs';

const MIN = 60_000;
const t0 = 1_800_000_000_000;
const trial = { expiresAt: t0 + 30 * MIN, announcedAt: t0, liveThisMeeting: true };
const at = (ms, extra = {}) => overlayTrialNotice({ now: t0 + ms, ...trial, ...extra });

const NOTHING = { banner: null, chip: null, minutesLeft: null };
const counting = (minutesLeft, tone = 'ok') => ({ banner: null, chip: { minutesLeft, tone }, minutesLeft });

test('no trial, nothing failed: the overlay shows nothing', () => {
  assert.deepEqual(overlayTrialNotice({ now: t0 }), NOTHING);
  assert.deepEqual(overlayTrialNotice({ now: t0, expiresAt: null, startFailed: null }), NOTHING);
});

test('a trial that just started: the banner alone, which says the minutes itself', () => {
  // No countdown beside it: "started: 30 minutes" and "30 min left" would say
  // the same thing twice. The countdown is what the banner folds into.
  assert.deepEqual(at(0), { banner: 'started', chip: null, minutesLeft: 30 });
});

test('the started banner folds away by itself, leaving the countdown', () => {
  assert.equal(at(TRIAL_STARTED_BANNER_MS - 1).banner, 'started');
  assert.deepEqual(at(TRIAL_STARTED_BANNER_MS), counting(30));
});

test('closing the started banner leaves the countdown', () => {
  assert.deepEqual(at(1_000, { dismissed: { started: true } }), counting(30));
});

test('a trial this overlay did not see start (Settings, an earlier launch) shows only the countdown', () => {
  assert.deepEqual(at(0, { announcedAt: null }), counting(30));
});

test('minutes are rounded up, and never read zero while the trial is live', () => {
  assert.equal(at(2 * MIN + 1, { announcedAt: null }).chip.minutesLeft, 28);
  assert.equal(at(2 * MIN, { announcedAt: null }).chip.minutesLeft, 28);
  assert.equal(at(30 * MIN - 1).chip.minutesLeft, 1);
});

test('the warning starts at exactly five minutes left', () => {
  assert.deepEqual(at(30 * MIN - TRIAL_ENDING_MS - 1), counting(6));
  assert.deepEqual(at(30 * MIN - TRIAL_ENDING_MS), { banner: 'ending', chip: { minutesLeft: 5, tone: 'warning' }, minutesLeft: 5 });
});

test('the warning has no close: it stays, with the amber countdown, until the trial ends', () => {
  const warning = (minutesLeft) => ({ banner: 'ending', chip: { minutesLeft, tone: 'warning' }, minutesLeft });
  assert.deepEqual(at(27 * MIN, { dismissed: { started: true, ending: true } }), warning(3));
  assert.deepEqual(at(30 * MIN - 1, { dismissed: { started: true, ending: true } }), warning(1));
});

test('a trial that starts with under five minutes left warns instead of announcing', () => {
  assert.equal(overlayTrialNotice({ now: t0, expiresAt: t0 + 2 * MIN, announcedAt: t0, liveThisMeeting: true }).banner, 'ending');
});

test('at the expiry instant the trial has ended: banner, no countdown', () => {
  assert.equal(at(30 * MIN - 1).banner, 'ending');
  assert.deepEqual(at(30 * MIN), { banner: 'ended', chip: null, minutesLeft: null });
  assert.deepEqual(at(45 * MIN), { banner: 'ended', chip: null, minutesLeft: null });
});

test('the ended banner cannot be closed away', () => {
  assert.equal(at(30 * MIN, { dismissed: { started: true } }).banner, 'ended');
});

test('a trial that ran out before this meeting is not announced as ended in it', () => {
  assert.deepEqual(overlayTrialNotice({ now: t0, expiresAt: t0 - MIN, liveThisMeeting: false }), NOTHING);
});

test('an automatic start that failed offers the manual start, and cannot be closed away', () => {
  const FAILED = { banner: 'failed', chip: null, minutesLeft: null };
  assert.deepEqual(overlayTrialNotice({ now: t0, startFailed: 'unreachable' }), FAILED);
  assert.deepEqual(overlayTrialNotice({ now: t0, startFailed: 'rate_limited' }), FAILED);
  // Closed, it would hand the overlay to "Transcription Not Configured", which
  // sends the user to Settings › Audio: the wrong advice for a trial that
  // could not start. It goes when the trial starts, keys are added, or the
  // next meeting begins.
  assert.deepEqual(overlayTrialNotice({ now: t0, startFailed: 'unreachable', dismissed: { started: true, ending: true, failed: true } }), FAILED);
});

test('a trial that is live wins over an earlier failed start', () => {
  assert.deepEqual(at(0, { startFailed: 'unreachable' }), { banner: 'started', chip: null, minutesLeft: 30 });
});

test('a clock that runs behind the server never shows more minutes than a trial has', () => {
  // Review, 2026-10-10: the expiry is the server's, the clock is this machine's.
  // Twenty seconds behind made the banner read "started: 31 minutes".
  const behind = { now: t0, expiresAt: t0 + 30 * MIN + 20_000, announcedAt: t0, liveThisMeeting: true };
  assert.equal(overlayTrialNotice(behind).minutesLeft, 31, 'without the length, the raw difference');
  assert.deepEqual(overlayTrialNotice({ ...behind, durationMs: 30 * MIN }), { banner: 'started', chip: null, minutesLeft: 30 });
  assert.equal(overlayTrialNotice({ ...behind, now: t0 + 60_000, announcedAt: null, durationMs: 30 * MIN }).chip.minutesLeft, 30);
  // The length is a cap, never a floor, and a bad one is ignored.
  assert.equal(overlayTrialNotice({ ...behind, now: t0 + 10 * MIN, announcedAt: null, durationMs: 30 * MIN }).chip.minutesLeft, 21);
  assert.equal(overlayTrialNotice({ ...behind, durationMs: NaN }).minutesLeft, 31);
  assert.equal(overlayTrialNotice({ ...behind, durationMs: 0 }).minutesLeft, 31);
});
