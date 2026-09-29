import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { decideScrollInterrupt } from '../scrollInterruptDecision.mjs';

describe('decideScrollInterrupt', () => {
  test('arms on a fresh upward scroll while not already suppressed', () => {
    assert.equal(
      decideScrollInterrupt({
        delta: -10,
        distanceFromBottom: 0,
        alreadySuppressed: false,
        transitionInFlight: false,
      }),
      'arm',
    );
  });

  test('does not re-arm on a fresh upward scroll while already suppressed', () => {
    assert.equal(
      decideScrollInterrupt({
        delta: -10,
        distanceFromBottom: 5,
        alreadySuppressed: true,
        transitionInFlight: false,
      }),
      'none',
    );
  });

  // Regression: fed208b5 -> b2eb7840. The re-arm check originally ran BEFORE
  // the arm check and gated purely on distance, so any upward scroll that
  // hadn't yet traveled past the re-arm tolerance (< 28px) was swallowed
  // instead of arming. Verifies arm wins even at 0 distance-from-bottom,
  // which is exactly the state auto-follow leaves the view in.
  test('arms even at 0 distance-from-bottom (auto-following state)', () => {
    assert.equal(
      decideScrollInterrupt({
        delta: -3,
        distanceFromBottom: 0,
        alreadySuppressed: false,
        transitionInFlight: false,
      }),
      'arm',
    );
  });

  // Regression: b2eb7840 -> 4b527cf9. A tiny upward wheel nudge arms
  // suppression via onWheel, then the browser's own resulting `scroll` event
  // reaches handleScrollInterrupt a frame later. Before this fix, the re-arm
  // branch checked distanceFromBottom alone (no direction requirement) —
  // and a small nudge still leaves distanceFromBottom under the 28px
  // threshold, so that same gesture immediately cleared the suppression it
  // just armed. Verifies a small upward delta at close range does NOT re-arm.
  test('does not re-arm on a small upward delta close to bottom (the wheel self-disarm bug)', () => {
    assert.equal(
      decideScrollInterrupt({
        delta: -10, // scrollTop decreased (moved up) since the last sample
        distanceFromBottom: 10, // still well under the 28px re-arm tolerance
        alreadySuppressed: true, // onWheel already armed suppression synchronously
        transitionInFlight: false,
      }),
      'none',
    );
  });

  test('re-arms on deliberate downward motion back near bottom', () => {
    assert.equal(
      decideScrollInterrupt({
        delta: 15,
        distanceFromBottom: 10,
        alreadySuppressed: true,
        transitionInFlight: false,
      }),
      're-arm',
    );
  });

  test('does not re-arm on downward motion while still far from bottom', () => {
    assert.equal(
      decideScrollInterrupt({
        delta: 15,
        distanceFromBottom: 400,
        alreadySuppressed: true,
        transitionInFlight: false,
      }),
      'none',
    );
  });

  test('does not re-arm while a width/height transition is in flight, even if close to bottom', () => {
    assert.equal(
      decideScrollInterrupt({
        delta: 15,
        distanceFromBottom: 5,
        alreadySuppressed: true,
        transitionInFlight: true,
      }),
      'none',
    );
  });

  test('does nothing on zero delta (no net scroll movement)', () => {
    assert.equal(
      decideScrollInterrupt({
        delta: 0,
        distanceFromBottom: 5,
        alreadySuppressed: false,
        transitionInFlight: false,
      }),
      'none',
    );
  });

  test('respects a custom rearmDistanceThresholdPx', () => {
    assert.equal(
      decideScrollInterrupt({
        delta: 15,
        distanceFromBottom: 50,
        alreadySuppressed: true,
        transitionInFlight: false,
        rearmDistanceThresholdPx: 100,
      }),
      're-arm',
    );
  });
});
