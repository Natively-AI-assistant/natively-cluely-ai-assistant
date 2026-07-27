// scripts/__tests__/sd-interview-sim-side-channels.test.mjs
//
// Tier0 tests for SD interview-sim side-channel snapshots.
// Analysis-only — no live Gemini, no WTA pack mutation.
//
// Run: node --test scripts/__tests__/sd-interview-sim-side-channels.test.mjs

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  createRun,
  appendTurn,
  appendSideChannel,
  finalize,
  SdInterviewSimRunner,
} = require('../lib/sd-interview-sim');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIM_LIB_DIR = path.join(__dirname, '../lib/sd-interview-sim');

describe('sd-interview-sim appendSideChannel', () => {
  test('appendSideChannel records entries tied to turn_idx / checkpoint and finalize round-trips them', () => {
    const run = createRun({
      provenance: { git_sha: 'abc', tier: 'T0', models: {} },
    });
    appendTurn(run, { role: 'interviewer', text: 'Q1' });
    appendTurn(run, { role: 'assistant', text: 'A1' });

    appendSideChannel(run, {
      turn_idx: 1,
      checkpoint: 'after_assistant',
      designSheet: {
        problemKey: 'url-shortener',
        schemaVersion: 1,
        committed: [{ id: 'entities:url', status: 'committed', text: 'URL maps to code' }],
        coverageGaps: { entities: { uncovered: false } },
        updatedAt: 1,
      },
      recentSdAnswers: {
        problemKey: 'url-shortener',
        items: [{ answerId: 'a1', text: 'A1', capturedAt: 1 }],
        cap: { maxItems: 3, maxTotalChars: 1800 },
        updatedAt: 1,
        schemaVersion: 1,
      },
      requirements: {
        gateClosed: true,
        advanceAccepted: true,
        problemClass: 'crud_product',
        problemKey: 'url-shortener',
        slots: {
          functional_requirements: { filled: true, askedOnce: true, value: 'shorten URLs' },
        },
      },
    });

    const { bundle } = finalize(run, { end_reason: 'scenario_stop' });

    assert.equal(bundle.side_channels.length, 1);
    const sc = bundle.side_channels[0];
    assert.equal(sc.turn_idx, 1);
    assert.equal(sc.checkpoint, 'after_assistant');
    assert.equal(sc.designSheet.problemKey, 'url-shortener');
    assert.equal(sc.designSheet.committed[0].id, 'entities:url');
    assert.equal(sc.recentSdAnswers.items[0].answerId, 'a1');
    assert.equal(sc.requirements.gateClosed, true);
    assert.equal(sc.requirements.slots.functional_requirements.value, 'shorten URLs');
  });
});

