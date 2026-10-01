import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '../../..', rel), 'utf8');

// The OS silently drops global-shortcut (RegisterHotKey / Carbon-IOKit)
// registrations on sleep/wake and display/workspace change — KeybindManager
// names those exact causes (HEALTH_CHECK_INTERVAL_MS comment). Until this
// wiring existed they were only recovered by the 10 s health poll, so for up to
// 10 s after the event the app's own chord (CommandOrControl+Enter, +1..7, …)
// leaked its completing key into the focused app. These guard the event-driven
// recovery that closes that window. Source-level because main.ts has no runtime
// test seam; the behaviour of revalidateShortcuts() itself is covered by
// KeybindRegistrationState + the manager.

function sliceBlock(src, startMarker) {
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, `marker not found: ${startMarker}`);
  // Grab a generous window — enough to contain the handler body.
  return src.slice(start, start + 600);
}

test('the powerMonitor resume handler revalidates global shortcuts', () => {
  const main = read('electron/main.ts');
  // Bound the slice by the NEXT handler so the whole resume body is captured
  // regardless of comment length.
  const start = main.indexOf("powerMonitor.on('resume'");
  const end = main.indexOf("powerMonitor.on('suspend'");
  assert.ok(start >= 0 && end > start, 'resume/suspend handlers not found in order');
  const block = main.slice(start, end);
  assert.match(
    block,
    /revalidateShortcuts\(\)/,
    'resume must recover shortcuts the OS dropped across sleep/wake, not wait up to 10 s for the health poll.',
  );
});

test('the powerMonitor unlock-screen handler revalidates global shortcuts', () => {
  const main = read('electron/main.ts');
  const start = main.indexOf("powerMonitor.on('unlock-screen'");
  assert.ok(start >= 0, 'unlock-screen handler not found');
  const block = main.slice(start, start + 400);
  assert.match(
    block,
    /revalidateShortcuts\(\)/,
    'unlock-screen must recover shortcuts the OS dropped while the session was locked.',
  );
});

test('display add/remove revalidate global shortcuts', () => {
  const main = read('electron/main.ts');
  assert.match(
    main,
    /screen\.on\(\s*'display-added'/,
    'a display-added listener must exist (docking / external monitor / workspace switch drops RegisterHotKey).',
  );
  assert.match(
    main,
    /screen\.on\(\s*'display-removed'/,
    'a display-removed listener must exist for the same reason.',
  );
  const block = sliceBlock(main, 'const revalidateOnDisplayChange');
  assert.match(
    block,
    /revalidateShortcuts\(\)/,
    'the display-change handler must call revalidateShortcuts().',
  );
});

test('revalidateShortcuts only recovers dropped shortcuts (never unregisters)', () => {
  // The recovery calls are safe to fire on every resume/display event precisely
  // because revalidateShortcuts is idempotent: it re-registers only what
  // isRegistered() reports lost. This pins that contract in the source so a
  // future refactor cannot turn it into an unregisterAll()-style pass.
  const km = read('electron/services/KeybindManager.ts');
  const fn = km.slice(
    km.indexOf('public revalidateShortcuts('),
    km.indexOf('private startHealthCheck('),
  );
  assert.ok(fn.length > 0, 'revalidateShortcuts() not found');
  assert.doesNotMatch(
    fn,
    /unregisterAll\(/,
    'revalidateShortcuts must NOT unregisterAll — that would open the very gap it closes.',
  );
  assert.match(
    fn,
    /isRegistered\(/,
    'revalidateShortcuts must skip still-live shortcuts via isRegistered().',
  );
});
