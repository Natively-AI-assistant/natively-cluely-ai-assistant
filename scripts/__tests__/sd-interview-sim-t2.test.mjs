// scripts/__tests__/sd-interview-sim-t2.test.mjs
//
// T2 dual-agent path (ticket 05): env gate, stub interviewer + thin candidate,
// spend/turn/interview caps, export on budget_hit. Default runs stay $0 —
// no live Gemini. Live path is opt-in (RUN_SD_INTERVIEW_SIM_T2=1 + key) and
// may skip when keys are absent.
//
// Run: node --test scripts/__tests__/sd-interview-sim-t2.test.mjs

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  shouldRunT2DualAgent,
  DEFAULT_INTERVIEWER_MODEL,
  DEFAULT_SUT_MODEL,
  createStubInterviewerAgent,
  createThinCandidateAgent,
  extractMermaidAttachments,
  NightlyInterviewCap,
  runT2DualAgent,
  SdInterviewSimRunner,
  writeCorpusBundle,
} = require('../lib/sd-interview-sim');

describe('sd-interview-sim T2 env gate', () => {
  test('shouldRunT2DualAgent is false without opt-in (even with Gemini key)', () => {
    assert.equal(shouldRunT2DualAgent({ GEMINI_API_KEY: 'secret' }), false);
    assert.equal(shouldRunT2DualAgent({}), false);
    assert.equal(
      shouldRunT2DualAgent({ RUN_SD_GROUNDING_E2E: '1', GEMINI_API_KEY: 'g' }),
      false,
    );
  });

  test('shouldRunT2DualAgent is false when opted in but no key', () => {
    assert.equal(shouldRunT2DualAgent({ RUN_SD_INTERVIEW_SIM_T2: '1' }), false);
    assert.equal(
      shouldRunT2DualAgent({ RUN_SD_INTERVIEW_SIM_T2: '1', GEMINI_API_KEY: '  ' }),
      false,
    );
  });

  test('shouldRunT2DualAgent is true with RUN_SD_INTERVIEW_SIM_T2=1 + Gemini key', () => {
    assert.equal(
      shouldRunT2DualAgent({ RUN_SD_INTERVIEW_SIM_T2: '1', GEMINI_API_KEY: 'g-test' }),
      true,
    );
  });

  test('default models prefer Flash-Lite interviewer and product Flash SUT', () => {
    assert.match(DEFAULT_INTERVIEWER_MODEL, /flash-lite/i);
    assert.match(DEFAULT_SUT_MODEL, /flash/i);
    assert.ok(!/flash-lite/i.test(DEFAULT_SUT_MODEL));
  });
});

describe('sd-interview-sim T2 mermaid extraction', () => {
  test('extractMermaidAttachments pulls fenced mermaid into kind=mermaid attachments', () => {
    const text = [
      'Sketch an HLD.',
      '```mermaid',
      'flowchart LR',
      '  A[Client] --> B[API]',
      '```',
      'Discuss QPS next.',
    ].join('\n');
    const atts = extractMermaidAttachments(text);
    assert.equal(atts.length, 1);
    assert.equal(atts[0].kind, 'mermaid');
    assert.match(atts[0].source, /flowchart LR/);
    assert.equal(atts[0].syntaxValid, true);
  });
});

