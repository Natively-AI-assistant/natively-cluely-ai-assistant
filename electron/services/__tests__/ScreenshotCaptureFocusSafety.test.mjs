// electron/services/__tests__/ScreenshotCaptureFocusSafety.test.mjs
//
// FOCUS-SAFETY regression coverage for the Cmd+Shift+H "Selective Screenshot"
// fix. The fix added a `throw` on an invalid/empty crop
// (ScreenshotHelper.ts: "Region capture failed: ..."). That throw propagates
// out through AppState.takeSelectiveScreenshot → withScreenshotCaptureSession.
//
// The risk this file guards: the cropper opens DURING meetings (Zoom / browser
// in the foreground). If a capture error skipped window restoration, or if
// restoration re-activated our overlay, we would STEAL FOCUS from the
// foreground app — defeating the whole stealth model. This must hold on the
// NEW error path exactly as it did on the success path.
//
// The focus-safety guarantee rests on three facts in electron/main.ts, all of
// which this file pins:
//
//   1. restoreWindowsAfterScreenshot(session) runs inside a `finally` block in
//      withScreenshotCaptureSession (~main.ts:5856-5858), so windows are
//      restored whether capture() resolves OR throws. Our new throw cannot
//      leave windows hidden / focus dangling.
//
//   2. On macOS, restoreWithoutFocus is UNCONDITIONALLY true
//      (`process.platform === 'darwin' || !restoreFocus`, ~main.ts:5764), which
//      makes `activate = !session.restoreWithoutFocus` false
//      (~main.ts:5801) — so restoreWindowsAfterScreenshot re-shows every window
//      WITHOUT activating it. Restoration never steals focus on macOS.
//
//   3. The crop error is thrown from inside captureWithDesktopCapturer, which
//      performs NO window / focus / activation operations — so the throw path
//      cannot itself touch focus; it just unwinds into the finally.
//
// Facts #1 and #2 are structural properties of main.ts; fact #3 is a property
// of ScreenshotHelper.ts. We assert #1 and #2 by (a) source-anchoring the
// production code (a tripwire if someone moves restore out of the finally or
// drops the darwin guard) and (b) mirroring the restore-activation decision as
// a pure function and exhaustively checking it. Fact #3 is asserted by the
// runtime test in ScreenshotCaptureRuntime.test.mjs (no window ops) and
// re-anchored here.
//
// Run: `ELECTRON_RUN_AS_NODE=1 electron --test`
//   (also runs under bare `node --test` — no native ABI or Electron surface is
//   touched; this file only reads source text and evaluates a pure function.)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const MAIN_TS = path.join(root, 'electron/main.ts');
const SCREENSHOT_TS = path.join(root, 'electron/ScreenshotHelper.ts');
const IPC_TS = path.join(root, 'electron/ipcHandlers.ts');

const mainSrc = fs.readFileSync(MAIN_TS, 'utf8');
const screenshotSrc = fs.readFileSync(SCREENSHOT_TS, 'utf8');
const ipcSrc = fs.readFileSync(IPC_TS, 'utf8');

// ── Mirrored production logic ──────────────────────────────────────────────
// 1:1 transcription of the two focus decisions in withScreenshotCaptureSession
// / createScreenshotCaptureSession / restoreWindowsAfterScreenshot. Kept as a
// pure function so we can enumerate the truth table without booting Electron.
//
//   createScreenshotCaptureSession (main.ts:5764):
//     restoreWithoutFocus: process.platform === 'darwin' || !restoreFocus
//   restoreWindowsAfterScreenshot (main.ts:5801):
//     const activate = !session.restoreWithoutFocus
//
// "activate" is the ONLY thing that grants focus to a restored window
// (switchToOverlay(!activate) / showWindow({ activate })). activate === false
// ⇒ no focus is taken.
function wouldActivateOnRestore(platform, restoreFocus) {
  const restoreWithoutFocus = platform === 'darwin' || !restoreFocus;
  const activate = !restoreWithoutFocus;
  return activate;
}

describe('Screenshot capture focus safety — restore-activation truth table', () => {
  test('macOS never activates (steals focus) on restore, regardless of restoreFocus', () => {
    // Both the global-shortcut caller (restoreFocus defaults true) and any
    // explicit restoreFocus=false path must NOT activate on darwin.
    assert.equal(wouldActivateOnRestore('darwin', true), false,
      'macOS + restoreFocus=true must NOT steal focus (stealth during meetings)');
    assert.equal(wouldActivateOnRestore('darwin', false), false,
      'macOS + restoreFocus=false must NOT steal focus');
  });

  test('Windows activates only when focus restoration was explicitly requested', () => {
    // On Windows the overlay is a normal top-level window; restoring focus is
    // the intended UX when restoreFocus=true, and suppressed when false.
    assert.equal(wouldActivateOnRestore('win32', true), true,
      'Windows + restoreFocus=true restores focus to the overlay (expected)');
    assert.equal(wouldActivateOnRestore('win32', false), false,
      'Windows + restoreFocus=false must NOT activate');
  });
});

