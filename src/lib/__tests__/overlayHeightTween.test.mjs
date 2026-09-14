// Guards the branching of the overlay's auto expand/contract height channel.
//
// The three SNAP branches are the ones that matter: each corresponds to a
// subsystem that already owns the height channel on its own clock, and a tween
// running underneath it is a regression, not a polish.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideHeightCommit,
  shouldReportTweenHeight,
  HEIGHT_TWEEN_EPSILON_PX,
} from '../overlayHeightTween.mjs';

const base = {
  from: 100,
  to: 300,
  streamingWithText: false,
  widthAnimating: false,
  resizing: false,
  reducedMotion: false,
};

test('a discrete change tweens', () => {
  const d = decideHeightCommit(base);
  assert.equal(d.action, 'tween');
  assert.equal(d.height, 300);
  assert.equal(d.reason, 'discrete');
});

test('the contract direction tweens too', () => {
  const d = decideHeightCommit({ ...base, from: 300, to: 0 });
  assert.equal(d.action, 'tween');
  assert.equal(d.height, 0);
});

test('the first measurement snaps — the shell entry flourish owns that moment', () => {
  const d = decideHeightCommit({ ...base, from: null });
  assert.equal(d.action, 'snap');
  assert.equal(d.reason, 'first-measure');
});

test('streaming WITH TEXT snaps: driveStreamingHeight owns the channel there', () => {
  const d = decideHeightCommit({ ...base, streamingWithText: true });
  assert.equal(d.action, 'snap');
  assert.equal(d.reason, 'streaming');
});

test('a reserved stream that has NOT produced text still tweens', () => {
  // The regression this pins: a typed question reserves its streaming id before
  // the first token, and the wait can be seconds. Keying the snap on the id
  // alone made "send a question, the overlay opens" cut instead of glide —
  // measured live at 0 → 145px in one frame. The caller must pass
  // `streamingWithText`, not "a stream exists".
  assert.equal(decideHeightCommit({ ...base, from: 0, to: 145 }).action, 'tween');
});

test('a width transition snaps: the two axes must move in lockstep', () => {
  // The regression this pins, reported from the real app: pressing the manual
  // expand/contract toggle made the width grow and THEN the height, because the
  // height ran its own 300ms curve while the width spring re-wrapped the text
  // under it. The height is a CONSEQUENCE of the width here, not an independent
  // change, so it must track it frame for frame.
  const d = decideHeightCommit({ ...base, widthAnimating: true });
  assert.equal(d.action, 'snap');
  assert.equal(d.reason, 'width-transition');
});

test('a resize drag snaps: the pointer is the clock', () => {
  const d = decideHeightCommit({ ...base, resizing: true });
  assert.equal(d.action, 'snap');
  assert.equal(d.reason, 'resize-drag');
});

test('a resize drag outranks streaming (both snap, drag names itself)', () => {
  const d = decideHeightCommit({ ...base, resizing: true, streamingWithText: true });
  assert.equal(d.action, 'snap');
  assert.equal(d.reason, 'resize-drag');
});

test('reduced motion snaps (WCAG 2.3.3)', () => {
  const d = decideHeightCommit({ ...base, reducedMotion: true });
  assert.equal(d.action, 'snap');
  assert.equal(d.reason, 'reduced-motion');
});

test('sub-epsilon layout noise commits nothing', () => {
  for (const delta of [0, HEIGHT_TWEEN_EPSILON_PX, -HEIGHT_TWEEN_EPSILON_PX]) {
    const d = decideHeightCommit({ ...base, to: 100 + delta });
    assert.equal(d.action, 'none', `delta ${delta}`);
    assert.equal(d.height, 100);
  }
});

test('one past epsilon does commit — the gate is not a dead zone', () => {
  assert.equal(decideHeightCommit({ ...base, to: 100 + HEIGHT_TWEEN_EPSILON_PX + 1 }).action, 'tween');
});

test('a negative measurement floors at 0 instead of asking for a negative box', () => {
  assert.equal(decideHeightCommit({ ...base, from: 40, to: -12 }).height, 0);
});

test('fractional measurements are rounded, so the epsilon gate is stable', () => {
  assert.equal(decideHeightCommit({ ...base, from: 100, to: 100.4 }).action, 'none');
  assert.equal(decideHeightCommit({ ...base, from: 100, to: 300.6 }).height, 301);
});

// ── shouldReportTweenHeight ────────────────────────────────────────────────
const rep = { now: 1000, lastReportAt: 900, lastReported: 200, height: 260 };

test('reports once the ~30fps interval has elapsed', () => {
  assert.equal(shouldReportTweenHeight(rep), true);
});

test('holds inside the interval — no per-frame native setBounds', () => {
  assert.equal(shouldReportTweenHeight({ ...rep, lastReportAt: 980 }), false);
});

test('exactly at the interval boundary reports', () => {
  assert.equal(shouldReportTweenHeight({ ...rep, lastReportAt: 967 }), true);
});

test('an unchanged integer height issues no redundant blur re-raster', () => {
  assert.equal(shouldReportTweenHeight({ ...rep, height: 200.2 }), false);
});

test('a zero/negative height is never reported — the window has a 1px floor', () => {
  assert.equal(shouldReportTweenHeight({ ...rep, height: 0 }), false);
  assert.equal(shouldReportTweenHeight({ ...rep, height: -5 }), false);
});
