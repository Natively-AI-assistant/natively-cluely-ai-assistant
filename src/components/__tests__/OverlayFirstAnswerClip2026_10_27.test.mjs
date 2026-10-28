// 2026-10-27: the first quick-action answer (What to answer?, Clarify, ...) left
// the overlay window short, cutting off the footer, until the next press.
//
// Traced live on Windows: the expand tween led the window and armed the
// observer hold; the answer started streaming mid-tween, so decideHeightCommit
// returned a 'streaming' snap, which stopped the tween. A stopped framer
// animation never runs onComplete, so the hold was never released and nothing
// settled: every observer report of the growing panel was skipped, the hold
// expired on its timer, and the window stayed at 310px under a 352px panel.
//
// The snap branch now does what the interrupted tween's onComplete would have.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const ui = fs.readFileSync(path.resolve(dirname, '../NativelyInterface.tsx'), 'utf8');

const snapBranch = () => {
  const commit = ui.indexOf('const commitViewportHeight = useCallback(');
  assert.ok(commit > 0, 'commitViewportHeight not found');
  const start = ui.indexOf("if (decision.action === 'snap') {", commit);
  assert.ok(start > commit, 'the snap branch moved');
  return ui.slice(start, ui.indexOf('\n      }\n', start));
};

test('a snap that interrupts a height tween releases its hold and settles the window', () => {
  const snap = snapBranch();
  const noted = snap.indexOf('const interruptedTween =');
  const stop = snap.indexOf('viewportTweenRef.current?.stop();');
  assert.ok(noted >= 0 && noted < stop, 'whether a tween was running must be read before it is stopped');
  // A tween still waiting on its window lead has a target but no animation yet.
  assert.match(
    snap.slice(noted, stop),
    /viewportTweenRef\.current !== null \|\| viewportTweenTargetRef\.current !== null/,
    'a snap while the tween waits on its window lead leaves the hold armed',
  );
  assert.match(
    snap,
    /if \(interruptedTween && !animationControlsRef\.current && !isResizingRef\.current\) \{\s*heightReportSuppressedUntilRef\.current = 0;/,
    'the stopped tween\'s observer hold is never released',
  );
  assert.match(snap, /resizeOverlayWindow\(settled\);/, 'the window is never settled to the real height');
});

test('the tween\'s own onComplete still releases and settles (the path the snap mirrors)', () => {
  const tween = ui.slice(ui.indexOf('viewportTweenRef.current = animate(viewportHeight, decision.height, {'));
  const done = tween.slice(tween.indexOf('onComplete: () => {'), tween.indexOf('});'));
  assert.match(done, /if \(!animationControlsRef\.current\) heightReportSuppressedUntilRef\.current = 0;/);
  assert.match(done, /resizeOverlayWindow\(settled\);/);
});
