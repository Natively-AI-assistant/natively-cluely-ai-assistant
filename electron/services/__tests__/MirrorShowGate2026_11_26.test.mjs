// GitHub #630: a Natively window that opens by itself while the screen is
// mirrored must not reach the projector, not even for a frame. See
// electron/services/mirrorShowGate.ts. Fake windows record what reached the
// screen; the guard is faked by a hold flag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMirrorShowGate } from '../mirrorShowGate.ts';

function fakeWindow(name) {
  const calls = [];
  const win = {
    name,
    onScreen: false,
    destroyed: false,
    calls,
    show() { calls.push('show'); win.onScreen = true; },
    showInactive() { calls.push('showInactive'); win.onScreen = true; },
    focus() { calls.push('focus'); win.onScreen = true; }, // macOS: orders a hidden window in
    moveTop() { calls.push('moveTop'); win.onScreen = true; },
    hide() { calls.push('hide'); win.onScreen = false; },
    isVisible() { return win.onScreen; },
    isDestroyed() { return win.destroyed; },
  };
  return win;
}

function rig({ hold = true, guarded = (w) => w.name !== 'other' } = {}) {
  const state = { hold, held: 0, logs: [] };
  const gate = createMirrorShowGate({
    isGuarded: guarded,
    shouldHold: () => state.hold,
    onHeld: () => { state.held += 1; },
    log: (m) => state.logs.push(m),
  });
  return { gate, state };
}

test('mirrored: show and showInactive never reach the screen, and the guard is told', () => {
  const { gate, state } = rig();
  const overlay = fakeWindow('overlay');
  gate.install(overlay);
  overlay.show();
  overlay.showInactive();
  assert.equal(overlay.onScreen, false);
  assert.deepEqual(overlay.calls, []);
  assert.equal(state.held, 2);
  assert.equal(gate.isHeld(overlay), true);
});

test('a held window reports visible, so its helper hides it and records it like a shown one', () => {
  const { gate } = rig();
  const notes = fakeWindow('notes');
  gate.install(notes);
  notes.showInactive();
  assert.equal(notes.isVisible(), true, 'NotesWindowHelper.hide() bails out on a window that is not visible');
  notes.hide(); // the guard's hide
  assert.equal(gate.isHeld(notes), false);
  assert.equal(notes.isVisible(), false);
  assert.deepEqual(notes.calls, ['hide']);
});

test('focus and moveTop on a hidden window are held too (macOS would order it in)', () => {
  const { gate, state } = rig();
  const launcher = fakeWindow('launcher');
  gate.install(launcher);
  launcher.focus();
  launcher.moveTop(); // already held: no second notice to the guard
  assert.equal(launcher.onScreen, false);
  assert.deepEqual(launcher.calls, []);
  assert.equal(state.held, 1);
  const pill = fakeWindow('pill');
  gate.install(pill);
  pill.moveTop();
  assert.deepEqual(pill.calls, []);
  assert.equal(state.held, 2);
});

test('focus on a held window stays held', () => {
  const { gate } = rig();
  const overlay = fakeWindow('overlay');
  gate.install(overlay);
  overlay.showInactive();
  overlay.focus();
  overlay.moveTop();
  assert.deepEqual(overlay.calls, []);
});

test('focus and moveTop on a window already on screen pass through', () => {
  const { gate, state } = rig({ hold: false });
  const overlay = fakeWindow('overlay');
  gate.install(overlay);
  overlay.show();
  state.hold = true; // the user revealed it while mirrored, say
  overlay.focus();
  overlay.moveTop();
  assert.deepEqual(overlay.calls, ['show', 'focus', 'moveTop']);
});

test('not mirrored: every call goes straight through', () => {
  const { gate, state } = rig({ hold: false });
  const overlay = fakeWindow('overlay');
  gate.install(overlay);
  overlay.showInactive();
  overlay.hide();
  overlay.focus();
  assert.deepEqual(overlay.calls, ['showInactive', 'hide', 'focus']);
  assert.equal(state.held, 0);
});

test('a window that is not one of Natively\'s guarded windows is never held', () => {
  const { gate } = rig();
  const other = fakeWindow('other');
  gate.install(other);
  other.show();
  assert.deepEqual(other.calls, ['show']);
});

test('releaseAll shows held windows for real, without focus, and only once', () => {
  const { gate } = rig();
  const overlay = fakeWindow('overlay');
  const pill = fakeWindow('pill');
  gate.install(overlay);
  gate.install(pill);
  overlay.show();
  pill.showInactive();
  assert.equal(gate.releaseAll(), 2);
  assert.deepEqual(overlay.calls, ['showInactive'], 'released inactive even though show() was asked');
  assert.deepEqual(pill.calls, ['showInactive']);
  assert.equal(gate.releaseAll(), 0);
});

test('releaseAll skips a window destroyed while held', () => {
  const { gate } = rig();
  const notes = fakeWindow('notes');
  gate.install(notes);
  notes.show();
  notes.destroyed = true;
  assert.equal(gate.releaseAll(), 0);
  assert.deepEqual(notes.calls, []);
});

test('a later show once the hold lifts reaches the screen and clears the hold', () => {
  const { gate, state } = rig();
  const overlay = fakeWindow('overlay');
  gate.install(overlay);
  overlay.show();
  state.hold = false; // the guard is restoring, or the mirror ended
  overlay.show();
  assert.equal(gate.isHeld(overlay), false);
  assert.deepEqual(overlay.calls, ['show']);
});

test('a throwing hold check fails open: the window shows', () => {
  const logs = [];
  const gate = createMirrorShowGate({
    isGuarded: () => true,
    shouldHold: () => { throw new Error('boom'); },
    onHeld: () => {},
    log: (m) => logs.push(m),
  });
  const overlay = fakeWindow('overlay');
  gate.install(overlay);
  overlay.show();
  assert.deepEqual(overlay.calls, ['show']);
  assert.equal(logs.length, 1);
});

test('installing twice does not wrap twice', () => {
  const { gate, state } = rig();
  const overlay = fakeWindow('overlay');
  gate.install(overlay);
  gate.install(overlay);
  overlay.show();
  assert.equal(state.held, 1);
});
