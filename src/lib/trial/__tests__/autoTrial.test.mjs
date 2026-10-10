import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shouldAutoStartTrial, classifyAutoTrial, runAutoTrial, autoTrialFollowUp, AUTO_TRIAL_QUIET_MS } from '../autoTrial.mjs';
import { TRIAL_RETRY_DELAY_MS, startTrialWithRetry } from '../trialStart.mjs';

const eligible = { meetingAi: 'none', hasRealNativelyKey: false, licensed: false, trialClaimed: false, hasTrialToken: false, credentialsReadable: true };

test('a meeting with no AI, on a device that never had a trial, starts one', () => {
  assert.equal(shouldAutoStartTrial(eligible), true);
});

for (const [why, change] of [
  ['the user\'s own AI answers the meeting', { meetingAi: 'own' }],
  ['Natively already answers the meeting', { meetingAi: 'natively' }],
  ['a real Natively key is stored', { hasRealNativelyKey: true }],
  ['a licence is active', { licensed: true }],
  ['the trial was already claimed', { trialClaimed: true }],
  ['a trial token is already held', { hasTrialToken: true }],
  // Review, 2026-10-10: an unreadable keychain looks exactly like "nothing set
  // up, never had a trial". Starting one then spends an existing customer's
  // only trial and cannot even switch them onto it (writes are refused).
  ['the credential store could not be read', { credentialsReadable: false }],
  ['nobody said whether the credential store was read', { credentialsReadable: undefined }],
]) {
  test(`no automatic trial when ${why}`, () => {
    assert.equal(shouldAutoStartTrial({ ...eligible, ...change }), false);
  });
}

test('missing or unknown state never starts a trial', () => {
  assert.equal(shouldAutoStartTrial(null), false);
  assert.equal(shouldAutoStartTrial(undefined), false);
  assert.equal(shouldAutoStartTrial({}), false);
  assert.equal(shouldAutoStartTrial({ ...eligible, meetingAi: undefined }), false);
});

test('a reply is read the way the trial card read it, plus the no-hardware-id case', () => {
  assert.equal(classifyAutoTrial({ ok: true, hasToken: true }), 'started');
  assert.equal(classifyAutoTrial({ ok: true, hasToken: true, already_used: true }), 'unavailable');
  assert.equal(classifyAutoTrial({ ok: true, expired: true }), 'unavailable');
  // A refusal about the NETWORK, not the device: it says nothing about whether
  // this machine has had a trial, so it must not be remembered as one.
  assert.equal(classifyAutoTrial({ ok: false, error: 'trial_ip_limit', status: 403 }), 'network_limited');
  // The server's daily ceiling on new trials (its budget guard) is the same kind
  // of answer: not about this device, nothing to remember, ask again another day.
  assert.equal(classifyAutoTrial({ ok: false, error: 'trial_daily_limit', status: 403 }), 'network_limited');
  assert.equal(classifyAutoTrial({ ok: false, error: 'trial_start_rate_limited', status: 429 }), 'rate_limited');
  assert.equal(classifyAutoTrial({ ok: false, error: 'network_error' }), 'failed');
  assert.equal(classifyAutoTrial(null), 'failed');
  // A retry can never fix a machine with no hardware id, so it is not "failed".
  assert.equal(classifyAutoTrial({ ok: false, error: 'hardware_id_unavailable' }), 'unsupported');
});

test('our own failure is retried once, after the usual wait', async () => {
  const replies = [{ ok: false, error: 'network_error' }, { ok: true, hasToken: true }];
  const waits = [];
  let calls = 0;
  const outcome = await runAutoTrial(async () => replies[calls++], async (ms) => { waits.push(ms); });
  assert.equal(outcome, 'started');
  assert.equal(calls, 2);
  assert.deepEqual(waits, [TRIAL_RETRY_DELAY_MS]);
});

test('a second failure is final, and a throw counts as a failure', async () => {
  let calls = 0;
  const outcome = await runAutoTrial(async () => { calls++; throw new Error('offline'); }, async () => {});
  assert.equal(outcome, 'failed');
  assert.equal(calls, 2);
});

for (const reply of [
  { ok: true, hasToken: true },
  { ok: true, expired: true },
  { ok: false, error: 'trial_start_rate_limited', status: 429 },
  { ok: false, error: 'hardware_id_unavailable' },
]) {
  test(`the server's answer is final, no retry: ${JSON.stringify(reply)}`, async () => {
    let calls = 0;
    await runAutoTrial(async () => { calls++; return reply; }, async () => { assert.fail('must not wait'); });
    assert.equal(calls, 1);
  });
}

test('what main does next for each outcome', () => {
  assert.deepEqual(autoTrialFollowUp('started'), { markClaimed: false, notify: null, quietMs: 0 });
  // The device has had its trial: remember it, so the Natively API card can take over.
  assert.deepEqual(autoTrialFollowUp('unavailable'), { markClaimed: true, notify: null, quietMs: 0 });
  assert.deepEqual(autoTrialFollowUp('unsupported'), { markClaimed: false, notify: null, quietMs: 0 });
  // Too many trials from this network, or the server's ceiling for the day: not
  // this device's answer. Nothing is written, so a later meeting may start one.
  // But not the very next: asking at every meeting would walk an honest user
  // into the server's hourly limit and the "too many attempts" banner.
  assert.deepEqual(autoTrialFollowUp('network_limited'), { markClaimed: false, notify: null, quietMs: AUTO_TRIAL_QUIET_MS });
  assert.equal(AUTO_TRIAL_QUIET_MS, 30 * 60_000);
  assert.deepEqual(autoTrialFollowUp('failed'), { markClaimed: false, notify: 'unreachable', quietMs: 0 });
  // The server's hourly limit on start attempts is per NETWORK, and it counts
  // attempts the network's own cap then refuses. On an office or campus address
  // that is already at its cap, someone who has done nothing would get "too
  // many attempts" and a Start button that cannot work, at every meeting that
  // hour. Quiet, like the cap itself.
  assert.deepEqual(autoTrialFollowUp('rate_limited'), { markClaimed: false, notify: null, quietMs: AUTO_TRIAL_QUIET_MS });
});

test('one retry loop serves both readings of a reply', async () => {
  // runAutoTrial is the card's loop with the automatic start's classifier, not a copy of it.
  const seen = [];
  const outcome = await startTrialWithRetry(async () => ({ ok: false, error: 'hardware_id_unavailable' }), async () => { assert.fail('must not wait'); }, (res) => { seen.push(res.error); return 'unsupported'; });
  assert.equal(outcome, 'unsupported');
  assert.deepEqual(seen, ['hardware_id_unavailable']);
  // The network refusal is final too: no retry.
  let calls = 0;
  assert.equal(await runAutoTrial(async () => { calls++; return { ok: false, error: 'trial_ip_limit', status: 403 }; }, async () => { assert.fail('must not wait'); }), 'network_limited');
  assert.equal(calls, 1);
});
