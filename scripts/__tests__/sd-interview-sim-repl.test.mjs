// scripts/__tests__/sd-interview-sim-repl.test.mjs
// Dual-role REPL: interviewer (default) → WTA; candidate → skip WTA + auto interviewer.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createReplSession, parseReplCommand } = require('../lib/sd-interview-sim/replSession.js');

describe('parseReplCommand', () => {
  test('recognizes mode / auto / quit / help / save', () => {
    assert.deepEqual(parseReplCommand('/mode candidate'), {
      type: 'mode',
      mode: 'candidate',
    });
    assert.deepEqual(parseReplCommand('/auto off'), { type: 'auto', on: false });
    assert.deepEqual(parseReplCommand('/quit'), { type: 'quit' });
    assert.deepEqual(parseReplCommand('quit'), { type: 'quit' });
    assert.equal(parseReplCommand('hello?'), null);
  });

  test('/mode auto and /run start a self-driving run', () => {
    assert.deepEqual(parseReplCommand('/mode auto'), { type: 'autoRun', turns: null });
    assert.deepEqual(parseReplCommand('/mode auto 5'), { type: 'autoRun', turns: 5 });
    assert.deepEqual(parseReplCommand('/run'), { type: 'autoRun', turns: null });
    assert.deepEqual(parseReplCommand('/run 3'), { type: 'autoRun', turns: 3 });
  });
});

describe('createReplSession', () => {
  test('interviewer mode injects probe then calls SUT (WTA)', async () => {
    const injected = [];
    const sutCalls = [];
    const session = createReplSession({
      scenario: { id: 'repl', prompt: 'Design a URL shortener' },
      sut: async (ctx) => {
        sutCalls.push(ctx.interviewerTurn.text);
        return { text: 'We start with requirements…', spend: { input_tokens: 1, output_tokens: 2, estimated_usd: 0 } };
      },
      interviewerAgent: async () => ({ text: 'should not run' }),
      inject: (_st, turns) => {
        for (const t of turns) injected.push({ role: t.role, text: t.text });
        return [];
      },
    });

    assert.equal(session.getMode(), 'interviewer');
    const out = await session.handleLine('What is peak QPS?');
    assert.equal(out.type, 'turn');
    assert.equal(out.interviewer.text, 'What is peak QPS?');
    assert.equal(out.assistant.text, 'We start with requirements…');
    assert.equal(sutCalls.length, 1);
    assert.equal(injected[0].role, 'interviewer');
    assert.equal(session.getBundle().turns.length, 2);
  });

  test('candidate mode skips SUT and auto-runs interviewer agent', async () => {
    const sutCalls = [];
    const agentCalls = [];
    const session = createReplSession({
      scenario: { prompt: 'Design Bitly' },
      mode: 'candidate',
      autoInterviewer: true,
      sut: async () => {
        sutCalls.push(1);
        return { text: 'ghost' };
      },
      interviewerAgent: async (ctx) => {
        agentCalls.push(ctx.bundle.turns.length);
        return { text: 'How do you shard the DB?\nHAND_BACK', hand_back: true };
      },
      inject: () => [],
    });

    const out = await session.handleLine('First I clarify scale: 100M URLs/day.');
    assert.equal(out.type, 'turn');
    assert.equal(out.assistant.text, 'First I clarify scale: 100M URLs/day.');
    assert.match(out.interviewer.text, /shard/);
    assert.equal(out.interviewer.hand_back, true);
    assert.equal(sutCalls.length, 0, 'candidate mode must not call WTA/SUT');
    assert.equal(agentCalls.length, 1);
    assert.equal(session.getMode(), 'candidate');
  });

  test('handleLine("/mode auto") asks the caller to drive a run', async () => {
    const session = createReplSession({
      scenario: { prompt: 'x' },
      sut: async () => ({ text: 'natively' }),
      interviewerAgent: async () => ({ text: 'probe' }),
      inject: () => [],
    });

    assert.deepEqual(await session.handleLine('/mode auto'), {
      type: 'autoRun',
      turns: null,
    });
    assert.deepEqual(await session.handleLine('/run 4'), { type: 'autoRun', turns: 4 });
  });

  test('autoTurn drives interviewer agent then the SUT, unattended', async () => {
    const probes = ['Design it.', 'How do you shard?\nEND_INTERVIEW'];
    let i = 0;
    const sutCalls = [];
    const session = createReplSession({
      scenario: { prompt: 'Design Bitly' },
      sut: async (ctx) => {
        sutCalls.push(ctx.interviewerTurn.text);
        return { text: `answer ${sutCalls.length}` };
      },
      interviewerAgent: async () => {
        const text = probes[Math.min(i, probes.length - 1)];
        i += 1;
        return { text, end_interview: /END_INTERVIEW/.test(text) };
      },
      inject: () => [],
    });

    const first = await session.autoTurn();
    assert.equal(first.type, 'turn');
    assert.equal(first.sequence, 'interviewer-then-candidate');
    assert.equal(first.interviewer.text, 'Design it.');
    assert.equal(first.assistant.text, 'answer 1');
    assert.equal(first.end_interview, false);

    const second = await session.autoTurn();
    assert.equal(second.end_interview, true, 'END_INTERVIEW must surface so the run can stop');
    assert.equal(sutCalls.length, 2);
    assert.equal(session.getBundle().turns.length, 4);
  });

  test('/mode switches role; /auto off skips agent after candidate turn', async () => {
    let agentCalls = 0;
    const session = createReplSession({
      scenario: { prompt: 'x' },
      sut: async () => ({ text: 'natively' }),
      interviewerAgent: async () => {
        agentCalls += 1;
        return { text: 'probe' };
      },
      inject: () => [],
    });

    await session.handleLine('/mode candidate');
    assert.equal(session.getMode(), 'candidate');
    await session.handleLine('/auto off');
    const out = await session.handleLine('My answer alone.');
    assert.equal(out.type, 'turn');
    assert.equal(out.assistant.text, 'My answer alone.');
    assert.equal(out.interviewer, null);
    assert.equal(agentCalls, 0);
  });
});
