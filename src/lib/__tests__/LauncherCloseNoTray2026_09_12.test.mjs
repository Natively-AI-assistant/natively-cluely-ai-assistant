// src/lib/__tests__/LauncherCloseNoTray2026_09_12.test.mjs
//
// In-app reviews (2026-08-31 / 2026-09-07 / 2026-09-10, Windows, 1-2★):
// "closing the app doesn't work most of the times", "it is only running in
// the background in taskmanager". On Windows the launcher X hides to the
// tray. Undetectable mode destroys the tray AND removes the taskbar button,
// so after X there is nothing on screen that can bring the window back or
// quit it — only Task Manager. Hide-to-tray is only a valid answer to X when
// a tray exists to come back from.
//
// Platform is injected so both branches run on any host (CLAUDE.md).

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { decideLauncherClose } from '../launcherCloseDecision.mjs';

const packagedWin = { platform: 'win32', isDev: false, quitting: false };

describe('decideLauncherClose', () => {
  test('win32, packaged, tray present → hide (existing behaviour)', () => {
    assert.equal(decideLauncherClose({ ...packagedWin, hasTray: true }), 'hide');
  });

  test('win32, packaged, NO tray → quit (nothing could bring the window back)', () => {
    assert.equal(decideLauncherClose({ ...packagedWin, hasTray: false }), 'quit');
  });

  test('linux behaves like win32', () => {
    assert.equal(decideLauncherClose({ ...packagedWin, platform: 'linux', hasTray: false }), 'quit');
    assert.equal(decideLauncherClose({ ...packagedWin, platform: 'linux', hasTray: true }), 'hide');
  });

  test('already quitting → let the close proceed, tray or not', () => {
    assert.equal(decideLauncherClose({ ...packagedWin, quitting: true, hasTray: true }), 'close');
    assert.equal(decideLauncherClose({ ...packagedWin, quitting: true, hasTray: false }), 'close');
  });

  test('dev build → quit, so no zombie survives between runs (2026-07-10 rule)', () => {
    assert.equal(decideLauncherClose({ ...packagedWin, isDev: true, hasTray: true }), 'quit');
  });

  test('darwin never intercepts the close', () => {
    assert.equal(decideLauncherClose({ ...packagedWin, platform: 'darwin', hasTray: false }), 'close');
    assert.equal(decideLauncherClose({ ...packagedWin, platform: 'darwin', hasTray: true }), 'close');
  });
});
