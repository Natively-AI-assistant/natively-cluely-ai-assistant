import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '../../..', rel), 'utf8');

// Regression pins for the Windows launcher <-> meeting-overlay swap feeling
// like two windows blinking rather than one continuous motion.
//
// The structural defect was a HOLE, not a curve problem. switchToOverlay used
// to run `launcherWindow.hide()` synchronously at the end of the function
// while the overlay sat at setOpacity(0) behind its content-protection shield
// for another 60ms — roughly four frames with NEITHER surface painted. The fix
// is a handoff: the launcher's renderer recedes, its window stays alive
// underneath the always-on-top overlay, and it is only hidden once that recede
// has run out.
//
// Three contracts hold the result together, and all three are cheap to break
// by accident:
//
//   1. The launcher hide must stay DEFERRED behind the shield on win32.
//   2. LAUNCHER_RECEDE_MS must stay strictly greater than
//      LAUNCHER_RECEDE_LEAD_MS + OVERLAY_SHIELD_MS, or the launcher finishes
//      fading before the overlay has painted anything and the swap is
//      sequential again — the blank gap in a new costume.
//   3. The overlay shell, pill and toggle must stay on ONE timeline.
//
// Plus the cross-file duration mirrors: the timings live in three places
// (WindowHelper.ts owns them, src/index.css animates them, and
// src/lib/windowTransitions.ts schedules cleanup off them) and silently drift.
//
// main.ts / WindowHelper.ts import electron at module scope and cannot load
// under `node --test`; these assert the contracts in source, matching the
// MeetingOverlayStaleFrame / StealthShortcutGuard approach.

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const helperSource = () => stripComments(read('electron/WindowHelper.ts'));

const sliceSwitchToOverlay = (helper) => {
  const start = helper.indexOf('public switchToOverlay(');
  assert.ok(start > -1, 'switchToOverlay() not found in electron/WindowHelper.ts');
  const end = helper.indexOf('public switchToLauncher(', start);
  assert.ok(end > start, 'end of switchToOverlay() not found');
  return helper.slice(start, end);
};

const sliceSwitchToLauncher = (helper) => {
  const start = helper.indexOf('public switchToLauncher(');
  assert.ok(start > -1, 'switchToLauncher() not found in electron/WindowHelper.ts');
  const end = helper.indexOf('public setWindowMode(', start);
  assert.ok(end > start, 'end of switchToLauncher() not found');
  return helper.slice(start, end);
};

const numericConstant = (helper, name) => {
  const m = new RegExp(`static readonly ${name}\\s*=\\s*(\\d+)`).exec(helper);
  assert.ok(m, `WindowHelper.${name} not found — the swap choreography depends on it.`);
  return Number(m[1]);
};

// ─── #1: the launcher hide is deferred behind the shield on Windows ──────────
test('switchToOverlay does not hide the launcher synchronously on Windows', () => {
  const body = sliceSwitchToOverlay(helperSource());

  // The trailing "Hide Launcher SECOND" block runs BEFORE the shield's 60ms
  // timer fires, so reaching it on the normal win32 path IS the blank gap.
  const tailAt = body.lastIndexOf('this.launcherWindow.hide()');
  assert.ok(tailAt > -1, 'switchToOverlay must still hide the launcher on the paths that do not defer.');
  const guardWindow = body.slice(Math.max(0, tailAt - 400), tailAt);
  assert.match(
    guardWindow,
    /!launcherHideDeferred/,
    "the synchronous launcher hide must yield to the deferred one — on win32 it runs ~60ms before the overlay is un-shielded, leaving neither window painted.",
  );

  // ...and the flag has to be a real handoff, not a platform check in
  // disguise: with no overlay window there is no shield timer to hand off to,
  // and the launcher must still be hidden by the fallback above.
  const armAt = body.indexOf('launcherHideDeferred = true');
  const timerAt = body.indexOf('this.opacityTimeout = setTimeout(');
  assert.ok(
    armAt > -1 && timerAt > -1 && armAt < timerAt,
    'launcherHideDeferred must be set exactly where the shield timer is armed, so any path that arms no timer still falls through to the synchronous hide.',
  );
});

