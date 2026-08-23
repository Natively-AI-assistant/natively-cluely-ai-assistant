// Regression test for "the app goes into the background after Stop meeting
// (undetectable mode OFF) — I have to bring it back with Cmd+B".
//
// Symptom: pressing Stop ends the meeting, but the launcher window ends up
// BEHIND the user's meeting app; only Cmd+B (showInactive path) recovers it.
//
// Root cause: during a meeting Natively is NOT the active macOS app — the
// overlay is a non-activating NSPanel (type:'panel' + becomesKeyOnlyIfNeeded)
// precisely so the user's meeting app stays foreground. The Stop flow's
// overlay→launcher swap (switchToLauncher) relied on launcherWindow.show() +
// .focus() alone to foreground the app: Focus() uses
// activateIgnoringOtherApps:NO (never activates while another app is active),
// and on macOS 14+ cooperative activation the system may deny Show()'s
// self-activation from a background app. Hiding the always-on-top overlay then
// removed the only visible Natively surface, leaving the regular-level
// launcher behind the active app.
//
// Fix: switchToLauncher() explicitly activates the app via
// app.focus({steal:true}) after the overlay hides, gated so no other window
// invariant changes:
//   - darwin only (the bug is a macOS activation-policy issue)
//   - !inactive     — ghost/showInactive shows must NEVER steal focus
//                     (screenshot restores, toggle shows)
//   - !wasLauncher  — only true overlay→launcher swaps (user-initiated Stop /
//                     overlay close); cold-start ready-to-show has
//                     currentWindowMode already 'launcher' and is excluded
//   - !getUndetectable() — app activation re-reveals the dock tile and would
//                     fight _enforceDockState; stealth keeps its own path
//                     (reassertUndetectableStealth)
//
// These source-contract assertions pin the call and every load-bearing gate so
// a refactor that drops one fails CI loudly. They fail against pre-fix source.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const whPath = path.resolve(__dirname, '../../../electron/WindowHelper.ts');
const whSource = readFileSync(whPath, 'utf8');

function extractMethodBody(source, methodName) {
  const re = new RegExp(`(?:public|private|protected)\\s+(?:async\\s+)?${methodName}\\s*\\([^)]*\\)\\s*(?::[^{]*)?\\{`);
  const m = re.exec(source);
  assert.ok(m, `could not locate ${methodName}`);
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

test('switchToLauncher explicitly activates the app on overlay→launcher swaps', () => {
  const body = extractMethodBody(whSource, 'switchToLauncher');
  assert.match(
    body,
    /app\.focus\(\s*\{\s*steal:\s*true\s*\}\s*\)/,
    'switchToLauncher must call app.focus({steal:true}) — show()/focus() alone cannot foreground a background app whose only surface was a non-activating panel'
  );
});

test('the activation is gated on darwin, !inactive, !wasLauncher, and !undetectable', () => {
  const body = extractMethodBody(whSource, 'switchToLauncher');
  const callIdx = body.search(/app\.focus\(\s*\{\s*steal:\s*true\s*\}\s*\)/);
  assert.ok(callIdx >= 0, 'app.focus({steal:true}) present');

  // The guard is the if-condition immediately preceding the call.
  const before = body.slice(0, callIdx);
  const guardStart = before.lastIndexOf('if (');
  assert.ok(guardStart >= 0, 'app.focus({steal:true}) must be inside an if-guard');
  const guard = before.slice(guardStart);

  assert.match(guard, /process\.platform === 'darwin'/, 'gate: darwin only');
  assert.match(guard, /!inactive/, 'gate: never on inactive/ghost shows (screenshot restores, toggle shows must not steal focus)');
  assert.match(guard, /!wasLauncher/, 'gate: only true overlay→launcher swaps (excludes cold-start, where mode is already launcher)');
  assert.match(guard, /!this\.appState\.getUndetectable\(\)/, 'gate: never in undetectable mode (activation re-reveals the dock tile)');
});

test('activation happens AFTER the overlay hide (panel-hide focus-return must not undo it)', () => {
  const body = extractMethodBody(whSource, 'switchToLauncher');
  const hideIdx = body.search(/overlayWindow\.hide\(\)/);
  const focusIdx = body.search(/app\.focus\(\s*\{\s*steal:\s*true\s*\}\s*\)/);
  assert.ok(hideIdx >= 0, 'overlayWindow.hide() present');
  assert.ok(focusIdx >= 0, 'app.focus({steal:true}) present');
  assert.ok(
    focusIdx > hideIdx,
    'app.focus({steal:true}) must run after overlayWindow.hide() — if Electron applies panel-hide focus-return semantics, activating first would be undone by the hide'
  );
});

test('the overlay stays a non-activating panel (the design constraint that makes explicit activation necessary)', () => {
  assert.match(
    whSource,
    /type:\s*'panel'/,
    "overlay must keep type:'panel' — if this changes, the activation model changed and this test's premise needs re-review"
  );
});
