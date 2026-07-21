// electron/services/__tests__/WhatToAnswerSnapshotWiring.test.mjs
//
// Structural regression guards for audit findings #6 + #3 + #9 in the live
// what-to-answer path. The wiring lives inside IntelligenceEngine.runWhatShouldISay
// / WhatToAnswerLLM.generateStream / main.ts — classes that can't be cheaply
// instantiated in a unit test — so we assert the load-bearing shape so a refactor
// can't silently revert it. Behavioral coverage of the pure pieces lives in:
//   - electron/llm/__tests__/WhatToAnswerRequestSnapshot.test.mjs  (snapshot + batch reducer)
//   - electron/services/__tests__/ChatStreamGuard.test.mjs         (renderer reducer)
//   - electron/services/__tests__/ModePinnedResolution.test.mjs    (mode pin)
//   - electron/services/__tests__/IntelligenceTraceCorrelation.test.mjs (#9 setCorrelation)
//
// Pure source-assertion — runs under plain `node --test`.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

describe('#6 — runWhatShouldISay captures ONE mode snapshot at t0 and threads it', () => {
  const src = read('../../IntelligenceEngine.ts');
  // Isolate the method body so assertions can't accidentally match another method.
  const start = src.indexOf('async runWhatShouldISay(');
  const end = src.indexOf('async runFollowUp', start) >= 0
    ? src.indexOf('async runFollowUp', start)
    : src.indexOf('private getActiveModeId', start);
  assert.ok(start >= 0 && end > start, 'runWhatShouldISay must be isolatable');
  const body = src.slice(start, end);

  test('the mode is captured exactly ONCE into snapshot locals near t0', () => {
    assert.match(body, /const snapshotModeInfo = this\.getActiveModeInfo\(\)/, 'must snapshot mode info at t0');
    assert.match(body, /const snapshotModeId = this\.getActiveModeId\(\)/, 'must snapshot mode template id at t0');
  });

  test('the per-request planAnswer calls read the SNAPSHOT, not a fresh live query', () => {
    // The two planAnswer calls inside runWhatShouldISay (follow-up memory mode +
    // main answer plan) must use snapshotModeInfo. A fresh this.getActiveModeInfo()
    // inside a planAnswer({...}) call here would re-introduce the race.
    assert.match(body, /activeMode: snapshotModeInfo/, 'planAnswer must read the snapshot mode');
    // There must be NO remaining inline getActiveModeInfo() feeding a planAnswer in
    // this method (the snapshot replaced both).
    assert.doesNotMatch(body, /activeMode: this\.getActiveModeInfo\(\)/,
      'no planAnswer in runWhatShouldISay may re-read the live mode');
  });

  test('session-memory routing reads the snapshot template id, not a fresh live read', () => {
    assert.match(body, /const modeId = snapshotModeId/, 'session-memory modeId must come from the snapshot');
    assert.doesNotMatch(body, /const modeId = this\.getActiveModeId\(\)/,
      'session-memory routing must not re-read the live mode mid-request');
  });

  test('an immutable request snapshot is built and passed into generateStream', () => {
    assert.match(body, /const requestSnapshot: WhatToAnswerRequestSnapshot = Object\.freeze\(/,
      'a frozen request snapshot must be assembled');
    assert.match(body, /generateStream\([^;]*,\s*modeContextPromise,\s*requestSnapshot\)/,
      'the snapshot must be threaded into WhatToAnswerLLM.generateStream');
  });

  test('the parallel mode-context prefetch is pinned to the t0 mode id', () => {
    assert.match(body, /buildRetrievedActiveModeContextBlockHybrid\(\s*preparedTranscript, preparedTranscript, 1800, undefined, true, snapshotModeInfo\?\.id,/,
      'the prefetched retrieval must pin the snapshot mode id');
  });
});

describe('#9 — the live IntelligenceTrace is correlated with the latency trace', () => {
  const src = read('../../IntelligenceEngine.ts');
  const start = src.indexOf('async runWhatShouldISay(');
  const end = src.indexOf('async runFollowUp', start);
  const body = src.slice(start, end > start ? end : start + 30000);

  test('wtaTrace.setCorrelation is called with the shared requestId + ids only', () => {
    assert.match(body, /wtaTrace\.setCorrelation\(\{/, 'the engine trace must be correlated');
    assert.match(body, /requestId: trace\.requestId/, 'must share the PiLatencyTrace requestId');
    assert.match(body, /surface: 'what_to_answer'/, 'must mark the surface');
    assert.match(body, /modeId: snapshotModeId/, 'must carry the mode marker');
    assert.match(body, /meetingId: meetingMarker/, 'must carry the meeting marker');
  });
});

describe('#3 — live tokens carry the generationId end-to-end', () => {
  test('engine stamps generationId on the live suggested_answer_token emits', () => {
    const src = read('../../IntelligenceEngine.ts');
    const start = src.indexOf('async runWhatShouldISay(');
    const end = src.indexOf('async runFollowUp', start);
    const body = src.slice(start, end > start ? end : start + 30000);
    // The streaming emitChunk + the finalization flush emits must pass generationId.
    const emits = body.match(/this\.emit\('suggested_answer_token', [^)]*confidence, generationId\)/g) || [];
    assert.ok(emits.length >= 3, `at least the stream + 2 flush emits must carry generationId (found ${emits.length})`);
  });

  test('main forwards generationId per item on the token batch', () => {
    const src = read('../../main.ts');
    assert.match(src, /on\('suggested_answer_token', \(token: string, question: string, confidence: number, generationId\?: number\)/,
      'the main listener must accept generationId');
    assert.match(src, /queueBatch\('suggested_answer', \{ token, question, confidence, generationId \}\)/,
      'the batch item must carry generationId');
  });

  test('renderer drops superseded live batches via resolveLiveAnswerBatch', () => {
    const src = read('../../../src/components/NativelyInterface.tsx');
    assert.match(src, /resolveLiveAnswerBatch/, 'renderer must use the live-answer batch guard');
    assert.match(src, /liveAnswerGenIdRef/, 'renderer must track an active live-answer generation id');
    assert.match(src, /\(it as any\)\.generationId/, 'the guard must read the per-item generationId');
  });
});
