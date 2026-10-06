// The overlay's pill and resize toggle after their window reloads.
//
// Both render from a state the overlay renderer broadcasts (wide or not, shown
// or hidden, theme, opacity). Main caches the last broadcast and re-sent it on
// the aux window's did-finish-load, so a window that reloaded mid-meeting (the
// crash recovery in main.ts reloads both) would catch up.
//
// It did not. did-finish-load fires when the page has loaded, and the aux
// route subscribes later, from a React effect behind a dynamic import, so the
// re-sent state arrived before anyone was listening and was dropped. Measured
// 2026-10-05 on macOS (Electron 43, dev build): with the last broadcast at
// { shellWide: true, interfaceTheme: 'liquid-glass' }, the toggle's renderer
// was killed and reloaded by main; it came back as { default, aria-pressed
// false }: an "Expand" button on a panel that was already wide, whose first
// click collapsed it.
//
// The aux windows now ASK for the state once they are subscribed, which cannot
// be early, and stay hidden until the answer is in so the default state is
// never painted or clicked. After the fix the same steps gave { liquid-glass,
// aria-pressed true }. No platform branch anywhere in this path; not executed
// on Windows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { blockFrom, readSource, repoRoot } from './_sourceSlices.mjs';

const require = createRequire(import.meta.url);
const { overlayUiStateFor } = require(path.join(repoRoot, 'dist-electron/electron/utils/overlayUiStateQuery.js'));

const STATE = { shellWide: true, interfaceTheme: 'liquid-glass' };

test('the pill and the toggle are handed the last broadcast state', () => {
  assert.deepEqual(overlayUiStateFor(7, [7, 9], STATE), STATE);
  assert.deepEqual(overlayUiStateFor(9, [7, 9], STATE), STATE);
});

test('no other window is handed it', () => {
  assert.equal(overlayUiStateFor(3, [7, 9], STATE), null);
  assert.equal(overlayUiStateFor(3, [null, undefined], STATE), null);
});

test('nothing broadcast yet answers null, so the aux window keeps its defaults', () => {
  assert.equal(overlayUiStateFor(7, [7, 9], null), null);
  assert.equal(overlayUiStateFor(7, [7, 9], undefined), null);
});

test('main answers overlay-ui-state:get from the cached broadcast', () => {
  const body = blockFrom(readSource('electron/ipcHandlers.ts'), "safeHandle('overlay-ui-state:get'");
  assert.match(body, /overlayUiStateFor\(\s*event\.sender\.id/);
  assert.match(body, /getOverlayUiState\(\)/);
  assert.match(
    readSource('electron/preload.ts'),
    /getOverlayUiState:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('overlay-ui-state:get'\)/,
  );
});

const aux = readSource('src/components/OverlayAuxWindows.tsx');
const hook = aux.slice(aux.indexOf('function useOverlayUiState'), aux.indexOf('function useOverlayAuxAppearance'));

test('the aux windows ask for the state after they have subscribed', () => {
  const subscribed = hook.indexOf('onOverlayUiState');
  const asked = hook.indexOf('getOverlayUiState');
  assert.ok(subscribed !== -1 && asked !== -1, 'the hook must both subscribe and ask');
  assert.ok(subscribed < asked, 'ask after subscribing: asking first leaves a gap in which a broadcast is lost');
});

test('nothing is painted, or clickable, until the answer is in', () => {
  assert.match(hook, /useState\(false\)/, 'starts unsynced');
  assert.match(hook, /\.finally\(\(\) => \{\s*if \(alive\) setSynced\(true\)/, 'an empty or failed answer still ends the wait');
  assert.match(hook, /if \(!ask\) \{\s*setSynced\(true\)/, 'a preload without the call does not hide the window for good');
  assert.equal(
    aux.split("visibility: synced ? 'visible' : 'hidden'").length - 1,
    2,
    'both the pill root and the toggle root wait',
  );
});

test('the push that could not arrive in time is gone', () => {
  const create = readSource('electron/WindowHelper.ts');
  const body = create.slice(create.indexOf('private createOverlayAuxWindows('), create.indexOf('private positionOverlayAuxWindows('));
  assert.doesNotMatch(body, /did-finish-load'[^]*?send\('overlay-ui-state', this\.lastOverlayUiState\)/);
});
