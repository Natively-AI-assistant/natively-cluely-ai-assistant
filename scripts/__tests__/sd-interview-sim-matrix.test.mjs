// scripts/__tests__/sd-interview-sim-matrix.test.mjs
//
// T1 matrix harness tests (headless): fixtures + stub SUT via SdInterviewSimRunner.
// Zero live API / Electron / Gemini. Electron boot is covered by
// scripts/e2e-sd-interview-sim.js (schedule/dispatch CI only).
//
// Run: node --test scripts/__tests__/sd-interview-sim-matrix.test.mjs

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  MATRIX_IDS,
  FIXTURE_DIR,
  loadFixture,
  loadMatrixFixtures,
  createStubSut,
  runMatrixScenario,
  runCoreMatrix,
} = require('../lib/sd-interview-sim/matrix.js');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('sd-interview-sim T1 matrix fixtures', () => {
  test('core matrix includes gate→advance and post-gate probe', () => {
    assert.deepEqual(MATRIX_IDS, ['gate-advance', 'post-gate-probe']);
    for (const id of MATRIX_IDS) {
      const fixture = loadFixture(id);
      assert.equal(fixture.id, id);
      assert.ok(Array.isArray(fixture.turns) && fixture.turns.length >= 1);
      assert.ok(fixture.expect);
    }
    const loaded = loadMatrixFixtures();
    assert.equal(loaded.length, 2);
    assert.ok(fs.existsSync(path.join(FIXTURE_DIR, 'gate-advance.json')));
    assert.ok(fs.existsSync(path.join(FIXTURE_DIR, 'post-gate-probe.json')));
  });
});

describe('sd-interview-sim T1 matrix runner (stub SUT)', () => {
  test('gate→advance scenario returns transcript bundle + scenario_stop', async () => {
    const fixture = loadFixture('gate-advance');
    const result = await runMatrixScenario(fixture);
    assert.equal(result.id, 'gate-advance');
    assert.equal(result.ok, true, result.failures.join('; '));
    assert.equal(result.outcome.end_reason, 'scenario_stop');
    assert.equal(result.bundle.provenance.tier, 'T1');
    assert.equal(result.bundle.provenance.models.sut, 'stub');
    assert.ok(result.bundle.turns.some((t) => t.role === 'user_driver'));
    assert.ok(
      result.bundle.turns.filter((t) => t.role === 'assistant').length >= 3,
    );
  });

  test('post-gate probe scenario captures mermaid + stub answers', async () => {
    const fixture = loadFixture('post-gate-probe');
    const result = await runMatrixScenario(fixture);
    assert.equal(result.id, 'post-gate-probe');
    assert.equal(result.ok, true, result.failures.join('; '));
    assert.equal(result.outcome.end_reason, 'scenario_stop');
    const mermaid = result.bundle.turns
      .flatMap((t) => t.attachments || [])
      .find((a) => a.kind === 'mermaid');
    assert.ok(mermaid);
    assert.equal(mermaid.syntaxValid, true);
  });

  test('runCoreMatrix runs both scenarios with stub SUT ($0)', async () => {
    const results = await runCoreMatrix({
      provenance: { git_sha: 'test' },
    });
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.ok), results.flatMap((r) => r.failures).join('; '));
    assert.ok(results.every((r) => r.bundle.provenance.models.sut === 'stub'));
  });

  test('injects into SessionTracker-like addTranscript when provided', async () => {
    const segments = [];
    const sessionTracker = {
      addTranscript(seg) {
        segments.push(seg);
        return { role: seg.speaker === 'system' ? 'interviewer' : seg.speaker };
      },
      reset() {
        segments.length = 0;
      },
    };
    const result = await runMatrixScenario(loadFixture('gate-advance'), {
      sessionTracker,
    });
    assert.equal(result.ok, true, result.failures.join('; '));
    assert.ok(segments.length >= 3);
    assert.ok(segments.every((s) => s.speaker === 'system' && s.final === true));
  });

  test('createStubSut never requires live API and is phase-aware', async () => {
    const gateSut = createStubSut({ sdPhase: 'requirements' });
    const postSut = createStubSut({ sdPhase: 'post_requirements' });
    const gateAns = await gateSut({
      interviewerTurn: { text: 'Scale?', continue: false },
    });
    const postAns = await postSut({
      interviewerTurn: { text: 'Base62 collision under 1000 QPS?' },
    });
    assert.match(gateAns.text, /Requirements/i);
    assert.match(postAns.text, /High-Level Design|Base62/i);
  });
});

describe('sd-interview-sim T1 boundary (additive vs gate/grounding)', () => {
  test('does not replace Requirements-gate e2e ownership', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
    );
    assert.equal(
      typeof pkg.scripts['e2e:sd-requirements-gate'],
      'string',
      'Requirements-gate e2e script must remain',
    );
    assert.equal(
      typeof pkg.scripts['e2e:sd-interview-sim'],
      'string',
      'sim e2e script must be additive',
    );
    assert.ok(
      fs.existsSync(path.join(repoRoot, 'scripts/e2e-sd-requirements-gate.js')),
    );
    assert.ok(
      fs.existsSync(path.join(repoRoot, 'scripts/e2e-sd-interview-sim.js')),
    );
    assert.notEqual(
      pkg.scripts['e2e:sd-interview-sim'],
      pkg.scripts['e2e:sd-requirements-gate'],
    );
  });

  test('matrix does not use grounding benchmark as runner', () => {
    const matrixSrc = fs.readFileSync(
      path.join(repoRoot, 'scripts/lib/sd-interview-sim/matrix.js'),
      'utf8',
    );
    const e2eSrc = fs.readFileSync(
      path.join(repoRoot, 'scripts/e2e-sd-interview-sim.js'),
      'utf8',
    );
    // Forbid requiring/importing the grounding benchmark as the matrix driver.
    assert.equal(/require\(['"][^'"]*benchmark-sd-grounding/.test(matrixSrc), false);
    assert.equal(/require\(['"][^'"]*benchmark-sd-grounding/.test(e2eSrc), false);
    assert.ok(matrixSrc.includes('SdInterviewSimRunner'));
    assert.ok(e2eSrc.includes('sd-interview-sim/matrix'));
  });

  test('workflow job is schedule/dispatch only (never pull_request)', () => {
    const yml = fs.readFileSync(
      path.join(repoRoot, '.github/workflows/build-smoke.yml'),
      'utf8',
    );
    assert.match(yml, /sd-interview-sim-e2e:/);
    assert.match(
      yml,
      /sd-interview-sim-e2e:[\s\S]*?if:\s*github\.event_name == 'workflow_dispatch' \|\| github\.event_name == 'schedule'/,
    );
    // Job must not be gated only by pull_request; top-level may still list PR for other jobs.
    const jobBlock = yml.slice(yml.indexOf('sd-interview-sim-e2e:'));
    const nextJob = jobBlock.search(/\n  [a-z0-9-]+:/);
    const body = nextJob === -1 ? jobBlock : jobBlock.slice(0, nextJob);
    assert.doesNotMatch(body, /if:.*pull_request/);
  });
});
