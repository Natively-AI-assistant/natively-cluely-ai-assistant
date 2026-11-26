// electron/services/__tests__/PhoneMirrorShowHide2026_11_26.test.mjs
//
// #667 "Hide and Show from remote device": the phone mirror page gets a Show /
// Hide button that does what Toggle Visibility (Cmd+B / Ctrl+B) does.
//
// Pinned here:
//   1. decideRemoteVisibility: the phone asks for a STATE; a repeat, a stale
//      label or a second tap while the first toggle lands does nothing.
//   2. createVisibilityRelay: a screenshot's brief hide never reaches the phone.
//   2b. The controller against a model of the real overlay (Cmd/Ctrl+B
//      collapses, the window hides 400 ms later) on a fake clock: a Hide
//      tapped during that collapse no longer brings the overlay back.
//   3. WindowHelper reports every visibility change, on the darwin AND win32
//      branches of hideMainWindow (platform injected, not process.platform).
//   4. The REAL PhoneMirrorService over a real socket: the 'visibility' frame,
//      its replay on connect, no repeats unless forced, kept across stop/start,
//      the phone command validated, never sent to an extension socket.
//   5. The phone page: the button, the frame handler, the command it sends,
//      and no Mac-only wording (the page cannot tell the desktop's OS).
//   6. The wiring: main toggles through revealAfterMirrorHide + toggleMainWindow,
//      the Cmd/Ctrl+B path, and ipcHandlers routes the command there.
//
// Same electron stub and 4123-4134 port guard as the other PhoneMirror tests.
// Loopback ws, same on macOS and Windows.

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { transformSync } from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../');
const require = createRequire(path.join(repoRoot, 'package.json'));
const WS = require('ws').WebSocket;
const http = require('node:http');

const distServices = path.resolve(repoRoot, 'dist-electron/electron/services');
const {
  decideRemoteVisibility,
  createVisibilityRelay,
  isShownToUser,
  createPhoneVisibilityController,
  REMOTE_VISIBILITY_SETTLE_MS,
  VISIBILITY_RELAY_DELAY_MS,
} = require(path.join(distServices, 'phoneVisibility.js'));

// ── 1. The decision ─────────────────────────────────────────────────────────
describe('decideRemoteVisibility', () => {
  test('toggles only toward a state the window is not in', () => {
    assert.equal(decideRemoteVisibility(false, true, null, 0), 'toggle');
    assert.equal(decideRemoteVisibility(true, false, null, 0), 'toggle');
    assert.equal(decideRemoteVisibility(true, true, null, 0), 'none');
    assert.equal(decideRemoteVisibility(false, false, null, 0), 'none');
  });

  test('a second Hide while the overlay is still collapsing does nothing', () => {
    // The overlay stays visible for 400 ms after toggle-expand; a second
    // toggle in that time would expand it again.
    const last = { visible: false, at: 1000 };
    assert.equal(decideRemoteVisibility(false, true, last, 1400), 'none');
    assert.equal(decideRemoteVisibility(false, true, last, 1000 + REMOTE_VISIBILITY_SETTLE_MS - 1), 'none');
    // Long after: the window came back some other way, Hide works again.
    assert.equal(decideRemoteVisibility(false, true, last, 1000 + REMOTE_VISIBILITY_SETTLE_MS), 'toggle');
  });

  test('the opposite state is never held back', () => {
    assert.equal(decideRemoteVisibility(true, false, { visible: false, at: 1000 }, 1100), 'toggle');
  });

  test('a clock that went backwards does not block forever', () => {
    assert.equal(decideRemoteVisibility(false, true, { visible: false, at: 5000 }, 1000), 'toggle');
  });
});

// ── 2. The relay ────────────────────────────────────────────────────────────
function fakeTimers() {
  let seq = 0;
  const pending = new Map();
  return {
    timers: {
      setTimeout: (fn, ms) => { const id = ++seq; pending.set(id, { fn, ms }); return id; },
      clearTimeout: (id) => { pending.delete(id); },
    },
    pending,
    fire() { const all = [...pending.values()]; pending.clear(); for (const t of all) t.fn(); },
  };
}

