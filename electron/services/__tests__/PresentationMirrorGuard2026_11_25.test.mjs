// GitHub #630: in Undetectable mode, hide Natively while the screen is
// mirrored to a projector or another display (a mirror is not a capture, so
// content protection does not reach it). See
// electron/services/presentationMirrorGuard.ts and
// native-module/src/display_mirror.rs. Pure decision logic; the native check,
// the windows and the timer are faked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIRROR_POLL_MS, createPresentationMirrorGuard } from '../presentationMirrorGuard.ts';

const MIRRORED = { mirrored: true, wireless: false, mirroredDisplays: 2 };
const SINGLE = { mirrored: false, wireless: false, mirroredDisplays: 0 };

function rig({ undetectable = true, visible = true, mirror = SINGLE, native = true } = {}) {
  const state = { undetectable, visible, mirror, busy: false, reads: 0 };
  const hides = [];
  const restores = [];
  const timers = new Map();
  let nextId = 1;
  let nextToken = 1;
  const guard = createPresentationMirrorGuard({
    readMirrorState: () => {
      state.reads += 1;
      return native ? state.mirror : null;
    },
    isUndetectable: () => state.undetectable,
    anyWindowVisible: () => state.visible,
    isBusy: () => state.busy,
    hideAll: () => {
      const token = `token-${nextToken++}`;
      hides.push(token);
      state.visible = false;
      return token;
    },
    restore: (token) => {
      restores.push(token);
      state.visible = true;
    },
    merge: (earlier, later) => `${earlier.includes('+') ? `(${earlier})` : earlier}+${later}`,
    setInterval: (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; },
    clearInterval: (id) => { timers.delete(id); },
  });
  const tick = () => { for (const t of timers.values()) t.fn(); };
  return { guard, state, hides, restores, timers, tick };
}

test('Undetectable on: polls on the mirror interval; off stops the poll', () => {
  const { guard, timers, state } = rig();
  guard.sync(true);
  assert.deepEqual([...timers.values()].map((t) => t.ms), [MIRROR_POLL_MS]);
  guard.sync(true); // idempotent
  assert.equal(timers.size, 1);
  state.undetectable = false;
  guard.sync(false);
  assert.equal(timers.size, 0);
});

test('not mirrored: nothing is hidden', () => {
  const { guard, hides, tick } = rig();
  guard.sync(true);
  tick();
  assert.deepEqual(hides, []);
  assert.equal(guard.mirrored, false);
});

test('mirroring starts with windows on screen: hides them, and restores them once it ends', () => {
  const { guard, state, hides, restores, tick } = rig();
  guard.sync(true);
  state.mirror = MIRRORED;
  tick();
  assert.deepEqual(hides, ['token-1']);
  assert.equal(guard.mirrored, true);
  assert.equal(state.visible, false);
  tick(); // still mirrored, nothing on screen: no second hide
  assert.deepEqual(hides, ['token-1']);
  state.mirror = SINGLE;
  tick();
  assert.deepEqual(restores, ['token-1']);
  assert.equal(state.visible, true);
  tick(); // restored once only
  assert.deepEqual(restores, ['token-1']);
});

test('a window that opens by itself while mirrored is hidden again, and the hides are merged for the restore', () => {
  const { guard, state, hides, restores, tick } = rig({ mirror: MIRRORED });
  guard.sync(true);
  assert.deepEqual(hides, ['token-1']);
  state.visible = true; // e.g. a meeting starts and shows the overlay
  guard.check(); // main runs check() on every window show
  assert.deepEqual(hides, ['token-1', 'token-2']);
  state.visible = true;
  guard.check();
  state.mirror = SINGLE;
  tick();
  assert.deepEqual(restores, ['(token-1+token-2)+token-3']);
});

test('without a merge the later hide is the one restored', () => {
  const restores = [];
  let n = 0;
  const state = { visible: true, mirror: MIRRORED };
  const guard = createPresentationMirrorGuard({
    readMirrorState: () => state.mirror,
    isUndetectable: () => true,
    anyWindowVisible: () => state.visible,
    isBusy: () => false,
    hideAll: () => { state.visible = false; return `t${++n}`; },
    restore: (token) => restores.push(token),
    setInterval: () => 1,
    clearInterval: () => {},
  });
  guard.sync(true);
  state.visible = true;
  guard.check();
  state.mirror = SINGLE;
  guard.check();
  assert.deepEqual(restores, ['t2']);
});

