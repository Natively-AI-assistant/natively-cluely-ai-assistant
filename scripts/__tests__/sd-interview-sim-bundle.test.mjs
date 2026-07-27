// scripts/__tests__/sd-interview-sim-bundle.test.mjs
//
// Tier0 unit tests for SD interview sim transcript-bundle helpers
// (create / append / finalize / budget / mermaid). No Electron / Gemini.
//
// Run: node --test scripts/__tests__/sd-interview-sim-bundle.test.mjs

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createRun,
  appendTurn,
  recordSpend,
  budgetExceeded,
  finalize,
} = require('../lib/sd-interview-sim');

describe('sd-interview-sim transcript bundle', () => {
  test('createRun yields schema_version 1, run_id, provenance, empty turns/side_channels', () => {
    const run = createRun({
      provenance: {
        git_sha: 'abc123',
        tier: 'T0',
        models: { interviewer: 'stub', sut: 'stub' },
      },
    });

    assert.equal(run.bundle.schema_version, 1);
    assert.equal(typeof run.bundle.run_id, 'string');
    assert.ok(run.bundle.run_id.length > 0);
    assert.deepEqual(run.bundle.provenance, {
      git_sha: 'abc123',
      tier: 'T0',
      models: { interviewer: 'stub', sut: 'stub' },
    });
    assert.deepEqual(run.bundle.turns, []);
    assert.deepEqual(run.bundle.side_channels, []);
  });

  test('appendTurn preserves order/indexes and round-trips mermaid attachments', () => {
    const run = createRun({
      provenance: { git_sha: 'abc', tier: 'T0', models: {} },
    });
    appendTurn(run, { role: 'interviewer', text: 'Design a URL shortener.' });
    appendTurn(run, {
      role: 'assistant',
      text: 'Here is an HLD.',
      attachments: [
        {
          kind: 'mermaid',
          source: 'flowchart LR\n  A[Client] --> B[API]',
        },
      ],
    });
    appendTurn(run, { role: 'user_driver', text: 'continue' });

    assert.equal(run.bundle.turns.length, 3);
    assert.deepEqual(
      run.bundle.turns.map((t) => ({ idx: t.idx, role: t.role })),
      [
        { idx: 0, role: 'interviewer' },
        { idx: 1, role: 'assistant' },
        { idx: 2, role: 'user_driver' },
      ],
    );
    const att = run.bundle.turns[1].attachments[0];
    assert.equal(att.kind, 'mermaid');
    assert.equal(att.source, 'flowchart LR\n  A[Client] --> B[API]');
    assert.equal(att.syntaxValid, true);
  });

  test('invalid mermaid sets syntaxValid=false without failing finalize', () => {
    const run = createRun({
      provenance: { git_sha: 'abc', tier: 'T0', models: {} },
    });
    appendTurn(run, {
      role: 'interviewer',
      text: 'Sketch something broken.',
      attachments: [{ kind: 'mermaid', source: 'not valid mermaid [[[[' }],
    });
    assert.equal(run.bundle.turns[0].attachments[0].syntaxValid, false);

    const { bundle, outcome } = finalize(run, { end_reason: 'scenario_stop' });
    assert.equal(outcome.end_reason, 'scenario_stop');
    assert.equal(bundle.turns[0].attachments[0].kind, 'mermaid');
    assert.equal(bundle.turns[0].attachments[0].syntaxValid, false);
    assert.equal(bundle.outcome.end_reason, 'scenario_stop');
  });

  test('spend and turn caps trip budgetExceeded and end_reason=budget_hit', () => {
    const run = createRun({
      provenance: { git_sha: 'abc', tier: 'T0', models: {} },
      budgets: { maxTurns: 2, maxInputTokens: 100, maxEstimatedUsd: 0.05 },
    });
    appendTurn(run, { role: 'interviewer', text: 'q1' });
    assert.equal(budgetExceeded(run), false);

    appendTurn(run, { role: 'assistant', text: 'a1' });
    assert.equal(budgetExceeded(run), true);

    const { outcome } = finalize(run);
    assert.equal(outcome.end_reason, 'budget_hit');

    const tokenRun = createRun({
      provenance: { git_sha: 'abc', tier: 'T0', models: {} },
      budgets: { maxInputTokens: 10 },
    });
    recordSpend(tokenRun, { input_tokens: 10 });
    assert.equal(budgetExceeded(tokenRun), true);
    assert.equal(finalize(tokenRun).outcome.end_reason, 'budget_hit');

    const usdRun = createRun({
      provenance: { git_sha: 'abc', tier: 'T0', models: {} },
      budgets: { maxEstimatedUsd: 1 },
    });
    recordSpend(usdRun, { estimated_usd: 1 });
    assert.equal(budgetExceeded(usdRun), true);
    assert.equal(finalize(usdRun).outcome.end_reason, 'budget_hit');
  });

  test('finalize on abort still produces a complete bundle with spend snapshot', () => {
    const run = createRun({
      provenance: {
        git_sha: 'deadbeef',
        tier: 'T2',
        models: { interviewer: 'flash-lite', sut: 'flash' },
      },
      budgets: { maxTurns: 20 },
    });
    appendTurn(run, { role: 'interviewer', text: 'Start.' });
    appendTurn(run, { role: 'assistant', text: 'Partial answer.' });
    recordSpend(run, { input_tokens: 40, output_tokens: 12, estimated_usd: 0.002 });

    const { bundle, outcome } = finalize(run, { end_reason: 'error' });

    assert.equal(bundle.schema_version, 1);
    assert.ok(bundle.run_id);
    assert.equal(bundle.provenance.git_sha, 'deadbeef');
    assert.equal(bundle.turns.length, 2);
    assert.deepEqual(bundle.side_channels, []);
    assert.equal(outcome.end_reason, 'error');
    assert.deepEqual(outcome.spend, {
      input_tokens: 40,
      output_tokens: 12,
      estimated_usd: 0.002,
    });
    assert.deepEqual(bundle.outcome, outcome);
  });
});
