// Regression test for the "stale/choppy overlay UI on meeting restart" bug —
// the remaining half after the renderer-side width-collapse fix.
//
// Symptom: starting a new meeting soon after a prior one briefly showed the
// PREVIOUS meeting's overlay UI (old messages + expanded width), then tore it
// down on-screen with a choppy ~1s collapse.
//
// Root cause: the overlay BrowserWindow is PERSISTENT — created with
// show:false and thereafter only hide()/show()'d (WindowHelper), never
// destroyed. Its React tree is never unmounted between meetings. startMeeting()
// show()s the overlay (setWindowMode('overlay')) BEFORE the start-side
// `session-reset` IPC lands, so the window paints the previous meeting's
// content for several frames, then clears it on-screen (chat unmount + height
// recompute + shellWidth→OS-resize shrink) = the visible choppy flash.
// endMeeting() used to hide the overlay but never clear it, so the stale tree
// was carried straight into the next meeting's first visible frames.
//
// Fix: endMeeting() now sends `session-reset` to the overlay IMMEDIATELY AFTER
// setWindowMode('launcher') has hidden it. The renderer's onSessionReset
// handler runs the full synchronous clear while the window is HIDDEN, with a
// whole meeting of idle time before the next show() — so the next meeting's
// first visible frame is already the clean collapsed baseline, with nothing to
// resize or tear down on screen.
//
// Strategy: source-contract assertions against the endMeeting() body in
// main.ts. The ordering (hide THEN clear) is load-bearing — clearing before
// the hide would clear while visible (the bug). These structural assertions
// pin the wiring so a future refactor that drops the send, or moves it before
// the hide, fails CI loudly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(__dirname, '../../../electron/main.ts');
const mainSource = readFileSync(mainPath, 'utf8');

function extractMethodBody(methodName) {
  const re = new RegExp(`(?:public|private|protected)\\s+(?:async\\s+)?${methodName}\\s*\\([^)]*\\)\\s*(?::[^{]*)?\\{`);
  const m = re.exec(mainSource);
  assert.ok(m, `could not locate ${methodName} in main.ts`);
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (i < mainSource.length && depth > 0) {
    const ch = mainSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, `unbalanced braces in ${methodName}`);
  return mainSource.slice(start, i - 1);
}

const endMeetingBody = extractMethodBody('endMeeting');

test('endMeeting sends session-reset to the overlay so its hidden tree is cleared before the next meeting', () => {
  assert.ok(
    /getOverlayWindow\(\)\?\.\s*webContents\.send\(\s*['"]session-reset['"]\s*\)/.test(endMeetingBody),
    'BUG: endMeeting() must send `session-reset` to the overlay window. The overlay is persistent (never destroyed) and only hidden/shown, so without clearing it on stop the previous meeting\'s messages + expanded width survive into the next meeting\'s first visible frame.',
  );
});

test('endMeeting clears the overlay AFTER hiding it (setWindowMode(launcher)), so the clear is off-screen', () => {
  const hideIdx = endMeetingBody.search(/setWindowMode\(\s*['"]launcher['"]\s*\)/);
  const resetIdx = endMeetingBody.search(/getOverlayWindow\(\)\?\.\s*webContents\.send\(\s*['"]session-reset['"]\s*\)/);

  assert.ok(hideIdx >= 0, 'sanity: endMeeting() must switch to launcher (hides the overlay).');
  assert.ok(resetIdx >= 0, 'sanity: endMeeting() must send session-reset to the overlay.');
  assert.ok(
    hideIdx < resetIdx,
    'BUG: endMeeting() must hide the overlay (setWindowMode("launcher")) BEFORE sending session-reset — otherwise the clear (messages teardown + width shrink) runs while the overlay is still VISIBLE, which is the on-screen choppy collapse this fix exists to remove.',
  );
});
