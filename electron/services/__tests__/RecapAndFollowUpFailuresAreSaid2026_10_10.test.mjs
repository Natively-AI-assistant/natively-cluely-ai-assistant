// electron/services/__tests__/RecapAndFollowUpFailuresAreSaid2026_10_10.test.mjs
//
// Recap and Follow-up questions swallowed a provider failure the way Clarify
// did (ClarifyCancelledIsNotAFailure2026_10_10). Their stream classes caught
// every error and ended quietly, so a missing key, an empty quota or a dead
// network reached the engine as a stream with no words. The engine returned an
// empty string, said nothing, and the overlay kept the "Thinking..." bubble
// under the Recap or Follow-up label with no reason.
//
// Now, as for Clarify: the class throws the error on, the engine reports it
// with the provider's reason, a stream that ends with no words is reported
// too, and a press that was cancelled or overtaken stays silent. Runs the real
// compiled engine and the real Recap and Follow-up classes. Shared code with no
// platform branch: the same on macOS and Windows.
//
//   npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/RecapAndFollowUpFailuresAreSaid2026_10_10.test.mjs

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

const helper = (streamChat) => ({
  getPromptTier: () => 'full',
  fitContextForCurrentModel: (t) => t,
  getAiResponseLanguage: () => 'auto',
  streamChat,
});

const ACTIONS = [
  {
    name: 'Recap',
    mode: 'recap',
    field: 'recapLLM',
    run: (engine) => engine.runRecap(),
    tokenEvent: 'recap_token',
    finalEvent: 'recap',
    real: (streamChat) => {
      const { RecapLLM } = require(path.join(repoRoot, 'dist-electron/electron/llm/RecapLLM.js'));
      return new RecapLLM(helper(streamChat));
    },
    noModel: 'Recap needs an AI model. Add one in Settings, then try again.',
    empty: 'No recap came back. Try again.',
  },
  {
    name: 'Follow-up questions',
    mode: 'follow_up_questions',
    field: 'followUpQuestionsLLM',
    run: (engine) => engine.runFollowUpQuestions(),
    tokenEvent: 'follow_up_questions_token',
    finalEvent: 'follow_up_questions_update',
    real: (streamChat) => {
      const { FollowUpQuestionsLLM } = require(path.join(repoRoot, 'dist-electron/electron/llm/FollowUpQuestionsLLM.js'));
      return new FollowUpQuestionsLLM(helper(streamChat));
    },
    noModel: 'Follow-up questions need an AI model. Add one in Settings, then try again.',
    empty: 'No questions came back. Try again.',
  },
];

async function makeEngine(action) {
  const { IntelligenceEngine } = await import(pathToFileURL(path.join(repoRoot, 'dist-electron/electron/IntelligenceEngine.js')).href);
  const { SessionTracker } = require(path.join(repoRoot, 'dist-electron/electron/SessionTracker.js'));
  const session = new SessionTracker();
  session.addTranscript({ speaker: 'system', text: 'How would you design the cache for this service?', timestamp: Date.now() - 4000, final: true });
  const engine = new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, session);
  const errors = []; const tokens = []; const finals = [];
  engine.on('error', (error, mode) => errors.push({ message: error.message, mode }));
  engine.on(action.tokenEvent, (t) => tokens.push(t));
  engine.on(action.finalEvent, (t) => finals.push(t));
  return { engine, session, errors, tokens, finals };
}