describe('createVisibilityRelay', () => {
  test('a screenshot hide undone before the delay sends the unchanged state only', () => {
    let visible = true;
    const sent = [];
    const ft = fakeTimers();
    const relay = createVisibilityRelay(() => visible, (v) => sent.push(v), 300, ft.timers);
    visible = false; relay.changed();
    visible = true; relay.changed();
    assert.equal(ft.pending.size, 1, 'one timer, restarted');
    assert.equal([...ft.pending.values()][0].ms, 300);
    ft.fire();
    assert.deepEqual(sent, [true], 'read at fire time: still showing');
  });

  test('a lasting hide is sent once it holds', () => {
    let visible = true;
    const sent = [];
    const ft = fakeTimers();
    const relay = createVisibilityRelay(() => visible, (v) => sent.push(v), 300, ft.timers);
    visible = false; relay.changed();
    assert.deepEqual(sent, []);
    ft.fire();
    assert.deepEqual(sent, [false]);
  });

  test('flush sends now and cancels the wait; dispose sends nothing', () => {
    let visible = false;
    const sent = [];
    const ft = fakeTimers();
    const relay = createVisibilityRelay(() => visible, (v) => sent.push(v), 300, ft.timers);
    relay.changed();
    relay.flush();
    assert.deepEqual(sent, [false]);
    assert.equal(ft.pending.size, 0);
    relay.changed();
    relay.dispose();
    assert.equal(ft.pending.size, 0);
    assert.deepEqual(sent, [false]);
  });

  test('the default delay is longer than a screenshot hide', () => {
    assert.ok(VISIBILITY_RELAY_DELAY_MS >= 200 && VISIBILITY_RELAY_DELAY_MS <= 1000);
  });
});

// ── 2b. The controller against a model of the real desktop ─────────────────
// The model follows the real code: AppState.toggleMainWindow(true) in launcher
// mode hides/shows the window; in overlay mode it shows a hidden-but-expanded
// overlay directly, otherwise sends toggle-expand, and the renderer
// (NativelyInterface's isExpanded effect) reports expanded at once, hides the
// window 400 ms after a collapse (timer cancelled by a re-expand) and shows it
// on an expand. Cmd/Ctrl+B on the computer is the same toggle.
function desktopModel(mode = 'overlay') {
  let t = 0;
  let seq = 0;
  const timers = new Map();
  const clock = {
    now: () => t,
    timers: {
      setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: t + ms }); return id; },
      clearTimeout: (id) => { timers.delete(id); },
    },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]);
        t = next[1].at;
        next[1].fn();
      }
      t = end;
    },
  };
  const d = {
    mode, visible: true, expanded: true, hideTimer: null, toggles: 0, listener: () => {},
    isVisible: () => d.visible,
    getCurrentWindowMode: () => d.mode,
    isOverlayExpanded: () => d.expanded,
    setVisible(v) { if (d.visible !== v) { d.visible = v; d.listener(); } },
    setExpanded(v) { if (d.expanded !== v) { d.expanded = v; d.listener(); } },
    toggle() {
      d.toggles++;
      if (d.mode === 'launcher') { d.setVisible(!d.visible); return; }
      if (!d.visible && d.expanded) { d.setVisible(true); return; }
      d.setExpanded(!d.expanded);
      if (d.expanded) {
        if (d.hideTimer) { clock.timers.clearTimeout(d.hideTimer); d.hideTimer = null; }
        d.setVisible(true);
      } else {
        d.hideTimer = clock.timers.setTimeout(() => { d.hideTimer = null; d.setVisible(false); }, 400);
      }
    },
  };
  // What the phones receive: like PhoneMirrorService.setDesktopVisible, a
  // repeat is dropped unless forced ('!') or it answers requests ('[ids]').
  const published = [];
  let sent = null;
  const ctl = createPhoneVisibilityController({
    source: d,
    toggle: () => d.toggle(),
    publish: (visible, force, replyTo) => {
      if (visible === sent && !force && !replyTo?.length) return;
      sent = visible;
      published.push(`${visible}${force ? '!' : ''}${replyTo?.length ? `[${replyTo.join(',')}]` : ''}`);
    },
    now: clock.now,
    timers: clock.timers,
  });
  d.listener = () => ctl.windowChanged();
  return { d, ctl, clock, published };
}