describe('SdInterviewSimRunner side-channel snapshots', () => {
  test('getSideChannelSnapshot hook records side_channels at turn boundaries', async () => {
    const snapCalls = [];
    const { bundle } = await new SdInterviewSimRunner({
      scenario: {
        id: 'side-channel-hook',
        turns: [
          { role: 'interviewer', text: 'Q1' },
          { role: 'interviewer', text: 'Q2' },
        ],
      },
      sut: () => ({ text: 'stub answer' }),
      getSideChannelSnapshot: (ctx) => {
        snapCalls.push({
          turnCount: ctx.turnCount,
          lastRole: ctx.bundle.turns[ctx.bundle.turns.length - 1]?.role,
        });
        return {
          checkpoint: 'after_assistant',
          designSheet: { problemKey: `turn-${ctx.turnCount}`, schemaVersion: 1 },
        };
      },
    }).run();

    assert.equal(snapCalls.length, 2);
    assert.equal(bundle.side_channels.length, 2);
    assert.equal(bundle.side_channels[0].checkpoint, 'after_assistant');
    assert.equal(bundle.side_channels[0].turn_idx, 1); // assistant turn after first Q
    assert.equal(bundle.side_channels[0].designSheet.problemKey, 'turn-2');
    assert.equal(bundle.side_channels[1].turn_idx, 3);
    assert.equal(bundle.side_channels[1].designSheet.problemKey, 'turn-4');
  });

  test('stubbed designSheet / recentSdAnswers / Requirements / screen_context round-trip via SUT payload', async () => {
    const stubState = {
      designSheet: {
        problemKey: 'chat',
        schemaVersion: 1,
        committed: [
          {
            id: 'api:send',
            section: 'api',
            text: 'POST /messages',
            fillSource: 'speech',
            status: 'committed',
            updatedAt: 42,
          },
        ],
        coverageGaps: {
          entities: { uncovered: false },
          api: { uncovered: false },
          hld: { uncovered: true },
          deep_dive_topics: { uncovered: true },
        },
        updatedAt: 42,
      },
      recentSdAnswers: {
        problemKey: 'chat',
        items: [
          {
            answerId: 'ans-1',
            capturedAt: 42,
            text: 'Messages fan out via Redis pub/sub.',
            extractedCoverage: { api: true },
          },
        ],
        cap: { maxItems: 3, maxTotalChars: 1800 },
        updatedAt: 42,
        schemaVersion: 1,
      },
      requirements: {
        gateClosed: true,
        advanceAccepted: true,
        problemClass: 'crud_product',
        problemKey: 'chat',
        slots: {
          functional_requirements: {
            filled: true,
            askedOnce: true,
            fillSource: 'interviewer',
            value: '1:1 and group chat',
          },
          scale_qps: { filled: true, askedOnce: true, value: '10k QPS' },
        },
      },
      screen_context: 'Whiteboard: Client → API Gateway → Chat Service → Redis',
    };

    const { bundle } = await new SdInterviewSimRunner({
      scenario: {
        id: 'stub-sd-state',
        turns: [{ role: 'interviewer', text: 'How do messages fan out?' }],
      },
      sut: () => ({
        text: 'Messages fan out via Redis pub/sub.',
        sideChannel: {
          checkpoint: 'post_answer',
          ...stubState,
        },
      }),
    }).run();

    assert.equal(bundle.side_channels.length, 1);
    const sc = bundle.side_channels[0];
    assert.equal(sc.checkpoint, 'post_answer');
    assert.equal(sc.turn_idx, 1);
    assert.deepEqual(sc.designSheet, stubState.designSheet);
    assert.deepEqual(sc.recentSdAnswers, stubState.recentSdAnswers);
    assert.deepEqual(sc.requirements, stubState.requirements);
    assert.equal(sc.screen_context, stubState.screen_context);
    // Speech turns stay speech — structured state lives only in side_channels.
    assert.equal(bundle.turns[1].text, 'Messages fan out via Redis pub/sub.');
    assert.equal(bundle.turns[1].attachments.length, 0);
  });

  test('fixture turn sideChannel payload is recorded without requiring getSideChannelSnapshot', async () => {
    const { bundle } = await new SdInterviewSimRunner({
      scenario: {
        id: 'fixture-payload',
        turns: [
          {
            role: 'interviewer',
            text: 'Advance when ready.',
            sideChannel: {
              checkpoint: 'gate_check',
              requirements: { gateClosed: false, advanceAccepted: false, problemKey: 'x' },
            },
          },
        ],
      },
      sut: () => ({ text: 'Still gathering scale.' }),
    }).run();

    assert.equal(bundle.side_channels.length, 1);
    assert.equal(bundle.side_channels[0].checkpoint, 'gate_check');
    assert.equal(bundle.side_channels[0].requirements.gateClosed, false);
  });

  test('sim lib does not import live deep-dive pack builder (analysis-only boundary)', () => {
    const files = fs.readdirSync(SIM_LIB_DIR).filter((f) => f.endsWith('.js'));
    assert.ok(files.length >= 1);
    for (const file of files) {
      const src = fs.readFileSync(path.join(SIM_LIB_DIR, file), 'utf8');
      assert.doesNotMatch(
        src,
        /sdDeepDiveContextPack|buildSdDeepDiveContextPack|buildPostGateContextPack/,
        `${file} must not wire sim transcripts into live WTA packs`,
      );
      assert.doesNotMatch(
        src,
        /side_channels.*(?:contextPack|deepDivePack)|injectFullTranscript/,
        `${file} must not treat side_channels as pack input`,
      );
    }
  });
});
