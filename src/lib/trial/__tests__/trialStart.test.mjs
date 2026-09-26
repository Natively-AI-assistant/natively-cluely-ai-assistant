// What a trial:start reply means for the Free-trial promo (toaster policy
// Phase 3, docs/superpowers/specs/2026-09-26-toaster-policy-design.md §6 rows
// 7-8). Replies are main's trial:start shapes (electron/ipcHandlers.ts) and
// the server codes the Settings card already handles (NativelyApiSettings).
//
// Run: node --experimental-strip-types --test src/lib/trial/__tests__/trialStart.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyTrialStart, startTrialWithRetry, TRIAL_START_COPY } from '../trialStart.mjs';

const rows = [
  ['a stored token', { ok: true, hasToken: true, persisted: true }, 'started'],
  ['a stored token (persisted not reported)', { ok: true, hasToken: true }, 'started'],
  ['the server says the trial is used up', { ok: true, expired: true, hasToken: false }, 'unavailable'],
  ['already used on this device', { ok: true, already_used: true, expired: true }, 'unavailable'],
  ['IP limit', { ok: false, error: 'trial_ip_limit', status: 403 }, 'unavailable'],
  ['already_used code', { ok: false, error: 'already_used', status: 409 }, 'unavailable'],
  ['trial_already_used code', { ok: false, error: 'trial_already_used', status: 409 }, 'unavailable'],
  ['trial_expired code', { ok: false, error: 'trial_expired', status: 410 }, 'unavailable'],
  ['rate limited by code', { ok: false, error: 'trial_start_rate_limited', status: 429 }, 'rate_limited'],
  ['rate limited by status', { ok: false, error: 'request_failed', status: 429 }, 'rate_limited'],
  ['server error', { ok: false, error: 'request_failed', status: 503 }, 'failed'],
  ['network error', { ok: false, error: 'fetch failed' }, 'failed'],
  ['timeout', { ok: false, error: 'The operation was aborted due to timeout' }, 'failed'],
  ['no device id', { ok: false, error: 'hardware_id_unavailable' }, 'failed'],
  ['ok but no token', { ok: true, hasToken: false }, 'failed'],
  ['token that could not be stored', { ok: true, hasToken: true, persisted: false }, 'failed'],
  ['no reply at all', undefined, 'failed'],
];
for (const [name, res, want] of rows) {
  test(`classifyTrialStart: ${name} → ${want}`, () => {
    assert.equal(classifyTrialStart(res), want);
  });
}

function fakeStart(replies) {
  const calls = { n: 0 };
  const start = async () => { const r = replies[Math.min(calls.n, replies.length - 1)]; calls.n += 1; if (r instanceof Error) throw r; return r; };
  return { start, calls };
}
const waits = () => { const log = []; return { log, wait: async (ms) => { log.push(ms); } }; };

test('startTrialWithRetry: our error is retried once after 3 s', async () => {
  const { start, calls } = fakeStart([{ ok: false, error: 'fetch failed' }, { ok: true, hasToken: true }]);
  const w = waits();
  assert.equal(await startTrialWithRetry(start, w.wait), 'started');
  assert.equal(calls.n, 2);
  assert.deepEqual(w.log, [3000]);
});

test('startTrialWithRetry: a second failure is reported, never a third try', async () => {
  const { start, calls } = fakeStart([{ ok: false, error: 'request_failed', status: 502 }]);
  const w = waits();
  assert.equal(await startTrialWithRetry(start, w.wait), 'failed');
  assert.equal(calls.n, 2);
});

test('startTrialWithRetry: a thrown IPC error counts as our error', async () => {
  const { start, calls } = fakeStart([new Error('ipc gone'), { ok: true, hasToken: true }]);
  assert.equal(await startTrialWithRetry(start, waits().wait), 'started');
  assert.equal(calls.n, 2);
});

for (const [kind, reply] of [['unavailable', { ok: true, expired: true }], ['rate_limited', { ok: false, error: 'trial_start_rate_limited' }], ['started', { ok: true, hasToken: true }]]) {
  test(`startTrialWithRetry: ${kind} is final, no retry`, async () => {
    const { start, calls } = fakeStart([reply]);
    const w = waits();
    assert.equal(await startTrialWithRetry(start, w.wait), kind);
    assert.equal(calls.n, 1);
    assert.deepEqual(w.log, []);
  });
}

test('the copy never shows a code', () => {
  assert.deepEqual(Object.keys(TRIAL_START_COPY).sort(), ['failed', 'rate_limited', 'unavailable']);
  for (const [kind, text] of Object.entries(TRIAL_START_COPY)) {
    assert.ok(!/_|\bhttp\b|\d{3}/.test(text), `${kind}: ${text}`);
    assert.ok(text.endsWith('.'), kind);
  }
});