describe('phone visibility controller (modelled desktop)', () => {
  test('EDGE: phone Hide, then Cmd/Ctrl+B on the computer within 200 ms: the phone is answered with the real state', () => {
    const { d, ctl, clock, published } = desktopModel('overlay');
    ctl.start();
    assert.equal(ctl.request(false, 'A'), 'toggle');
    clock.advance(150);
    d.toggle();                       // Cmd/Ctrl+B re-expands before the hide
    clock.advance(REMOTE_VISIBILITY_SETTLE_MS);
    assert.equal(d.visible, true, 'the computer had the last word');
    assert.deepEqual(published, ['true', 'true[A]'], 'answered with showing, within the settle time');
    clock.advance(5000);
    assert.deepEqual(published, ['true', 'true[A]'], 'answered once');
  });

  test('a request is answered with the frame that reports its state', () => {
    const { ctl, clock, published } = desktopModel('overlay');
    ctl.start();
    ctl.request(false, 'A');
    clock.advance(VISIBILITY_RELAY_DELAY_MS);
    assert.deepEqual(published, ['true', 'false[A]']);
    clock.advance(5000);
    assert.deepEqual(published, ['true', 'false[A]'], 'the settle timer was cleared');
  });

  test('a second phone asking the same during the collapse is answered at once (already hidden to the user)', () => {
    const { ctl, clock, published } = desktopModel('overlay');
    ctl.start();
    ctl.request(false, 'A');
    clock.advance(100);
    assert.equal(ctl.request(false, 'B'), 'none');
    clock.advance(5000);
    assert.deepEqual(published, ['true', 'false![B]', 'false[A]']);
  });

  test('a toggle that lands slowly: a repeat is not toggled again and both are answered when it lands', () => {
    const { d, ctl, clock, published } = desktopModel('launcher');
    // The window shows 500 ms after the toggle (a slow renderer).
    d.toggle = () => { d.toggles++; clock.timers.setTimeout(() => d.setVisible(!d.visible), 500); };
    d.visible = false;
    ctl.start();
    assert.equal(ctl.request(true, 'A'), 'toggle');
    clock.advance(200);
    assert.equal(ctl.request(true, 'B'), 'none');
    clock.advance(5000);
    assert.equal(d.toggles, 1);
    assert.equal(d.visible, true);
    assert.deepEqual(published, ['false', 'true[A,B]']);
  });

  test('asking for the state it is already in is answered at once', () => {
    const { ctl, published } = desktopModel('overlay');
    ctl.start();
    assert.equal(ctl.request(true, 'A'), 'none');
    assert.deepEqual(published, ['true', 'true![A]']);
  });

  // Found running the real app (2026-11-26): a screenshot hides the windows
  // for its whole capture, 3.1 s when the capture failed. The phone flipped
  // to Show, and a Show tapped then would have put Natively into the shot.
  test('SCREENSHOT: a 3 s capture hide never reaches the phone', () => {
    const { d, ctl, clock, published } = desktopModel('overlay');
    ctl.start();
    ctl.holdStart();
    d.setVisible(false);
    clock.advance(3100);
    d.setVisible(true);
    ctl.holdEnd();
    clock.advance(2000);
    assert.deepEqual(published, ['true']);
  });

  test('SCREENSHOT: a Hide tapped during the capture runs after the restore', () => {
    const { d, ctl, clock, published } = desktopModel('overlay');
    ctl.start();
    ctl.holdStart();
    d.setVisible(false);
    assert.equal(ctl.request(false, 'A'), 'deferred');
    assert.equal(d.toggles, 0, 'nothing toggled mid-capture');
    clock.advance(1000);
    d.setVisible(true);
    ctl.holdEnd();
    assert.equal(d.toggles, 1, 'run once the windows are back');
    clock.advance(2000);
    assert.equal(d.visible, false);
    assert.deepEqual(published, ['true', 'false[A]']);
  });

  test('SCREENSHOT: a Show tapped during the capture of a hidden Natively shows it only after the capture', () => {
    const { d, ctl, clock, published } = desktopModel('launcher');
    d.visible = false;
    ctl.start();
    ctl.holdStart();                  // capture while Natively is hidden: nothing to hide
    assert.equal(ctl.request(true, 'A'), 'deferred');
    clock.advance(1000);
    assert.equal(d.visible, false, 'not shown into the screenshot');
    ctl.holdEnd();
    assert.equal(d.visible, true);
    clock.advance(1000);
    assert.deepEqual(published, ['false', 'true[A]']);
  });

  test('SCREENSHOT: an answer owed when the capture starts is the state the capture restores, on time', () => {
    const { d, ctl, clock, published } = desktopModel('launcher');
    d.toggle = () => { d.toggles++; };   // a toggle that never lands
    ctl.start();
    ctl.request(false, 'A');
    ctl.holdStart();
    d.setVisible(false);
    clock.advance(REMOTE_VISIBILITY_SETTLE_MS);
    assert.deepEqual(published, ['true', 'true[A]'], 'answered at the settle time, not with the capture hide');
    clock.advance(5000);
    d.setVisible(true);
    ctl.holdEnd();
    clock.advance(1000);
    assert.deepEqual(published, ['true', 'true[A]']);
  });

  // Review 2026-11-26: a selective screenshot holds until the user has drawn
  // the crop. A Hide tapped then ran seconds after the phone said
  // "Your computer did not respond".
  test('SCREENSHOT: a tap held longer than the settle time (a 10 s crop) is dropped and answered with the restored state', () => {
    const { d, ctl, clock, published } = desktopModel('overlay');
    ctl.start();
    ctl.holdStart();
    d.setVisible(false);
    clock.advance(1000);
    assert.equal(ctl.request(false, 'A'), 'deferred');
    clock.advance(REMOTE_VISIBILITY_SETTLE_MS);
    assert.deepEqual(published, ['true', 'true![A]'], 'answered within the settle time, well before the phone gives up');
    clock.advance(10000 - 1000 - REMOTE_VISIBILITY_SETTLE_MS);
    d.setVisible(true);
    ctl.holdEnd();
    clock.advance(3000);
    assert.equal(d.toggles, 0, 'nothing happens after the phone was answered');
    assert.equal(d.visible, true);
    assert.deepEqual(published, ['true', 'true![A]']);
  });

  test('SCREENSHOT: only the taps that waited too long are dropped; a later one still runs after the restore', () => {
    const { d, ctl, clock, published } = desktopModel('launcher');
    ctl.start();
    ctl.holdStart();
    d.setVisible(false);
    ctl.request(false, 'A');
    clock.advance(REMOTE_VISIBILITY_SETTLE_MS + 100);   // A dropped
    ctl.request(false, 'B');
    clock.advance(500);
    d.setVisible(true);
    ctl.holdEnd();                                       // B runs
    clock.advance(2000);
    assert.equal(d.toggles, 1);
    assert.equal(d.visible, false);
    assert.deepEqual(published, ['true', 'true![A]', 'false[B]']);
  });

  test('dispose clears taps waiting out a capture', () => {
    const { ctl, clock, published } = desktopModel('launcher');
    ctl.start();
    ctl.holdStart();
    ctl.request(false, 'A');
    ctl.dispose();
    clock.advance(5000);
    assert.deepEqual(published, ['true']);
  });

  // Review 2026-11-26: the repeat guard held for 1.5 s even after its toggle
  // had landed, so a Hide after Cmd/Ctrl+B had brought Natively back did nothing.
  for (const mode of ['launcher', 'overlay']) {
    test(`${mode}: phone Hide lands, Cmd/Ctrl+B brings it back, a second Hide within 1.5 s hides it again`, () => {
      const { d, ctl, clock, published } = desktopModel(mode);
      ctl.start();
      assert.equal(ctl.request(false, 'A'), 'toggle');
      clock.advance(500);
      assert.equal(d.visible, false);
      d.toggle();                                     // Cmd/Ctrl+B on the computer
      clock.advance(300);
      assert.equal(d.visible, true);
      assert.equal(ctl.request(false, 'B'), 'toggle', 'the earlier toggle landed: not a repeat');
      clock.advance(1000);
      assert.equal(d.visible, false);
      assert.equal(d.toggles, 3);
      assert.ok(published.includes('false[B]'), JSON.stringify(published));
    });
  }

  test('holdEnd without holdStart does nothing', () => {
    const { ctl, clock, published } = desktopModel('overlay');
    ctl.start();
    ctl.holdEnd();
    clock.advance(1000);
    assert.equal(ctl.request(false, 'A'), 'toggle');
    assert.deepEqual(published, ['true']);
  });

  test('dispose drops owed answers', () => {
    const { ctl, clock, published } = desktopModel('launcher');
    ctl.start();
    ctl.request(false, 'A');
    ctl.dispose();
    clock.advance(5000);
    assert.deepEqual(published, ['true']);
  });

  test('isShownToUser: a collapsing overlay is already gone; a launcher is its window', () => {
    const src = (visible, mode, expanded) => ({ isVisible: () => visible, getCurrentWindowMode: () => mode, isOverlayExpanded: () => expanded });
    assert.equal(isShownToUser(src(true, 'overlay', true)), true);
    assert.equal(isShownToUser(src(true, 'overlay', false)), false, 'collapsing');
    assert.equal(isShownToUser(src(false, 'overlay', true)), false, 'held hidden (screenshot, mirror)');
    assert.equal(isShownToUser(src(true, 'launcher', false)), true, 'expanded is an overlay flag');
    assert.equal(isShownToUser(src(false, 'launcher', true)), false);
  });

  test('THE RACE: Cmd/Ctrl+B on the computer, then Hide on the phone within the 400 ms collapse, stays hidden', () => {
    const { d, ctl, clock, published } = desktopModel('overlay');
    ctl.start();
    d.toggle();                       // Cmd/Ctrl+B on the computer: collapse starts
    clock.advance(200);
    // Reading the window alone, this was a toggle (and re-expanded the overlay):
    assert.equal(decideRemoteVisibility(false, d.isVisible(), null, clock.now()), 'toggle');
    assert.equal(ctl.request(false), 'none');
    assert.equal(d.toggles, 1, 'the phone did not toggle');
    clock.advance(1000);
    assert.equal(d.visible, false, 'hidden, as both asked');
    assert.equal(d.expanded, false);
    assert.deepEqual(published, ['true', 'false!'], 'the phone heard hidden at once, and only once');
  });

  test('Hide from the phone, then a second Hide (another phone) during the collapse: one toggle, hidden', () => {
    const { d, ctl, clock } = desktopModel('overlay');
    ctl.start();
    assert.equal(ctl.request(false), 'toggle');
    clock.advance(100);
    assert.equal(ctl.request(false), 'none');
    clock.advance(1000);
    assert.equal(d.toggles, 1);
    assert.equal(d.visible, false);
  });

  test('the phone hears hidden only once the overlay collapsed, and Show then brings it back', () => {
    const { d, ctl, clock, published } = desktopModel('overlay');
    ctl.start();
    ctl.request(false);
    clock.advance(VISIBILITY_RELAY_DELAY_MS - 1);
    assert.deepEqual(published, ['true']);
    clock.advance(1);
    assert.deepEqual(published, ['true', 'false']);
    clock.advance(1000);
    // The phone's button now reads Show; its tap comes after the window hid.
    assert.equal(ctl.request(true), 'toggle');
    assert.equal(d.visible, true);
    assert.equal(d.expanded, true);
    clock.advance(1000);
    assert.deepEqual(published, ['true', 'false', 'true']);
  });

  test('Cmd/Ctrl+B twice within 400 ms (collapse undone): the phone never hears hidden', () => {
    const { d, ctl, clock, published } = desktopModel('overlay');
    ctl.start();
    d.toggle();
    clock.advance(150);
    d.toggle();
    clock.advance(2000);
    assert.equal(d.visible, true);
    assert.deepEqual(published, ['true']);
  });

  test('a hidden-but-expanded overlay (screenshot / mirror hide) counts as hidden, and Show shows it', () => {
    const { d, ctl, clock } = desktopModel('overlay');
    d.visible = false;
    assert.equal(ctl.request(true), 'toggle');
    assert.equal(d.visible, true);
    clock.advance(1000);
  });

  test('a screenshot hide shorter than the delay does not reach the phone as hidden', () => {
    const { d, ctl, clock, published } = desktopModel('overlay');
    ctl.start();
    d.setVisible(false);
    clock.advance(120);
    d.setVisible(true);
    clock.advance(1000);
    assert.ok(!published.includes('false'), published.join(','));
  });

  test('launcher mode: Hide hides, Show shows, a repeat is answered without a toggle', () => {
    const { d, ctl, clock, published } = desktopModel('launcher');
    ctl.start();
    assert.equal(ctl.request(false), 'toggle');
    assert.equal(d.visible, false);
    clock.advance(2000);
    assert.equal(ctl.request(false), 'none');
    assert.equal(published.at(-1), 'false!');
    assert.equal(ctl.request(true), 'toggle');
    assert.equal(d.visible, true);
    assert.equal(d.toggles, 2);
  });
});