describe('sd-interview-sim T2 NightlyInterviewCap', () => {
  test('blocks when max interviews/night is reached', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-t2-cap-'));
    try {
      const cap = new NightlyInterviewCap({
        maxInterviewsPerNight: 2,
        stateDir: dir,
        now: () => new Date('2026-07-27T10:00:00Z'),
      });
      assert.equal(cap.remaining(), 2);
      assert.equal(cap.canStart(), true);
      cap.recordStart();
      cap.recordStart();
      assert.equal(cap.canStart(), false);
      assert.equal(cap.remaining(), 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('sd-interview-sim T2 dual-agent stub path ($0)', () => {
  test('stub interviewer + thin candidate trigger SUT; injects speech; captures assistant', async () => {
    const injectLog = [];
    const sutCalls = [];
    const interviewer = createStubInterviewerAgent([
      {
        text: 'Design a URL shortener. Sketch HLD.',
        attachments: [
          {
            kind: 'mermaid',
            source: 'flowchart LR\n  A[Client] --> B[API]',
          },
        ],
      },
      { text: 'What is the QPS target?', end_interview: true },
    ]);
    const candidate = createThinCandidateAgent();

    const { bundle, outcome } = await runT2DualAgent({
      scenario: { id: 'stub-dual', prompt: 'URL shortener' },
      interviewerAgent: interviewer,
      candidateAgent: candidate,
      sut: async (ctx) => {
        sutCalls.push(ctx);
        return { text: `answer-${sutCalls.length}` };
      },
      onInject: (seg) => injectLog.push(seg),
      provenance: { git_sha: 't2dead', tier: 'T2' },
      models: {
        interviewer: 'stub-interviewer',
        sut: 'stub-sut',
      },
    });

    assert.equal(bundle.provenance.tier, 'T2');
    assert.equal(bundle.provenance.models.interviewer, 'stub-interviewer');
    assert.equal(bundle.provenance.models.sut, 'stub-sut');
    assert.ok(injectLog.length >= 1);
    assert.equal(injectLog[0].text, 'Design a URL shortener. Sketch HLD.');
    assert.equal(injectLog[0].speaker, 'system');

    const roles = bundle.turns.map((t) => t.role);
    assert.ok(roles.includes('interviewer'));
    assert.ok(roles.includes('assistant'));
    assert.equal(sutCalls.length, 2);
    assert.equal(outcome.end_reason, 'coverage_complete');

    const mermaid = bundle.turns
      .flatMap((t) => t.attachments || [])
      .find((a) => a.kind === 'mermaid');
    assert.ok(mermaid);
    assert.equal(mermaid.syntaxValid, true);
  });

  test('SdInterviewSimRunner accepts interviewerAgent dual mode', async () => {
    const probes = createStubInterviewerAgent([
      { text: 'Q1' },
      { text: 'Done.', end_interview: true },
    ]);
    const { bundle, outcome } = await new SdInterviewSimRunner({
      interviewerAgent: probes,
      candidateAgent: createThinCandidateAgent(),
      sut: () => ({ text: 'A' }),
      provenance: { tier: 'T2', models: { interviewer: 'stub', sut: 'stub' } },
    }).run();
    assert.equal(bundle.provenance.tier, 'T2');
    assert.equal(outcome.end_reason, 'coverage_complete');
    assert.ok(bundle.turns.filter((t) => t.role === 'assistant').length >= 1);
  });

  test('max turns stop with end_reason=max_turns and still export', async () => {
    const interviewer = createStubInterviewerAgent([
      { text: 'Q1' },
      { text: 'Q2' },
      { text: 'Q3' },
      { text: 'Q4' },
    ]);
    const { bundle, outcome } = await runT2DualAgent({
      interviewerAgent: interviewer,
      candidateAgent: createThinCandidateAgent(),
      sut: () => ({ text: 'A' }),
      maxTurns: 3,
      budgets: { maxTurns: 3 },
    });
    assert.equal(outcome.end_reason, 'max_turns');
    assert.ok(bundle.turns.length <= 3);
    assert.ok(bundle.run_id);
    assert.equal(bundle.outcome.end_reason, 'max_turns');
  });

  test('token/USD budget hit stops with budget_hit and still writes corpus', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-t2-corpus-'));
    try {
      const interviewer = createStubInterviewerAgent([
        { text: 'Q1', spend: { input_tokens: 50, estimated_usd: 0.02 } },
        { text: 'Q2', spend: { input_tokens: 50, estimated_usd: 0.02 } },
        { text: 'Q3', spend: { input_tokens: 50, estimated_usd: 0.02 } },
      ]);
      const { bundle, outcome } = await runT2DualAgent({
        interviewerAgent: interviewer,
        candidateAgent: createThinCandidateAgent(),
        sut: () => ({
          text: 'A',
          spend: { output_tokens: 10, estimated_usd: 0.01 },
        }),
        budgets: { maxEstimatedUsd: 0.05 },
        corpusDir: dir,
      });
      assert.equal(outcome.end_reason, 'budget_hit');
      assert.ok(outcome.spend.estimated_usd >= 0.05);
      assert.ok(bundle.outcome.spend.input_tokens > 0);
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
      assert.equal(files.length, 1);
      const written = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
      assert.equal(written.outcome.end_reason, 'budget_hit');
      assert.equal(written.provenance.tier, 'T2');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('nightly interview cap stops further interviews with budget_hit export', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-t2-night-'));
    const corpusDir = path.join(dir, 'corpus');
    try {
      const cap = new NightlyInterviewCap({
        maxInterviewsPerNight: 1,
        stateDir: dir,
        now: () => new Date('2026-07-27T22:00:00Z'),
      });
      assert.equal(cap.canStart(), true);

      const first = await runT2DualAgent({
        interviewerAgent: createStubInterviewerAgent([
          { text: 'Only one.', end_interview: true },
        ]),
        candidateAgent: createThinCandidateAgent(),
        sut: () => ({ text: 'ok' }),
        nightlyCap: cap,
        corpusDir,
      });
      assert.equal(first.outcome.end_reason, 'coverage_complete');
      assert.equal(cap.canStart(), false);

      const second = await runT2DualAgent({
        interviewerAgent: createStubInterviewerAgent([{ text: 'should not run' }]),
        candidateAgent: createThinCandidateAgent(),
        sut: () => ({ text: 'nope' }),
        nightlyCap: cap,
        corpusDir,
      });
      assert.equal(second.outcome.end_reason, 'budget_hit');
      assert.equal(second.bundle.turns.length, 0);
      assert.ok(second.bundle.run_id);
      const files = fs.readdirSync(corpusDir).filter((f) => f.endsWith('.json'));
      assert.ok(files.length >= 2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('outcome records spend counters when agents report spend', async () => {
    const { outcome } = await runT2DualAgent({
      interviewerAgent: createStubInterviewerAgent([
        {
          text: 'Probe',
          spend: { input_tokens: 100, output_tokens: 20, estimated_usd: 0.001 },
          end_interview: true,
        },
      ]),
      candidateAgent: createThinCandidateAgent(),
      sut: () => ({
        text: 'Answer',
        spend: { input_tokens: 50, output_tokens: 80, estimated_usd: 0.002 },
      }),
      models: {
        interviewer: DEFAULT_INTERVIEWER_MODEL,
        sut: DEFAULT_SUT_MODEL,
      },
    });
    assert.equal(outcome.spend.input_tokens, 150);
    assert.equal(outcome.spend.output_tokens, 100);
    assert.ok(Math.abs(outcome.spend.estimated_usd - 0.003) < 1e-9);
  });

  test('no fine-tune / train-job hooks exported from t2 surface', () => {
    const mod = require('../lib/sd-interview-sim/t2.js');
    assert.equal(typeof mod.fineTune, 'undefined');
    assert.equal(typeof mod.trainJob, 'undefined');
    assert.equal(typeof mod.startFineTune, 'undefined');
    assert.equal(typeof mod.writeCorpusBundle, 'undefined');
    // corpus export is via shared corpus helpers, not train pipeline
    assert.equal(typeof writeCorpusBundle, 'function');
  });

  test('thin candidate agent only triggers — does not invent answer text', async () => {
    const candidate = createThinCandidateAgent();
    const decision = await candidate({
      interviewerTurn: { text: 'Q?' },
      bundle: { turns: [] },
    });
    assert.equal(decision.action, 'trigger');
    assert.equal(decision.text, undefined);
    assert.ok(!('answer' in decision));
  });
});

describe('sd-interview-sim T2 live gate soft-skip', () => {
  test('live dual-agent path is not invoked by default node --test', () => {
    // Prove protocol stays offline: gate false under empty env.
    assert.equal(shouldRunT2DualAgent({}), false);
  });

  test('T2 workflow job is schedule/dispatch only (never pull_request)', () => {
    const yml = fs.readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../.github/workflows/build-smoke.yml',
      ),
      'utf8',
    );
    assert.match(yml, /sd-interview-sim-t2:/);
    assert.match(
      yml,
      /sd-interview-sim-t2:[\s\S]*?if:\s*github\.event_name == 'workflow_dispatch' \|\| github\.event_name == 'schedule'/,
    );
    const jobBlock = yml.slice(yml.indexOf('sd-interview-sim-t2:'));
    const nextJob = jobBlock.search(/\n  [a-z0-9-]+:/);
    const body = nextJob === -1 ? jobBlock : jobBlock.slice(0, nextJob);
    assert.doesNotMatch(body, /if:.*pull_request/);
    assert.match(body, /RUN_SD_INTERVIEW_SIM_T2/);
  });

  test('package script sd-interview-sim:t2 is additive (not gate/grounding)', () => {
    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)), '../../package.json'),
        'utf8',
      ),
    );
    assert.equal(typeof pkg.scripts['sd-interview-sim:t2'], 'string');
    assert.equal(typeof pkg.scripts['e2e:sd-requirements-gate'], 'string');
    assert.ok(fs.existsSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '../sd-interview-sim-t2.js'),
    ));
  });
});