test('the Windows launcher hide runs from inside the shield callback, after the un-shield', () => {
  const body = sliceSwitchToOverlay(helperSource());
  const timerAt = body.indexOf('this.opacityTimeout = setTimeout(');
  assert.ok(timerAt > -1, 'the deferred un-shield timer must still exist.');
  const callback = body.slice(timerAt, body.indexOf('}, 60);', timerAt));

  const restoreAt = callback.indexOf('setOpacity(1)');
  const handoffAt = callback.indexOf('this.hideLauncherAfterOverlayHandoff()');
  assert.ok(
    handoffAt > -1,
    'the shield callback must hand the screen off to the overlay before the launcher goes away.',
  );
  assert.ok(
    restoreAt > -1 && restoreAt < handoffAt,
    'the overlay must be made opaque BEFORE the launcher is released — that ordering is the entire fix.',
  );

  const guardAt = callback.indexOf("this.currentWindowMode !== 'overlay'");
  assert.ok(
    guardAt > -1 && guardAt < handoffAt,
    'the mode guard must run before the handoff — once switchToLauncher owns the launcher, hiding it here fights it.',
  );
});

test('every route that takes ownership of the launcher cancels the deferred hide', () => {
  const helper = helperSource();

  for (const fn of ['public switchToLauncher(', 'public hideMainWindow(']) {
    const start = helper.indexOf(fn);
    assert.ok(start > -1, `${fn} not found.`);
    const body = helper.slice(start, start + 4000);
    assert.match(
      body,
      /this\.clearLauncherHideTimeout\(\)/,
      `${fn} must cancel the deferred launcher hide. Deferring it is only safe because the two functions that take over the launcher — one shows it, one hides it — both clear the timer; drop either and a queued hide fires on a launcher the user is looking at.`,
    );
  }
});

// ─── #2: the overlap invariant ───────────────────────────────────────────────
test('the launcher recede outlasts the lead plus the shield', () => {
  const helper = helperSource();
  const recede = numericConstant(helper, 'LAUNCHER_RECEDE_MS');
  const lead = numericConstant(helper, 'LAUNCHER_RECEDE_LEAD_MS');
  const shield = numericConstant(helper, 'OVERLAY_SHIELD_MS');

  assert.ok(
    recede > lead + shield,
    `LAUNCHER_RECEDE_MS (${recede}) must be strictly greater than LAUNCHER_RECEDE_LEAD_MS + OVERLAY_SHIELD_MS (${lead} + ${shield} = ${lead + shield}). At or below it, the launcher is fully faded before the overlay's first opaque frame and the swap is two sequential animations again — the blank gap with easing painted over it. The margin is the overlap that makes the two windows read as one motion.`,
  );
});

test('OVERLAY_SHIELD_MS still describes the real shield timer', () => {
  const body = sliceSwitchToOverlay(helperSource());
  const shield = numericConstant(helperSource(), 'OVERLAY_SHIELD_MS');
  assert.ok(
    body.includes(`}, ${shield});`),
    `OVERLAY_SHIELD_MS (${shield}) must match the literal delay on switchToOverlay's un-shield timer — it is only a mirror, and the overlap invariant above is computed from it.`,
  );
});

// ─── #3: the overlay group is one object ─────────────────────────────────────
test('shell, pill and toggle share one entrance timeline', () => {
  const helper = helperSource();
  const start = helper.indexOf('private sendOverlayTransition(');
  assert.ok(start > -1, 'sendOverlayTransition() not found.');
  const body = helper.slice(start, helper.indexOf('public beginLauncherRecede(', start));

  assert.match(
    body,
    /this\.overlayWindow,\s*this\.pillWindow,\s*this\.toggleWindow/,
    'all three overlay windows must receive the same cue — they are separate HWNDs but one object on screen.',
  );

  const css = read('src/index.css');
  const enterBlock = css.slice(css.indexOf('[data-overlay-enter="entering"]'));
  const declarations = enterBlock.slice(0, enterBlock.indexOf('}'));
  assert.doesNotMatch(
    declarations,
    /transition-delay|animation-delay/,
    'no stagger on the overlay entrance. The pill is welded chrome, not a discrete control, and applyOverlayAuxVisibility/switchToOverlay deliberately land it on the same compositor commit as the shell; a delay here undoes that.',
  );
});

