// scripts/__tests__/sd-interview-sim-runner.test.mjs
//
// Tier0 tests for SdInterviewSimRunner: fixture interviewer + stub SUT cycle.
// Zero live API / Electron / Gemini.
//
// Run: node --test scripts/__tests__/sd-interview-sim-runner.test.mjs

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  SdInterviewSimRunner,
  injectSpeech,
  toInjectSegment,
} = require('../lib/sd-interview-sim');

describe('sd-interview-sim inject dialect (SessionTracker-style)', () => {
  test('toInjectSegment maps role→speaker like gate harness (system→interviewer path)', () => {
    assert.deepEqual(toInjectSegment({ role: 'interviewer', text: 'Q?' }, 1000), {
      speaker: 'system',
      text: 'Q?',
      timestamp: 1000,
      final: true,
    });
    assert.equal(toInjectSegment({ role: 'user', text: 'go' }, 0).speaker, 'user');
    assert.equal(toInjectSegment({ role: 'assistant', text: 'a' }, 0).speaker, 'assistant');
    assert.equal(
      toInjectSegment({ role: 'interviewer', speaker: 'system', text: 'x' }, 0).speaker,
      'system',
    );
  });

  test('injectSpeech records segments without SessionTracker (harness-equivalent)', () => {
    const log = [];
    const injected = injectSpeech(null, [{ role: 'interviewer', text: 'Design X.' }], {
      baseTs: 5000,
      onSegment: (seg) => log.push(seg),
    });
    assert.equal(injected.length, 1);
    assert.equal(injected[0].segment.speaker, 'system');
    assert.equal(injected[0].segment.text, 'Design X.');
    assert.deepEqual(log[0].text, 'Design X.');
  });
});

describe('SdInterviewSimRunner fixture + stub SUT', () => {
  test('accepts fixture-interviewer config + budgets and returns { bundle, outcome }', async () => {
    const sutCalls = [];
    const runner = new SdInterviewSimRunner({
      scenario: {
        id: 'single-probe',
        turns: [{ role: 'interviewer', text: 'Design a URL shortener.' }],
      },
      budgets: { maxEstimatedUsd: 1 },
      provenance: { git_sha: 'deadbeef', tier: 'T0' },
      sut: async (ctx) => {
        sutCalls.push(ctx);
        return { text: 'I would start with requirements.' };
      },
    });

    const result = await runner.run();
    assert.equal(typeof result.bundle, 'object');
    assert.equal(typeof result.outcome, 'object');
    assert.equal(result.bundle.schema_version, 1);
    assert.ok(result.bundle.run_id);
    assert.equal(result.bundle.provenance.git_sha, 'deadbeef');
    assert.equal(result.bundle.provenance.tier, 'T0');
    assert.equal(result.outcome.end_reason, 'scenario_stop');
    assert.equal(sutCalls.length, 1);
  });

  test('one full cycle injects interviewer text then captures stub assistant answer', async () => {
    const injectLog = [];
    const { bundle, outcome } = await new SdInterviewSimRunner({
      scenario: {
        id: 'cycle',
        turns: [{ role: 'interviewer', speaker: 'system', text: 'What is the QPS target?' }],
      },
      sut: () => ({ text: 'About 1000 QPS.' }),
      onInject: (seg) => injectLog.push(seg),
    }).run();

    assert.equal(injectLog.length, 1);
    assert.equal(injectLog[0].speaker, 'system');
    assert.equal(injectLog[0].text, 'What is the QPS target?');

    assert.equal(bundle.turns.length, 2);
    assert.deepEqual(
      bundle.turns.map((t) => ({ role: t.role, text: t.text })),
      [
        { role: 'interviewer', text: 'What is the QPS target?' },
        { role: 'assistant', text: 'About 1000 QPS.' },
      ],
    );
    assert.equal(outcome.end_reason, 'scenario_stop');
    assert.deepEqual(bundle.outcome, outcome);
  });

  test('scenario stop and max turns produce correct end_reason and still export', async () => {
    const stopResult = await new SdInterviewSimRunner({
      scenario: {
        id: 'stop-early',
        turns: [
          { role: 'interviewer', text: 'Q1', stop: true },
          { role: 'interviewer', text: 'Q2 should not run' },
        ],
      },
      sut: () => ({ text: 'A1' }),
    }).run();
    assert.equal(stopResult.outcome.end_reason, 'scenario_stop');
    assert.equal(stopResult.bundle.turns.length, 2);
    assert.equal(stopResult.bundle.turns[0].text, 'Q1');
    assert.ok(stopResult.bundle.run_id);
    assert.equal(stopResult.bundle.outcome.end_reason, 'scenario_stop');

    let callCount = 0;
    const maxResult = await new SdInterviewSimRunner({
      scenario: {
        id: 'max-turns',
        turns: [
          { role: 'interviewer', text: 'Q1' },
          { role: 'interviewer', text: 'Q2' },
          { role: 'interviewer', text: 'Q3' },
        ],
      },
      maxTurns: 3,
      sut: () => {
        callCount += 1;
        return { text: `A${callCount}` };
      },
    }).run();
    assert.equal(maxResult.outcome.end_reason, 'max_turns');
    assert.ok(maxResult.bundle.turns.length >= 2);
    assert.ok(maxResult.bundle.turns.length <= 3);
    assert.equal(maxResult.bundle.outcome.end_reason, 'max_turns');
    assert.ok(maxResult.bundle.run_id);
  });

  test('mermaid on an interviewer fixture turn appears as an attachment on that turn', async () => {
    const mermaidSource = 'flowchart LR\n  A[Client] --> B[API]';
    const { bundle } = await new SdInterviewSimRunner({
      scenario: {
        id: 'mermaid-probe',
        turns: [
          {
            role: 'interviewer',
            text: 'Sketch an HLD.',
            attachments: [{ kind: 'mermaid', source: mermaidSource }],
          },
        ],
      },
      sut: () => ({ text: 'Looks good.' }),
    }).run();

    const iv = bundle.turns[0];
    assert.equal(iv.role, 'interviewer');
    assert.equal(iv.attachments.length, 1);
    assert.equal(iv.attachments[0].kind, 'mermaid');
    assert.equal(iv.attachments[0].source, mermaidSource);
    assert.equal(iv.attachments[0].syntaxValid, true);
  });

  test('optional continue appends a user_driver turn after the stub answer', async () => {
    const { bundle } = await new SdInterviewSimRunner({
      scenario: {
        id: 'with-continue',
        turns: [{ role: 'interviewer', text: 'Go deeper.', continue: true }],
      },
      sut: () => ({ text: 'Deep dive on caching.' }),
    }).run();

    assert.deepEqual(
      bundle.turns.map((t) => t.role),
      ['interviewer', 'assistant', 'user_driver'],
    );
    assert.equal(bundle.turns[2].text, 'continue');
  });

  test('entry is additive sd-interview-sim family (helpers still exported)', async () => {
    const mod = require('../lib/sd-interview-sim');
    assert.equal(typeof mod.createRun, 'function');
    assert.equal(typeof mod.appendTurn, 'function');
    assert.equal(typeof mod.finalize, 'function');
    assert.equal(typeof mod.SdInterviewSimRunner, 'function');
    assert.equal(typeof mod.injectSpeech, 'function');
  });
});
