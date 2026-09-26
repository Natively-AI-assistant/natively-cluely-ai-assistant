// One "Trial ended" card, a wipe that tells the truth, and a reachable
// "All set" (toaster policy Phase 3, spec §5 rows 3, 5, 6; §7.5).
//
// - Settings → Plans used to open a second copy of the card whenever main said
//   it was due; App's launcher host is the only one now (Settings keeps the
//   card only as the mid-trial options card from "See your options").
// - trial-ended {choice:'byok'} arrives while the card is still Cleaning up;
//   both hosts used to unmount it there, so "All set" was reachable only when
//   the wipe FAILED (and then said the data was gone).
// - A failed wipe now throws, and the card says so with Try again.
//
// Source assertions: App and the Settings pane are not unit-renderable here.
// The main-process half is executed in
// electron/services/__tests__/TrialEndByokHonest2026_09_26.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, '..', rel), 'utf8');
const app = read('../App.tsx');
const settings = read('settings/NativelyApiSettings.tsx');
const modal = read('trial/FreeTrialModal.tsx');

const appCard = app.slice(app.indexOf('showTrialExpiredModal && ('), app.indexOf('{/* Ad toasters */}'));

test('App: a failed BYOK wipe throws, so the card cannot say "All set"', () => {
  assert.ok(appCard.includes("const res = await window.electronAPI?.endTrialByok?.(opts);"));
  assert.ok(appCard.includes("if (!res?.success) throw new Error('wipe_failed');"));
  assert.ok(appCard.includes('return { wipeIncomplete: !!res.wipeIncomplete };'), 'the card learns whether data was left behind');
});

test('App: "Add my keys" opens Settings → AI Providers', () => {
  assert.ok(appCard.includes("onDone={(reason) => {"));
  assert.ok(appCard.includes("if (reason === 'byok') openSettingsExclusive('ai-providers');"));
});

test('App: the Standard plan runs no second wipe (the wipe runs once, at expiry)', () => {
  assert.ok(!appCard.includes('wipeTrialProfileData'));
});

test('App: trial-ended from the BYOK exit leaves the card to finish itself', () => {
  const ended = app.slice(app.indexOf('const removeTrialListener'), app.indexOf('const removeTrialStartedListener'));
  assert.ok(ended.includes("const removeTrialListener = window.electronAPI?.onTrialEnded?.((data) => {"));
  assert.ok(ended.includes("if (data?.choice !== 'byok') {"), 'only other endings close the card');
});

test('Settings never opens a second Trial ended card', () => {
  assert.ok(!/showEndedCard\) setShowTrialModal\(true\)/.test(settings));
  assert.ok(settings.includes('{showTrialModal && trialState?.active && ('), 'the Settings copy is the mid-trial options card only');
});

test('Settings: its options card ends the trial honestly and is not unmounted mid-wipe', () => {
  const byok = settings.slice(settings.indexOf('const handleByok'), settings.indexOf('const handleTrialDone'));
  assert.ok(byok.includes('const res = await window.electronAPI?.endTrialByok?.(opts);'));
  assert.ok(byok.includes("if (!res?.success) throw new Error('wipe_failed');"));
  assert.ok(byok.includes('return { wipeIncomplete: !!res.wipeIncomplete };'));
  const ended = settings.slice(settings.indexOf('const off = window.electronAPI?.onTrialEnded?.('), settings.indexOf('return () => off?.();'));
  assert.ok(ended.includes("if (data?.choice === 'byok' && showTrialModalRef.current) return;"));
  const done = settings.slice(settings.indexOf('const handleTrialDone'), settings.indexOf('};', settings.indexOf('const handleTrialDone')));
  assert.ok(done.includes("window.electronAPI?.openSettingsTab?.('ai-providers')"), '"Add my keys" goes to AI Providers here too');
});

test('the card: a failed wipe says so in plain words, with Try again', () => {
  const byok = modal.slice(modal.indexOf('const handleByok'), modal.indexOf('// The trial is still running'));
  assert.ok(byok.includes('setWipeFailures((n) => n + 1);'), 'counts failures');
  assert.ok(byok.includes('setError(WIPE_FAILED_COPY);') && !/e\??\.message/.test(byok), 'never the exception text');
  // Steps commit in order, so a late failure is a PARTIAL wipe: never claim nothing changed.
  assert.ok(modal.includes('const WIPE_FAILED_COPY = "Couldn\'t finish clearing your trial data. Try again.";'));
  assert.ok(modal.includes("{error ? 'Try again' : isActiveTrial ? 'End trial, use my own keys' : 'Use my own API keys'}"));
});

// Final review I2: a wipe that keeps failing (full disk, a locked database)
// must not wall the user in behind a card that cannot close.
test('the card: after a second failure, End trial anyway', () => {
  assert.ok(modal.includes('{wipeFailures >= 2 && ('), 'offered only after repeated failures');
  assert.ok(modal.includes('onClick={() => handleByok({ force: true })}'));
  assert.ok(modal.includes('End trial anyway'));
});

test('the card: All set says honestly when data was left behind', () => {
  const byok = modal.slice(modal.indexOf('const handleByok'), modal.indexOf('// The trial is still running'));
  assert.ok(byok.includes('const result = await onByok(opts);'));
  assert.ok(byok.includes('setWipeIncomplete(!!result?.wipeIncomplete);'));
  assert.ok(modal.includes("{wipeIncomplete ? \"Trial ended. Some trial data couldn't be cleared.\" : 'Trial data is gone.'}"));
});

test('the card: All set leads to the keys', () => {
  assert.ok(modal.includes('<span>Add my keys</span>'));
  assert.ok(!modal.includes('<span>Open Natively</span>'));
});