// ── 3. WindowHelper reports changes, both platform branches ────────────────
function windowHelperFixture(platform) {
  const source = fs.readFileSync(path.join(repoRoot, 'electron/WindowHelper.ts'), 'utf8');
  const module = { exports: {} };
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, __dirname: '/tmp', console: { log() {}, warn() {} },
    process: Object.create(process, { platform: { value: platform } }),
    require: (name) => {
      if (name === 'electron') return { app: { isPackaged: false }, BrowserWindow: {}, screen: {} };
      if (name.startsWith('node:') || name === 'path' || name === 'fs' || name === 'os') return require(name);
      if (name.endsWith('KeybindManager')) return { KeybindManager: { getInstance: () => ({ setMode() {} }) } };
      return {};
    },
  });
  const ops = [];
  const fakeWindow = (name) => ({
    minimized: false,
    handlers: {},
    on(event, fn) { this.handlers[event] = fn; },
    isDestroyed: () => false,
    isVisible: () => true,
    isMinimized() { return this.minimized; },
    restore() { ops.push(`${name}.restore`); this.minimized = false; },
    show: () => ops.push(`${name}.show`),
    showInactive: () => ops.push(`${name}.showInactive`),
    focus: () => {},
    setContentProtection: () => {},
    hide: () => ops.push(`${name}.hide`),
    setOpacity: (v) => ops.push(`${name}.opacity=${v}`),
  });
  // Anything else switchToLauncher asks AppState: a no-op that says "no".
  const appState = new Proxy({}, { get: () => () => false });
  const helper = Object.create(module.exports.WindowHelper.prototype);
  Object.assign(helper, {
    isWindowVisible: true,
    visibilityListener: null,
    launcherWindow: fakeWindow('launcher'),
    overlayWindow: fakeWindow('overlay'),
    pillWindow: null,
    toggleWindow: null,
    stopStealthTyping() {},
    applyOverlayAuxVisibility() {},
    syncOverlayAuxVisibility() {},
    lastOverlayUiState: null,
    currentWindowMode: 'launcher',
    appState,
    contentProtection: false,
  });
  return { helper, ops };
}

