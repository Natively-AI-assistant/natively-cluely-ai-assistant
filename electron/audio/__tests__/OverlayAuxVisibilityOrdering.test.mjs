// Regression test for the "overlay group shows/hides in two pieces" bug.
//
// Symptom (two halves of one root cause):
//   1. Stop meeting → the launcher UI appears, and only THEN does the top pill
//      vanish — the pill is visibly stranded on top of the launcher.
//   2. Starting/showing the overlay → the pill appears at a different moment
//      than the shell body.
//
// Root cause: after the pill and resize toggle moved into their own
// BrowserWindows (the 3-window overlay), their visibility was driven ONLY by
// the overlay window's 'show'/'hide' events. That is one hop behind every call
// site, and switchToLauncher makes the gap visible because it shows the
// launcher FIRST and hides the overlay SECOND:
//     show launcher → hide overlay → ('hide' event) → hide pill
// The pill is alwaysOnTop and the launcher is a regular window, so every frame
// in that tail paints the pill over the launcher.
//
// Fix: every show/hide call site drives the aux chrome EXPLICITLY, in the same
// synchronous block as the overlay's own show/hide, via
// applyOverlayAuxVisibility(want). The 'show'/'hide' event handlers remain as a
// backstop for OS-driven visibility changes but are no longer the mechanism.
//
// Strategy: source-contract assertions against WindowHelper.ts. The ORDERING is
// load-bearing (hiding the aux chrome after the launcher show reintroduces the
// bug verbatim), and ordering is exactly what a well-meaning refactor drops. On
// win32 the placement is additionally constrained by the opacity shield: the
// aux show must land while the windows are still at opacity 0, i.e. before the
// deferred setOpacity(1), or the pill flashes through content protection.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  path.resolve(__dirname, '../../../electron/WindowHelper.ts'),
  'utf8',
);

function extractMethodBody(methodName) {
  const re = new RegExp(
    `(?:public|private|protected)\\s+(?:async\\s+)?${methodName}\\s*\\([^)]*\\)\\s*(?::[^{]*)?\\{`,
  );
  const m = re.exec(source);
  assert.ok(m, `could not locate ${methodName} in WindowHelper.ts`);
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, `unbalanced braces in ${methodName}`);
  return source.slice(start, i - 1);
}

const switchToLauncher = extractMethodBody('switchToLauncher');
const switchToOverlay = extractMethodBody('switchToOverlay');
const hideOverlay = extractMethodBody('hideOverlay');
const hideMainWindow = extractMethodBody('hideMainWindow');
const showOverlay = extractMethodBody('showOverlay');