test('the pill scales from the seam it shares with the shell, not its own top', () => {
  const css = read('src/index.css');
  const pillAt = css.indexOf('[data-window="overlay-pill"][data-overlay-enter] body');
  assert.ok(pillAt > -1, 'the pill window needs its own transform-origin for the swap entrance.');
  const rule = css.slice(pillAt, css.indexOf('}', pillAt));
  assert.match(
    rule,
    /transform-origin:\s*bottom center/,
    'the pill sits directly above the shell, so it must grow from its BOTTOM edge while the shell grows from its top — otherwise a gap opens between them at scale 0.96 and the group stops reading as one rigid object.',
  );
});

// ─── #4: cross-file duration mirrors ─────────────────────────────────────────
test('the recede duration is identical in WindowHelper, the CSS and the renderer module', () => {
  const recede = numericConstant(helperSource(), 'LAUNCHER_RECEDE_MS');

  const css = read('src/index.css');
  const recedeAt = css.indexOf('[data-launcher-transition="receding"] body');
  assert.ok(recedeAt > -1, 'the launcher recede rule is missing from src/index.css.');
  const rule = css.slice(recedeAt, css.indexOf('}', recedeAt));
  assert.ok(
    rule.includes(`opacity ${recede}ms`) && rule.includes(`transform ${recede}ms`),
    `src/index.css must animate the recede over exactly LAUNCHER_RECEDE_MS (${recede}ms). WindowHelper arms the deferred launcher hide off this number; if the CSS is slower the window vanishes mid-fade.`,
  );

  const mod = read('src/lib/windowTransitions.ts');
  assert.ok(
    new RegExp(`LAUNCHER_RECEDE_MS = ${recede}\\b`).test(mod),
    `src/lib/windowTransitions.ts mirrors LAUNCHER_RECEDE_MS (${recede}) for its self-heal timer.`,
  );
});

test('the overlay entrance duration matches the renderer cleanup timer', () => {
  const css = read('src/index.css');
  const enterAt = css.indexOf('[data-overlay-enter="entering"] body');
  assert.ok(enterAt > -1, 'the overlay entrance rule is missing from src/index.css.');
  const rule = css.slice(enterAt, css.indexOf('}', enterAt));
  const m = /transform (\d+)ms/.exec(rule);
  assert.ok(m, 'the overlay entrance must animate transform for a known duration.');

  const mod = read('src/lib/windowTransitions.ts');
  assert.ok(
    new RegExp(`OVERLAY_ENTER_MS = ${m[1]}\\b`).test(mod),
    `src/lib/windowTransitions.ts must mirror the CSS entrance duration (${m[1]}ms) — it tears the attribute down on that timer, and tearing it down early snaps a half-finished entrance to rest.`,
  );

  const opacity = /opacity (\d+)ms/.exec(rule);
  assert.ok(opacity, 'the overlay entrance must animate opacity for a known duration.');
  assert.ok(
    Number(opacity[1]) < Number(m[1]),
    'opacity must finish before the transform. The surface being fully present while its shape is still settling is what makes the entrance read as an object arriving rather than a layer fading up.',
  );
});