for (const platform of ['darwin', 'win32']) {
  describe(`WindowHelper visibility listener (${platform} branch)`, () => {
    test('hideMainWindow reports hidden once, repeats report nothing', () => {
      const { helper, ops } = windowHelperFixture(platform);
      const heard = [];
      helper.onVisibilityChange((v) => heard.push(v));
      helper.hideMainWindow();
      helper.hideMainWindow();
      assert.deepEqual(heard, [false]);
      assert.equal(helper.isVisible(), false);
      // The platform branch really ran: Windows zeroes opacity, macOS must not.
      const zeroed = ops.some((o) => o.endsWith('opacity=0'));
      assert.equal(zeroed, platform === 'win32', ops.join(','));
    });

    test('the overlay collapsing or expanding is reported; other UI state is not', () => {
      const { helper } = windowHelperFixture(platform);
      const heard = [];
      helper.onVisibilityChange((v) => heard.push(v));
      helper.setOverlayUiState({ expanded: true, hasContent: true });
      helper.setOverlayUiState({ expanded: true, hasContent: false, overlayOpacity: 0.5 });
      assert.deepEqual(heard, [], 'still expanded: nothing');
      helper.setOverlayUiState({ expanded: false });
      assert.deepEqual(heard, [true], 'collapse reported (the window is still up for 400 ms)');
      helper.setOverlayUiState({ expanded: false, shellWide: true });
      helper.setOverlayUiState({ expanded: true });
      assert.deepEqual(heard, [true, true]);
    });

    // Review 2026-11-26 (pre-existing): these hid Natively but left the flag
    // at "shown", so Cmd/Ctrl+B needed two presses and the phone offered Hide.
    test('closing the overlay mid-meeting (Cmd+W / Alt+F4: hideOverlay) reports hidden in overlay mode only', () => {
      const { helper, ops } = windowHelperFixture(platform);
      const heard = [];
      helper.onVisibilityChange((v) => heard.push(v));
      helper.currentWindowMode = 'overlay';
      helper.hideOverlay();
      assert.ok(ops.includes('overlay.hide'));
      assert.equal(helper.isVisible(), false);
      assert.deepEqual(heard, [false]);
      const other = windowHelperFixture(platform).helper;   // launcher mode: the launcher owns the flag
      other.hideOverlay();
      assert.equal(other.isVisible(), true);
    });

    test('a minimized launcher reports hidden, a restored one shown; overlay mode leaves the flag alone', () => {
      const { helper } = windowHelperFixture(platform);
      const heard = [];
      helper.onVisibilityChange((v) => heard.push(v));
      const win = helper.launcherWindow;
      helper.trackLauncherMinimize(win);
      win.minimized = true; win.handlers.minimize();
      assert.equal(helper.isVisible(), false);
      win.minimized = false; win.handlers.restore();
      assert.equal(helper.isVisible(), true);
      assert.deepEqual(heard, [false, true]);
      helper.currentWindowMode = 'overlay';
      win.handlers.minimize();
      assert.equal(helper.isVisible(), true, 'overlay mode: not the launcher\'s flag');
    });

    test(`showing a minimized launcher ${platform === 'darwin' ? 'restores it first' : 'leaves the restore to showInactive (no restore(): it would take focus)'}`, () => {
      const { helper, ops } = windowHelperFixture(platform);
      helper.launcherWindow.minimized = true;
      helper.isWindowVisible = false;
      helper.switchToLauncher(true);
      const restoreAt = ops.indexOf('launcher.restore');
      const showAt = ops.indexOf('launcher.showInactive');
      assert.ok(showAt >= 0, ops.join(','));
      if (platform === 'darwin') assert.ok(restoreAt >= 0 && restoreAt < showAt, ops.join(','));
      else assert.equal(restoreAt, -1, ops.join(','));
      assert.equal(helper.isVisible(), true);
    });

    test('a listener that throws does not break the hide', () => {
      const { helper } = windowHelperFixture(platform);
      helper.onVisibilityChange(() => { throw new Error('boom'); });
      helper.hideMainWindow();
      assert.equal(helper.isVisible(), false);
    });
  });
}