for (const action of ACTIONS) {
  describe(`${action.name} says why it has nothing, or says nothing`, () => {
    test('the provider fails: one error, with its reason, through the real class', async () => {
      const { engine, errors, finals } = await makeEngine(action);
      engine[action.field] = action.real(async function* () { throw new Error('429 Too Many Requests'); });
      assert.equal(await action.run(engine), null);
      assert.deepEqual(errors, [{ message: '429 Too Many Requests', mode: action.mode }]);
      assert.deepEqual(finals, []);
    });

    test('the provider fails after the first words: still one error', async () => {
      const { engine, errors, tokens, finals } = await makeEngine(action);
      engine[action.field] = action.real(async function* () { yield 'First '; throw new Error('socket hang up'); });
      assert.equal(await action.run(engine), null);
      assert.deepEqual(tokens, ['First ']);
      assert.deepEqual(errors, [{ message: 'socket hang up', mode: action.mode }]);
      assert.deepEqual(finals, [], 'half an answer is not delivered as the finished one');
    });

    test('the model ends with no words: said, not left blank', async () => {
      const { engine, errors, finals } = await makeEngine(action);
      engine[action.field] = action.real(async function* () { /* nothing */ });
      assert.equal(await action.run(engine), null);
      assert.deepEqual(errors, [{ message: action.empty, mode: action.mode }]);
      assert.deepEqual(finals, []);
    });

    test('cancelled mid-stream: no error', async () => {
      const { engine, errors, finals } = await makeEngine(action);
      engine[action.field] = action.real(async function* () { yield 'First '; engine.reset(); yield 'second'; });
      await action.run(engine);
      assert.deepEqual(errors, [], 'the user stopped it: that is not a failure');
      assert.deepEqual(finals, []);
    });

    test('overtaken before the first word: no error', async () => {
      const { engine, errors, tokens } = await makeEngine(action);
      engine[action.field] = action.real(async function* () { engine.reset(); yield 'First'; });
      await action.run(engine);
      assert.deepEqual(errors, []);
      assert.deepEqual(tokens, []);
    });

    // Found in review (Follow-up questions did this; Recap never did).
    test('overtaken by an answer: the mode stays the answer\'s', async () => {
      const { engine } = await makeEngine(action);
      const modes = [];
      engine.on('mode_changed', (m) => modes.push(m));
      engine[action.field] = action.real(async function* () {
        engine.currentGenerationId++; // an answer starts
        engine.setMode('what_to_say');
        yield 'First';
      });
      await action.run(engine);
      assert.equal(engine.getActiveMode(), 'what_to_say');
      assert.deepEqual(modes, [action.mode, 'what_to_say'], 'no idle in between');
    });

    test('a failure after the press was cancelled is not reported', async () => {
      const { engine, errors } = await makeEngine(action);
      engine[action.field] = action.real(async function* () { engine.reset(); throw new Error('aborted'); });
      assert.equal(await action.run(engine), null);
      assert.deepEqual(errors, [], 'the user had already stopped it');
    });

    test('no model is configured: one error that says so', async () => {
      const { engine, errors } = await makeEngine(action);
      engine[action.field] = null;
      assert.equal(await action.run(engine), null);
      assert.deepEqual(errors, [{ message: action.noModel, mode: action.mode }]);
    });

    test('the sentences the engine writes are shown as written, not as a rejected key', async () => {
      const { chatFailureFromError } = await import(pathToFileURL(path.join(repoRoot, 'src/lib/chatFailure.mjs')).href);
      for (const sentence of [action.noModel, action.empty]) {
        assert.deepEqual(chatFailureFromError(sentence, { provider: 'Google' }), { code: 'CHAT_ERROR', message: sentence });
      }
    });

    test('an answer that arrives is delivered as before', async () => {
      const { engine, errors, tokens, finals } = await makeEngine(action);
      engine[action.field] = action.real(async function* () { yield 'First, '; yield 'then second.'; });
      assert.equal(await action.run(engine), 'First, then second.');
      assert.deepEqual(errors, []);
      assert.deepEqual(tokens, ['First, ', 'then second.']);
      assert.deepEqual(finals, ['First, then second.']);
    });
  });
}

