// src/lib/trial/trialMeter.mjs
//
// What the launcher's small free-trial card shows (2026-10-10): the time left
// on the clock, and how much of the two allowances a trial can run out of
// before the clock does, voice and AI, has been used.
//
// Pure: the card (src/components/trial/TrialMeterToaster.tsx) feeds it the
// clock and what the launcher already holds about the trial, and draws what
// comes back. The numbers are formatted there, with the same formatMeter the
// usage rows in Settings use, so the two can never disagree by a rounding step.

import { TRIAL_ENDING_MS } from './overlayTrialNotice.mjs';

/** An allowance reads as running low from here: the usage rows' threshold in Settings. */
export const TRIAL_METER_HIGH_PCT = 80;

const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

const length = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : Infinity);

/**
 * `18:42`. Seconds are zero-padded so the string never changes width.
 *
 * `capMs`, when given, is how long a trial lasts: the expiry is the server's
 * and the clock is this machine's, and one that runs behind would otherwise
 * read more time than a trial has ("30:20").
 */
export function trialClock(msLeft, capMs) {
  const totalSec = Math.ceil(Math.max(0, Math.min(msLeft, length(capMs))) / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function meterRow(id, used, limit, unit) {
  // No limit is not zero usage: it is an answer that has not arrived, or one
  // this build does not understand. The row is left off.
  if (!(typeof limit === 'number' && Number.isFinite(limit) && limit > 0)) return null;
  const percent = (used * 100) / limit;
  const tone = percent >= 100 ? 'out' : percent >= TRIAL_METER_HIGH_PCT ? 'low' : 'ok';
  return { id, used, limit, unit, percent, fill: Math.min(100, percent), tone };
}

/**
 * @param {{
 *   now: number,
 *   expiresAt?: number | null,   when the trial ends (ms)
 *   usage?: { ai_tokens?: number, stt_seconds?: number } | null,
 *   limits?: { ai_tokens?: number, stt_minutes?: number, duration_ms?: number } | null,
 * } | null | undefined} s
 * @returns {null | {
 *   msLeft: number, clock: string, timeLow: boolean,
 *   rows: Array<{ id: 'voice' | 'ai', used: number, limit: number, unit: 'minutes' | 'tokens',
 *                 percent: number, fill: number, tone: 'ok' | 'low' | 'out' }>,
 *   tone: 'ok' | 'low' | 'out',
 * }}  null when there is no running trial to show
 */
export function trialMeterView(s) {
  if (!s || typeof s.expiresAt !== 'number' || !Number.isFinite(s.expiresAt)) return null;
  const usage = s.usage ?? {};
  const limits = s.limits ?? {};
  // Never more than a trial lasts (see trialClock).
  const msLeft = Math.min(s.expiresAt - s.now, length(limits.duration_ms));
  // At 0:00 the Trial ended card takes over; this one has nothing left to count.
  if (!(msLeft > 0)) return null;

  const rows = [
    // Voice is metered in seconds and sold in minutes.
    meterRow('voice', count(usage.stt_seconds) / 60, limits.stt_minutes, 'minutes'),
    meterRow('ai', count(usage.ai_tokens), limits.ai_tokens, 'tokens'),
  ].filter(Boolean);

  const timeLow = msLeft <= TRIAL_ENDING_MS;
  const tone = rows.some((r) => r.tone === 'out') ? 'out'
    : timeLow || rows.some((r) => r.tone === 'low') ? 'low'
      : 'ok';
  return { msLeft, clock: trialClock(msLeft), timeLow, rows, tone };
}

const RANK = { ok: 0, low: 1, out: 2 };

/**
 * A closed card stays closed until what it shows gets worse: closed while all
 * was well, it comes back once for the last five minutes or a low allowance,
 * and once more when an allowance is used up.
 *
 * @param {'ok' | 'low' | 'out'} tone             what the card shows now
 * @param {'ok' | 'low' | 'out' | null} closedAt  what it showed when it was closed, if it was
 */
export function shouldShowTrialMeter(tone, closedAt) {
  if (closedAt == null) return true;
  return RANK[tone] > RANK[closedAt];
}