test('every write of the visibility flag goes through the setter', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'electron/WindowHelper.ts'), 'utf8');
  const writes = source.match(/this\.isWindowVisible\s*=[^=]/g) || [];
  // The one write left is the setter's own.
  assert.equal(writes.length, 1, writes.join(' | '));
});

// ── 4. The real service over a socket ──────────────────────────────────────
const serviceBundle = process.env.PHONE_MIRROR_SERVICE_BUNDLE
  ? path.resolve(process.env.PHONE_MIRROR_SERVICE_BUNDLE)
  : path.join(distServices, 'PhoneMirrorService.js');
const clientBundle = process.env.PHONE_MIRROR_CLIENT_BUNDLE
  ? path.resolve(process.env.PHONE_MIRROR_CLIENT_BUNDLE)
  : path.join(distServices, 'phoneMirrorClient.js');

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-pm-showhide-'));
const electronStub = {
  app: { isReady: () => true, getPath: () => userDataDir, whenReady: () => Promise.resolve(), on: () => {} },
  BrowserWindow: class {
    static getFocusedWindow() { return null; }
    static getAllWindows() { return []; }
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('enc:' + s, 'utf8'),
    decryptString: (buf) => Buffer.from(buf).toString('utf8').replace(/^enc:/, ''),
  },
};
const originalLoad = Module._load;
const originalListen = http.Server.prototype.listen;
let svc;
let port = 0;
let token = '';
let extToken = '';
const commands = [];
let offCommands = null;

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