describe('nothing to work from is still an answer, not a failure', () => {
  for (const action of ACTIONS) {
    test(`${action.name} with no conversation yet says so in its own bubble`, async () => {
      const { IntelligenceEngine } = await import(pathToFileURL(path.join(repoRoot, 'dist-electron/electron/IntelligenceEngine.js')).href);
      const { SessionTracker } = require(path.join(repoRoot, 'dist-electron/electron/SessionTracker.js'));
      const engine = new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, new SessionTracker());
      const errors = []; const finals = [];
      engine.on('error', (e, mode) => errors.push({ message: e.message, mode }));
      engine.on(action.finalEvent, (t) => finals.push(t));
      engine[action.field] = action.real(async function* () { yield 'unused'; });
      assert.equal(await action.run(engine), null);
      assert.deepEqual(errors, []);
      assert.equal(finals.length, 1, 'the worded line it always gave');
      assert.doesNotMatch(finals[0], /unused/);
    });
  }
});

describe('the overlay takes an empty bubble away when nothing came back', () => {
  const src = read('src/components/NativelyInterface.tsx');
  const bodyOf = (name, next) => {
    const at = src.indexOf(`const ${name} = async () => {`);
    assert.ok(at > 0, `located ${name}`);
    return src.slice(at, src.indexOf(`const ${next}`, at));
  };

  test('Recap', () => {
    const body = bodyOf('handleRecap', 'handleFollowUpQuestions');
    assert.match(body, /const result = await window\.electronAPI\.generateRecap\(\);\s*(\/\/[^\n]*\n\s*)*if \(!result\?\.summary\) discardEmptyPlaceholder\('recap'\);/);
  });

  test('Follow-up questions', () => {
    const body = bodyOf('handleFollowUpQuestions', 'handleClarify');
    assert.match(body, /const result = await window\.electronAPI\.generateFollowUpQuestions\(\);\s*(\/\/[^\n]*\n\s*)*if \(!result\?\.questions\) discardEmptyPlaceholder\('follow_up_questions'\);/);
  });

  // Found in review: a stream that failed after its first words left them in
  // an open row (text on screen, not in the list) that nothing closed.
  test('on a failure, words that arrived are kept and closed, and an empty bubble goes', () => {
    assert.match(src, /if \(data\.mode === 'clarify' \|\| data\.mode === 'recap' \|\| data\.mode === 'follow_up_questions'\) \{\s*(\/\/[^\n]*\n\s*)*if \(streamingIntentRef\.current === data\.mode\) flushToken\(\);\s*discardEmptyPlaceholder\(data\.mode\);/);
  });

  test('a flush closes a row that has words and leaves an empty placeholder alone', async () => {
    const { commitStreamingFlush } = await import(pathToFileURL(path.join(repoRoot, 'src/lib/streamingTokenQueue.mjs')).href);
    const rows = [{ id: 'r1', role: 'system', text: '', intent: 'recap', isStreaming: true }];
    assert.deepEqual(commitStreamingFlush(rows, 'r1', 'First '), [{ id: 'r1', role: 'system', text: 'First ', intent: 'recap', isStreaming: false }]);
    const at = src.indexOf('const flushToken = useCallback(() => {');
    const body = src.slice(at, src.indexOf('}, []);', at));
    assert.match(body, /if \(!text\) \{\s*return;\s*\}/, 'no words yet: the placeholder is left for discardEmptyPlaceholder');
    assert.match(body, /setMessages\(\(prev\) => commitStreamingFlush\(prev, msgId, withDiagramRepairs\(text\)\)\);/);
  });

  // Found in review: main sent the failure ahead of the words still waiting in
  // its token batch, so they opened a new row under the failure line.
  test('main sends the words that came before a failure first', () => {
    const main = read('electron/main.ts');
    assert.match(main, /this\.intelligenceManager\.on\('error', \(error: Error, mode: string\) => \{[\s\S]{0,420}flushBatchesBeforeFinal\(\)\s*const win = answerWindow\(\)\s*this\.sendToWindow\(win, 'intelligence-error'/);
  });
});