// ─── #5: macOS is deliberately untouched ─────────────────────────────────────
test('the swap choreography never fires off Windows', () => {
  const helper = helperSource();

  for (const fn of ['private sendOverlayTransition(', 'public beginLauncherRecede(', 'private restoreLauncherFromRecede(']) {
    const start = helper.indexOf(fn);
    assert.ok(start > -1, `${fn} not found.`);
    const body = helper.slice(start, start + 900);
    assert.match(
      body,
      /process\.platform !== 'win32'/,
      `${fn} must return early off win32. macOS has no opacity shield to arm an invisible pre-entrance state behind, and it re-presents a hidden window's last composited frame on show() — so an entrance there risks a rest-frame flash nobody can verify from Windows. Its path stays byte-identical to before this change.`,
    );
  }

  const css = read('src/index.css');
  for (const attr of ['[data-overlay-enter="armed"]', '[data-launcher-transition="receding"]']) {
    const at = css.indexOf(attr);
    assert.ok(at > -1, `${attr} rule missing from src/index.css.`);
    const selectorStart = css.lastIndexOf('\n', css.lastIndexOf('html', at)) + 1;
    assert.match(
      css.slice(selectorStart, at + attr.length),
      /html\[data-platform="win32"\]/,
      `${attr} must stay gated on html[data-platform="win32"] — the CSS gate and the main-process gate have to agree, or macOS gets a half-installed animation.`,
    );
  }
});

