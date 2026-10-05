// scripts/intent-benchmark/__tests__/reportReplay.test.mjs
//
// The reporting and gating layer. These target the ways a benchmark lies:
// scoring an unanswered axis as absent rather than wrong, presenting a
// degenerate ECE as calibration, and a merge gate that a label swap walks past.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { scoreRun, checkAcceptance, PRODUCTION_LEGACY_SHARES } from '../report.mjs';
import { diffRuns } from '../replay.mjs';
import { emptyFrame, rowToInput, SCORED_AXES } from '../providers/contract.mjs';

const result = (expected, predicted, extra = {}) => ({ expected, predicted, ...extra });

describe('scoring', () => {
  test('an UNRESOLVED axis is scored wrong, not skipped', () => {
    // A provider that answers only the easy axes must not outrank one that
    // attempts all of them.
    const results = [
      result({ needs_response: 'yes' }, { needs_response: 'yes' }),
      result({ needs_response: 'no' }, {}),   // provider returned nothing for this axis
    ];
    const s = scoreRun({ providerId: 'p', results });
    assert.equal(s.axes.needs_response.n, 2);
    assert.equal(s.axes.needs_response.unresolved, 1);
    assert.equal(s.axes.needs_response.accuracy, 0.5, 'the unresolved row counts against it');
  });

  test('reports both balanced and production-weighted legacy accuracy', () => {
    // Balanced says what a model can learn; weighted says what it does on real
    // traffic. Reporting only one of them would be a choice disguised as a fact.
    const results = [
      result({}, {}, { expectedLegacyIntent: 'general', predictedLegacyIntent: 'general' }),
      result({}, {}, { expectedLegacyIntent: 'follow_up', predictedLegacyIntent: 'general' }),
    ];
    const s = scoreRun({ providerId: 'p', results });
    assert.equal(s.legacy.balancedAccuracy, 0.5);
    assert.ok(s.legacy.productionWeighted.weightedAccuracy > 0.99,
      'follow_up is 0.2% of production, so missing it barely moves the weighted number');
  });

  test('production shares cover all eight legacy labels and sum to ~1', () => {
    const sum = Object.values(PRODUCTION_LEGACY_SHARES).reduce((a, b) => a + b, 0);
    assert.equal(Object.keys(PRODUCTION_LEGACY_SHARES).length, 8);
    assert.ok(Math.abs(sum - 1) < 0.01, `shares sum to ${sum}`);
  });
});

describe('acceptance bar', () => {
  const perfect = () => scoreRun({
    providerId: 'p',
    latencies: [5, 6, 7],
    results: [
      result({ needs_response: 'yes', dialogue_act: 'question', mode_intent: 'x' },
        { needs_response: 'yes', dialogue_act: 'question', mode_intent: 'x', confidence: { needs_response: 0.9 } }),
      result({ needs_response: 'no', dialogue_act: 'backchannel', mode_intent: 'y' },
        { needs_response: 'no', dialogue_act: 'backchannel', mode_intent: 'y', confidence: { needs_response: 0.9 } }),
    ],
  });

  test('passes the F1 and latency bars when the model is perfect and fast', () => {
    const rows = checkAcceptance(perfect());
    const byWhat = Object.fromEntries(rows.map((r) => [r.what, r]));
    assert.equal(byWhat['needs_response macro F1'].pass, true);
    assert.equal(byWhat['p95 latency (ms)'].pass, true);
  });

  test('FAILS the ECE bar when confidences are degenerate, even if ECE is small', () => {
    // Seven of the ten legacy regex rules return a hardcoded confidence. Its
    // ECE can look excellent while measuring a constant rather than a belief.
    // Passing that would let the control clear a bar it never actually met.
    const rows = checkAcceptance(perfect());
    const ece = rows.find((r) => r.what.startsWith('ECE'));
    assert.equal(ece.pass, false, 'a degenerate confidence distribution must not pass');
    assert.match(ece.note, /DEGENERATE/);
  });

  test('states what each macro F1 is averaged over', () => {
    const rows = checkAcceptance(perfect());
    const nr = rows.find((r) => r.what === 'needs_response macro F1');
    assert.match(nr.note, /labels with support/);
  });
});

