// macOS Dock-tile contract: exactly ONE Natively tile in normal mode, NONE in
// undetectable mode.
//
// Three mechanisms broke it, each reproduced on the real build (2026-09-23,
// Electron 43.1.0, packaged-like bundle without LSUIElement, Dock tiles counted
// through the Accessibility API):
//
//   1. BrowserWindow.setVisibleOnAllWorkspaces() without
//      skipTransformProcessType flips the activation policy itself —
//      visibleOnFullScreen:true runs Browser::DockHide(), false runs DockShow().
//      Every overlay-family window called it at creation, so startup did
//      regular→UIElement→regular several times in ~350ms. Electron's own
//      DockHide() comment: rapid hide/show leaves "multiple dock icons".
//   2. The startup setActivationPolicy('accessory') … ('regular') round-trip
//      added more of the same churn. As shipped: 4 tiles at startup, 2 left
//      after quit. skipTransformProcessType + no round-trip: 1 tile.
//   3. process.title on macOS goes through libuv's _LSApplicationCheckIn, which
//      re-registers the app as a Foreground app: a HIDDEN Dock tile comes back.
//      _applyDisguise re-asserted it at +200/+1000/+5000ms even in undetectable
//      mode, after the startup enforcement loop had finished.
//
// Platform is injected (no process.platform mutation), so both branches run on
// either OS. The last test is a source guard: the only direct
// setVisibleOnAllWorkspaces() call left in electron/ is the one in the policy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const {
  setVisibleOnAllWorkspacesKeepingDock,
  shouldPromoteToRegularAtStartup,
  planDisguiseTitleWrites,
  DOCK_ENFORCE_INTERVAL_MS,
  DOCK_ENFORCE_MAX_ATTEMPTS,
  DOCK_ENFORCE_STARTUP_MAX_ATTEMPTS,
  ELECTRON_DOCK_HIDE_GUARD_MS,
} = require(path.join(repoRoot, 'dist-electron/electron/utils/macDockPolicy.js'));
const { disguiseAppName } = require(path.join(repoRoot, 'dist-electron/electron/utils/disguiseAppName.js'));

function fakeWindow() {
  const calls = [];
  return {
    calls,
    setVisibleOnAllWorkspaces(visible, options) {
      calls.push([visible, options]);
    },
  };
}

test('workspace visibility never lets Electron transform the process type', () => {
  for (const [visible, visibleOnFullScreen] of [[true, true], [false, false], [true, false]]) {
    const win = fakeWindow();
    setVisibleOnAllWorkspacesKeepingDock(win, visible, visibleOnFullScreen);
    assert.deepEqual(win.calls, [[visible, { visibleOnFullScreen, skipTransformProcessType: true }]]);
  }
});

test('startup promotes to regular only on macOS, only in normal mode, only when no tile is up', () => {
  // Dev Electron.app is patched to LSUIElement=1 (born without a tile): promote once.
  assert.equal(shouldPromoteToRegularAtStartup('darwin', false, false), true);
  // Packaged bundle is born regular: a second promotion is pointless churn.
  assert.equal(shouldPromoteToRegularAtStartup('darwin', false, true), false);
  // Undetectable must never gain a tile.
  assert.equal(shouldPromoteToRegularAtStartup('darwin', true, false), false);
  assert.equal(shouldPromoteToRegularAtStartup('darwin', true, true), false);
  // Windows has no activation policy; the taskbar is driven by skipTaskbar.
  for (const undetectable of [true, false]) {
    for (const dockVisible of [true, false]) {
      assert.equal(shouldPromoteToRegularAtStartup('win32', undetectable, dockVisible), false);
    }
  }
});

test('disguise title re-asserts are suppressed only where they unhide the macOS Dock', () => {
  // Hidden macOS Dock: no delayed re-asserts, no identical rewrite (the
  // undetectable startup path wrote the title BEFORE hiding the Dock), and a
  // re-hide after any write that does happen.
  assert.deepEqual(planDisguiseTitleWrites('darwin', true), {
    scheduleReasserts: false,
    skipUnchangedWrite: true,
    reassertStealthAfterWrite: true,
  });
  assert.deepEqual(planDisguiseTitleWrites('darwin', false), {
    scheduleReasserts: true,
    skipUnchangedWrite: false,
    reassertStealthAfterWrite: false,
  });
  // Windows: process.title is the console title, no Dock. Behaviour unchanged.
  for (const undetectable of [true, false]) {
    assert.deepEqual(planDisguiseTitleWrites('win32', undetectable), {
      scheduleReasserts: true,
      skipUnchangedWrite: false,
      reassertStealthAfterWrite: false,
    });
  }
});

test('disguise names are unchanged per platform (one source for startup and _applyDisguise)', () => {
  const expected = {
    darwin: { terminal: 'Terminal ', settings: 'System Settings ', activity: 'Activity Monitor ', none: 'Natively' },
    win32: { terminal: 'Command Prompt ', settings: 'Settings ', activity: 'Task Manager ', none: 'Natively' },
  };
  for (const [platform, names] of Object.entries(expected)) {
    for (const [mode, name] of Object.entries(names)) {
      assert.equal(disguiseAppName(mode, platform), name, `${platform}/${mode}`);
    }
  }
  // Anything outside the union falls back to the real name, like _applyDisguise's default.
  assert.equal(disguiseAppName('service', 'darwin'), 'Natively');
});

// Electron's Browser::DockHide() is a silent no-op for 1 s after any
// DockShow() (browser_mac.mm, base::Seconds(1)). Measured on the real build: a
// fast OFF→ON toggle had three hides ignored before the fourth took. The
// enforcement loop must keep retrying past that second. (PR #595.)
test('dock enforcement retries outlast Electron\'s 1 s DockHide guard', () => {
  assert.equal(ELECTRON_DOCK_HIDE_GUARD_MS, 1000);
  assert.ok(DOCK_ENFORCE_INTERVAL_MS * DOCK_ENFORCE_MAX_ATTEMPTS > ELECTRON_DOCK_HIDE_GUARD_MS);
  assert.ok(DOCK_ENFORCE_STARTUP_MAX_ATTEMPTS >= DOCK_ENFORCE_MAX_ATTEMPTS);
});

test('no electron/ window calls setVisibleOnAllWorkspaces directly', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        walk(full);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        if (full.endsWith(path.join('utils', 'macDockPolicy.ts'))) continue;
        fs.readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
          const code = line.replace(/\/\/.*$/, '');
          if (/^\s*\*/.test(code)) return;
          if (/\.setVisibleOnAllWorkspaces\s*\(/.test(code)) {
            offenders.push(`${path.relative(repoRoot, full)}:${i + 1}`);
          }
        });
      }
    }
  };
  walk(path.join(repoRoot, 'electron'));
  assert.deepEqual(
    offenders,
    [],
    'Call setVisibleOnAllWorkspacesKeepingDock() instead — the raw call flips the macOS ' +
      'activation policy (DockHide/DockShow) unless skipTransformProcessType is passed.',
  );
});
