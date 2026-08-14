import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
const require = createRequire(import.meta.url);

function makeHelper() {
  return {
    setNegotiationCoachingHandler() {},
  };
}

async function makeEngine() {
  const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
  const { SessionTracker } = require(sessionPath);
  const session = new SessionTracker();
  const engine = new IntelligenceEngine(makeHelper(), session);
  return { engine, session };
}

test('runCodeHint returns stream on supersession and does not emit stale final result', async () => {
  const { engine, session } = await makeEngine();
  let returned = false;

  engine.codeHintLLM = {
    generateStream() {
      return {
        async *[Symbol.asyncIterator]() {
          yield 'partial hint';
          engine.currentGenerationId += 1;
          yield 'stale hint';
        },
        async return() {
          returned = true;
          return { done: true };
        },
      };
    },
  };

  const tokens = [];
  const finals = [];
  engine.on('suggested_answer_token', token => tokens.push(token));
  engine.on('suggested_answer', answer => finals.push(answer));

  const result = await engine.runCodeHint(['screenshot.png'], 'fix this code');

  assert.equal(result, null);
  assert.equal(returned, true);
  assert.deepEqual(tokens, ['partial hint']);
  assert.deepEqual(finals, []);
  assert.deepEqual(session.getFullUsage(), []);
  assert.equal(session.getFullTranscript().some(segment => segment.text.includes('partial hint')), false);
});