describe('Screenshot capture focus safety — production source anchors', () => {
  // FACT #2: the darwin guard that forces restoreWithoutFocus. If this is ever
  // relaxed, macOS restoration could start stealing focus.
  test('createScreenshotCaptureSession keeps the unconditional darwin restoreWithoutFocus guard', () => {
    assert.ok(
      /restoreWithoutFocus:\s*process\.platform === 'darwin' \|\| !restoreFocus/.test(mainSrc),
      'main.ts must set restoreWithoutFocus = (darwin || !restoreFocus) — the macOS no-focus-steal guarantee',
    );
    assert.ok(
      /const activate = !session\.restoreWithoutFocus/.test(mainSrc),
      'restoreWindowsAfterScreenshot must derive activate from restoreWithoutFocus',
    );
  });

  // FACT #1: restore must be in the `finally`, so the NEW throw path still
  // restores windows. This regex asserts the ordering: within
  // withScreenshotCaptureSession, `return await capture(session)` is followed
  // by a `finally {` that calls restoreWindowsAfterScreenshot BEFORE the next
  // method begins.
  test('withScreenshotCaptureSession restores windows in a finally (runs on the throw path too)', () => {
    const start = mainSrc.indexOf('private async withScreenshotCaptureSession');
    assert.ok(start !== -1, 'withScreenshotCaptureSession must exist');
    // Bound the search to the method body (up to the next `private ` member or
    // a generous window) so we do not match unrelated finallys elsewhere.
    const body = mainSrc.slice(start, start + 1600);

    const captureIdx = body.indexOf('return await capture(session)');
    const finallyIdx = body.indexOf('} finally {');
    const restoreIdx = body.indexOf('this.restoreWindowsAfterScreenshot(session)');

    assert.ok(captureIdx !== -1, 'must await capture(session)');
    assert.ok(finallyIdx !== -1, 'must have a finally block');
    assert.ok(restoreIdx !== -1, 'must call restoreWindowsAfterScreenshot');
    assert.ok(
      captureIdx < finallyIdx && finallyIdx < restoreIdx,
      'restoreWindowsAfterScreenshot must run inside the finally AFTER capture() — ' +
      'so a capture throw (e.g. "Region capture failed") still restores windows',
    );
  });

  // FACT #3: the crop error we added is thrown from a code path that performs
  // NO window/focus operations, so it cannot itself steal or drop focus — it
  // simply unwinds into the session finally above.
  test('the crop-failure throw lives in captureWithDesktopCapturer and touches no window/focus APIs', () => {
    const throwIdx = screenshotSrc.indexOf('Region capture failed');
    assert.ok(throwIdx !== -1, 'the fail-loud crop throw must exist');

    const fnIdx = screenshotSrc.lastIndexOf('private async captureWithDesktopCapturer', throwIdx);
    assert.ok(fnIdx !== -1 && fnIdx < throwIdx,
      'the throw must be inside captureWithDesktopCapturer');

    // The method must not perform focus/activation/window-visibility ops. If a
    // future edit introduces one, this trips so focus behaviour is re-reviewed.
    const fnBody = screenshotSrc.slice(fnIdx, throwIdx + 400);
    const forbidden = /\.focus\(|\.activate\(|setAlwaysOnTop|moveTop|\bshow\(\)|\bhide\(\)|switchToOverlay|switchToLauncher|BrowserWindow/;
    assert.ok(
      !forbidden.test(fnBody),
      'captureWithDesktopCapturer must not perform window/focus operations — ' +
      'the crop throw must unwind cleanly into withScreenshotCaptureSession\'s finally',
    );
  });

  // Cancel-vs-failure distinction: the IPC layer only treats the exact string
  // "Selection cancelled" as a user cancel (ipcHandlers.ts / main.ts). Our new
  // failure wording must stay distinct, so a real error is surfaced (and the
  // renderer's catch logs it) rather than silently swallowed as a cancel.
  test('the crop-failure message is distinct from the "Selection cancelled" sentinel', () => {
    const throwLineIdx = screenshotSrc.indexOf('Region capture failed');
    assert.ok(throwLineIdx !== -1);
    const around = screenshotSrc.slice(throwLineIdx - 40, throwLineIdx + 120);
    assert.ok(
      !/Selection cancelled/.test(around),
      'the crop-failure throw must NOT reuse the "Selection cancelled" wording',
    );
    // And the IPC cancel-mapping still keys on the exact sentinel: the
    // take-selective-screenshot handler in ipcHandlers.ts maps only the exact
    // string "Selection cancelled" to { cancelled: true }; anything else
    // (including our "Region capture failed") is surfaced as a real error.
    assert.ok(
      /=== 'Selection cancelled'/.test(ipcSrc),
      'ipcHandlers.ts must still map only the exact "Selection cancelled" sentinel to a cancel',
    );
  });
});