test('applyOverlayAuxVisibility exists and takes the wanted state explicitly', () => {
  assert.match(
    source,
    /private applyOverlayAuxVisibility\(want: boolean\): void \{/,
    'the explicit aux-visibility primitive must survive — call sites mid-swap ' +
      'cannot derive visibility from the overlay (it is still visible while ' +
      'being hidden)',
  );
  // The derived form must be a thin wrapper over it, not a second implementation.
  const sync = extractMethodBody('syncOverlayAuxVisibility');
  assert.match(
    sync,
    /this\.applyOverlayAuxVisibility\(/,
    'syncOverlayAuxVisibility must delegate to applyOverlayAuxVisibility so the ' +
      'two paths cannot drift',
  );
});

test('switchToLauncher hides the aux chrome BEFORE showing the launcher', () => {
  const hideAux = switchToLauncher.indexOf('this.applyOverlayAuxVisibility(false)');
  assert.notEqual(hideAux, -1, 'switchToLauncher must hide the aux chrome explicitly');

  const launcherShow = Math.min(
    ...['this.launcherWindow.show()', 'this.launcherWindow.showInactive()']
      .map((s) => switchToLauncher.indexOf(s))
      .filter((i) => i !== -1),
  );
  assert.ok(Number.isFinite(launcherShow), 'expected a launcher show call');

  assert.ok(
    hideAux < launcherShow,
    'the pill/toggle hide must precede the launcher show — the pill is ' +
      'alwaysOnTop and the launcher is not, so any frame with both up paints ' +
      'the pill over the launcher (the reported Stop-meeting bug)',
  );
});

test('switchToLauncher still hides the overlay body AFTER showing the launcher', () => {
  // The aux fix must not have inverted the show-before-hide invariant that
  // keeps at least one Natively window on screen through the swap.
  const launcherShow = Math.min(
    ...['this.launcherWindow.show()', 'this.launcherWindow.showInactive()']
      .map((s) => switchToLauncher.indexOf(s))
      .filter((i) => i !== -1),
  );
  const overlayHide = switchToLauncher.indexOf('this.overlayWindow.hide()');
  assert.notEqual(overlayHide, -1, 'switchToLauncher must still hide the overlay');
  assert.ok(
    launcherShow < overlayHide,
    'the launcher show must still precede the overlay hide (no no-window-visible gap)',
  );
});

test('switchToOverlay shows the aux chrome in the same block as the body, on both platform paths', () => {
  const shows = [...switchToOverlay.matchAll(/this\.applyOverlayAuxVisibility\(true\)/g)];
  assert.equal(
    shows.length,
    2,
    'both the win32 opacity-shield branch and the macOS/default branch must ' +
      'show the aux chrome explicitly — one per branch',
  );
});

test('the win32 aux show lands while the opacity shield is still down', () => {
  // Opacity-shield order: setOpacity(0) → show → aux show → deferred setOpacity(1).
  // Showing the aux windows after the un-shield would flash the pill on a
  // content-protected display.
  const shieldDown = switchToOverlay.indexOf('this.pillWindow?.setOpacity(0)');
  const auxShow = switchToOverlay.indexOf('this.applyOverlayAuxVisibility(true)');
  const unshield = switchToOverlay.indexOf('this.pillWindow?.setOpacity(1)');
  assert.ok(shieldDown !== -1 && auxShow !== -1 && unshield !== -1);
  assert.ok(
    shieldDown < auxShow && auxShow < unshield,
    'the win32 aux show must sit between the opacity shield going down and ' +
      'coming back up',
  );
});

test('switchToOverlay pre-applies expanded:true to the aux state before the body is shown', () => {
  const ensure = switchToOverlay.indexOf("send('ensure-expanded')");
  const preApply = switchToOverlay.indexOf('expanded: true');
  assert.notEqual(preApply, -1, 'the cached aux UI state must be pre-expanded');
  assert.ok(
    ensure < preApply,
    'pre-apply must accompany ensure-expanded — the pill otherwise learns the ' +
      'expansion a renderer→main→pill round trip later and fades in 0.22s ' +
      'behind the body (OverlayAuxWindows opacity gate)',
  );
  const setState = switchToOverlay.indexOf('this.setOverlayUiState(');
  assert.ok(
    setState !== -1 && setState < switchToOverlay.indexOf('this.applyOverlayAuxVisibility(true)'),
    'the pre-applied state must be pushed BEFORE the pill window is shown, so ' +
      'the pill paints expanded on its first frame',
  );
});

test('every direct overlay hide/show path drives the aux chrome explicitly', () => {
  assert.match(
    hideOverlay,
    /this\.applyOverlayAuxVisibility\(false\)/,
    'hideOverlay must take the pill/toggle down with the body',
  );
  assert.match(
    hideMainWindow,
    /this\.applyOverlayAuxVisibility\(false\)/,
    'hideMainWindow feeds screenshot capture (fixed 80ms compositor flush) — ' +
      'an event-hop pill hide can leak the pill into the captured frame',
  );
  assert.match(
    showOverlay,
    /this\.applyOverlayAuxVisibility\(true\)/,
    'showOverlay must bring the pill/toggle up with the body',
  );
});

test('hideMainWindow hides the aux chrome before the overlay body', () => {
  const auxHide = hideMainWindow.indexOf('this.applyOverlayAuxVisibility(false)');
  const bodyHide = hideMainWindow.indexOf('this.overlayWindow?.hide()');
  assert.ok(auxHide !== -1 && bodyHide !== -1);
  assert.ok(
    auxHide < bodyHide,
    'aux chrome is alwaysOnTop — it must go down first or it outlives the body',
  );
});

// ── Welded overlay group (macOS child windows) ──────────────────────────────
// The pill/toggle become real AppKit child windows of the shell, so the group
// moves in ONE window-server transaction and cannot come apart. Measured on
// Electron 43/macOS: children follow the parent by the same delta; a child
// move neither moves the parent nor fires a parent 'move'; parent.hide()
// propagates but parent.show() does NOT.
//
// Everything below guards an invariant that, if broken, silently degrades back
// to the lagging behaviour or actively fights the OS drag loop.

test('drag management is enabled on BOTH platforms, welding on macOS only', () => {
  // Two separate mechanisms, deliberately decoupled:
  //   welded      = macOS AppKit child windows (atomic parent→child moves)
  //   dragManaged = pill drags the group instead of using an OS drag region
  // Windows gets dragManaged WITHOUT welding: setParentWindow there is OWNER
  // semantics (no auto-move), but an OS drag region enters the modal move loop
  // which starves the follower window, so managing the drag still wins.
  assert.match(
    source,
    /this\.overlayGroupDragManaged =\s*\n?\s*this\.overlayGroupWelded \|\|\s*\n?\s*\(process\.platform === 'win32' && process\.env\.NATIVELY_OVERLAY_GROUP_DRAG !== '0'\)/,
    'Windows must opt into managed drag independently of welding',
  );
  assert.match(
    source,
    /this\.overlayGroupDragManaged =\s*\n?\s*this\.overlayGroupWelded \|\|/,
    'a welded pill MUST be drag-managed — a welded child dragged natively ' +
      'moves alone and tears the group apart, so macOS cannot disable it ' +
      'independently',
  );
  // The drag entry points gate on dragManaged, not welded, or Windows no-ops.
  assert.match(extractMethodBody('moveOverlayGroupTo'), /if \(!this\.overlayGroupDragManaged\) return;/);
  assert.match(extractMethodBody('beginOverlayGroupDrag'), /if \(!this\.overlayGroupDragManaged\) return;/);
  assert.match(extractMethodBody('endOverlayGroupDrag'), /if \(!this\.overlayGroupDragManaged\) return;/);
});

test('the non-welded (Windows) drag path carries the pill, the welded one does not', () => {
  const move = extractMethodBody('moveOverlayGroupTo');
  // On macOS AppKit already moved the child; doing it again doubles the delta.
  assert.match(
    move,
    /if \(!this\.overlayGroupWelded\) this\.positionOverlayAuxWindows\(\)/,
    'the pill must be re-derived from the shell when NOT welded, and left ' +
      'alone when welded (AppKit already moved it — touching it doubles the move)',
  );
});

test('the group drag is anchor-based and clamped every frame', () => {
  // Measured: letting either window leave the screen accumulates a permanent
  // offset (~295px) because macOS refuses to place a window fully off-screen
  // and the shell/pill hit that limit at different moments. Both delta-
  // offsetting and per-frame re-deriving failed this way; anchoring + clamping
  // every frame held at 0px across a full-width drag into both edges.
  const move = extractMethodBody('moveOverlayGroupTo');
  assert.match(
    move,
    /this\.clampedGroupOrigin\(origin\.x \+ offsetX, origin\.y \+ offsetY\)/,
    'each frame must target anchor+total-offset, clamped — not a relative step',
  );
  assert.match(
    extractMethodBody('beginOverlayGroupDrag'),
    /this\.groupDragOrigin = \{ x: o\.x, y: o\.y \}/,
    'drag start must capture the anchor',
  );
  assert.match(
    extractMethodBody('endOverlayGroupDrag'),
    /this\.groupDragOrigin = null/,
    'drag end must release the anchor, or the next drag anchors on a stale origin',
  );
  // Anchoring is what makes clamping non-rubber-banding: a clamped frame drops
  // nothing, because the next target is recomputed from the pointer's absolute
  // offset rather than accumulated.
  assert.ok(
    !move.includes('o.x + dx'),
    'no relative-delta arithmetic may remain in the drag path',
  );
});

test('a move arriving without a start still anchors safely', () => {
  assert.match(
    extractMethodBody('moveOverlayGroupTo'),
    /if \(!this\.groupDragOrigin\) this\.beginOverlayGroupDrag\(\)/,
    'a renderer reload mid-drag must not leave the group anchored on null',
  );
});

test('welding is macOS-only and has a kill switch', () => {
  assert.match(
    source,
    /this\.overlayGroupWelded\s*=\s*isMac && process\.env\.NATIVELY_OVERLAY_WINDOW_GROUP !== '0'/,
    'welding must be gated on darwin (win32 setParentWindow is OWNER semantics ' +
      '— owned windows do not move with the owner, so Windows must keep the ' +
      'event-mirroring path) and must stay disableable at runtime',
  );
  assert.match(
    source,
    /this\.pillWindow\.setParentWindow\(this\.overlayWindow\)/,
    'the pill must be parented to the overlay',
  );
  assert.match(
    source,
    /this\.toggleWindow\.setParentWindow\(this\.overlayWindow\)/,
    'the toggle must be parented to the overlay',
  );
});

test('welded mode stands down the manual move mirroring in BOTH directions', () => {
  // overlay 'move' → reposition aux: would be a SECOND, later move (the very
  // lag welding removes) and would fight the window-server drag loop.
  assert.match(
    source,
    /if \(!this\.overlayGroupWelded && !this\.auxSyncing\) this\.positionOverlayAuxWindows\(\)/,
    "the overlay 'move' handler must skip aux repositioning while welded",
  );
  // pill 'move' → move overlay: the child would then follow the parent it just
  // moved = double-move.
  const pillMove = source.slice(source.indexOf("this.pillWindow.on('move'"));
  const guard = pillMove.indexOf('if (this.overlayGroupDragManaged) return;');
  const mirror = pillMove.indexOf('overlay.setPosition(');
  assert.ok(guard !== -1, "the pill 'move' handler must bail out while welded");
  assert.ok(
    guard < mirror,
    'the welded guard must precede the reverse mirroring, or a child move ' +
      'double-moves the pill',
  );
});

test('welded mode does not clamp the pill independently of the shell', () => {
  const body = extractMethodBody('positionOverlayAuxWindows');
  assert.match(
    body,
    /const rigidToShell = this\.overlayGroupWelded \|\| this\.overlayGroupDragging;/,
    'the pill must be rigid to the shell both while welded AND during any ' +
      'managed drag — clamping it on its own displaces it relative to the ' +
      'shell, reintroducing "the group came apart" by another route',
  );
  assert.match(body, /const px = rigidToShell\s*\n?\s*\?\s*idealX/);
  assert.match(body, /const py = rigidToShell \? idealY :/);
  assert.match(source, /private clampOverlayGroupIntoWorkArea\(\): void/);
});

test('drag release settles the group', () => {
  const end = extractMethodBody('endOverlayGroupDrag');
  assert.match(end, /this\.clampOverlayGroupIntoWorkArea\(\)/, 'release must settle the group');
  assert.match(
    end,
    /this\.overlayGroupDragging = false/,
    'release must clear the drag flag so the settle-clamp can run again',
  );
});

test("the settle-clamp cannot fire mid-drag off our own programmatic moves", () => {
  // 'moved' is emitted for programmatic setPosition too, so the drag flag —
  // not just auxSyncing — is what keeps the clamp out of the drag loop.
  assert.match(
    source,
    /this\.overlayWindow\.on\('moved',[\s\S]{0,300}?!this\.overlayGroupDragging/,
    "the 'moved' clamp must be suppressed while a group drag is in flight",
  );
  assert.match(
    extractMethodBody('moveOverlayGroupTo'),
    /this\.overlayGroupDragging = true/,
    'a drag frame must raise the flag',
  );
  assert.match(
    extractMethodBody('beginOverlayGroupDrag'),
    /this\.overlayGroupDragging = true/,
    'drag start must raise the flag before any frame lands',
  );
});

test('welded geometry is re-asserted at settle points, not only before a show', () => {
  // Measured: macOS constrains a window's frame back onto the screen when it
  // is ORDERED IN, for a position set while it was hidden — a VISIBLE window
  // moves freely (so a live drag does not drift; probed at 0px over 200 steps
  // driven past the edge). The overlay is hidden/re-shown constantly and can
  // be parked partly off-screen, so the shell can shift on show while its
  // hidden children do not follow, leaving offsets stale (observed 44px).
  // Re-placing children from the parent's ACTUAL bounds after each settle
  // point converges it.
  const apply = extractMethodBody('applyOverlayAuxVisibility');
  const placements = [...apply.matchAll(/this\.positionOverlayAuxWindows\(\)/g)];
  assert.equal(
    placements.length,
    2,
    'children must be placed BEFORE the show (so their first painted frame is ' +
      'right) and AGAIN after it (so a constrained parent frame self-corrects)',
  );
  const showCall = apply.indexOf('apply(this.pillWindow, want)');
  assert.ok(
    placements[0].index < showCall && placements[1].index > showCall,
    'one placement must straddle each side of the show',
  );
  assert.match(
    extractMethodBody('endOverlayGroupDrag'),
    /this\.positionOverlayAuxWindows\(\)/,
    'drag release is a settle point too — cheap insurance (0.22ms, and child ' +
      'moves provably do not feed back) against any drift the live drag left',
  );
});

test('the group-drag IPC is restricted to the pill window', () => {
  const ipc = readFileSync(
    path.resolve(__dirname, '../../../electron/ipcHandlers.ts'),
    'utf8',
  );
  const handler = ipc.slice(ipc.indexOf("safeHandle(\n    'overlay-group-drag'"));
  assert.ok(handler.length > 0, 'overlay-group-drag handler not found');
  const body = handler.slice(0, handler.indexOf('safeHandle', 10));
  assert.match(
    body,
    /pillWin\.webContents\.id === event\.sender\.id/,
    'the drag channel must be sender-id validated like every other overlay ' +
      'channel — it moves a window, so any renderer could otherwise drive it',
  );
  assert.ok(
    !body.includes('getToggleWindow'),
    'the toggle is not a drag handle and must not be accepted as a sender',
  );
  for (const phase of ['start', 'end']) {
    assert.ok(
      body.includes(`delta?.phase === '${phase}'`),
      `the drag protocol must handle the '${phase}' phase`,
    );
  }
  assert.match(body, /helper\.moveOverlayGroupTo\(/, 'move frames must use the anchored API');
});

test('the pill window turns OFF its OS drag region when welded', () => {
  const css = readFileSync(path.resolve(__dirname, '../../../src/index.css'), 'utf8');
  assert.match(
    css,
    /\[data-overlay-group-drag-managed='true'\][\s\S]{0,140}?-webkit-app-region: no-drag/,
    'the OS drag region must be disabled in the pill window on BOTH platforms ' +
      '— on macOS a natively-dragged child moves alone, on Windows it enters ' +
      'the modal move loop',
  );
  const aux = readFileSync(
    path.resolve(__dirname, '../../../src/components/OverlayAuxWindows.tsx'),
    'utf8',
  );
  assert.match(
    aux,
    /data-overlay-group-drag-managed=\{dragManaged \? 'true' : undefined\}/,
    'the pill root must carry the attribute that CSS keys off',
  );
  assert.match(
    aux,
    /setPointerCapture/,
    'the manual drag needs pointer capture, or it dies when the cursor leaves ' +
      'the ~200px pill window mid-drag',
  );
  assert.match(
    aux,
    /closest\?\.\('button, a, input, select, textarea, \[role="button"\]'\)/,
    "the manual drag must not start on the pill's own buttons",
  );
});

test("the overlay 'show'/'hide' event handlers are retained as a backstop", () => {
  // Explicit call-site driving is the mechanism; the events must still cover
  // OS-driven visibility changes (Mission Control, space switches, third-party
  // hides) that no call site of ours passes through.
  assert.match(
    source,
    /this\.overlayWindow\.on\('show',[\s\S]{0,400}?this\.syncOverlayAuxVisibility\(\)/,
    "the overlay 'show' handler must still sync aux visibility",
  );
  assert.match(
    source,
    /this\.overlayWindow\.on\('hide',[\s\S]{0,400}?this\.syncOverlayAuxVisibility\(\)/,
    "the overlay 'hide' handler must still sync aux visibility",
  );
});
