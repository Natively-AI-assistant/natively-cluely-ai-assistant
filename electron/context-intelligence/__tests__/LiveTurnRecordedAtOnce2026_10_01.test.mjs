/**
 * A live turn is in the conversation history AT ONCE; its screen text arrives
 * when the record is ready (2026-10-01).
 *
 * recordLiveTurn awaited the screen transcription and only THEN wrote the turn.
 * That was a wait of at most the 6 s cloud budget. With the Ollama model
 * writing the record (phase 5c-1) it could be 45 s, and a follow-up asked
 * inside that window was assembled without the previous answer: the assistant
 * forgot what it had said ten seconds earlier.
 */
import { test, describe, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  fakeOllama, helper, setMode, setScopes, fakeCredentials, isolateSingletons, userData, dist, require, CRED_SLOT,
} from '../../services/__tests__/fakeOllamaHarness.mjs';
import path from 'node:path';

const { IntelligenceEngine } = require(dist('IntelligenceEngine.js'));
const {
  getConversationState, clearConversationState, recordAnswerSummary, attachScreenToAnsweredTurn,
} = require(dist('context-intelligence/question/conversation-state-store.js'));
const { SCREEN_NOT_TRANSCRIBED } = require(dist('services/screen/screenDescription.js'));
const { renderDigitsPng } = require(dist('llm/visionTestImage.js'));
const { getScreenUnderstandingService } = require(dist('services/screen/ScreenUnderstandingService.js'));

isolateSingletons();
const SESSION = 'live-turn-test';
const turns = () => getConversationState(SESSION)?.turns ?? [];
const until = async (cond, ms = 3000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 10)); } return true; };

describe('attachScreenToAnsweredTurn', () => {
  beforeEach(() => clearConversationState(SESSION));
  test('fills in the screen text of the turn with that answer, replacing the "not transcribed" marker', () => {
    recordAnswerSummary(SESSION, 'Free up disk space.', SCREEN_NOT_TRANSCRIBED, 'what is this error?');
    recordAnswerSummary(SESSION, 'Run it with --no-cache.', undefined, 'how do I fix it?');
    assert.equal(attachScreenToAnsweredTurn(SESSION, 'Free up disk space.', 'FATAL E4012: disk quota exceeded'), true);
    assert.deepEqual(turns().map((t) => t.screen), ['FATAL E4012: disk quota exceeded', undefined]);
    assert.equal(turns().length, 2, 'no turn is added');
  });
  test('the turn is gone, the session is unknown, or there is no text: nothing changes', () => {
    recordAnswerSummary(SESSION, 'An answer.', undefined, 'a question');
    assert.equal(attachScreenToAnsweredTurn(SESSION, 'A different answer.', 'text'), false);
    assert.equal(attachScreenToAnsweredTurn('no-such-session', 'An answer.', 'text'), false);
    assert.equal(attachScreenToAnsweredTurn(SESSION, 'An answer.', '   '), false);
    assert.equal(turns()[0].screen, undefined);
  });
  test('the same answer given twice: the LATEST turn gets it', () => {
    recordAnswerSummary(SESSION, 'Same answer.', undefined, 'first');
    recordAnswerSummary(SESSION, 'Same answer.', undefined, 'second');
    attachScreenToAnsweredTurn(SESSION, 'Same answer.', 'screen text');
    assert.deepEqual(turns().map((t) => t.screen), [undefined, 'screen text']);
  });
});

describe('recordLiveTurn', () => {
  let ollama; let n = 0;
  const cloudless = () => {
    globalThis[CRED_SLOT] = {
      getDisabledProviders: () => [], anyVisionProviderConfigured: () => true, anyLocalVisionProviderConfigured: () => false,
      getNativelyApiKey: () => undefined, getOpenaiApiKey: () => undefined, getGeminiApiKey: () => undefined, getClaudeApiKey: () => undefined,
      getGroqApiKey: () => undefined, getDeepseekApiKey: () => undefined, getOpenrouterApiKey: () => undefined, getNvidiaNimApiKey: () => undefined,
      getFluxionApiKey: () => undefined, getAgentRouterApiKey: () => undefined, getLitellmBaseURL: () => undefined, getNinerouterBaseURL: () => undefined,
      getNinerouterVisionModels: () => [], getAllCredentials: () => ({}),
    };
  };
  const engine = () => Object.assign(Object.create(IntelligenceEngine.prototype), { conversationSessionId: () => SESSION });
  const shot = () => { const p = path.join(userData, `live-${++n}.png`); fs.writeFileSync(p, renderDigitsPng(String(3000 + n))); return p; };
  beforeEach(() => { fakeCredentials(); cloudless(); setScopes({}); setMode('vision_first'); clearConversationState(SESSION); getScreenUnderstandingService().rungHealth.clear(); });
  afterEach(async () => { delete globalThis.__nativelyGetLLMHelper; await ollama?.stop(); ollama = null; });

  test('the answer is in history at once, while a slow local record is still being written', async () => {
    let release;
    ollama = fakeOllama({ 'llava:7b': true }, { holdChat: () => new Promise((r) => { release = r; }).then(() => false) });
    // (holdChat returning a promise is truthy: the record request is held open.)
    const h = helper(await ollama.start(), 'llava:7b');
    globalThis.__nativelyGetLLMHelper = () => h;
    engine().recordLiveTurn('Your disk is full; free some space.', undefined, 'what is this error?', 1, [shot()]);
    assert.equal(await until(() => turns().length === 1, 500), true, 'the turn was not recorded until the screen record finished');
    assert.equal(turns()[0].a, 'Your disk is full; free some space.');
    assert.equal(turns()[0].screen, SCREEN_NOT_TRANSCRIBED, 'until the record arrives, the turn says a screen was there');
    assert.equal(ollama.chats().length <= 1, true);
    void release;
  });
  test('when the record arrives it is attached to that turn, even after a later turn was recorded', async () => {
    ollama = fakeOllama({ 'llava:7b': true }, { reply: 'FATAL E4012: disk quota exceeded' });
    const h = helper(await ollama.start(), 'llava:7b');
    globalThis.__nativelyGetLLMHelper = () => h;
    const e = engine();
    e.recordLiveTurn('Your disk is full; free some space.', undefined, 'what is this error?', 1, [shot()]);
    recordAnswerSummary(SESSION, 'Delete old build caches.', undefined, 'how do I fix it?');
    assert.equal(await until(() => /E4012/.test(turns()[0]?.screen ?? '')), true, `screen text never attached: ${JSON.stringify(turns())}`);
    assert.equal(turns().length, 2);
    assert.equal(turns()[1].screen, undefined);
  });
  test('no screenshot: recorded at once with no screen and no marker', async () => {
    engine().recordLiveTurn('Just an answer.', undefined, 'a question', 0, undefined);
    assert.equal(await until(() => turns().length === 1, 500), true);
    assert.equal(turns()[0].screen, undefined);
  });
});
