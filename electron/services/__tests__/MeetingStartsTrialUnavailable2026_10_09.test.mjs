// The automatic trial on a device that has already had one. The server says
// so; main remembers it, so the Natively API card can take the trial's place
// and the next meeting does not ask again. The overlay is offered no manual start: its
// existing "no AI set up" notice is already the right thing to show.
//
// A separate file from MeetingStartsTrial because "claimed" is permanent, and
// the compiled module's credentials live for the whole process.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadIpcHandlers } from './autoTrialHarness.mjs';

let ipc;
before(() => { ipc = loadIpcHandlers('meeting-starts-trial-used'); });
const told = () => ipc.sends.filter((s) => s.channel === 'trial-auto-start').map((s) => s.data);

test('the meeting ended while the first attempt was failing: no second attempt, nobody told', async () => {
  ipc.state.reply = async () => { ipc.state.meetingActive = false; throw new Error('offline'); };
  ipc.appState.autoStartTrialForMeeting();
  await ipc.settle();
  assert.equal(ipc.trialStartCalls.length, 1, 'a trial must not start for a meeting that is over');
  assert.deepEqual(told(), [{ state: 'pending' }, { state: 'settled' }]);
  ipc.state.meetingActive = true;
});

test('trial already used on this device: claimed locally, the overlay is offered nothing', async () => {
  ipc.trialStartCalls.length = 0;
  ipc.sends.length = 0;
  ipc.state.reply = async () => ({
    ok: true, trial_token: 'old_tok', already_used: true, expired: true,
    started_at: '2026-09-01T10:00:00Z', expires_at: '2026-09-01T10:30:00Z',
  });
  ipc.appState.autoStartTrialForMeeting();
  await ipc.settle();
  assert.equal(ipc.trialStartCalls.length, 1, 'the server\'s answer is final: no retry');
  assert.equal(ipc.sends.filter((s) => s.channel === 'trial-started').length, 0);
  assert.deepEqual(told(), [{ state: 'pending' }, { state: 'settled' }], 'not a failure: there is no manual start to offer');
  const local = await ipc.handlers.get('trial:get-local')({});
  assert.equal(local.hasToken, false);
  assert.equal(local.trialClaimed, true);
  assert.ok(ipc.sends.some((s) => s.channel === 'credentials-changed'), 'the launcher re-reads its card inputs');
});

test('the next meeting does not ask the server again', async () => {
  ipc.trialStartCalls.length = 0;
  ipc.state.reply = async () => { throw new Error('must not be called'); };
  ipc.appState.autoStartTrialForMeeting();
  await ipc.settle();
  assert.equal(ipc.trialStartCalls.length, 0);
});
