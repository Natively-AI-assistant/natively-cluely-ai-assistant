// scripts/__tests__/sd-overlay-interview-harness.test.mjs
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const H = require('../lib/sd-overlay-interview/harness.js');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('sd-overlay-interview harness gate', () => {
  test('skips when no live key and stub off', () => {
    const d = H.shouldRunOverlayInterview({});
    assert.equal(d.run, false);
    assert.equal(d.mode, 'skip');
    assert.match(H.overlayInterviewSkipMessage(d), /SKIP/);
  });

  test('skips on blank keys', () => {
    const d = H.shouldRunOverlayInterview({
      GEMINI_API_KEY: '  ',
      NATIVELY_API_KEY: '',
    });
    assert.equal(d.run, false);
    assert.equal(d.mode, 'skip');
  });

  test('live mode with GEMINI_API_KEY', () => {
    const d = H.shouldRunOverlayInterview({ GEMINI_API_KEY: 'g-test' });
    assert.equal(d.run, true);
    assert.equal(d.mode, 'live');
  });

  test('live mode with NATIVELY_API_KEY', () => {
    const d = H.shouldRunOverlayInterview({ NATIVELY_API_KEY: 'n-test' });
    assert.equal(d.run, true);
    assert.equal(d.mode, 'live');
  });

  test('stub debug opts in without a key', () => {
    const d = H.shouldRunOverlayInterview({ SD_OVERLAY_INTERVIEW_STUB_LLM: '1' });
    assert.equal(d.run, true);
    assert.equal(d.mode, 'stub');
  });

  test('planned testids align with ticket 01 (answer panel, not surface)', () => {
    assert.equal(H.PLANNED_TESTIDS.gateStrip, 'sd-requirements-gate-strip');
    assert.equal(H.PLANNED_TESTIDS.gateAdvance, 'sd-requirements-gate-advance');
    assert.equal(H.PLANNED_TESTIDS.answerSurface, 'sd-overlay-answer-panel');
  });

  test('core matrix: tickets 03+04 asserted (4 steps)', () => {
    assert.equal(H.CORE_UI_MATRIX_STEPS.length, 4);
    const t03 = H.matrixStepsForTicket('03');
    assert.equal(t03.length, 2);
    assert.ok(t03.every((s) => s.status === 'asserted'));
    const t04 = H.matrixStepsForTicket('04');
    assert.equal(t04.length, 2);
    assert.ok(t04.every((s) => s.status === 'asserted'));
    assert.equal(t04[0].fixtureHint, 'happy-gated-advance');
    assert.equal(t04[1].testid, H.PLANNED_TESTIDS.answerSurface);
  });

  test('loads premature-soft-refuse fixture + soft-refuse label matcher', () => {
    const fx = H.loadPrematureSoftRefuseFixture(repoRoot);
    assert.equal(fx.id, 'premature-soft-refuse');
    const labels = H.softRefuseMustNameLabels(fx);
    assert.ok(labels.includes('scale / QPS'));
    assert.ok(labels.includes('latency'));
    assert.ok(labels.includes('consistency vs availability'));

    const spoken =
      'Before we move on, we still need to pin down scale / QPS, latency, and consistency vs availability. ' +
      "Quick one — what's your take on scale / QPS, or should I state an assumption so we can keep going?";
    assert.equal(H.softRefuseTextMatchesLabels(spoken, labels), true);
    assert.equal(H.softRefuseTextMatchesLabels('unrelated answer', labels), false);

    const turns = H.interviewerTurnsFromFixture(fx);
    assert.ok(turns.length >= 2);
    assert.ok(turns.every((t) => t.role !== 'user'));
  });

  test('happy-gated-advance fill turns reuse checklist language', () => {
    const fx = H.loadHappyGatedAdvanceFixture(repoRoot);
    assert.equal(fx.id, 'happy-gated-advance');
    assert.ok(Array.isArray(fx.expect?.requiredSlotsFilled));
    assert.ok(fx.expect.requiredSlotsFilled.includes('scale_qps'));

    const fillTurns = H.checklistFillTurnsFromFixture(fx);
    assert.ok(fillTurns.length >= 1);
    const blob = fillTurns.map((t) => t.text).join('\n');
    assert.match(blob, /1000 QPS|Scale/i);
    assert.match(blob, /latency|50ms/i);
    assert.match(blob, /availability|consistency/i);
    assert.ok(fillTurns.every((t) => t.role !== 'user'));
  });

  test('post-gate probe is bounded (not DF marathon)', () => {
    const probe = H.postGateProbeFromFixture({});
    assert.equal(probe, H.DEFAULT_POST_GATE_PROBE);
    assert.match(probe, /entities|URL shortener/i);
    const custom = H.postGateProbeFromFixture({ postGateProbe: ' Custom probe? ' });
    assert.equal(custom, 'Custom probe?');
  });

  test('matrix budgets default under DF length + env overrides', () => {
    const d = H.resolveMatrixBudgets({});
    assert.equal(d.maxTurns, H.MATRIX_BUDGET_DEFAULTS.maxTurns);
    assert.ok(d.maxTurns < 32);
    assert.equal(d.maxMs, 180_000);
    assert.equal(d.maxEstimatedUsd, null);

    const o = H.resolveMatrixBudgets({
      SD_OVERLAY_INTERVIEW_MAX_TURNS: '6',
      SD_OVERLAY_INTERVIEW_MAX_MS: '60000',
      SD_OVERLAY_INTERVIEW_MAX_USD: '0.25',
    });
    assert.equal(o.maxTurns, 6);
    assert.equal(o.maxMs, 60000);
    assert.equal(o.maxEstimatedUsd, 0.25);
  });

  test('turn budget enforces caps', () => {
    const b = H.createTurnBudget({ maxTurns: 3, maxMs: 60_000, maxEstimatedUsd: 0.1 });
    b.bump(1);
    b.bump(1);
    assert.equal(b.turnCount, 2);
    assert.throws(() => b.bump(2), /turn cap exceeded/);

    const usd = H.createTurnBudget({ maxTurns: 20, maxMs: 60_000, maxEstimatedUsd: 0.05 });
    usd.addEstimatedUsd(0.04);
    assert.throws(() => usd.addEstimatedUsd(0.02), /USD cap exceeded/);
  });

  test('answerChromeLooksPresent distinguishes live vs stub', () => {
    assert.equal(H.answerChromeLooksPresent('', 'live'), false);
    assert.equal(H.answerChromeLooksPresent('short', 'live'), false);
    assert.equal(
      H.answerChromeLooksPresent(
        'I would model URL, User, and Click as the core entities for the shortener.',
        'live',
      ),
      true,
    );
    assert.equal(
      H.answerChromeLooksPresent('No AI providers configured. Please add at least one API key in Settings.', 'stub'),
      true,
    );
  });
});
