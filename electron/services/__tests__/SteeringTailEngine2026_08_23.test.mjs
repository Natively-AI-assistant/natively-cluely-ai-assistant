// electron/services/__tests__/SteeringTailEngine2026_08_23.test.mjs
//
// End-to-end for the steering-tail strip: the REAL engine, the verbatim live
// session-D press-1 reply, the verbatim greeting question. The emitted final
// must lose "Where would you like to start?" and keep the greeting.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
const require = createRequire(import.meta.url);

async function makeEngine(chunks) {
  const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
  const { SessionTracker } = require(sessionPath);
  const session = new SessionTracker();
  const engine = new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, session);
  engine.whatToAnswerLLM = { async *generateStream() { for (const c of chunks) yield c; } };
  return engine;
}

test('the live D press-1 host closer is stripped by the real engine', async () => {
  const engine = await makeEngine([
    'Hey, great to meet you too. Thanks for taking the time to chat today. ',
    'Where would you like to start?',
  ]);
  let final = null;
  engine.on('suggested_answer', (a) => { final = a; });

  await engine.runWhatShouldISay('Hey Even, good to meet you.', 0.9, undefined, { skipCooldown: true });

  assert.ok(final, 'a final answer must be emitted');
  assert.doesNotMatch(final, /Where would you like to start\?/);
  assert.match(final, /great to meet you too/);
});

test('a substantive turn with a trailing question is untouched (gate holds)', async () => {
  const engine = await makeEngine([
    'I would start with the write path, since that is where the contention shows up first. ',
    'Do you want the storage side or the API side first?',
  ]);
  let final = null;
  engine.on('suggested_answer', (a) => { final = a; });

  await engine.runWhatShouldISay('Walk me through the RedisMart architecture end to end.', 0.9, undefined, { skipCooldown: true });

  assert.match(final ?? '', /storage side or the API side/, 'a substantive answer keeps its clarifying question');
});
