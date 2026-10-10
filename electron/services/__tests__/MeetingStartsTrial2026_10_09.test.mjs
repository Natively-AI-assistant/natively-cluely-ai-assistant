// A meeting that starts with no AI to answer it starts the free trial by
// itself (2026-10-09). It replaced the "try Natively" card on Home, which
// reached about one new install in twelve while half of them started their
// first meeting with nothing configured, and so with no transcript either
// (with no keys the transcription provider is 'none').
//
// This EXECUTES the real hook out of the compiled bundle: what matters is
// which meeting starts make a request, and a source reading cannot tell that.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadIpcHandlers, LIVE_TRIAL } from './autoTrialHarness.mjs';

let ipc;
before(() => { ipc = loadIpcHandlers('meeting-starts-trial'); });

const startMeeting = () => ipc.appState.autoStartTrialForMeeting();
const sent = (channel) => ipc.sends.filter((s) => s.channel === channel);
// What the overlay is told about the automatic start, in order.
const told = () => sent('trial-auto-start').map((s) => s.data);

test('main registers the meeting-start hook', () => {
  assert.equal(typeof ipc.appState.autoStartTrialForMeeting, 'function');
  assert.equal(typeof ipc.appState.autoTrialSettled, 'function');
});

test('own AI keys: the meeting starts no trial', async () => {
  await ipc.handlers.get('set-groq-api-key')({}, 'gsk_test_own_key');
  startMeeting();
  await ipc.settle();
  assert.equal(ipc.trialStartCalls.length, 0);
  assert.deepEqual(told(), [], 'nothing was attempted, so the overlay hears nothing');
  await ipc.handlers.get('set-groq-api-key')({}, '');
});

test('offline: one retry, then the overlay is told so it can offer the manual start', async () => {
  ipc.state.reply = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
  startMeeting();
  await ipc.settle();
  assert.equal(ipc.trialStartCalls.length, 2, 'the first failure is retried once');
  // 'pending' first: the overlay holds back "Transcription Not Configured"
  // (true for a second, with no keys) while the trial is on its way.
  assert.deepEqual(told(), [{ state: 'pending' }, { state: 'failed', reason: 'unreachable' }]);
  assert.equal(sent('trial-started').length, 0);
  const local = await ipc.handlers.get('trial:get-local')({});
  assert.equal(local.hasToken, false);
  assert.equal(local.trialClaimed, false, 'a start that never reached the server claims nothing');
});

test('no AI: the meeting starts the trial, without waiting for it', async () => {
  ipc.trialStartCalls.length = 0;
  ipc.sends.length = 0;
  let release;
  ipc.state.reply = () => new Promise((resolve) => { release = () => resolve(LIVE_TRIAL()); });
  const returned = startMeeting();
  assert.equal(returned, undefined, 'the hook returns at once: a meeting never waits on the network');
  assert.equal(ipc.appState.autoTrialSettled(), false);
  // A second start request while the first is in flight must not double up.
  startMeeting();
  while (!release) await new Promise((r) => setTimeout(r, 5));
  release();
  await ipc.settle();
  assert.equal(ipc.trialStartCalls.length, 1);
  assert.equal(ipc.trialStartCalls[0].hwid, 'meeting-starts-trial-hwid');
  assert.equal(sent('trial-started').length, 1);
  assert.deepEqual(told(), [{ state: 'pending' }, { state: 'settled' }]);
  const local = await ipc.handlers.get('trial:get-local')({});
  assert.equal(local.hasToken, true);
  assert.equal(local.trialClaimed, true);
});

test('a trial is already running: the next meeting starts nothing', async () => {
  ipc.trialStartCalls.length = 0;
  ipc.state.reply = async () => { throw new Error('must not be called'); };
  startMeeting();
  await ipc.settle();
  assert.equal(ipc.trialStartCalls.length, 0);
});
