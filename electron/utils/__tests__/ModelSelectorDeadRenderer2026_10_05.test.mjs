// Reused windows after their renderer dies: the model picker and the cropper.
//
// The picker is ONE BrowserWindow, created hidden at startup and reused for
// every open. When its renderer process went away (crash, out of memory,
// killed), nothing brought it back: main.ts deliberately does not reload it,
// and the helper only recreated a DESTROYED window, which a window with a dead
// renderer is not. So every later open showed the same dead window: an empty,
// transparent rectangle with no rows to click, and (from the overlay) the
// full-display click catcher armed behind it, which swallowed the user's next
// click anywhere on screen. It stayed that way until the app was restarted.
//
// Reproduced 2026-10-05 on macOS (Electron 43, dev build): picker opened and
// answered over CDP; its renderer was killed with SIGSEGV
// (render-process-gone reason=crashed); the next open put the 141x96 window on
// screen and its page never answered again. After the fix the same steps give
// a new window whose page answers, and a picker killed WHILE open takes the
// click catcher down with it.
//
// The screenshot cropper is reused the same way and main.ts does not reload it
// either. Its dead window is the full display at the screen-saver level; on
// macOS, where Escape is read by the page, it stayed up for the 30 s selection
// timeout. Same mechanism, read from the code, not reproduced (showing it
// covers the whole screen).
//
// The module under test imports no electron and reads no process.platform, so
// one code path serves macOS and Windows. Not executed on Windows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { methodBody, readSource, repoRoot } from './_sourceSlices.mjs';

const require = createRequire(import.meta.url);
const { hasLiveRenderer, onRendererGone, allowRespawn, RESPAWN_MAX, RESPAWN_WINDOW_MS } = require(
  path.join(repoRoot, 'dist-electron/electron/utils/rendererLiveness.js'),
);

function fakeWindow({ destroyed = false, contentsDestroyed = false, crashed = false } = {}) {
  const webContents = new EventEmitter();
  webContents.isDestroyed = () => contentsDestroyed;
  webContents.isCrashed = () => crashed;
  return { isDestroyed: () => destroyed, webContents };
}

test('a window with a running renderer can be reused', () => {
  assert.equal(hasLiveRenderer(fakeWindow()), true);
});

test('no window, or a destroyed one, cannot be reused', () => {
  assert.equal(hasLiveRenderer(null), false);
  assert.equal(hasLiveRenderer(undefined), false);
  assert.equal(hasLiveRenderer(fakeWindow({ destroyed: true })), false);
  assert.equal(hasLiveRenderer(fakeWindow({ contentsDestroyed: true })), false);
});

test('a window whose renderer is gone cannot be reused, though it is not destroyed', () => {
  const dead = fakeWindow({ crashed: true });
  assert.equal(dead.isDestroyed(), false, 'the case the old isDestroyed() check let through');
  assert.equal(hasLiveRenderer(dead), false);
});

test('hasLiveRenderer answers false, and never throws, when the window throws', () => {
  const throwing = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      isCrashed: () => {
        throw new Error('Object has been destroyed');
      },
    },
  };
  assert.equal(hasLiveRenderer(throwing), false);
});

for (const reason of ['crashed', 'oom', 'killed', 'abnormal-exit', 'launch-failed', 'integrity-failure']) {
  test(`renderer gone (${reason}) calls back once, and not from inside the event`, () => {
    const win = fakeWindow();
    const deferred = [];
    let gone = 0;
    onRendererGone(win, () => gone++, (fn) => deferred.push(fn));

    win.webContents.emit('render-process-gone', {}, { reason });
    // Other listeners for this event still have to read the window's
    // webContents; the callback destroys the window, so it must wait.
    assert.equal(gone, 0);
    assert.equal(deferred.length, 1);
    deferred[0]();
    assert.equal(gone, 1);

    // A second event for the same window must not discard twice.
    win.webContents.emit('render-process-gone', {}, { reason });
    assert.equal(deferred.length, 1);
  });
}

test('a renderer that exited cleanly is not treated as gone', () => {
  const win = fakeWindow();
  const deferred = [];
  onRendererGone(win, () => assert.fail('clean exit is the window closing normally'), (fn) => deferred.push(fn));
  win.webContents.emit('render-process-gone', {}, { reason: 'clean-exit' });
  assert.equal(deferred.length, 0);
});

// ── A replacement is built in the background, but never in a loop ──

test('a dead window is rebuilt, up to the limit inside the rolling window', () => {
  const history = [];
  for (let i = 0; i < RESPAWN_MAX; i++) assert.equal(allowRespawn(history, 1_000 + i), true);
  assert.equal(allowRespawn(history, 2_000), false, 'a renderer that dies on every start must not loop');
  assert.equal(history.length, RESPAWN_MAX, 'a refusal is not recorded as a rebuild');
});

