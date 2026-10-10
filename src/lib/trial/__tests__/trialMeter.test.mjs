// The launcher's small free-trial card (2026-10-10): the time left on the
// clock and how much of the two allowances a trial can run out of, voice and
// AI, has been used. The rule is pure, so every reading the card can show is
// checked here without a window.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRIAL_ENDING_MS } from '../overlayTrialNotice.mjs';
import { TRIAL_METER_HIGH_PCT, shouldShowTrialMeter, trialClock, trialMeterView } from '../trialMeter.mjs';

const MIN = 60_000;
const NOW = Date.parse('2026-10-10T10:00:00Z');
const LIMITS = { ai_tokens: 60_000, stt_minutes: 30 };
const view = (over = {}) => trialMeterView({
  now: NOW,
  expiresAt: NOW + 20 * MIN,
  usage: { ai_tokens: 14_000, stt_seconds: 12 * 60 },
  limits: LIMITS,
  ...over,
});
const row = (v, id) => v.rows.find((r) => r.id === id);

test('the clock reads minutes and zero-padded seconds, and never goes below 0:00', () => {
  assert.equal(trialClock(30 * MIN), '30:00');
  assert.equal(trialClock(18 * MIN + 42_000), '18:42');
  assert.equal(trialClock(9 * MIN + 4_000), '9:04');
  // 400 ms left is still "1 second", not 0:00: zero is the moment it ends.
  assert.equal(trialClock(400), '0:01');
  assert.equal(trialClock(0), '0:00');
  assert.equal(trialClock(-5_000), '0:00');
});

test('a running trial shows the clock and both allowances', () => {
  const v = view();
  assert.equal(v.clock, '20:00');
  assert.equal(v.timeLow, false);
  assert.deepEqual(v.rows.map((r) => r.id), ['voice', 'ai']);
  assert.deepEqual(row(v, 'voice'), { id: 'voice', used: 12, limit: 30, unit: 'minutes', percent: 40, fill: 40, tone: 'ok' });
  assert.deepEqual(row(v, 'ai'), { id: 'ai', used: 14_000, limit: 60_000, unit: 'tokens', percent: (14_000 * 100) / 60_000, fill: (14_000 * 100) / 60_000, tone: 'ok' });
  assert.equal(v.tone, 'ok');
});

test('voice is metered in seconds and shown in minutes', () => {
  assert.equal(row(view({ usage: { ai_tokens: 0, stt_seconds: 90 } }), 'voice').used, 1.5);
});

test('there is no card without a live trial', () => {
  assert.equal(trialMeterView({ now: NOW, expiresAt: null, usage: {}, limits: LIMITS }), null);
  assert.equal(trialMeterView({ now: NOW, expiresAt: NaN, usage: {}, limits: LIMITS }), null);
  assert.equal(view({ expiresAt: NOW }), null, 'at 0:00 the Trial ended card takes over');
  assert.equal(view({ expiresAt: NOW - 1 }), null);
  assert.equal(trialMeterView(null), null);
});

test('the last five minutes turn the clock amber, the same moment the overlay warns', () => {
  assert.equal(view({ expiresAt: NOW + TRIAL_ENDING_MS + 1 }).timeLow, false);
  const v = view({ expiresAt: NOW + TRIAL_ENDING_MS });
  assert.equal(v.timeLow, true);
  assert.equal(v.tone, 'low');
});

test('an allowance turns amber when it runs low and red when it is used up', () => {
  const lowAt = (LIMITS.ai_tokens * TRIAL_METER_HIGH_PCT) / 100;
  assert.equal(row(view({ usage: { ai_tokens: lowAt - 1, stt_seconds: 0 } }), 'ai').tone, 'ok');
  assert.equal(row(view({ usage: { ai_tokens: lowAt, stt_seconds: 0 } }), 'ai').tone, 'low');
  assert.equal(row(view({ usage: { ai_tokens: 59_999, stt_seconds: 0 } }), 'ai').tone, 'low');
  assert.equal(row(view({ usage: { ai_tokens: 60_000, stt_seconds: 0 } }), 'ai').tone, 'out');
  assert.equal(row(view({ usage: { ai_tokens: 0, stt_seconds: 30 * 60 } }), 'voice').tone, 'out');
});

test('the card takes the worst reading on it', () => {
  assert.equal(view({ usage: { ai_tokens: 50_000, stt_seconds: 0 } }).tone, 'low');
  assert.equal(view({ usage: { ai_tokens: 50_000, stt_seconds: 31 * 60 } }).tone, 'out');
  assert.equal(view({ expiresAt: NOW + MIN, usage: { ai_tokens: 60_000, stt_seconds: 0 } }).tone, 'out');
});

test('past the limit the number is the real one and the bar stops at full', () => {
  const r = row(view({ usage: { ai_tokens: 66_000, stt_seconds: 0 } }), 'ai');
  assert.equal(r.used, 66_000);
  assert.equal(r.percent, 110);
  assert.equal(r.fill, 100);
});

test('usage that has not arrived reads as nothing used, never as NaN', () => {
  for (const usage of [undefined, null, {}, { ai_tokens: 'x', stt_seconds: undefined }, { ai_tokens: -5, stt_seconds: -1 }]) {
    const v = view({ usage });
    assert.deepEqual(v.rows.map((r) => [r.used, r.percent, r.tone]), [[0, 0, 'ok'], [0, 0, 'ok']]);
  }
});

test('an allowance with no limit is left off instead of drawn as a confident 0%', () => {
  assert.deepEqual(view({ limits: { ai_tokens: 60_000 } }).rows.map((r) => r.id), ['ai']);
  assert.deepEqual(view({ limits: { stt_minutes: 30, ai_tokens: 0 } }).rows.map((r) => r.id), ['voice']);
  assert.deepEqual(view({ limits: undefined }).rows, []);
});

test('a closed card stays closed until what it shows gets worse', () => {
  assert.equal(shouldShowTrialMeter('ok', null), true);
  assert.equal(shouldShowTrialMeter('ok', 'ok'), false);
  assert.equal(shouldShowTrialMeter('low', 'ok'), true, 'five minutes left is news');
  assert.equal(shouldShowTrialMeter('low', 'low'), false);
  assert.equal(shouldShowTrialMeter('out', 'low'), true, 'an allowance used up is news');
  assert.equal(shouldShowTrialMeter('out', 'out'), false);
  assert.equal(shouldShowTrialMeter('ok', 'low'), false, 'closed is closed when nothing is worse');
});

test('a clock that runs behind the server never shows more time than a trial has', () => {
  // The same skew as in the overlay: 20 s behind read "30:20" on a 30 minute trial.
  const behind = { expiresAt: NOW + 30 * MIN + 20_000 };
  assert.equal(view(behind).clock, '30:20', 'without the length, the raw difference');
  const capped = view({ ...behind, limits: { ...LIMITS, duration_ms: 30 * MIN } });
  assert.equal(capped.clock, '30:00');
  assert.equal(capped.msLeft, 30 * MIN);
  // A cap, never a floor; a bad length is ignored.
  assert.equal(view({ expiresAt: NOW + 12 * MIN, limits: { ...LIMITS, duration_ms: 30 * MIN } }).clock, '12:00');
  assert.equal(view({ ...behind, limits: { ...LIMITS, duration_ms: 0 } }).clock, '30:20');
  assert.equal(trialClock(31 * MIN, 30 * MIN), '30:00');
  assert.equal(trialClock(5 * MIN, 30 * MIN), '5:00');
});
