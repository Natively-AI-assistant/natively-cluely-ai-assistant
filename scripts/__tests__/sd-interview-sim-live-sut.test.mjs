// scripts/__tests__/sd-interview-sim-live-sut.test.mjs
//
// Tier0: live SUT adapter behaviour with a fake IntelligenceManager (no Electron / Gemini).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  collectAnswer,
  estimateSpendFromText,
  createIntelligenceSessionAdapter,
  createLiveWhatToAnswerSut,
  liveSideChannelSnapshot,
} = require('../lib/sd-interview-sim/liveSut.js');

describe('sd-interview-sim liveSut helpers', () => {
  test('collectAnswer joins async stream chunks', async () => {
    async function* gen() {
      yield 'Hel';
      yield 'lo';
    }
    assert.equal(await collectAnswer(gen()), 'Hello');
    assert.equal(await collectAnswer('plain'), 'plain');
  });

  test('estimateSpendFromText returns positive counters', () => {
    const spend = estimateSpendFromText('abcd'.repeat(100), { inputHintChars: 400 });
    assert.ok(spend.output_tokens > 0);
    assert.ok(spend.input_tokens > 0);
    assert.ok(spend.estimated_usd > 0);
  });

  test('createIntelligenceSessionAdapter injects with skipRefinementCheck', () => {
    const calls = [];
    const im = {
      addTranscript(seg, skip) {
        calls.push({ seg, skip });
      },
      getSdRequirementsGateStatus() {
        return { phase: 'requirements' };
      },
      getFormattedContext() {
        return 'ctx';
      },
    };
    const adapter = createIntelligenceSessionAdapter(im);
    adapter.addTranscript({ speaker: 'system', text: 'hi', timestamp: 1, final: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].skip, true);
    assert.equal(calls[0].seg.text, 'hi');
    assert.deepEqual(adapter.getSdRequirementsGateStatus(), { phase: 'requirements' });
  });

  test('createLiveWhatToAnswerSut calls runWhatShouldISay and returns text+spend', async () => {
    const im = {
      async runWhatShouldISay() {
        return '## Requirements\n- shorten URLs\n';
      },
      getLastAssistantMessage() {
        return '## Requirements\n- shorten URLs\n';
      },
    };
    const sut = createLiveWhatToAnswerSut({ intelligenceManager: im, timeoutMs: 5000 });
    const out = await sut({ interviewerTurn: { text: 'Design Bitly' } });
    assert.match(out.text, /Requirements/);
    assert.ok(out.spend.output_tokens > 0);
    assert.ok(out.spend.estimated_usd > 0);
  });

  test('createLiveWhatToAnswerSut pins sdProblemKey from scenario.prompt', async () => {
    const calls = [];
    const im = {
      async runWhatShouldISay(q, _c, _i, options) {
        calls.push({ q, options });
        return 'ok';
      },
    };
    const sut = createLiveWhatToAnswerSut({ intelligenceManager: im, timeoutMs: 5000 });
    const out = await sut({
      scenario: { prompt: 'Design a URL shortener like Bitly.' },
      interviewerTurn: { text: 'What about hot keys?' },
    });
    assert.equal(calls[0].q, undefined);
    assert.equal(calls[0].options.sdProblemKey, 'Design a URL shortener like Bitly.');
    assert.equal(out.meta.sdProblemKey, 'Design a URL shortener like Bitly.');
  });

  test('factory sdProblemKey wins over scenario when both set', async () => {
    const calls = [];
    const im = {
      async runWhatShouldISay(_q, _c, _i, options) {
        calls.push(options);
        return 'ok';
      },
    };
    const sut = createLiveWhatToAnswerSut({
      intelligenceManager: im,
      sdProblemKey: 'pinned-factory-key',
      timeoutMs: 5000,
    });
    await sut({
      scenario: { prompt: 'other prompt' },
      interviewerTurn: { text: 'clarifier' },
    });
    assert.equal(calls[0].sdProblemKey, 'pinned-factory-key');
  });

  test('createLiveWhatToAnswerSut rejects provider soft-failure text', async () => {
    const im = {
      async runWhatShouldISay() {
        return "I couldn't reach the AI provider — this looks like an API key or rate-limit issue.";
      },
    };
    const sut = createLiveWhatToAnswerSut({ intelligenceManager: im, timeoutMs: 2000 });
    await assert.rejects(() => sut({ interviewerTurn: { text: 'q' } }), /provider failure/);
  });

  test('liveSideChannelSnapshot pulls gate + context preview', () => {
    const snap = liveSideChannelSnapshot({
      getSdRequirementsGateStatus: () => ({ sdPhase: 'post_requirements' }),
      getFormattedContext: () => 'x'.repeat(5000),
    });
    assert.equal(snap.gateStatus.sdPhase, 'post_requirements');
    assert.equal(snap.recentContextPreview.length, 4000);
  });
});
