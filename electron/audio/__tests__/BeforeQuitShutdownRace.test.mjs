// Regression test for the "DefaultOutputWatcher fires into V8 teardown
// during app quit" race.
//
// Symptom: the before-quit handler called appState.setQuitting(true)
// and then appState.stopDefaultOutputWatcherForShutdown(). In the brief
// window between those two calls, the setInterval body could fire one
// last time — calling NativeModule.getDefaultOutputDeviceId() and then
// async-fire-and-forget handleDefaultOutputChanged(), which itself does
// several `await` boundaries that touch the native module while V8 is
// already tearing down native bindings. Same class of crash that
// affected the keyboard tap on quit.
//
// Fix: a hard `if (this._isQuitting) return;` at the top of both the
// interval body AND handleDefaultOutputChanged. setQuitting(true) is
// already called BEFORE stopDefaultOutputWatcherForShutdown() in the
// before-quit handler, so the guard catches the window deterministically.
//
// Strategy: structural assertions against main.ts source.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(__dirname, '../../../electron/main.ts');
const mainSource = readFileSync(mainPath, 'utf8');

test('DefaultOutputWatcher interval body bails immediately when this._isQuitting is true', () => {
  // Find the interval declaration and look for the guard at the top of its body.
  const intervalIdx = mainSource.indexOf('this._defaultOutputWatcherInterval = setInterval(');
  assert.ok(intervalIdx >= 0, 'could not locate DefaultOutputWatcher setInterval');
  // Capture a generous prefix of the interval body to inspect.
  const intervalBlock = mainSource.slice(intervalIdx, intervalIdx + 1600);
  assert.ok(
    /if\s*\(\s*this\._isQuitting\s*\)\s*return/.test(intervalBlock),
    'BUG: the DefaultOutputWatcher interval body must check `if (this._isQuitting) return;` before any native-module read. Otherwise the last interval tick before stopDefaultOutputWatcherForShutdown can call into NativeModule.getDefaultOutputDeviceId() during V8 teardown.',
  );

  // The _isQuitting guard must appear BEFORE the NativeModule.getDefaultOutputDeviceId()
  // INVOCATION (not a comment that just mentions the name). Anchor on the actual
  // assignment pattern.
  const quittingIdx = intervalBlock.search(/if\s*\(\s*this\._isQuitting\s*\)\s*return/);
  const nativeIdx = intervalBlock.search(/currentId\s*=\s*NativeModule\.getDefaultOutputDeviceId\s*\(/);
  assert.ok(nativeIdx >= 0, 'sanity: interval should assign currentId = NativeModule.getDefaultOutputDeviceId()');
  assert.ok(
    quittingIdx < nativeIdx,
    'BUG: the _isQuitting guard must be BEFORE the NativeModule call so the native module is never invoked during teardown.',
  );
});

test('handleDefaultOutputChanged bails immediately when this._isQuitting is true', () => {
  // Find the method body.
  const methodIdx = mainSource.indexOf('private async handleDefaultOutputChanged(');
  assert.ok(methodIdx >= 0, 'could not locate handleDefaultOutputChanged');
  // Inspect a generous chunk of the body for both the guard and the first await.
  const methodBody = mainSource.slice(methodIdx, methodIdx + 3500);
  assert.ok(
    /if\s*\(\s*this\._isQuitting\s*\)\s*return/.test(methodBody),
    'BUG: handleDefaultOutputChanged must guard `if (this._isQuitting) return;` at the top (before any await). Otherwise the async fire-and-forget interval body can land here while V8 is mid-teardown.',
  );

  // The _isQuitting guard must come before the first `await` inside the method.
  const quittingIdx = methodBody.search(/if\s*\(\s*this\._isQuitting\s*\)\s*return/);
  const firstAwaitIdx = methodBody.indexOf('await ');
  assert.ok(firstAwaitIdx > 0, 'sanity: handleDefaultOutputChanged has at least one await');
  assert.ok(
    quittingIdx < firstAwaitIdx,
    'BUG: the _isQuitting guard must run BEFORE the first await — once we yield, V8 teardown can start and the resumed body would race the disposal of native bindings.',
  );
});

test('before-quit handler calls setQuitting(true) BEFORE stopDefaultOutputWatcherForShutdown()', () => {
  // The whole point of the _isQuitting guard is that setQuitting(true)
  // beats the interval-stop call so any straggler tick observes the flag.
  const quitHandlerStart = mainSource.indexOf('app.on("before-quit"');
  assert.ok(quitHandlerStart >= 0, 'could not locate before-quit handler');
  const quitHandlerBlock = mainSource.slice(quitHandlerStart, quitHandlerStart + 1200);

  const setQuittingIdx = quitHandlerBlock.search(/appState\.setQuitting\s*\(\s*true\s*\)/);
  const stopWatcherIdx = quitHandlerBlock.search(/appState\.stopDefaultOutputWatcherForShutdown\??\s*\.\??\(\s*\)/);

  assert.ok(setQuittingIdx >= 0, 'sanity: before-quit must call appState.setQuitting(true)');
  assert.ok(stopWatcherIdx >= 0, 'sanity: before-quit must call appState.stopDefaultOutputWatcherForShutdown()');
  assert.ok(
    setQuittingIdx < stopWatcherIdx,
    'BUG: before-quit must call setQuitting(true) BEFORE stopDefaultOutputWatcherForShutdown(). Otherwise the interval can fire one final tick between the two calls and proceed past the (yet-unset) _isQuitting guard.',
  );
});

test('stopDefaultOutputWatcher() clears _defaultOutputWatcherInterval symmetrically with startDefaultOutputWatcher()', () => {
  // Sanity: pin the existing symmetric setInterval / clearInterval pair so
  // future refactors that rename or move the interval don't silently
  // remove the cleanup.
  assert.ok(
    /this\._defaultOutputWatcherInterval\s*=\s*setInterval\s*\(/.test(mainSource),
    'sanity: startDefaultOutputWatcher must assign to this._defaultOutputWatcherInterval',
  );
  assert.ok(
    /clearInterval\s*\(\s*this\._defaultOutputWatcherInterval\s*\)\s*;[\s\S]{0,40}this\._defaultOutputWatcherInterval\s*=\s*null/.test(mainSource),
    'sanity: stopDefaultOutputWatcher must clearInterval and null the slot',
  );
});
