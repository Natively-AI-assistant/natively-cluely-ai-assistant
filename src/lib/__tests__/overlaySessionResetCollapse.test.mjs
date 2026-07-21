// Regression test for the "stale expanded overlay on meeting restart" bug.
//
// Symptom: the overlay BrowserWindow/renderer is reused across meetings (never
// destroyed). On Stop→Start, the overlay briefly showed the PREVIOUS meeting's
// expanded coding/answer view at its wide shell width, then "refreshed" to the
// clean collapsed state a second or two later.
//
// Root cause: the `onSessionReset` handler in NativelyInterface cleared
// `messages` but never collapsed the code-width expansion. The shell only
// contracted later via the deferred checkCodeVisibility chain (rAF → 120ms
// stability gate → 0.7s spring), so the old wide frame was painted on the
// first frame of the new meeting.
//
// Fix: onSessionReset now snaps the code-width state back to the collapsed
// baseline SYNCHRONOUSLY — stops any in-flight width animation, clears
// codeExpandedRef + the visibility timers, and does an imperative
// `shellWidth.set(SHELL_WIDTH_COLLAPSED)` (not animate, so no transient wide
// frame). It deliberately does NOT touch isExpanded (the vertical
// content-shown flag), whose mounted default is correct for a fresh meeting
// and whose setter would trigger hideWindow().
//
// Strategy: source-contract assertions against the onSessionReset handler in
// NativelyInterface.tsx. The reset is component-internal state manipulation
// (motion values + refs), not a pure function, so a behavioural test would
// need a full React/DOM harness. These structural assertions pin the
// load-bearing reset lines so a future refactor that drops the collapse fails
// CI loudly — the gap that let this regress silently.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(__dirname, '../../components/NativelyInterface.tsx');
const source = readFileSync(sourcePath, 'utf8');

// Extract the body of the onSessionReset callback: from the
// `onSessionReset(() => {` opening to its matching close brace.
function extractOnSessionResetBody() {
  const marker = 'onSessionReset(() => {';
  const idx = source.indexOf(marker);
  assert.ok(idx >= 0, 'could not locate the onSessionReset(() => { handler in NativelyInterface.tsx');
  let i = idx + marker.length;
  let depth = 1;
  const start = i;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, 'unbalanced braces in onSessionReset handler');
  return source.slice(start, i - 1);
}

// Strip line comments so assertions match on actual code, not on the
// explanatory comments (which intentionally mention strings like
// `setIsExpanded(false)` to document why we DON'T call them).
function stripLineComments(s) {
  return s
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

const body = stripLineComments(extractOnSessionResetBody());

test('onSessionReset snaps shellWidth back to the collapsed baseline (imperative set, not animate)', () => {
  assert.ok(
    /shellWidth\.set\(\s*SHELL_WIDTH_COLLAPSED\s*\)/.test(body),
    'BUG: onSessionReset must imperatively `shellWidth.set(SHELL_WIDTH_COLLAPSED)` so the OS window contracts to the collapsed width on the first paint of the new meeting — otherwise the previous meeting\'s expanded width is shown until the deferred checkCodeVisibility collapse fires ~1-2s later.',
  );
  // Must be an imperative set, NOT an animate() (which would play a visible
  // wide→narrow tween on meeting start).
  assert.ok(
    !/animate\(\s*shellWidth\s*,\s*SHELL_WIDTH_COLLAPSED/.test(body),
    'BUG: the reset must use shellWidth.set() (instant), not animate(shellWidth, SHELL_WIDTH_COLLAPSED) which plays a transient wide frame.',
  );
});

test('onSessionReset clears the code-expansion ref so the next visibility scan starts collapsed', () => {
  assert.ok(
    /codeExpandedRef\.current\s*=\s*false/.test(body),
    'BUG: onSessionReset must reset codeExpandedRef.current = false — otherwise checkCodeVisibility believes the shell is still expanded and may not contract, and a stale expansion can re-fire.',
  );
});

test('onSessionReset stops any in-flight width animation and clears the deferred visibility machinery', () => {
  assert.ok(
    /animationControlsRef\.current\s*\.stop\(\)/.test(body) || /animationControlsRef\.current\?\.stop\(\)/.test(body),
    'BUG: onSessionReset must stop any in-flight shell-width animation (animationControlsRef.current.stop()) so a previous meeting\'s expansion tween cannot keep driving the width after reset.',
  );
  assert.ok(
    /clearTimeout\(\s*stableVisibilityTimerRef\.current\s*\)/.test(body),
    'BUG: onSessionReset must clear stableVisibilityTimerRef — a pending stability-gate timer from the old meeting could otherwise fire a stale expansion after reset.',
  );
  assert.ok(
    /pendingVisibilityRef\.current\s*=\s*null/.test(body),
    'BUG: onSessionReset must null pendingVisibilityRef so no stale pending visibility change survives into the new meeting.',
  );
});

test('onSessionReset does NOT call setIsExpanded(false) (would hide the just-started overlay)', () => {
  // isExpanded is the vertical content-shown flag; its mounted default (true)
  // is correct for a fresh meeting, and setIsExpanded(false) triggers
  // hideWindow() via the [isExpanded] effect. The stale "expanded" the user
  // saw was the code-WIDTH expansion, fixed above — not isExpanded.
  assert.ok(
    !/setIsExpanded\(\s*false\s*\)/.test(body),
    'BUG: onSessionReset must NOT call setIsExpanded(false) — that hides the overlay window of a meeting that just started. Collapse the code-width state (shellWidth/codeExpandedRef) instead.',
  );
});