test('the limit rolls: old rebuilds stop counting', () => {
  const history = [];
  for (let i = 0; i < RESPAWN_MAX; i++) allowRespawn(history, i);
  assert.equal(allowRespawn(history, RESPAWN_WINDOW_MS + RESPAWN_MAX), true);
});

// ── Wiring: the picker ──

const picker = readSource('electron/ModelSelectorWindowHelper.ts');
const cropper = readSource('electron/CropperWindowHelper.ts');

for (const method of ['preloadWindow', 'showWindow', 'toggleWindow']) {
  test(`${method} recreates the picker when its renderer is gone, not only when the window is destroyed`, () => {
    const body = methodBody(picker, method);
    assert.match(body, /hasLiveRenderer\(this\.window\)/);
    assert.doesNotMatch(
      body,
      /if \(!this\.window \|\| this\.window\.isDestroyed\(\)\)|if \(this\.window && !this\.window\.isDestroyed\(\)\) \{\s*if \(this\.window\.isVisible/,
      'isDestroyed() alone reuses a window whose renderer has died',
    );
  });
}

test('the picker window is torn down as soon as its renderer goes away', () => {
  assert.match(methodBody(picker, 'createWindow'), /onRendererGone\(win, \(\) => this\.discardDeadWindow\(win\)\)/);
  const dispose = methodBody(picker, 'disposeWindow');
  assert.match(dispose, /\.destroy\(\)/, 'a destroyed window is what the next open recreates');
  assert.match(
    dispose,
    /notifyOverlayPopover\?\.\(\s*'model',\s*false\s*\)/,
    'the click catcher must not stay armed behind a picker that no longer exists',
  );
  assert.ok(
    dispose.indexOf('setParentWindow(null)') !== -1 && dispose.indexOf('setParentWindow(null)') < dispose.indexOf('.destroy()'),
    'detached from the overlay before it is destroyed, as hideWindow does before hiding',
  );
});

test('its replacement is pre-built hidden, within the limit', () => {
  const discard = methodBody(picker, 'discardDeadWindow');
  assert.match(discard, /if \(this\.window !== win\) return/, 'a window already replaced is left alone');
  assert.match(discard, /if \(!this\.quitting && allowRespawn\(this\.respawnHistory, Date\.now\(\)\)\) this\.preloadWindow\(\)/);
});

test('nothing is rebuilt while the app is quitting', () => {
  assert.match(picker, /app\.once\('before-quit', \(\) => \{ this\.quitting = true \}\)/);
  const discard = methodBody(cropper, 'discardDeadWindow');
  assert.match(discard, /!this\.isQuitting &&[^]*allowRespawn\(/, 'renderers going away during quit are the teardown');
  assert.match(cropper, /this\.beforeQuitHandler = \(\) => \{\s*this\.isQuitting = true;/);
});

test('building a window never rebuilds one: createWindow tears the old one down without the respawn', () => {
  const create = methodBody(picker, 'createWindow');
  assert.match(create, /this\.disposeWindow\(this\.window\)/);
  assert.doesNotMatch(create, /this\.discardDeadWindow\(this\.window\)/, 'that would build a second window inside the first build');
  assert.doesNotMatch(methodBody(picker, 'disposeWindow'), /preloadWindow|createWindow/);
});

test('a panel that reports itself taller than its budget is told the budget again', () => {
  const size = methodBody(picker, 'setContentSize');
  assert.match(size, /if \(height > this\.heightBudget\)\s*\{\s*this\.window\.webContents\.send\('model-selector:height-budget', this\.heightBudget\)/);
});

// ── Wiring: the cropper ──

test('the cropper window is replaced when its renderer goes away', () => {
  assert.match(methodBody(cropper, 'createWindow'), /onRendererGone\(win, \(\) => this\.discardDeadWindow\(win\)\)/);
  const discard = methodBody(cropper, 'discardDeadWindow');
  assert.match(discard, /this\.isDisposed \|\| this\.cropperWindow !== win\) return/);
  assert.match(discard, /if \(this\.isWaitingForSelection\) this\.rejectCurrentSelection\(null\)/, 'a selection in progress ends as cancelled');
  assert.match(discard, /this\.unregisterEscapeShortcut\(\)/, 'the Windows-only global Escape must not outlive the window');
  assert.ok(
    discard.indexOf('this.cropperWindow = null') < discard.indexOf('win.destroy()'),
    'forgotten before it is destroyed, so its own closed handler does not run the cleanup twice',
  );
  assert.match(discard, /allowRespawn\(this\.respawnHistory, Date\.now\(\)\)/);
});

test('a replaced cropper window closing does not touch its replacement', () => {
  const create = methodBody(cropper, 'createWindow');
  const closed = create.slice(create.indexOf("on('closed'"));
  assert.ok(
    closed.indexOf('if (this.cropperWindow !== win) return') !== -1 &&
      closed.indexOf('if (this.cropperWindow !== win) return') < closed.indexOf('this.cropperWindow = null'),
  );
});
