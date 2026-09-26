// "Trial ended" claims the card slot the moment it is due (toaster policy
// Phase 2, final review #2; spec §3.2 rule 5).
//
// At launch App waits 10 s before opening the card, and the no-keys cards it
// competes with (natively_api_new) show at ~6 s. The orchestrator must hear
// "Trial ended is open" when the card becomes DUE, not when it paints, or the
// two end up on screen together. The delay timer must also die with the
// trial: a key saved inside those 10 s supersedes the trial, and the timer
// used to reopen the card anyway.
//
// Source assertions: App.tsx's mount effect is not unit-renderable. The
// orchestrator side (the open card is taken away) is behavioural, in
// src/lib/onboarding/__tests__/orchestratorCardGates.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(here, '..', '..', 'App.tsx'), 'utf8');

test('the orchestrator hears Trial ended while it is due, not only once it paints', () => {
  assert.ok(app.includes('setOrchestratorUserState({ trialEndedOpen: showTrialExpiredModal || trialEndedDue });'));
});

test('the launch path marks the card due before its 10 s delay', () => {
  const launch = app.slice(app.indexOf('if (local.showEndedCard)'), app.indexOf('// Seed the banner from the LOCAL token'));
  assert.ok(launch.includes('setTrialEndedDue(true);'), 'due at once');
  assert.ok(launch.indexOf('setTrialEndedDue(true);') < launch.indexOf('setTimeout('), 'before the delay starts');
  assert.ok(launch.includes('trialEndedTimer = setTimeout('), 'the delay handle is kept');
});

test('a superseded trial kills the delay and releases the slot', () => {
  const ended = app.slice(app.indexOf('const removeTrialListener'), app.indexOf('const removeTrialStartedListener'));
  assert.ok(ended.includes('if (trialEndedTimer) { clearTimeout(trialEndedTimer); trialEndedTimer = null; }'));
  assert.ok(ended.includes('setTrialEndedDue(false);'));
});

test('unmount clears the delay', () => {
  assert.ok(app.includes('if (trialEndedTimer) clearTimeout(trialEndedTimer);'));
});

test('closing the card releases the slot', () => {
  const done = app.slice(app.indexOf('onDone={(reason) => {', app.indexOf('showTrialExpiredModal && (')));
  assert.ok(done.slice(0, 200).includes('setTrialEndedDue(false);'));
});