async function connectPhone() {
  const ws = new WS(`ws://127.0.0.1:${port}/ws?t=${encodeURIComponent(token)}`);
  const frames = [];
  ws.on('message', (d) => frames.push(JSON.parse(String(d))));
  ws.on('error', () => {});
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await settle(30);
  return { ws, frames, visibility: () => frames.filter((f) => f.type === 'visibility').map((f) => f.visible) };
}

describe('PhoneMirrorService visibility', () => {
  before(async () => {
    Module._load = function (request, parent, isMain) {
      if (request === 'electron') return electronStub;
      return originalLoad.call(this, request, parent, isMain);
    };
    http.Server.prototype.listen = function (...args) {
      if (typeof args[0] === 'number' && args[0] >= 4123 && args[0] < 4135) {
        process.nextTick(() => this.emit('error', Object.assign(new Error('taken (test)'), { code: 'EADDRINUSE' })));
        return this;
      }
      return originalListen.apply(this, args);
    };
    svc = (await import(pathToFileURL(serviceBundle).href)).PhoneMirrorService.getInstance();
    offCommands = svc.onPhoneCommand((cmd) => commands.push(cmd));
  });

  after(async () => {
    offCommands?.();
    if (svc?.isRunning()) await svc.stop({ persist: false });
    Module._load = originalLoad;
    http.Server.prototype.listen = originalListen;
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    if (svc.isRunning()) await svc.stop({ persist: false });
    commands.length = 0;
    const info = await svc.start({ exposeOnLan: false, persist: false });
    port = info.port;
    token = info.token;
    extToken = info.extToken;
    assert.ok(port < 4123 || port >= 4135);
  });

  // Runs first: the singleton has not been told any state yet.
  test('before the desktop reports, a phone gets no visibility frame (button stays hidden)', async () => {
    const phone = await connectPhone();
    assert.deepEqual(phone.visibility(), []);
    phone.ws.close();
  });

  test('changes reach a connected phone; repeats do not', async () => {
    svc.setDesktopVisible(true);
    const phone = await connectPhone();
    assert.deepEqual(phone.visibility(), [true], 'replayed on connect');
    svc.setDesktopVisible(false);
    svc.setDesktopVisible(false);
    svc.setDesktopVisible('no');
    await settle(30);
    assert.deepEqual(phone.visibility(), [true, false]);
    assert.deepEqual(Object.keys(phone.frames.findLast((f) => f.type === 'visibility')).sort(), ['type', 'visible']);
    phone.ws.close();
  });

  test('an answer is sent even when nothing changed, with the ids it settles', async () => {
    svc.setDesktopVisible(true);
    const phone = await connectPhone();
    svc.setDesktopVisible(true, false, ['v1-abc']);
    svc.setDesktopVisible(true, false, []);
    await settle(30);
    const frames = phone.frames.filter((f) => f.type === 'visibility');
    assert.deepEqual(frames, [{ type: 'visibility', visible: true }, { type: 'visibility', visible: true, replyTo: ['v1-abc'] }]);
    phone.ws.close();
  });

  test('force re-sends the same state (a phone asked for what it already had)', async () => {
    svc.setDesktopVisible(true);
    const phone = await connectPhone();
    svc.setDesktopVisible(true, true);
    await settle(30);
    assert.deepEqual(phone.visibility(), [true, true]);
    phone.ws.close();
  });

  test('the replay comes after history, transcript and recording', async () => {
    svc.setDesktopVisible(false);
    const phone = await connectPhone();
    const types = phone.frames.map((f) => f.type);
    assert.ok(types.indexOf('visibility') > types.indexOf('recording'), types.join(','));
    assert.ok(types.indexOf('visibility') > types.indexOf('transcript-history'), types.join(','));
    phone.ws.close();
  });

  test('kept across stop and start: it is the desktop window, not the server', async () => {
    svc.setDesktopVisible(false);
    await svc.stop({ persist: false });
    svc.setDesktopVisible(true);
    const info = await svc.start({ exposeOnLan: false, persist: false });
    port = info.port;
    token = info.token;
    const phone = await connectPhone();
    assert.deepEqual(phone.visibility(), [true]);
    phone.ws.close();
  });

  test('the phone command carries a boolean state; anything else is dropped', async () => {
    const phone = await connectPhone();
    phone.ws.send(JSON.stringify({ type: 'visibility', visible: false }));
    phone.ws.send(JSON.stringify({ type: 'visibility', visible: true, id: 'v2-k3j9' }));
    phone.ws.send(JSON.stringify({ type: 'visibility', visible: true, id: '../../x y' }));
    phone.ws.send(JSON.stringify({ type: 'visibility' }));
    phone.ws.send(JSON.stringify({ type: 'visibility', visible: 'false' }));
    phone.ws.send(JSON.stringify({ type: 'visibility', visible: 1 }));
    await settle(60);
    assert.deepEqual(commands, [
      { type: 'visibility', visible: false },
      { type: 'visibility', visible: true, id: 'v2-k3j9' },
      { type: 'visibility', visible: true },
    ], 'a malformed id is dropped, the request kept');
    phone.ws.close();
  });

  // The connect replay reaches every socket before it says hello (the
  // extension ignores frame types it does not know); after hello, broadcasts
  // skip extension sockets.
  test('an extension socket gets no visibility broadcast after hello', async () => {
    assert.ok(extToken, 'the service mints an extension token');
    const ws = new WS(`ws://127.0.0.1:${port}/ws?t=${encodeURIComponent(extToken)}`);
    const frames = [];
    ws.on('message', (d) => frames.push(JSON.parse(String(d))));
    ws.on('error', () => {});
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    ws.send(JSON.stringify({ type: 'hello', role: 'extension', v: 1 }));
    await settle(50);
    frames.length = 0;
    svc.setDesktopVisible(true, true);
    await settle(50);
    assert.equal(frames.filter((f) => f.type === 'visibility').length, 0);
    ws.close();
  });
});

