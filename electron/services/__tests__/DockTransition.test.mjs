import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reducerPath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/services/toggleStateReducer.js'
);

async function load() {
  return import(pathToFileURL(reducerPath).href);
}

// Regression for the macOS rapid-toggle stealth bug: the debounced dock
// hide/show must only run when it would actually change the OS state, and a
// burst of toggles must settle to the user's LAST intent. decideDockTransition
// encodes the skip-if-already-applied gate that prevents activation-policy
// churn (which is what reset window sharingType and broke content protection).
//
// In production the second arg is the OS ground truth `!app.dock.isVisible()`
// (currentlyHidden), re-read on every self-verifying enforcement attempt — so
// shouldApply means "the dock is not yet in the state the user wants."

test('null lastApplied → first ON transition always applies', async () => {
  const { decideDockTransition } = await load();
  assert.deepEqual(decideDockTransition(true, null), { shouldApply: true, next: true });
});

test('null lastApplied → first OFF transition always applies', async () => {
  const { decideDockTransition } = await load();
  assert.deepEqual(decideDockTransition(false, null), { shouldApply: true, next: false });
});

test('settled ON while dock already hidden → skip (no churn)', async () => {
  const { decideDockTransition } = await load();
  const d = decideDockTransition(true, true);
  assert.equal(d.shouldApply, false, 'must NOT re-run dock.hide() when already hidden');
  assert.equal(d.next, true);
});

test('settled OFF while dock already shown → skip (no churn)', async () => {
  const { decideDockTransition } = await load();
  const d = decideDockTransition(false, false);
  assert.equal(d.shouldApply, false, 'must NOT re-run dock.show() when already shown');
  assert.equal(d.next, false);
});

test('settled ON while dock currently shown → apply hide', async () => {
  const { decideDockTransition } = await load();
  assert.deepEqual(decideDockTransition(true, false), { shouldApply: true, next: true });
});

test('settled OFF while dock currently hidden → apply show', async () => {
  const { decideDockTransition } = await load();
  assert.deepEqual(decideDockTransition(false, true), { shouldApply: true, next: false });
});

// Simulate the debounced outcome of a rapid burst: the debounce collapses many
// clicks into ONE decision read against the final settled state. Whatever the
// user's last intent is, exactly one (or zero) dock op fires and it matches.
test('rapid burst ending ON (dock was shown) → exactly one hide, matches intent', async () => {
  const { decideDockTransition } = await load();
  // Only the SETTLED state reaches the decision (debounce coalesces the rest).
  const settled = true; // last click left it ON
  const lastApplied = false; // dock currently shown
  const d = decideDockTransition(settled, lastApplied);
  assert.equal(d.shouldApply, true);
  assert.equal(d.next, true, 'final applied dock state equals user last intent (undetectable)');
});

test('rapid burst returning to original state → zero dock ops', async () => {
  const { decideDockTransition } = await load();
  // User toggled ON then OFF quickly; dock was already shown and stays shown.
  const d = decideDockTransition(false, false);
  assert.equal(d.shouldApply, false, 'no dock churn when net state is unchanged');
});

// Self-verifying enforcement: second arg is currentlyHidden (= !isVisible()).
// These cases model the OS-ground-truth re-read each retry performs.
test('enforce: want undetectable, OS already hidden → no re-apply (converged)', async () => {
  const { decideDockTransition } = await load();
  assert.equal(decideDockTransition(true, /*currentlyHidden*/ true).shouldApply, false);
});

test('enforce: want undetectable, OS still visible (dropped hide) → re-apply', async () => {
  const { decideDockTransition } = await load();
  // The exact failure: app.dock.hide() was issued but macOS dropped it, so the
  // dock is still visible. The enforcement loop must re-issue hide.
  assert.equal(decideDockTransition(true, /*currentlyHidden*/ false).shouldApply, true);
});

test('enforce: want detectable, OS still hidden (dropped show) → re-apply', async () => {
  const { decideDockTransition } = await load();
  assert.equal(decideDockTransition(false, /*currentlyHidden*/ true).shouldApply, true);
});
