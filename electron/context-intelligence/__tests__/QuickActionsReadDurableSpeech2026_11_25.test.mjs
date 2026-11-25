/**
 * Recap, Brainstorm, Code hint and Direct Assist read the DURABLE speech, not
 * the rolling window (PR #793, 2026-11-25).
 *
 * SessionTracker's rolling context (getContext / getFormattedContext) is
 * evicted 180 s back on every final line, whatever window is asked for. The
 * main answer paths moved to the durable transcript on 2026-10-04 (E12,
 * SPEECH_WINDOW_SECONDS); these four still read the rolling window, so a
 * problem stated four minutes before a Brainstorm press reached the model
 * without its statement. Driven through a real SessionTracker so the
 * eviction is the real one.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  setScopes, fakeCredentials, isolateSingletons, dist, require,
} from '../../services/__tests__/fakeOllamaHarness.mjs';

const { IntelligenceEngine } = require(dist('IntelligenceEngine.js'));
const { SessionTracker } = require(dist('SessionTracker.js'));
const { clearConversationState } = require(dist('context-intelligence/question/conversation-state-store.js'));
const { SPEECH_WINDOW_MAX_CHARS } = require(dist('llm/conversationHistoryPolicy.js'));

isolateSingletons();
const SESSION = 'durable-speech-quick-actions-test';

/** A meeting whose setup (ID-SETUP) was said 240 s before the press. */
function meeting() {
  const s = new SessionTracker();
  const now = Date.now();
  const lines = [
    [240, 'interviewer', 'The service is called ID-SETUP and it must keep p99 under forty milliseconds.'],
    [225, 'user', 'Understood, forty milliseconds at the ninety-ninth percentile.'],
    [60, 'interviewer', 'Now, how would you shard its write path?'],
    [5, 'user', 'Let me think about the keys first.'],
  ];
  for (const [ago, speaker, text] of lines) {
    s.addTranscript({ speaker, text, timestamp: now - ago * 1000, final: true, confidence: 0.95 });
  }
  s.addAssistantMessage('Mention consistent hashing.', undefined, 'what_to_answer');
  return s;
}

const engine = (over = {}) => Object.assign(Object.create(IntelligenceEngine.prototype), {
  conversationSessionId: () => SESSION,
  setMode: () => {}, emit: () => true, currentGenerationId: 0, assistCancellationToken: null,
  buildV3ForTranscriptSurface: async () => null,
  buildRecapFollowUpContract: () => null,
  ...over,
});

describe('the rolling window really drops the setup', () => {
  test('getFormattedContext(180) has lost a line said 240 s ago; the durable speech has it', () => {
    const s = meeting();
    assert.doesNotMatch(s.getFormattedContext(180), /ID-SETUP/);
    assert.match(s.getFormattedSpeech(600), /ID-SETUP/);
  });
});

describe('quick actions are handed the setup said more than 180 s ago', () => {
  beforeEach(() => { setScopes({}); fakeCredentials(); clearConversationState(SESSION); });

  test('Recap', async () => {
    let seen = null;
    const e = engine({
      session: meeting(),
      recapLLM: { generateStream: async function* (context) { seen = context; yield 'Recap.'; } },
    });
    await e.runRecap();
    assert.match(String(seen), /ID-SETUP/);
  });

  test('Brainstorm', async () => {
    let seen = null;
    const e = engine({
      session: meeting(),
      brainstormLLM: { generateStream: async function* (context) { seen = context; yield 'Approach one.'; } },
    });
    await e.runBrainstorm(undefined, 'Shard the write path');
    assert.match(String(seen), /ID-SETUP/);
  });

  test('Code hint with no pinned question', async () => {
    let seen = null;
    const e = engine({
      session: meeting(),
      codeHintLLM: { generateStream: async function* (_imgs, _q, _src, transcript) { seen = transcript; yield 'Hash the key.'; } },
    });
    await e.runCodeHint(undefined);
    assert.match(String(seen), /ID-SETUP/);
  });

  test('speech only: the assistant\'s own suggestion is not handed back as something said', async () => {
    let seen = null;
    const e = engine({
      session: meeting(),
      brainstormLLM: { generateStream: async function* (context) { seen = context; yield 'Approach one.'; } },
    });
    await e.runBrainstorm(undefined, 'Shard the write path');
    assert.doesNotMatch(String(seen), /ASSISTANT \(PREVIOUS SUGGESTION\)/);
  });

  test('typed chat lines are kept (Chat history off): a typed-only chat still has something to recap', async () => {
    const prev = process.env.NATIVELY_CHAT_HISTORY_MULTI_TURN;
    process.env.NATIVELY_CHAT_HISTORY_MULTI_TURN = '0';
    try {
      const s = new SessionTracker();
      s.addTranscript({ speaker: 'user', text: 'Typed setup: the queue is called ID-TYPED.', timestamp: Date.now() - 30_000, final: true, confidence: 1, origin: 'manual_chat' });
      s.addAssistantMessage('Use a dead-letter queue.', undefined, 'what_to_answer');
      let seen = null;
      const e = engine({
        session: s,
        recapLLM: { generateStream: async function* (context) { seen = context; yield 'Recap.'; } },
      });
      await e.runRecap();
      assert.match(String(seen), /\[ME TYPED\]: Typed setup: the queue is called ID-TYPED\./);
      assert.doesNotMatch(String(seen), /ASSISTANT \(PREVIOUS SUGGESTION\)/);
    } finally {
      if (prev === undefined) delete process.env.NATIVELY_CHAT_HISTORY_MULTI_TURN; else process.env.NATIVELY_CHAT_HISTORY_MULTI_TURN = prev;
    }
  });

  test('the window is bounded like the composer\'s: a long meeting keeps its newest lines', async () => {
    const s = new SessionTracker();
    const now = Date.now();
    for (let i = 0; i < 120; i++) {
      s.addTranscript({ speaker: i % 2 ? 'user' : 'interviewer', text: `line ${i} ${'word '.repeat(20)}`, timestamp: now - (590 - i * 4) * 1000, final: true, confidence: 0.95 });
    }
    let seen = null;
    const e = engine({
      session: s,
      brainstormLLM: { generateStream: async function* (context) { seen = context; yield 'Approach one.'; } },
    });
    await e.runBrainstorm(undefined, 'Shard the write path');
    assert.ok(String(seen).length <= SPEECH_WINDOW_MAX_CHARS + 2000, `context ${String(seen).length} chars`);
    assert.match(String(seen), /line 119 /);
  });
});

describe('Direct Assist', () => {
  test('meetingTranscript is read from the durable speech window', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'electron/ipcHandlers.ts'), 'utf8');
    const i = src.indexOf("let meetingTranscript = '';");
    assert.ok(i > 0);
    const block = src.slice(i, i + 600);
    assert.match(block, /getFormattedSpeech\?\.\(SPEECH_WINDOW_SECONDS\)/);
    assert.doesNotMatch(block, /getFormattedContext/);
  });
});
