// electron/utils/__tests__/windowTitleGuard.test.mjs
//
// Contract tests for createPageTitleGuard() — the stealth gate that stops the
// renderer's HTML <title> ("Natively") from owning the window title while
// undetectable. A proctor enumerating window titles would otherwise read the
// brand. The page loads async (after createWindow) and Electron's default
// page-title-updated behaviour pushes the <title> into the window title.
//
// The module is dependency-free, so it loads in bare `node --test`. We import
// the COMPILED output (dist-electron/...), which is why `build:electron` runs first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const { createPageTitleGuard } = require(
  path.join(repoRoot, 'dist-electron/electron/utils/windowTitleGuard.js'),
);

// Build a fake page-title-updated event that records whether preventDefault ran.
const fakeEvent = () => {
  let prevented = false;
  return {
    preventDefault: () => { prevented = true; },
    wasPrevented: () => prevented,
  };
};

test('undetectable: prevents the page title and re-asserts the disguise title', () => {
  const setTitles = [];
  const guard = createPageTitleGuard({
    isUndetectable: () => true,
    disguiseTitle: () => 'Activity Monitor',
    setTitle: (t) => setTitles.push(t),
  });
  const ev = fakeEvent();
  guard(ev);
  assert.equal(ev.wasPrevented(), true, 'must stop the <title> from reaching the window');
  assert.deepEqual(setTitles, ['Activity Monitor']);
});

test('normal mode: inert — no preventDefault, no title change', () => {
  const setTitles = [];
  const guard = createPageTitleGuard({
    isUndetectable: () => false,
    disguiseTitle: () => 'Activity Monitor',
    setTitle: (t) => setTitles.push(t),
  });
  const ev = fakeEvent();
  guard(ev);
  assert.equal(ev.wasPrevented(), false, 'normal mode lets the page title through');
  assert.deepEqual(setTitles, []);
});

test('reads undetectable at EVENT time, not attach time (mid-session toggle)', () => {
  let undetectable = true;
  const setTitles = [];
  const guard = createPageTitleGuard({
    isUndetectable: () => undetectable,
    disguiseTitle: () => 'Terminal',
    setTitle: (t) => setTitles.push(t),
  });

  // Undetectable ON: guarded.
  guard(fakeEvent());
  assert.deepEqual(setTitles, ['Terminal']);

  // User toggles undetectable OFF: the next page-title change is let through.
  undetectable = false;
  guard(fakeEvent());
  assert.deepEqual(setTitles, ['Terminal'], 'no new title once undetectable is off');

  // Toggle back ON: guarded again, no re-attach needed.
  undetectable = true;
  guard(fakeEvent());
  assert.deepEqual(setTitles, ['Terminal', 'Terminal']);
});

test('disguise title is read at event time (disguise-mode switch honoured)', () => {
  let mode = 'activity';
  const titleFor = (m) => (m === 'activity' ? 'Activity Monitor' : 'Terminal');
  const setTitles = [];
  const guard = createPageTitleGuard({
    isUndetectable: () => true,
    disguiseTitle: () => titleFor(mode),
    setTitle: (t) => setTitles.push(t),
  });

  guard(fakeEvent());
  mode = 'terminal';
  guard(fakeEvent());
  assert.deepEqual(setTitles, ['Activity Monitor', 'Terminal']);
});
