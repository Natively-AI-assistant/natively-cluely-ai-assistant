// Windows taskbar contract: in normal mode Natively owns ONE taskbar button
// (the launcher's, grouped with its pinned / Start-menu shortcut), and in
// undetectable mode none.
//
// Three source-confirmed ways it broke (Electron 43.1.0, electron-builder
// 26.8.1; reviewed, not executed on Windows — see the commit message):
//   1. NativeWindowViews::SetFocusable(true) calls SetSkipTaskbar(false) →
//      ITaskbarList::AddTab. The overlay/pill/toggle are skipTaskbar windows,
//      and syncOverlayInteractionPolicy called setFocusable(true) on every hover
//      when the no-activate policy was not applied (stealth hook missing, or a
//      CJK IME active at launch) — and again on every undetectable toggle.
//   2. The NSIS installer stamps every shortcut with System.AppUserModel.ID =
//      build.appId, but the app set com.natively.assistant.<mode>, so a pinned
//      shortcut and the running window were two buttons.
//   3. No setWindowOpenHandler: target=_blank links opened a default Electron
//      window — a taskbar button with no content protection, even in
//      undetectable mode (macOS too, minus the taskbar).
//
// Platform is injected everywhere, so both branches run on either OS.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const dist = (p) => path.join(repoRoot, 'dist-electron/electron', p);

const {
  WINDOWS_APP_USER_MODEL_ID,
  LEGACY_LOGIN_ITEM_NAMES,
  appUserModelIdForDisguise,
  setOpenAtLogin,
  getOpenAtLogin,
} = require(dist('utils/windowsTaskbarPolicy.js'));
const { restoreFocusableOffTaskbar } = require(dist('utils/windowsFocusPolicy.js'));
const { shouldOpenExternally } = require(dist('utils/windowOpenPolicy.js'));

const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

// --- 2. AppUserModelID ------------------------------------------------------

test('the undisguised app uses the installer shortcut AppUserModelID (build.appId)', () => {
  assert.equal(WINDOWS_APP_USER_MODEL_ID, pkg.build.appId,
    'must equal package.json build.appId — NSIS stamps it on every shortcut (WinShell::SetLnkAUMI)');
  assert.equal(appUserModelIdForDisguise('none'), pkg.build.appId);
});

test('disguise modes keep their own AppUserModelIDs (they must NOT group with the real app)', () => {
  assert.equal(appUserModelIdForDisguise('terminal'), 'com.natively.assistant.terminal');
  assert.equal(appUserModelIdForDisguise('settings'), 'com.natively.assistant.settings');
  assert.equal(appUserModelIdForDisguise('activity'), 'com.natively.assistant.activity');
});

// --- 2b. open-at-login keyed on a stable name ---------------------------------

function fakeLoginApi(launchItems = []) {
  const calls = [];
  return {
    calls,
    setLoginItemSettings(s) { calls.push(s); },
    getLoginItemSettings(o) { calls.push({ get: o }); return { openAtLogin: 'MAC_VALUE', launchItems }; },
  };
}

test('win32: enabling open-at-login removes every legacy per-disguise entry, then writes the stable one', () => {
  const api = fakeLoginApi();
  setOpenAtLogin(api, 'win32', true, 'C:\\Natively\\Natively.exe');
  const deletes = api.calls.slice(0, -1);
  assert.deepEqual(deletes.map((c) => [c.name, c.openAtLogin]), LEGACY_LOGIN_ITEM_NAMES.map((n) => [n, false]));
  assert.deepEqual(api.calls.at(-1), {
    openAtLogin: true, openAsHidden: false, path: 'C:\\Natively\\Natively.exe', name: WINDOWS_APP_USER_MODEL_ID,
  });
  // The old default (com.natively.assistant.none) is one of the cleaned names.
  assert.ok(LEGACY_LOGIN_ITEM_NAMES.includes('com.natively.assistant.none'));
  assert.ok(!LEGACY_LOGIN_ITEM_NAMES.includes(WINDOWS_APP_USER_MODEL_ID));
});

test('win32: disabling open-at-login deletes the stable AND every legacy entry', () => {
  const api = fakeLoginApi();
  setOpenAtLogin(api, 'win32', false, 'C:\\Natively\\Natively.exe');
  assert.ok(api.calls.every((c) => c.openAtLogin === false));
  assert.deepEqual(api.calls.map((c) => c.name).sort(), [WINDOWS_APP_USER_MODEL_ID, ...LEGACY_LOGIN_ITEM_NAMES].sort());
});

test('win32: open-at-login reads any enabled user entry we own, under the stable or a legacy name', () => {
  const exe = 'C:\\Natively\\Natively.exe';
  const item = (name, enabled = true, scope = 'user') => ({ name, enabled, scope, path: exe });
  assert.equal(getOpenAtLogin(fakeLoginApi([item('com.natively.assistant.none')]), 'win32', exe), true);
  assert.equal(getOpenAtLogin(fakeLoginApi([item(WINDOWS_APP_USER_MODEL_ID)]), 'win32', exe), true);
  assert.equal(getOpenAtLogin(fakeLoginApi([item(WINDOWS_APP_USER_MODEL_ID, false)]), 'win32', exe), false);
  assert.equal(getOpenAtLogin(fakeLoginApi([item('SomethingElse')]), 'win32', exe), false);
  assert.equal(getOpenAtLogin(fakeLoginApi([item(WINDOWS_APP_USER_MODEL_ID, true, 'machine')]), 'win32', exe), false);
  assert.equal(getOpenAtLogin(fakeLoginApi([]), 'win32', exe), false);
});