test('mirroring with nothing on screen hides nothing and restores nothing', () => {
  const { guard, state, hides, restores, tick } = rig({ visible: false, mirror: MIRRORED });
  guard.sync(true);
  tick();
  state.mirror = SINGLE;
  tick();
  assert.deepEqual(hides, []);
  assert.deepEqual(restores, []);
});

test('Cmd/Ctrl+B while mirrored: what the guard hid comes back at once, and the user wins until the mirror ends', () => {
  const { guard, state, hides, restores, tick } = rig({ mirror: MIRRORED });
  guard.sync(true);
  assert.deepEqual(hides, ['token-1']);
  assert.equal(guard.noteUserReveal(), true, 'the caller skips its toggle, or it would hide the window again');
  assert.deepEqual(restores, ['token-1'], 'restored through the hide token (notepad and Settings too)');
  assert.equal(state.visible, true);
  guard.check(); // main runs check() on the restored windows' show events
  tick();
  assert.deepEqual(hides, ['token-1'], 'the revealed windows stay on screen');
  state.mirror = SINGLE;
  tick();
  assert.deepEqual(restores, ['token-1'], 'restored once; nothing left to put back');
  // A new mirror starts protecting again.
  state.mirror = MIRRORED;
  tick();
  assert.deepEqual(hides, ['token-1', 'token-2']);
});

test('Cmd/Ctrl+B a second time while mirrored has nothing to restore, so the caller toggles as usual', () => {
  const { guard, restores } = rig({ mirror: MIRRORED });
  guard.sync(true);
  assert.equal(guard.noteUserReveal(), true);
  assert.equal(guard.noteUserReveal(), false);
  assert.deepEqual(restores, ['token-1']);
});

test('Cmd/Ctrl+B just after the mirror ended, before the poll saw it: the due restore runs', () => {
  const { guard, state, restores, hides } = rig({ mirror: MIRRORED });
  guard.sync(true);
  assert.deepEqual(hides, ['token-1']);
  state.mirror = SINGLE; // no tick yet
  assert.equal(guard.noteUserReveal(), true);
  assert.deepEqual(restores, ['token-1']);
  state.mirror = MIRRORED; // the next mirror is protected: no user reveal carried over
  guard.check();
  assert.deepEqual(hides, ['token-1', 'token-2']);
});

test('Cmd/Ctrl+B right after mirroring starts, before the poll saw it, still wins', () => {
  const { guard, state, hides } = rig({ visible: false });
  guard.sync(true);
  state.mirror = MIRRORED; // no tick yet
  assert.equal(guard.noteUserReveal(), false, 'nothing was hidden: the caller toggles');
  state.visible = true;
  guard.check();
  assert.deepEqual(hides, []);
});

test('Cmd/Ctrl+B when not mirrored changes nothing', () => {
  const { guard, state, hides, tick } = rig();
  guard.sync(true);
  assert.equal(guard.noteUserReveal(), false);
  state.mirror = MIRRORED;
  tick();
  assert.deepEqual(hides, ['token-1']);
});

test('Undetectable turned off while hidden: windows come back and the mirror is ignored', () => {
  const { guard, state, hides, restores, tick, timers } = rig({ mirror: MIRRORED });
  guard.sync(true);
  assert.deepEqual(hides, ['token-1']);
  state.undetectable = false;
  guard.sync(false);
  assert.deepEqual(restores, ['token-1']);
  assert.equal(timers.size, 0);
  state.visible = true;
  guard.check();
  tick();
  assert.deepEqual(hides, ['token-1']);
});

test('Undetectable off: the native check is never called', () => {
  const { guard, state } = rig({ undetectable: false, mirror: MIRRORED });
  guard.sync(false);
  guard.check();
  guard.noteUserReveal();
  assert.equal(state.reads, 0);
});

test('a screenshot in progress: waits for it, then hides', () => {
  const { guard, state, hides, tick } = rig({ mirror: MIRRORED });
  state.busy = true;
  guard.sync(true);
  assert.deepEqual(hides, []);
  state.busy = false;
  tick();
  assert.deepEqual(hides, ['token-1']);
});

test('an older native binary without the check: the guard does nothing', () => {
  const { guard, hides, tick } = rig({ native: false });
  guard.sync(true);
  tick();
  assert.deepEqual(hides, []);
});