test('startMeetingTransition waits for the recede before swapping, and only after the permission probes', () => {
  const main = stripComments(read('electron/main.ts'));
  const start = main.indexOf('private async startMeetingTransition(');
  assert.ok(start > -1, 'startMeetingTransition() not found.');
  const body = main.slice(start, main.indexOf('public endMeeting(', start));

  const recedeAt = body.indexOf('beginLauncherRecede()');
  const swapAt = body.indexOf("setWindowMode('overlay')");
  const micAt = body.indexOf('ensureMacMicrophoneAccess');

  assert.ok(recedeAt > -1, 'meeting start must ask the launcher to recede — without it the launcher is cut at full opacity.');
  assert.ok(
    body.slice(0, swapAt).includes('await this.windowHelper.beginLauncherRecede()'),
    'the recede must be AWAITED before the swap, or the overlay lands on a launcher that has not started moving.',
  );
  assert.ok(
    micAt > -1 && micAt < recedeAt,
    'the recede must come AFTER the permission probes. Those can throw and abort the start, and a launcher that had already receded would be left faded out on the screen the user is stuck on.',
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// THE RETURN DIRECTION (Stop meeting)
// ═════════════════════════════════════════════════════════════════════════════
//
// Everything above pins launcher → overlay. Stop is the same swap backwards and
// it shipped without any of the same treatment: switchToLauncher showed the
// launcher at opacity 0 and hid the overlay SYNCHRONOUSLY on the next line, so
// the shield that protects the arriving window opened over an empty screen
// instead of under a departing one. The identical hole, in the identical place,
// pointing the other way — and it is the more visible direction, because the
// DEPARTING overlay is the alwaysOnTop window, so its exit plays on top of the
// launcher rather than being hidden behind it.
//
// These mirror #1 through #5 above one-for-one. A change that fixes one
// direction and not the other is the failure mode they exist to catch.

// ─── #1 mirrored: the overlay hide is deferred behind the launcher shield ────
test('switchToLauncher does not hide the overlay synchronously on Windows', () => {
  const body = sliceSwitchToLauncher(helperSource());

  const tailAt = body.lastIndexOf('this.overlayWindow.hide()');
  assert.ok(tailAt > -1, 'switchToLauncher must still hide the overlay on the paths that do not defer.');
  const guardWindow = body.slice(Math.max(0, tailAt - 400), tailAt);
  assert.match(
    guardWindow,
    /!overlayHideDeferred/,
    'the synchronous overlay hide must yield to the deferred one — on win32 it runs ~60ms before the launcher is un-shielded, leaving neither window painted.',
  );

  const armAt = body.indexOf('overlayHideDeferred = true');
  const timerAt = body.indexOf('this.opacityTimeout = setTimeout(');
  assert.ok(
    armAt > -1 && timerAt > -1 && armAt < timerAt,
    'overlayHideDeferred must be set exactly where the shield timer is armed, so any path that arms no timer still falls through to the synchronous hide.',
  );
});

test('the Windows overlay hide runs from inside the launcher shield callback, after the un-shield', () => {
  const body = sliceSwitchToLauncher(helperSource());
  const timerAt = body.indexOf('this.opacityTimeout = setTimeout(');
  assert.ok(timerAt > -1, 'the launcher un-shield timer must still exist.');
  const callback = body.slice(timerAt, body.indexOf('}, WindowHelper.LAUNCHER_SHIELD_MS);', timerAt));

  const restoreAt = callback.indexOf('setOpacity(1)');
  const handoffAt = callback.indexOf('this.hideOverlayAfterLauncherHandoff()');
  assert.ok(
    handoffAt > -1,
    'the shield callback must hand the screen off to the launcher before the overlay goes away.',
  );
  assert.ok(
    restoreAt > -1 && restoreAt < handoffAt,
    'the launcher must be made opaque BEFORE the overlay is released — that ordering is the entire fix.',
  );

  const guardAt = callback.indexOf("this.currentWindowMode !== 'launcher'");
  assert.ok(
    guardAt > -1 && guardAt < handoffAt,
    'the mode guard must run before the handoff — once switchToOverlay owns the overlay, hiding it here fights it.',
  );
});

test('every route that takes ownership of the overlay cancels the deferred hide', () => {
  const helper = helperSource();

  for (const fn of ['public switchToOverlay(', 'public hideMainWindow(']) {
    const start = helper.indexOf(fn);
    assert.ok(start > -1, `${fn} not found.`);
    const body = helper.slice(start, start + 4000);
    assert.match(
      body,
      /this\.clearOverlayHideTimeout\(\)/,
      `${fn} must cancel the deferred overlay hide. Deferring it is only safe because the two functions that take over the overlay — one shows it, one hides it — both clear the timer; drop either and a Stop→Start inside 260ms hides the NEW meeting overlay.`,
    );
  }
});

test('the deferred overlay hide does not share the launcher hide timer', () => {
  const helper = helperSource();
  assert.match(
    helper,
    /private overlayHideTimeout: NodeJS\.Timeout \| null/,
    'the overlay hide needs its OWN handle. opacityTimeout is already shared between the two switch functions; hanging a third consumer off it means one clearTimeout can cancel the launcher un-shield and the overlay hide together.',
  );
  const handoff = helper.slice(helper.indexOf('private hideOverlayAfterLauncherHandoff('));
  const body = handoff.slice(0, handoff.indexOf('private clearOverlayHideTimeout('));
  assert.doesNotMatch(
    body,
    /this\.opacityTimeout/,
    'the overlay handoff must never touch opacityTimeout — that is the shield timer for whichever window is arriving.',
  );
});

test('the forced click-through on the departing group is always undone', () => {
  const helper = helperSource();

  // beginOverlayExit makes the whole group click-through, because for 260ms it
  // is invisible but still up and still alwaysOnTop — a click landing on a
  // window nobody can see is worse than the hard cut this replaced.
  const exit = helper.slice(helper.indexOf('public beginOverlayExit('));
  assert.match(
    exit.slice(0, exit.indexOf('private hideOverlayAfterLauncherHandoff(')),
    /setIgnoreMouseEvents\(true, \{ forward: true \}\)/,
    'the departing group must be made click-through for the length of its exit.',
  );

  // TWO routes must undo it, and only one of them is the happy path. The
  // handoff restores it after the hide; switchToOverlay restores it because a
  // Stop→Start inside the exit window CANCELS that handoff, and without this
  // the user gets a whole meeting of overlay that passes every click through.
  const handoff = helper.slice(helper.indexOf('private hideOverlayAfterLauncherHandoff('));
  assert.match(
    handoff.slice(0, handoff.indexOf('private clearOverlayHideTimeout(')),
    /this\.syncOverlayInteractionPolicy\(/,
    'the deferred hide must put the interaction policy back on its derived footing.',
  );

  const swap = helper.slice(helper.indexOf('public switchToOverlay('));
  const swapBody = swap.slice(0, swap.indexOf('public switchToLauncher('));
  const clearAt = swapBody.indexOf('this.clearOverlayHideTimeout()');
  const syncAt = swapBody.indexOf('this.syncOverlayInteractionPolicy(');
  assert.ok(
    clearAt > -1 && syncAt > clearAt,
    'switchToOverlay cancels the deferred hide, so it must re-derive the interaction policy itself — otherwise cancelling the hide also cancels the only restore, and the new meeting overlay is click-through for its whole life.',
  );
});

// ─── #2 mirrored: the overlap invariant ──────────────────────────────────────
test('the overlay exit outlasts the lead plus the launcher shield', () => {
  const helper = helperSource();
  const exit = numericConstant(helper, 'OVERLAY_EXIT_MS');
  const lead = numericConstant(helper, 'OVERLAY_EXIT_LEAD_MS');
  const shield = numericConstant(helper, 'LAUNCHER_SHIELD_MS');

  assert.ok(
    exit > lead + shield,
    `OVERLAY_EXIT_MS (${exit}) must be strictly greater than OVERLAY_EXIT_LEAD_MS + LAUNCHER_SHIELD_MS (${lead} + ${shield} = ${lead + shield}). At or below it the overlay is fully faded before the launcher first opaque frame and Stop is two sequential animations again — the blank gap with easing painted over it.`,
  );
});

test('LAUNCHER_SHIELD_MS still describes the real shield timer', () => {
  const body = sliceSwitchToLauncher(helperSource());
  assert.ok(
    body.includes('}, WindowHelper.LAUNCHER_SHIELD_MS);'),
    'the switchToLauncher un-shield timer must be armed from LAUNCHER_SHIELD_MS — the overlap invariant above is computed from it, and a hardcoded literal drifts silently.',
  );
});

test('the launcher shield is not gated on content protection', () => {
  const body = sliceSwitchToLauncher(helperSource());
  assert.doesNotMatch(
    body,
    /if \(process\.platform === 'win32' && this\.contentProtection\)/,
    "the launcher shield must not be gated on contentProtection. Two things ride on it: with CP off, show() presents the launcher's stale composited frame from when the meeting STARTED (the old 'Meeting ongoing' CTA), and the entire Stop choreography becomes dead code for those users.",
  );
});

// ─── #3 mirrored: the departing group is still one object ────────────────────
test('shell, pill and toggle share one exit timeline', () => {
  const css = read('src/index.css');
  const at = css.indexOf('[data-overlay-enter="leaving"] body');
  assert.ok(at > -1, 'the overlay exit rule is missing from src/index.css.');
  const blockStart = css.lastIndexOf('html[data-platform="win32"]', at);
  const selectors = css.slice(blockStart, css.indexOf('{', at));
  for (const w of ['overlay', 'overlay-pill', 'overlay-toggle']) {
    assert.ok(
      selectors.includes(`[data-window="${w}"]`),
      `the ${w} window must be on the exit timeline — the group has to leave as one piece, exactly as it arrives as one.`,
    );
  }
  const declarations = css.slice(css.indexOf('{', at), css.indexOf('}', at));
  assert.doesNotMatch(
    declarations,
    /transition-delay|animation-delay/,
    'no stagger on the overlay exit, for the same reason there is none on the entrance.',
  );
});

// ─── #4 mirrored: cross-file duration mirrors ────────────────────────────────
test('the overlay exit duration is identical in WindowHelper, the CSS and the renderer module', () => {
  const exit = numericConstant(helperSource(), 'OVERLAY_EXIT_MS');

  const css = read('src/index.css');
  const at = css.indexOf('[data-overlay-enter="leaving"] body');
  assert.ok(at > -1, 'the overlay exit rule is missing from src/index.css.');
  const rule = css.slice(at, css.indexOf('}', at));
  assert.ok(
    rule.includes(`opacity ${exit}ms`) && rule.includes(`transform ${exit}ms`),
    `src/index.css must animate the exit over exactly OVERLAY_EXIT_MS (${exit}ms). WindowHelper arms the deferred overlay hide off this number; if the CSS is slower the windows vanish mid-fade.`,
  );

  const mod = read('src/lib/windowTransitions.ts');
  assert.ok(
    new RegExp(`OVERLAY_EXIT_MS = ${exit}\\b`).test(mod),
    `src/lib/windowTransitions.ts mirrors OVERLAY_EXIT_MS (${exit}) for its self-heal timer.`,
  );
});

test('the launcher entrance duration matches the renderer cleanup timer', () => {
  const css = read('src/index.css');
  const at = css.indexOf('[data-launcher-transition="entering"] body');
  assert.ok(at > -1, 'the launcher entrance rule is missing from src/index.css.');
  const rule = css.slice(at, css.indexOf('}', at));
  const m = /transform (\d+)ms/.exec(rule);
  assert.ok(m, 'the launcher entrance must animate transform for a known duration.');

  assert.equal(
    numericConstant(helperSource(), 'LAUNCHER_ENTER_MS'),
    Number(m[1]),
    'WindowHelper.LAUNCHER_ENTER_MS must match the CSS entrance duration.',
  );

  const mod = read('src/lib/windowTransitions.ts');
  assert.ok(
    new RegExp(`LAUNCHER_ENTER_MS = ${m[1]}\\b`).test(mod),
    `src/lib/windowTransitions.ts must mirror the CSS entrance duration (${m[1]}ms) — it tears the attribute down on that timer, and tearing it down early snaps a half-finished entrance to rest.`,
  );

  const opacity = /opacity (\d+)ms/.exec(rule);
  assert.ok(opacity, 'the launcher entrance must animate opacity for a known duration.');
  assert.ok(
    Number(opacity[1]) < Number(m[1]),
    'opacity must finish before the transform, same as the overlay entrance — the surface being fully present while its shape is still settling is what makes an entrance read as an object arriving.',
  );
});

// ─── #5 mirrored: macOS is deliberately untouched ────────────────────────────
test('the return-direction choreography never fires off Windows', () => {
  const helper = helperSource();

  for (const fn of ['public beginOverlayExit(', 'private sendLauncherTransition(']) {
    const start = helper.indexOf(fn);
    assert.ok(start > -1, `${fn} not found.`);
    const body = helper.slice(start, start + 900);
    assert.match(
      body,
      /process\.platform !== 'win32'/,
      `${fn} must return early off win32 — same reason as the outbound direction: macOS has no opacity shield to hide a pre-entrance state behind and re-presents a hidden window last composited frame on show().`,
    );
  }

  const css = read('src/index.css');
  for (const attr of ['[data-overlay-enter="leaving"]', '[data-launcher-transition="arriving"]']) {
    const at = css.indexOf(attr);
    assert.ok(at > -1, `${attr} rule missing from src/index.css.`);
    const selectorStart = css.lastIndexOf('\n', css.lastIndexOf('html', at)) + 1;
    assert.match(
      css.slice(selectorStart, at + attr.length),
      /html\[data-platform="win32"\]/,
      `${attr} must stay gated on html[data-platform="win32"] — the CSS gate and the main-process gate have to agree.`,
    );
  }
});

test('endMeetingTransition waits for the overlay exit before swapping', () => {
  const main = stripComments(read('electron/main.ts'));
  const start = main.indexOf('private async endMeetingTransition(');
  assert.ok(start > -1, 'endMeetingTransition() not found.');
  const body = main.slice(start, main.indexOf('private async processCompletedMeetingForRAG(', start));

  const swapAt = body.indexOf("setWindowMode('launcher')");
  assert.ok(swapAt > -1, 'endMeetingTransition must still swap to the launcher.');
  assert.ok(
    body.slice(0, swapAt).includes('await this.windowHelper.beginOverlayExit()'),
    'the exit must be AWAITED before the swap — the mirror of startMeetingTransition awaiting beginLauncherRecede(). Without the lead the launcher shield opens over an empty screen instead of under a departing overlay.',
  );
});
