// electron/services/__tests__/FollowUpRefineFailuresAreSaid2026_10_26.test.mjs
//
// A refinement of the last answer (Shorten, Rephrase, ...) swallowed a provider
// failure the way Recap and Follow-up questions did before
// RecapAndFollowUpFailuresAreSaid2026_10_10. FollowUpLLM caught every error and
// ended quietly, the engine returned an empty string and said nothing, and the
// overlay kept the "Thinking..." bubble under the refinement's label for good.
// Found by PR #614 (live-reproduced on Windows with no AI key).
//
// Now, as for Recap: the class throws the error on, the engine reports it with
// the provider's reason, a stream with no words is reported too, and a press
// that was cancelled or overtaken stays silent. Runs the real compiled engine
// and the real FollowUpLLM. Shared code with no platform branch: the same on
// macOS and Windows.
//
//   npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/FollowUpRefineFailuresAreSaid2026_10_26.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const NO_MODEL = 'Follow-up needs an AI model. Add one in Settings, then try again.';
const EMPTY = 'No new version came back. Try again.';

const realFollowUp = (streamChat) => {
  const { FollowUpLLM } = require(path.join(repoRoot, 'dist-electron/electron/llm/FollowUpLLM.js'));
  return new FollowUpLLM({
    getPromptTier: () => 'full',
    fitContextForCurrentModel: (t) => t,
    getAiResponseLanguage: () => 'auto',
    streamChat,
  });
};

async function makeEngine() {
  const { IntelligenceEngine } = await import(pathToFileURL(path.join(repoRoot, 'dist-electron/electron/IntelligenceEngine.js')).href);
  const { SessionTracker } = require(path.join(repoRoot, 'dist-electron/electron/SessionTracker.js'));
  const session = new SessionTracker();
  session.addTranscript({ speaker: 'system', text: 'How would you design the cache for this service?', timestamp: Date.now() - 4000, final: true });
  session.addAssistantMessage('Put a read-through cache in front of the database, keyed by user id.', undefined, 'what_to_answer');
  const engine = new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, session);
  const errors = []; const tokens = []; const finals = [];
  engine.on('error', (error, mode) => errors.push({ message: error.message, mode }));
  engine.on('refined_answer_token', (t) => tokens.push(t));
  engine.on('refined_answer', (t, intent) => finals.push({ text: t, intent }));
  return { engine, errors, tokens, finals };
}

describe('a refinement says why it has nothing, or says nothing', () => {
  test('the provider fails: one error, with its reason, through the real class', async () => {
    const { engine, errors, finals } = await makeEngine();
    engine.followUpLLM = realFollowUp(async function* () { throw new Error('429 Too Many Requests'); });
    assert.equal(await engine.runFollowUp('shorten'), null);
    assert.deepEqual(errors, [{ message: '429 Too Many Requests', mode: 'follow_up' }]);
    assert.deepEqual(finals, []);
  });

  test('the provider fails after the first words: still one error', async () => {
    const { engine, errors, tokens, finals } = await makeEngine();
    engine.followUpLLM = realFollowUp(async function* () { yield 'Use '; throw new Error('socket hang up'); });
    assert.equal(await engine.runFollowUp('shorten'), null);
    assert.deepEqual(tokens, ['Use ']);
    assert.deepEqual(errors, [{ message: 'socket hang up', mode: 'follow_up' }]);
    assert.deepEqual(finals, [], 'half a rewrite is not delivered as the finished one');
  });

  test('the model ends with no words: said, not left blank', async () => {
    const { engine, errors, finals } = await makeEngine();
    engine.followUpLLM = realFollowUp(async function* () { /* nothing */ });
    assert.equal(await engine.runFollowUp('rephrase'), null);
    assert.deepEqual(errors, [{ message: EMPTY, mode: 'follow_up' }]);
    assert.deepEqual(finals, []);
  });

  test('cancelled mid-stream: no error', async () => {
    const { engine, errors, finals } = await makeEngine();
    engine.followUpLLM = realFollowUp(async function* () { yield 'Use '; engine.reset(); yield 'a cache'; });
    await engine.runFollowUp('shorten');
    assert.deepEqual(errors, [], 'the user stopped it: that is not a failure');
    assert.deepEqual(finals, []);
  });

  test('a failure after the press was cancelled is not reported', async () => {
    const { engine, errors } = await makeEngine();
    engine.followUpLLM = realFollowUp(async function* () { engine.reset(); throw new Error('aborted'); });
    assert.equal(await engine.runFollowUp('shorten'), null);
    assert.deepEqual(errors, [], 'the user had already stopped it');
  });

  test('no model is configured: one error that says so', async () => {
    const { engine, errors } = await makeEngine();
    engine.followUpLLM = null;
    assert.equal(await engine.runFollowUp('shorten'), null);
    assert.deepEqual(errors, [{ message: NO_MODEL, mode: 'follow_up' }]);
  });

  test('the sentences the engine writes are shown as written, not as a rejected key', async () => {
    const { chatFailureFromError } = await import(pathToFileURL(path.join(repoRoot, 'src/lib/chatFailure.mjs')).href);
    for (const sentence of [NO_MODEL, EMPTY]) {
      assert.deepEqual(chatFailureFromError(sentence, { provider: 'Google' }), { code: 'CHAT_ERROR', message: sentence });
    }
  });

  test('a rewrite that arrives is delivered as before', async () => {
    const { engine, errors, tokens, finals } = await makeEngine();
    engine.followUpLLM = realFollowUp(async function* () { yield 'Cache reads '; yield 'by user id.'; });
    assert.equal(await engine.runFollowUp('shorten'), 'Cache reads by user id.');
    assert.deepEqual(errors, []);
    assert.deepEqual(tokens, ['Cache reads ', 'by user id.']);
    assert.deepEqual(finals, [{ text: 'Cache reads by user id.', intent: 'shorten' }]);
  });
});

describe('the overlay closes a refinement\'s bubble when nothing came back', () => {
  const src = read('src/components/NativelyInterface.tsx');

  test('nothing came back: the empty bubble goes', () => {
    const at = src.indexOf("const handleFollowUp = async (intent: string = 'rephrase') => {");
    assert.ok(at > 0, 'located handleFollowUp');
    const body = src.slice(at, src.indexOf('const handleRecap', at));
    assert.match(body, /const result = await window\.electronAPI\.generateFollowUp\(intent\);\s*(\/\/[^\n]*\n\s*)*if \(!result\?\.refined\) discardEmptyPlaceholder\(intent\);/);
    assert.match(body, /\} catch \(err\) \{\s*discardEmptyPlaceholder\(intent\);/);
  });

  // The engine's mode is 'follow_up'; the bubble is named for the refinement.
  test('on a failure, words that arrived are kept and closed, and an empty bubble goes', () => {
    assert.match(src, /const refining = streamingIntentRef\.current;\s*if \(data\.mode === 'follow_up' && refining && overlayActionInFlightRef\.current\.has\(`follow_up:\$\{refining\}`\)\) \{\s*flushToken\(\);\s*discardEmptyPlaceholder\(refining\);\s*\}/);
    assert.match(src, /const actionKey = `follow_up:\$\{intent\}`;/, 'the in-flight key the error handler looks for');
  });
});