test('a throwing native check is treated as not mirrored and logged once', () => {
  const logs = [];
  let hid = 0;
  const guard = createPresentationMirrorGuard({
    readMirrorState: () => { throw new Error('boom'); },
    isUndetectable: () => true,
    anyWindowVisible: () => true,
    isBusy: () => false,
    hideAll: () => { hid += 1; return null; },
    restore: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    log: (m) => logs.push(m),
  });
  guard.sync(true);
  guard.check();
  guard.check();
  assert.equal(hid, 0);
  assert.equal(logs.filter((m) => m.includes('mirror check failed')).length, 1);
});

// mirrorShowGate.ts hooks (the window that opens by itself never reaches the
// projector): shouldHoldShow() decides, releaseHeld() shows what was held.
function gateRig({ undetectable = true, mirror = MIRRORED, heldCount = 0 } = {}) {
  const state = { undetectable, mirror, heldCount, released: 0, holdsDuringRestore: [] };
  let guard;
  guard = createPresentationMirrorGuard({
    readMirrorState: () => state.mirror,
    isUndetectable: () => state.undetectable,
    anyWindowVisible: () => true,
    isBusy: () => false,
    hideAll: () => 'session',
    restore: () => { state.holdsDuringRestore.push(guard.shouldHoldShow()); },
    releaseHeld: () => { const n = state.heldCount; state.heldCount = 0; state.released += n; return n; },
    setInterval: () => 1,
    clearInterval: () => {},
  });
  return { guard, state };
}

test('shouldHoldShow: held while mirrored in Undetectable, not otherwise', () => {
  const { guard, state } = gateRig();
  assert.equal(guard.shouldHoldShow(), true);
  state.mirror = SINGLE;
  assert.equal(guard.shouldHoldShow(), false);
  state.mirror = MIRRORED;
  state.undetectable = false;
  assert.equal(guard.shouldHoldShow(), false);
});

test('shouldHoldShow reads the mirror now, before any poll saw it', () => {
  const { guard, state } = gateRig({ mirror: SINGLE });
  guard.sync(true);
  state.mirror = MIRRORED; // no tick
  assert.equal(guard.shouldHoldShow(), true);
});

test('after the user reveals, shows are not held until the mirror ends and starts again', () => {
  const { guard, state } = gateRig();
  guard.sync(true);
  guard.noteUserReveal();
  assert.equal(guard.shouldHoldShow(), false);
  state.mirror = SINGLE;
  guard.check();
  state.mirror = MIRRORED;
  assert.equal(guard.shouldHoldShow(), true);
});

test('the restore\'s own shows are never held, even if a mirror starts again mid-restore', () => {
  const holds = [];
  const state = { mirror: MIRRORED };
  let guard;
  guard = createPresentationMirrorGuard({
    readMirrorState: () => state.mirror,
    isUndetectable: () => true,
    anyWindowVisible: () => true,
    isBusy: () => false,
    hideAll: () => 'session',
    restore: () => {
      state.mirror = MIRRORED; // plugged straight back in while restoring
      holds.push(guard.shouldHoldShow());
    },
    setInterval: () => 1,
    clearInterval: () => {},
  });
  guard.sync(true); // hides
  state.mirror = SINGLE;
  guard.check(); // restores
  assert.deepEqual(holds, [false]);
  assert.equal(guard.shouldHoldShow(), true, 'after the restore, the new mirror holds again');
});

test('the mirror ending releases held windows the guard had not hidden yet', () => {
  const { guard, state } = gateRig({ heldCount: 2 });
  guard.sync(true);
  assert.equal(state.released, 0, 'still mirrored: held windows stay held');
  state.mirror = SINGLE;
  guard.check();
  assert.equal(state.released, 2);
});

test('Cmd/Ctrl+B with only held windows (nothing hidden yet) reports a restore, so the caller skips its toggle', () => {
  const { guard, state } = gateRig();
  state.heldCount = 1;
  assert.equal(guard.noteUserReveal(), true);
  assert.equal(state.released, 1);
});

test('a throwing release is logged and does not break the check', () => {
  const logs = [];
  const guard = createPresentationMirrorGuard({
    readMirrorState: () => SINGLE,
    isUndetectable: () => true,
    anyWindowVisible: () => false,
    isBusy: () => false,
    hideAll: () => null,
    restore: () => {},
    releaseHeld: () => { throw new Error('boom'); },
    setInterval: () => 1,
    clearInterval: () => {},
    log: (m) => logs.push(m),
  });
  guard.check();
  assert.equal(guard.noteUserReveal(), false);
  assert.ok(logs.some((m) => m.includes('release failed')));
});
