// A start that finds the trial already run out on this device is remembered,
// whichever button asked. The Home card used to record that answer itself; with
// the card gone, main does, so the manual start the overlay offers after a
// failed automatic one leaves the same trace as the automatic one would have.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadIpcHandlers } from './autoTrialHarness.mjs';

let ipc;
before(() => { ipc = loadIpcHandlers('trial-used-is-remembered'); });

test('a manual start that the server answers "already used and run out" marks the trial claimed', async () => {
  assert.equal((await ipc.handlers.get('trial:get-local')({})).trialClaimed, false);
  ipc.state.reply = async () => ({
    ok: true, trial_token: 'old_tok', already_used: true, expired: true,
    started_at: '2026-09-01T10:00:00Z', expires_at: '2026-09-01T10:30:00Z',
  });
  const res = await ipc.handlers.get('trial:start')({}, 'overlay');
  assert.equal(res.ok, true);
  assert.equal(res.expired, true);
  const local = await ipc.handlers.get('trial:get-local')({});
  assert.equal(local.hasToken, false, 'a run-out trial is never stored as a live one');
  assert.equal(local.trialClaimed, true);
});

test('so the next meeting does not ask again', async () => {
  ipc.trialStartCalls.length = 0;
  ipc.appState.autoStartTrialForMeeting();
  await ipc.settle();
  assert.equal(ipc.trialStartCalls.length, 0);
});