describe('replay gate', () => {
  const run = (perLabel, macro, p95 = 10) => ({
    providerId: 'x',
    axes: { needs_response: { macroF1: macro, perLabel } },
    latency: { p95 },
  });

  test('catches a LABEL SWAP that leaves axis macro F1 unchanged', () => {
    // The regression an axis-level number cannot see: one label gains exactly
    // what another loses.
    const before = run({ yes: { f1: 0.9, support: 50 }, no: { f1: 0.7, support: 50 } }, 0.8);
    const after = run({ yes: { f1: 0.7, support: 50 }, no: { f1: 0.9, support: 50 } }, 0.8);
    const d = diffRuns(before, after);
    assert.equal(d.summary.needs_response.delta, 0, 'axis macro is identical');
    assert.equal(d.regressions.length, 1, 'but the label-level drop is caught');
    assert.equal(d.regressions[0].label, 'yes');
  });

  test('ignores movement inside the tolerance', () => {
    const before = run({ yes: { f1: 0.900, support: 50 } }, 0.9);
    const after = run({ yes: { f1: 0.895, support: 50 } }, 0.895);
    assert.equal(diffRuns(before, after, 0.01).regressions.length, 0);
  });

  test('tolerance is PER LABEL, so a systematic shift still trips the gate', () => {
    // Each label moves less than the tolerance on its own, but every one moves
    // the same way. Tolerance must not launder that.
    const before = run({ a: { f1: 0.9, support: 10 }, b: { f1: 0.9, support: 10 }, c: { f1: 0.9, support: 10 } }, 0.9);
    const after = run({ a: { f1: 0.88, support: 10 }, b: { f1: 0.88, support: 10 }, c: { f1: 0.88, support: 10 } }, 0.88);
    assert.equal(diffRuns(before, after, 0.01).regressions.length, 3);
  });

  test('a label with zero support in BOTH runs is not evidence', () => {
    const before = run({ follow_up: { f1: 0, support: 0 } }, 0.9);
    const after = run({ follow_up: { f1: 0, support: 0 } }, 0.9);
    assert.equal(diffRuns(before, after).regressions.length, 0);
  });

  test('flags a disappearing label and a disappearing axis', () => {
    const before = run({ yes: { f1: 0.9, support: 5 }, no: { f1: 0.9, support: 5 } }, 0.9);
    const after = run({ yes: { f1: 0.9, support: 5 } }, 0.9);
    assert.equal(diffRuns(before, after).lostLabels.length, 1);

    const gone = { providerId: 'x', axes: {}, latency: { p95: 10 } };
    assert.ok(diffRuns(before, gone).regressions.some((r) => r.kind === 'axis_missing'));
  });

  test('catches a latency regression', () => {
    const before = run({ yes: { f1: 0.9, support: 5 } }, 0.9, 10);
    const after = run({ yes: { f1: 0.9, support: 5 } }, 0.9, 40);
    assert.ok(diffRuns(before, after).regressions.some((r) => r.kind === 'latency'));
  });
});

describe('provider contract', () => {
  test('rowToInput never leaks labels to the provider', () => {
    const row = {
      id: 'x-1', input: 'so uh whats that', mode: 'lecture', channel: 'system',
      user_channel: 'mic', history: [], app_state: {}, mode_has_reference_files: true,
      labels: { needs_response: 'yes' }, legacy_intent: 'general',
    };
    const inp = rowToInput(row);
    assert.equal('labels' in inp, false, 'a provider that can see the answer is not a measurement');
    assert.equal('legacy_intent' in inp, false);
    assert.equal(inp.mode_has_reference_files, true, 'but it DOES need to know whether files exist');
  });

  test('rowToInput prefers punctuated text only when asked and available', () => {
    const row = { input: 'raw', input_punctuated: 'Raw.', history: [], app_state: {} };
    assert.equal(rowToInput(row).input, 'raw');
    assert.equal(rowToInput(row, { punctuated: true }).input, 'Raw.');
    assert.equal(rowToInput({ input: 'raw' }, { punctuated: true }).input, 'raw', 'falls back when absent');
  });

  test('emptyFrame covers every scored axis', () => {
    const f = emptyFrame();
    for (const axis of SCORED_AXES) assert.ok(axis in f, `${axis} missing from emptyFrame`);
  });
});