// ── 5. The phone page ──────────────────────────────────────────────────────
describe('phone page', () => {
  let html = '';
  before(() => {
    html = require(clientBundle).PHONE_MIRROR_HTML;
  });

  test('a hidden Show / Hide button sits in the bar, before the menu', () => {
    const bar = html.slice(html.indexOf('<header class="bar"'), html.indexOf('</header>'));
    assert.match(bar, /<button class="vis" id="visBtn" type="button" hidden/);
    assert.ok(bar.indexOf('id="visBtn"') < bar.indexOf('id="menuBtn"'));
  });

  test('the page handles the frame and asks for a state, not a toggle', () => {
    assert.match(html, /case 'visibility': onVisibility\(ev\); break;/);
    assert.match(html, /sendCommand\(\{ type: 'visibility', visible: target, id: id \}\)/);
    assert.match(html, /ev\.replyTo\.indexOf\(visPending\.id\) >= 0/);
    assert.match(html, /var target = !desktopVisible;/);
  });

  test('the button reads the state it changes to, and waits for the desktop', () => {
    assert.match(html, /desktopVisible \? 'Hide' : 'Show'/);
    assert.match(html, /var shown = desktopVisible !== null && conn === 'live';/);
    assert.match(html, /visBtn\.disabled = !!visPending;/);
    assert.match(html, /VIS_CONFIRM_MS = 4000/);
  });

  test('no Mac-only wording: the phone cannot tell which computer it talks to', () => {
    assert.doesNotMatch(html, /on your Mac\b/);
  });
});

// ── 6. The wiring ──────────────────────────────────────────────────────────
describe('wiring', () => {
  const main = fs.readFileSync(path.join(repoRoot, 'electron/main.ts'), 'utf8');
  const ipc = fs.readFileSync(path.join(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');

  test('the controller toggles through the Cmd/Ctrl+B path and reads WindowHelper', () => {
    const start = main.indexOf('this.phoneVisibility = createPhoneVisibilityController({');
    assert.ok(start > 0);
    const block = main.slice(start, main.indexOf('this.phoneVisibility.start();', start));
    assert.match(block, /source: this\.windowHelper,/);
    assert.match(block, /toggle: \(\) => this\.revealAfterMirrorHide\(\(\) => this\.toggleMainWindow\(true\)\)/);
    assert.match(block, /PhoneMirrorService\.getInstance\(\)\.setDesktopVisible\(visible, force, replyTo\)/);
    assert.doesNotMatch(block, /process\.platform/, 'no platform fork: the toggle is shared');
    assert.match(main, /this\.windowHelper\.onVisibilityChange\(\(\) => this\.phoneVisibility\?\.windowChanged\(\)\)/);
    assert.match(main, /public setVisibilityFromPhone\(visible: boolean, requestId\?: string\): void \{\s*this\.phoneVisibility\?\.request\(visible, requestId\);/);
  });

  test('screenshot captures hold the phone; the mirror hide does not', () => {
    const start = main.indexOf('private async withScreenshotCaptureSession<T>(');
    const body = main.slice(start, main.indexOf('public async takeScreenshot(', start));
    assert.ok(body.indexOf('this.phoneVisibility?.holdStart();') < body.indexOf('this.hideWindowsForScreenshot(session);'));
    assert.ok(body.indexOf('this.restoreWindowsAfterScreenshot(session);') < body.indexOf('this.phoneVisibility?.holdEnd();'));
    assert.match(body, /finally \{[\s\S]*this\.phoneVisibility\?\.holdEnd\(\);[\s\S]*\}/);
    const mirror = main.slice(main.indexOf('public hideWindowsForMirroring('), main.indexOf('public mergeMirroringHides('));
    assert.doesNotMatch(mirror, /holdStart/);
  });

  test('ipcHandlers routes the command to main, not the renderer channel', () => {
    assert.match(ipc, /if \(cmd\.type === 'visibility'\) \{[\s\S]{0,200}appState\.setVisibilityFromPhone\(cmd\.visible, cmd\.id\);/);
  });
});