test('darwin: open-at-login is exactly the previous single call (no names, no cleanup)', () => {
  const api = fakeLoginApi();
  setOpenAtLogin(api, 'darwin', true, '/Applications/Natively.app/Contents/MacOS/Natively');
  assert.deepEqual(api.calls, [{ openAtLogin: true, openAsHidden: false, path: '/Applications/Natively.app/Contents/MacOS/Natively' }]);
  assert.equal(getOpenAtLogin(fakeLoginApi(), 'darwin', '/x'), 'MAC_VALUE');
});

// --- 1. setFocusable(true) must not re-add a taskbar button ------------------

function fakeFocusWindow(focusable) {
  const calls = [];
  return {
    calls,
    isFocusable() { return focusable; },
    setFocusable(f) { calls.push(['setFocusable', f]); focusable = f; },
    setSkipTaskbar(s) { calls.push(['setSkipTaskbar', s]); },
  };
}

test('an already-focusable window is left alone (setFocusable(true) would only AddTab)', () => {
  for (const platform of ['win32', 'darwin']) {
    const win = fakeFocusWindow(true);
    restoreFocusableOffTaskbar(win, platform);
    assert.deepEqual(win.calls, [], platform);
  }
});

test('win32: making a window focusable immediately takes it back off the taskbar', () => {
  const win = fakeFocusWindow(false);
  restoreFocusableOffTaskbar(win, 'win32');
  assert.deepEqual(win.calls, [['setFocusable', true], ['setSkipTaskbar', true]]);
});

test('darwin: making a window focusable touches nothing else (no taskbar)', () => {
  const win = fakeFocusWindow(false);
  restoreFocusableOffTaskbar(win, 'darwin');
  assert.deepEqual(win.calls, [['setFocusable', true]]);
});

// --- 3. window.open / target=_blank -----------------------------------------

test('only https links leave the app, and only to the default browser', () => {
  assert.equal(shouldOpenExternally('https://natively.software/docs'), true);
  for (const url of ['http://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'about:blank',
    'x-apple.systempreferences:com.apple.preference.security', 'ms-settings:privacy', 'not a url', '']) {
    assert.equal(shouldOpenExternally(url), false, url);
  }
});

// --- wiring guards -----------------------------------------------------------

function tsFilesUnder(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') out.push(...tsFilesUnder(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

test('no electron/ code calls setFocusable(true) directly', () => {
  const offenders = [];
  for (const file of tsFilesUnder(path.join(repoRoot, 'electron'))) {
    if (file.endsWith(path.join('utils', 'windowsFocusPolicy.ts'))) continue;
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (/^\s*\*/.test(code)) return;
      if (/\.setFocusable\s*\(\s*true\s*\)/.test(code)) offenders.push(`${path.relative(repoRoot, file)}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [],
    'Use restoreFocusableOffTaskbar(): on Windows setFocusable(true) re-adds a taskbar button (AddTab).');
});

test('main.ts sets the AppUserModelID through the policy and denies every new window', () => {
  const main = fs.readFileSync(path.join(repoRoot, 'electron/main.ts'), 'utf8');
  assert.ok(/app\.setAppUserModelId\(\s*appUserModelIdForDisguise\(\s*mode\s*\)\s*\)/.test(main),
    'BUG: _applyDisguise must call app.setAppUserModelId(appUserModelIdForDisguise(mode)).');
  assert.ok(!/com\.natively\.assistant\.\$\{/.test(main), 'BUG: the old template AUMID is back in main.ts.');
  assert.ok(/on\(\s*['"]web-contents-created['"][\s\S]{0,400}setWindowOpenHandler/.test(main),
    'BUG: every webContents needs a setWindowOpenHandler (app.on("web-contents-created")).');
  const whenReady = main.indexOf('await app.whenReady()');
  const hook = main.search(/on\(\s*['"]web-contents-created['"]/);
  assert.ok(hook >= 0 && hook < whenReady, 'BUG: register the window-open policy before any window can exist.');
});

test('the open-at-login IPC goes through the stable-name helpers', () => {
  const ipc = fs.readFileSync(path.join(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');
  const set = ipc.slice(ipc.indexOf("safeHandle('set-open-at-login'"), ipc.indexOf("safeHandle('get-open-at-login'"));
  const get = ipc.slice(ipc.indexOf("safeHandle('get-open-at-login'"), ipc.indexOf("safeHandle('get-open-at-login'") + 400);
  assert.ok(/setOpenAtLogin\(\s*app\s*,\s*process\.platform/.test(set), 'BUG: set-open-at-login must call setOpenAtLogin(app, process.platform, …).');
  assert.ok(/getOpenAtLogin\(\s*app\s*,\s*process\.platform/.test(get), 'BUG: get-open-at-login must call getOpenAtLogin(app, process.platform, …).');
});
