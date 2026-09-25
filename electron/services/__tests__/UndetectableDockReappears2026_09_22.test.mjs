import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.resolve(repoRoot, rel), 'utf8');

const reducerPath = path.resolve(repoRoot, 'dist-electron/electron/services/toggleStateReducer.js');
const load = () => import(pathToFileURL(reducerPath).href);

// The Dock tile (with its running dot) comes back in undetectable mode, measured
// live on 2026-09-22 (macOS 26, Natively 2.8.8) by polling the process's
// LaunchServices type every 200 ms:
//
//   03:32:57.395  isUndetectable=true      (toggle ON)
//   03:32:57.695  UIElement                (dock.hide() worked)
//   03:33:00.011  Foreground               (nothing toggled — Dock tile is back)
//   03:33:06.518  Foreground               (relaunch)
//   03:33:07.086  UIElement                (pre-emptive startup hide worked)
//   03:33:12.238  Foreground               (5.7 s after launch — back again)
//
// Both returns land AFTER the self-verifying _enforceDockState() loop has given
// up (toggle path: 350 ms debounce + 6 × 130 ms; startup: 18 × 130 ms), so
// nothing corrects them. Three mechanisms, each verified on Electron 43.1.0:
//
//  1. `process.title = …` goes through libuv's uv__set_process_title, which on
//     macOS calls the private _LSApplicationCheckIn with the main bundle's
//     Info.plist. Natively.app has no LSUIElement, so every write re-registers
//     the process as a Foreground app — the same effect as app.dock.show().
//     _applyDisguise() writes it synchronously and again at +200 ms / +1 s /
//     +5 s; the +5 s timer is the 5.7 s relaunch return above. (app.setName()
//     does NOT do this — the older comments blaming it were wrong.)
//  2. A LaunchServices re-open of the running app (click on the pinned Dock
//     tile, `open -a`, Spotlight) transforms it back to Foreground before the
//     'activate' event fires. The handler only skipped dock.show(); it never
//     re-hid.
//  3. Electron's Browser::DockHide() is a silent no-op for 1 s after any
//     Browser::DockShow() (browser_mac.mm). The toggle path's enforcement
//     budget was 6 × 130 ms = 780 ms < 1 s, so a show landing mid-loop could
//     never be corrected.
//
// Platform is an argument so both branches run on any host (CLAUDE.md).

describe('shouldWriteProcessTitle', () => {
  test('darwin + undetectable → never write (it is an LS check-in that re-shows the Dock)', async () => {
    const { shouldWriteProcessTitle } = await load();
    assert.equal(shouldWriteProcessTitle('darwin', true), false);
  });

  test('darwin + normal mode → write (Dock tile is meant to be visible anyway)', async () => {
    const { shouldWriteProcessTitle } = await load();
    assert.equal(shouldWriteProcessTitle('darwin', false), true);
  });

  test('win32 / linux → always write (no LaunchServices, no Dock)', async () => {
    const { shouldWriteProcessTitle } = await load();
    assert.equal(shouldWriteProcessTitle('win32', true), true);
    assert.equal(shouldWriteProcessTitle('win32', false), true);
    assert.equal(shouldWriteProcessTitle('linux', true), true);
  });
});

describe('dock enforcement budget vs Electron\'s 1 s DockHide guard', () => {
  test('the toggle-path retry budget outlasts the guard', async () => {
    const { DOCK_ENFORCE_INTERVAL_MS, DOCK_ENFORCE_MAX_ATTEMPTS, ELECTRON_DOCK_HIDE_GUARD_MS } = await load();
    assert.equal(ELECTRON_DOCK_HIDE_GUARD_MS, 1000, 'browser_mac.mm: base::Seconds(1)');
    assert.ok(
      DOCK_ENFORCE_INTERVAL_MS * DOCK_ENFORCE_MAX_ATTEMPTS > ELECTRON_DOCK_HIDE_GUARD_MS,
      `${DOCK_ENFORCE_MAX_ATTEMPTS} × ${DOCK_ENFORCE_INTERVAL_MS} ms must exceed the ${ELECTRON_DOCK_HIDE_GUARD_MS} ms window in which app.dock.hide() is ignored`,
    );
  });

  test('the startup budget is at least the toggle budget', async () => {
    const { DOCK_ENFORCE_MAX_ATTEMPTS, DOCK_ENFORCE_STARTUP_MAX_ATTEMPTS } = await load();
    assert.ok(DOCK_ENFORCE_STARTUP_MAX_ATTEMPTS >= DOCK_ENFORCE_MAX_ATTEMPTS);
  });
});

// ------------------------------------------------------------- main.ts wiring
// AppState is not importable outside Electron, so these are source-level.

const MAIN = read('electron/main.ts');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const MAIN_CODE = stripComments(MAIN);

describe('main.ts wiring', () => {
  test('disabling undetectable mode reapplies the disguise', () => {
    const start = MAIN_CODE.indexOf('public setUndetectable(');
    assert.ok(start >= 0, 'setUndetectable not found');
    const body = MAIN_CODE.slice(start, start + 2500);
    assert.match(body, /this\._applyDisguise\(this\.disguiseMode\)/);
  });

  test("the 'activate' handler re-asserts stealth instead of merely skipping dock.show()", () => {
    const start = MAIN_CODE.indexOf('app.on("activate"');
    const startAlt = MAIN_CODE.indexOf("app.on('activate'");
    const at = start >= 0 ? start : startAlt;
    assert.ok(at >= 0, "app.on('activate') handler not found");
    const body = MAIN_CODE.slice(at, at + 1200);
    assert.match(body, /reassertUndetectableStealth\(\)/);
  });

  test('_enforceDockState no longer hardcodes a 6-attempt budget', () => {
    assert.doesNotMatch(MAIN_CODE, /maxAttempts:\s*number\s*=\s*6\b/);
    assert.match(MAIN_CODE, /maxAttempts:\s*number\s*=\s*DOCK_ENFORCE_MAX_ATTEMPTS/);
  });
});
