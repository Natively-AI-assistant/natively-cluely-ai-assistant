// Overlay top-pill Stop button: two defects, one file.
//
// 1. STALE RED HOVER. The pill lives in its own persistent BrowserWindow that
//    is hidden when the meeting ends and re-shown for the next one. Stop is
//    clicked with the cursor ON the button, and the window is then ordered out
//    from under the cursor, so Chromium never sees the pointer leave: `:hover`
//    survives the hide/show cycle and the next meeting opens with a red Stop
//    button nobody is hovering. Reproduced on macOS with real CGEvents, both in
//    a bare panel window and in the app (session 2's Stop computed
//    color rgb(248,113,113) = red-400 with the cursor elsewhere). A synthetic
//    mouseLeave on hide clears it. On macOS the welded pill is an AppKit CHILD
//    of the overlay and parent.hide() orders it out implicitly — isVisible() is
//    already false and no 'hide' fires — so the reset must not depend on either.
//
// 2. STOP DEPENDED ON THE OVERLAY RENDERER. The pill's click went
//    pill → main → overlay renderer → main. Measured: a 5 s busy overlay
//    renderer delayed "Ending Meeting" by 4.9 s, and a click during an overlay
//    renderer crash was silently dropped. Main now ends the meeting itself and
//    tells the overlay only to do its bookkeeping — never to stop again, which
//    would end a meeting the user restarted while the overlay was busy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { clearStaleHover } = require(path.join(repoRoot, 'dist-electron/electron/utils/overlayAuxHover.js'));
const { routeOverlayUiAction } = require(
  path.join(repoRoot, 'dist-electron/electron/utils/overlayUiActionRouter.js'),
);

function fakeWindow({ visible = true, destroyed = false, throws = false } = {}) {
  const sent = [];
  return {
    sent,
    isVisible: () => visible,
    isDestroyed: () => destroyed,
    webContents: {
      sendInputEvent(event) {
        if (throws) throw new Error('renderer gone');
        sent.push(event);
      },
    },
  };
}

test('clearStaleHover sends a mouseLeave to the aux window', () => {
  const win = fakeWindow();
  clearStaleHover(win);
  assert.equal(win.sent.length, 1);
  assert.equal(win.sent[0].type, 'mouseLeave');
});

test('clearStaleHover still resets a window that is ALREADY hidden (welded child ordered out by its parent)', () => {
  const win = fakeWindow({ visible: false });
  clearStaleHover(win);
  assert.deepEqual(
    win.sent.map((e) => e.type),
    ['mouseLeave'],
    'on macOS parent.hide() hides the pill implicitly; gating on isVisible() would skip exactly this case',
  );
});

test('clearStaleHover is a no-op for a missing or destroyed window and never throws', () => {
  assert.doesNotThrow(() => clearStaleHover(null));
  assert.doesNotThrow(() => clearStaleHover(undefined));
  const destroyed = fakeWindow({ destroyed: true });
  clearStaleHover(destroyed);
  assert.equal(destroyed.sent.length, 0);
  assert.doesNotThrow(() => clearStaleHover(fakeWindow({ throws: true })));
});

function fakeDeps({ forwardThrows = false, endRejects = false } = {}) {
  const calls = { ended: 0, forwarded: [], logged: [] };
  return {
    calls,
    deps: {
      endMeeting: async () => {
        calls.ended++;
        if (endRejects) throw new Error('teardown failed');
      },
      forwardToOverlay: (action) => {
        if (forwardThrows) throw new Error('overlay gone');
        calls.forwarded.push(action);
      },
      log: (msg) => calls.logged.push(msg),
    },
  };
}

test('end-meeting from the pill is ended by MAIN, not relayed for the overlay to end', async () => {
  const { calls, deps } = fakeDeps();
  await routeOverlayUiAction({ type: 'end-meeting' }, deps);
  assert.equal(calls.ended, 1, 'main must end the meeting itself');
  assert.deepEqual(calls.forwarded, [{ type: 'meeting-ended' }], 'the overlay only gets bookkeeping');
  assert.ok(
    !calls.forwarded.some((a) => a.type === 'end-meeting'),
    'forwarding end-meeting would let a late overlay renderer stop a meeting the user restarted',
  );
});

test('end-meeting still ends the meeting when the overlay renderer is unreachable', async () => {
  const { calls, deps } = fakeDeps({ forwardThrows: true });
  await routeOverlayUiAction({ type: 'end-meeting' }, deps);
  assert.equal(calls.ended, 1);
});

test('a failed teardown is logged, not thrown back into the pill', async () => {
  const { calls, deps } = fakeDeps({ endRejects: true });
  await assert.doesNotReject(routeOverlayUiAction({ type: 'end-meeting' }, deps));
  assert.ok(calls.logged.some((m) => /end-meeting/.test(m)));
});

test('layout actions are still relayed verbatim to the overlay renderer', async () => {
  for (const type of ['toggle-width', 'toggle-expand']) {
    const { calls, deps } = fakeDeps();
    await routeOverlayUiAction({ type }, deps);
    assert.deepEqual(calls.forwarded, [{ type }]);
    assert.equal(calls.ended, 0);
  }
});

test('a missing or empty action does nothing', async () => {
  for (const action of [null, undefined, {}, { type: '' }]) {
    const { calls, deps } = fakeDeps();
    await routeOverlayUiAction(action, deps);
    assert.equal(calls.ended, 0);
    assert.equal(calls.forwarded.length, 0);
  }
});
