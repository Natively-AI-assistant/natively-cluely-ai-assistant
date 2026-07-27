// scripts/lib/sd-interview-sim/matrix.js
//
// T1 fixture-interviewer matrix for the sd-interview-sim family.
// Additive — does NOT own Requirements-gate e2e or grounding benchmark.
// Default SUT is a phase-aware stub ($0 live API).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { SdInterviewSimRunner } = require('./runner');

const FIXTURE_DIR = path.join(__dirname, '..', '..', 'fixtures', 'sd-interview-sim');

/** Core T1 matrix ids (gate→advance + post-gate probe). */
const MATRIX_IDS = ['gate-advance', 'post-gate-probe'];

function loadFixture(id) {
  const p = path.join(FIXTURE_DIR, `${id}.json`);
  if (!fs.existsSync(p)) throw new Error(`missing sd-interview-sim fixture: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadMatrixFixtures() {
  return MATRIX_IDS.map(loadFixture);
}

/**
 * Deterministic stub SUT — never calls live Gemini (T0/T1 cost = $0).
 * Phase-aware canned text for structural wiring asserts only.
 *
 * @param {{ sdPhase?: string }} fixture
 */
function createStubSut(fixture = {}) {
  const phase = fixture.sdPhase || 'requirements';
  return async function stubSut(ctx) {
    const turn = ctx.interviewerTurn || {};
    if (phase === 'post_requirements') {
      return {
        text: [
          '## High-Level Design',
          'Clients hit an API tier; Redis caches hot redirects; Postgres stores mappings.',
          turn.text && /Base62|collision/i.test(turn.text)
            ? 'For collisions under 1000 QPS I use a pre-allocated Base62 counter shard.'
            : 'CDN terminates TLS; app servers own write path.',
        ].join('\n'),
      };
    }
    return {
      text: [
        'Clarifying requirements first.',
        '## Requirements',
        '- Functional and scale slots captured from interviewer so far.',
        turn.continue
          ? 'Checklist complete — ready to advance.'
          : 'Still filling open slots before later framework sections.',
      ].join('\n'),
    };
  };
}

/**
 * Assert fixture.expect against a completed { bundle, outcome }.
 *
 * @param {object} fixture
 * @param {{ bundle: object, outcome: object }} result
 * @returns {{ ok: boolean, failures: string[], notes: string[] }}
 */
function assertMatrixExpect(fixture, result) {
  const failures = [];
  const notes = [];
  const expect = fixture.expect || {};
  const { bundle, outcome } = result;
  const turns = bundle?.turns || [];

  if (!bundle?.run_id) failures.push('bundle missing run_id');
  if (bundle?.schema_version !== 1) failures.push('schema_version !== 1');
  if (bundle?.provenance?.tier !== 'T1') {
    failures.push(`expected provenance.tier=T1, got ${bundle?.provenance?.tier}`);
  }
  if (bundle?.provenance?.models?.sut !== 'stub') {
    failures.push(`expected models.sut=stub (default $0 path), got ${bundle?.provenance?.models?.sut}`);
  }
  if (bundle?.provenance?.models?.interviewer !== 'fixture') {
    failures.push(`expected models.interviewer=fixture, got ${bundle?.provenance?.models?.interviewer}`);
  }

  if (expect.end_reason && outcome?.end_reason !== expect.end_reason) {
    failures.push(`expected end_reason=${expect.end_reason}, got ${outcome?.end_reason}`);
  }

  const interviewerTurns = turns.filter((t) => t.role === 'interviewer');
  const assistantTurns = turns.filter((t) => t.role === 'assistant');
  const driverTurns = turns.filter((t) => t.role === 'user_driver');
  notes.push(
    `turns=${turns.length} interviewer=${interviewerTurns.length} ` +
      `assistant=${assistantTurns.length} driver=${driverTurns.length}`,
  );

  if (
    typeof expect.minInterviewerTurns === 'number' &&
    interviewerTurns.length < expect.minInterviewerTurns
  ) {
    failures.push(
      `expected >=${expect.minInterviewerTurns} interviewer turns, got ${interviewerTurns.length}`,
    );
  }
  if (
    typeof expect.minAssistantTurns === 'number' &&
    assistantTurns.length < expect.minAssistantTurns
  ) {
    failures.push(
      `expected >=${expect.minAssistantTurns} assistant turns, got ${assistantTurns.length}`,
    );
  }
  if (expect.requireUserDriver && driverTurns.length < 1) {
    failures.push('expected user_driver (advance/continue) turn');
  }
  if (expect.requireMermaidAttachment) {
    const withMermaid = interviewerTurns.some((t) =>
      (t.attachments || []).some((a) => a.kind === 'mermaid'),
    );
    if (!withMermaid) failures.push('expected mermaid attachment on an interviewer turn');
  }

  return { ok: failures.length === 0, failures, notes };
}

/**
 * Run one T1 matrix scenario via SdInterviewSimRunner + stub SUT.
 *
 * @param {object} fixture
 * @param {{
 *   sessionTracker?: { addTranscript?: Function },
 *   sut?: Function,
 *   provenance?: object,
 *   writeBundle?: (bundle: object) => void,
 * }} [opts]
 * @returns {Promise<{
 *   id: string,
 *   ok: boolean,
 *   failures: string[],
 *   notes: string[],
 *   bundle: object,
 *   outcome: object,
 * }>}
 */
async function runMatrixScenario(fixture, opts = {}) {
  const sut = opts.sut || createStubSut(fixture);
  const runner = new SdInterviewSimRunner({
    scenario: fixture,
    sut,
    sessionTracker: opts.sessionTracker || null,
    provenance: {
      tier: 'T1',
      ...(opts.provenance || {}),
      models: {
        interviewer: 'fixture',
        sut: 'stub',
        ...((opts.provenance && opts.provenance.models) || {}),
      },
    },
  });

  const { bundle, outcome } = await runner.run();
  if (typeof opts.writeBundle === 'function') {
    opts.writeBundle(bundle);
  }

  const asserted = assertMatrixExpect(fixture, { bundle, outcome });
  return {
    id: fixture.id,
    ok: asserted.ok,
    failures: asserted.failures,
    notes: asserted.notes,
    bundle,
    outcome,
  };
}

/**
 * Run the full T1 core matrix.
 *
 * @param {{
 *   sessionTracker?: { addTranscript?: Function, reset?: Function },
 *   fixtures?: object[],
 *   provenance?: object,
 *   writeBundle?: (bundle: object, fixture: object) => void,
 * }} [opts]
 */
async function runCoreMatrix(opts = {}) {
  const fixtures = opts.fixtures || loadMatrixFixtures();
  const results = [];
  for (const fixture of fixtures) {
    opts.sessionTracker?.reset?.();
    const result = await runMatrixScenario(fixture, {
      sessionTracker: opts.sessionTracker || null,
      provenance: opts.provenance,
      writeBundle: opts.writeBundle
        ? (bundle) => opts.writeBundle(bundle, fixture)
        : undefined,
    });
    results.push(result);
  }
  return results;
}

module.exports = {
  FIXTURE_DIR,
  MATRIX_IDS,
  loadFixture,
  loadMatrixFixtures,
  createStubSut,
  assertMatrixExpect,
  runMatrixScenario,
  runCoreMatrix,
};
