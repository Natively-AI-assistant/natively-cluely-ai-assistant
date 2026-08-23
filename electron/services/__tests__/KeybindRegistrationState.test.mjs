import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/services/keybindRegistrationState.js'
);

async function load() {
  return import(pathToFileURL(modulePath).href);
}

// Regression cover for the two ways the Settings "In use" badges went wrong.
//
// KeybindManager pushes registration outcomes to renderers over IPC, but the
// first registration pass runs from its constructor — before any BrowserWindow
// exists — so those pushes are sent to nobody. Retaining the outcomes is what
// lets a Settings window opened later ask what the situation actually is.
// Everything below is that retention rule.

test('a failure recorded with no renderer listening is still readable afterwards', async () => {
  const { NO_REGISTRATION_FAILURES, recordRegistrationOutcome, listRegistrationFailures } = await load();

  // Boot-time pass: nobody is listening to the IPC push.
  const state = recordRegistrationOutcome(
    NO_REGISTRATION_FAILURES, 'general:take-screenshot', 'CommandOrControl+H', false
  );

  // Settings mounts later and asks.
  assert.deepEqual(listRegistrationFailures(state), [
    { id: 'general:take-screenshot', accelerator: 'CommandOrControl+H' },
  ]);
});

test('a later success clears the failure (health-check recovery)', async () => {
  const { NO_REGISTRATION_FAILURES, recordRegistrationOutcome, listRegistrationFailures } = await load();

  let state = recordRegistrationOutcome(
    NO_REGISTRATION_FAILURES, 'chat:focusInput', 'CommandOrControl+Shift+Space', false
  );
  assert.equal(listRegistrationFailures(state).length, 1);

  // The app that owned the combo quits; revalidateShortcuts() gets it back.
  state = recordRegistrationOutcome(state, 'chat:focusInput', 'CommandOrControl+Shift+Space', true);
  assert.deepEqual(
    listRegistrationFailures(state), [],
    'a recovered shortcut must stop being reported — otherwise the user is told to rebind something that works'
  );
});

test('a full pass drops verdicts it is about to re-derive', async () => {
  const { NO_REGISTRATION_FAILURES, recordRegistrationOutcome, beginFullRegistrationPass, listRegistrationFailures } = await load();

  const state = recordRegistrationOutcome(
    NO_REGISTRATION_FAILURES, 'chat:scrollUp', 'CommandOrControl+Up', false
  );
  assert.equal(listRegistrationFailures(state).length, 1);

  // This pass WILL re-test the id, so the old verdict must not linger and race
  // the fresh one.
  const next = beginFullRegistrationPass(state, () => true);
  assert.deepEqual(listRegistrationFailures(next), []);
});

test('a full pass KEEPS verdicts for ids it will not attempt (launcher mode)', async () => {
  const { NO_REGISTRATION_FAILURES, recordRegistrationOutcome, beginFullRegistrationPass, listRegistrationFailures } = await load();

  // A chat shortcut genuinely lost to another app while in overlay mode.
  const state = recordRegistrationOutcome(
    NO_REGISTRATION_FAILURES, 'chat:focusInput', 'CommandOrControl+Shift+Space', false
  );

  // Back in launcher mode, shouldRegister() rejects every chat:* id, so the
  // pass does not re-test them. Clearing here erased the conflict at exactly
  // the moment the user opens Settings (which is opened FROM the launcher) and
  // the renderer asks for the snapshot — so the badge could never appear for
  // the shortcuts most likely to be conflicted.
  const attemptedInLauncherMode = (id) => !id.startsWith('chat:');
  const next = beginFullRegistrationPass(state, attemptedInLauncherMode);

  assert.deepEqual(
    listRegistrationFailures(next),
    [{ id: 'chat:focusInput', accelerator: 'CommandOrControl+Shift+Space' }],
    'a conflict is a property of the OS, not of which mode Natively is in — an untested id keeps ' +
      'the last verdict actually observed'
  );
});

test('an unchanged outcome keeps the SAME reference, so callers can skip the broadcast', async () => {
  const { NO_REGISTRATION_FAILURES, recordRegistrationOutcome } = await load();

  // The 10s health check re-tests every shortcut. markRegistration() compares
  // the returned reference to decide whether to send IPC to every window; if
  // this identity ever broke, a permanently-conflicted shortcut would spam
  // every renderer every 10 seconds for the life of the process.
  const failed = recordRegistrationOutcome(
    NO_REGISTRATION_FAILURES, 'chat:answer', 'CommandOrControl+5', false
  );
  assert.equal(recordRegistrationOutcome(failed, 'chat:answer', 'CommandOrControl+5', false), failed);

  const ok = recordRegistrationOutcome(failed, 'chat:answer', 'CommandOrControl+5', true);
  assert.notEqual(ok, failed, 'a real change must produce a new reference');
  assert.equal(recordRegistrationOutcome(ok, 'chat:answer', 'CommandOrControl+5', true), ok);
});

test('failures are tracked per id, not collapsed', async () => {
  const { NO_REGISTRATION_FAILURES, recordRegistrationOutcome, listRegistrationFailures } = await load();

  let state = NO_REGISTRATION_FAILURES;
  state = recordRegistrationOutcome(state, 'general:take-screenshot', 'CommandOrControl+H', false);
  state = recordRegistrationOutcome(state, 'chat:whatToAnswer', 'CommandOrControl+1', false);
  state = recordRegistrationOutcome(state, 'general:take-screenshot', 'CommandOrControl+H', true);

  assert.deepEqual(listRegistrationFailures(state), [
    { id: 'chat:whatToAnswer', accelerator: 'CommandOrControl+1' },
  ], 'clearing one id must not clear the others');
});

test('re-recording the same failure does not churn the reference', async () => {
  const { NO_REGISTRATION_FAILURES, recordRegistrationOutcome } = await load();

  const first = recordRegistrationOutcome(
    NO_REGISTRATION_FAILURES, 'chat:answer', 'CommandOrControl+5', false
  );
  const second = recordRegistrationOutcome(first, 'chat:answer', 'CommandOrControl+5', false);

  // The 10s health check re-reports the same unrecoverable shortcut forever.
  assert.equal(second, first, 'an unchanged outcome should return the same object');
});

test('a failure under a new accelerator replaces the old one', async () => {
  const { NO_REGISTRATION_FAILURES, recordRegistrationOutcome, listRegistrationFailures } = await load();

  let state = recordRegistrationOutcome(
    NO_REGISTRATION_FAILURES, 'chat:answer', 'CommandOrControl+5', false
  );
  // User rebinds to another combo that is ALSO taken.
  state = recordRegistrationOutcome(state, 'chat:answer', 'CommandOrControl+Shift+5', false);

  assert.deepEqual(listRegistrationFailures(state), [
    { id: 'chat:answer', accelerator: 'CommandOrControl+Shift+5' },
  ], 'the badge tooltip must name the combo that is currently failing');
});

test('the empty state is not mutated by recording into it', async () => {
  const { NO_REGISTRATION_FAILURES, recordRegistrationOutcome, listRegistrationFailures } = await load();

  recordRegistrationOutcome(NO_REGISTRATION_FAILURES, 'chat:recap', 'CommandOrControl+9', false);

  assert.deepEqual(
    listRegistrationFailures(NO_REGISTRATION_FAILURES), [],
    'the shared empty constant must stay empty — it is the reset value for every full pass'
  );
});
